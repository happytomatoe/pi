#!/usr/bin/env node
// Generate bundled-extensions.gen.ts: one static import per extension so the
// Bun compiler embeds each extension's whole module graph into the binary.
//
// The generated file is EXCLUDED from tsgo (see tsconfig.build.bundled.json) and
// compiled separately by Bun into dist/.../bundled-extensions.js, which
// overwrites the empty default tsgo emits from bundled-extensions.ts.
//
// Extension selection is driven by `pi list` (the same source of truth pi
// itself uses): an extension reported as `(filtered)` is DISABLED and skipped.
// Only ENABLED, installed extensions are bundled. File-based extensions not
// managed by `pi install` are intentionally excluded.
//
// Usage:
//   node scripts/gen-bundled-extensions.mjs --agent-dir <dir> [--pi-bin <pi>]
//   node scripts/gen-bundled-extensions.mjs --agent-dir <dir> --discover <ext-dir> [--discover <ext-dir> ...]
//   node scripts/gen-bundled-extensions.mjs --agent-dir <dir> <ext-entry.ts> [...]
//
// `--discover` / explicit entry paths are ADDITIVE (bundled in addition to the
// enabled `pi list` set). The `--pi-bin` flag (default: env PI_BIN or `pi`)
// selects which `pi` is queried. `--stage-dir <dir>` overrides the staging
// area; by default extensions are copied to <pkg>/.bundle-stage and `bun
// install` runs there so peer deps resolve without mutating the user's install.
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync, cpSync, mkdirSync } from "node:fs";
import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const defaultOut = path.resolve(scriptDir, "../src/core/extensions/bundled-extensions.gen.ts");

function parseArgs(argv) {
	const args = { agentDir: null, out: defaultOut, discover: [], exts: [], piBin: process.env.PI_BIN || "pi", stageDir: null };
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a === "--agent-dir") args.agentDir = argv[++i];
		else if (a === "--out") args.out = path.resolve(argv[++i]);
		else if (a === "--discover") args.discover.push(path.resolve(argv[++i]));
		else if (a === "--pi-bin") args.piBin = argv[++i];
		else if (a === "--stage-dir") args.stageDir = path.resolve(argv[++i]);
		else if (a === "--help" || a === "-h") {
			console.log("Usage: gen-bundled-extensions.mjs --agent-dir <dir> [--pi-bin <pi>] [--stage-dir <dir>] [--discover <ext-dir>]... [ext-entry.ts ...]");
			process.exit(0);
		} else if (a.startsWith("--")) {
			console.error(`Unknown option: ${a}`);
			process.exit(1);
		} else {
			args.exts.push(path.resolve(a));
		}
	}
	if (!args.agentDir) {
		console.error("Missing required --agent-dir <dir>");
		process.exit(1);
	}
	return args;
}

function isExtensionFile(name) {
	return name.endsWith(".ts") || name.endsWith(".js");
}

function readPiManifest(packageJsonPath) {
	try {
		const pkg = JSON.parse(readFileSync(packageJsonPath, "utf-8"));
		if (pkg && pkg.pi && Array.isArray(pkg.pi.extensions)) return pkg.pi.extensions;
	} catch {
		/* ignore */
	}
	return null;
}

function resolveExtensionEntries(dir) {
	const packageJsonPath = path.join(dir, "package.json");
	if (existsSync(packageJsonPath)) {
		const manifest = readPiManifest(packageJsonPath);
		if (manifest?.length) {
			const entries = [];
			for (const extPath of manifest) {
				const resolved = path.resolve(dir, extPath);
				if (existsSync(resolved)) entries.push(resolved);
			}
			if (entries.length) return entries;
		}
	}
	const indexTs = path.join(dir, "index.ts");
	const indexJs = path.join(dir, "index.js");
	if (existsSync(indexTs)) return [indexTs];
	if (existsSync(indexJs)) return [indexJs];
	return null;
}

function discoverInDir(dir) {
	if (!existsSync(dir)) return [];
	const found = [];
	let entries;
	try {
		entries = readdirSync(dir, { withFileTypes: true });
	} catch {
		return [];
	}
	for (const entry of entries) {
		const entryPath = path.join(dir, entry.name);
		if ((entry.isFile() || entry.isSymbolicLink()) && isExtensionFile(entry.name)) {
			found.push(entryPath);
		} else if (entry.isDirectory() || entry.isSymbolicLink()) {
			const sub = resolveExtensionEntries(entryPath);
			if (sub) found.push(...sub);
		}
	}
	return found;
}

function runPiList(piBin, cwd) {
	try {
		console.log(`\n== Reading enabled extensions from \`${piBin} list\` ==`);
		return execSync(`${piBin} list`, { cwd, encoding: "utf-8" });
	} catch (e) {
		console.warn(`[warn] \`${piBin} list\` failed (${e.message}); bundling nothing from pi list.`);
		return "";
	}
}

// Parse `pi list` text output. Format (note the indent levels):
//   <source>            e.g. npm:name / git:repo / ../../rel/path
//     <install-dir>     abs or rel path, indented one level deeper
// A `<source>` suffixed with ` (filtered)` is DISABLED and skipped.
function parsePiList(text, baseDir) {
	const lines = text.split("\n");
	const dirs = [];
	let i = 0;
	while (i < lines.length) {
		const line = lines[i];
		const header = /^  (\S.*?)(?: \(filtered\))?$/.exec(line);
		if (header && !line.includes("(filtered)")) {
			const next = lines[i + 1];
			const pathLine = next && /^    (\S+)$/.exec(next);
			if (pathLine) {
				dirs.push(path.resolve(baseDir, pathLine[1]));
				i += 2;
				continue;
			}
		}
		i += 1;
	}
	return dirs;
}

const args = parseArgs(process.argv.slice(2));

// Repo root is three levels up from this script (packages/coding-agent/scripts).
// `pi list` is run from here so its relative paths/args resolve correctly.
const repoRoot = path.resolve(scriptDir, "..", "..", "..");

// Bundled extension pairs: `importAbs` is the path the generated file
// imports (a STAGED, dependency-complete copy so `bun build` can resolve
// everything); `keyAbs` is the extension's REAL install path, used as the
// registry key so the runtime loader's short-circuit still matches what pi
// discovers on disk. For non-staged extensions the two are identical.
let pairs = [];

// Stage an installed extension into the staging area: copy it (preserving its
// existing node_modules) and run `bun install` there so peer deps that were
// never placed in the original install dir get resolved. Returns the staged
// dir. The staging area is created lazily and owned by the build script,
// which removes it only after `bun build` has consumed the staged files.
let _stageDir = null;
function ensureStageDir() {
	if (_stageDir) return _stageDir;
	_stageDir = args.stageDir || path.resolve(scriptDir, "..", ".bundle-stage");
	mkdirSync(_stageDir, { recursive: true });
	console.log(`\n== Staging extensions in ${_stageDir} ==`);
	return _stageDir;
}
function hashName(s) {
	return createHash("sha1").update(s).digest("hex").slice(0, 12);
}
function stageExtension(dir) {
	const stageDir = ensureStageDir();
	const dest = path.join(stageDir, hashName(dir));
	console.log(`  staging ${dir}`);
	// Skip VCS dirs (.git, .hg, .svn) and any nested repo metadata: git-sourced
	// extensions ship read-only pack files under .git/objects/pack that trigger
	// EACCES during copy and are useless inside the staging area anyway.
	const vcsSeg = new Set([".git", ".hg", ".svn"]);
	cpSync(dir, dest, { recursive: true, filter: (src) => !src.split(path.sep).some((s) => vcsSeg.has(s)) });
	console.log(`    -> ${dest}`);
	try {
		console.log(`    bun install (resolving peer deps)`);
		execSync("bun install", { cwd: dest, stdio: "inherit", env: process.env });
	} catch (e) {
		console.warn(`[warn] bun install failed in ${dest}: ${e.message}`);
	}
	return dest;
}

// Resolve an extension dir to (stagedImportAbs, realKeyAbs) pairs, one per
// entry file, matched by path relative to the extension dir so readdir
// ordering can't desync them. `resolver` is resolveExtensionEntries for
// installed packages (manifest/index) or discoverInDir for raw --discover dirs.
function addExtensionDir(dir, { stage, resolver }) {
	const realEntries = resolver(dir);
	if (!realEntries || realEntries.length === 0) return;
	let importDir = dir;
	if (stage) importDir = stageExtension(dir);
	const stagedEntries = resolver(importDir);
	if (!stagedEntries || stagedEntries.length === 0) return;
	const byRel = new Map(stagedEntries.map((s) => [path.relative(importDir, s), s]));
	for (const r of realEntries) {
		const s = byRel.get(path.relative(dir, r));
		if (s) pairs.push({ importAbs: s, keyAbs: r });
	}
}

// Default selection: ONLY enabled extensions reported by `pi list`.
// `(filtered)` marks a disabled extension and is skipped. Each is staged so
// its peer deps resolve. `--discover` dirs and explicit entry paths are
// ADDED on top and bundled directly (no staging).
if (args.exts.length === 0 && args.discover.length === 0) {
	const piList = runPiList(args.piBin, repoRoot);
	const installDirs = parsePiList(piList, repoRoot);
	for (const dir of installDirs) addExtensionDir(dir, { stage: true, resolver: resolveExtensionEntries });
}
for (const d of args.discover) addExtensionDir(d, { stage: false, resolver: discoverInDir });
for (const e of args.exts) pairs.push({ importAbs: e, keyAbs: e });

pairs = pairs.filter((p) => existsSync(p.importAbs) && statSync(p.importAbs).isFile());

if (pairs.length === 0) {
	console.warn("No ENABLED extension entry files found to bundle; embedding an empty registry.");
}

const imports = pairs
	.map((p, i) => `import _ext${i} from ${JSON.stringify(p.importAbs)};`)
	.join("\n");

const mapLines = pairs
	.map((p, i) => {
		const key = path.relative(args.agentDir, p.keyAbs).split(path.sep).join("/");
		return `\t${JSON.stringify(key)}: _ext${i} as unknown as ExtensionFactory,`;
	})
	.join("\n");

const out = `// AUTO-GENERATED by scripts/gen-bundled-extensions.mjs. Do not edit by hand.
// Static imports let the Bun compiler embed each extension's full module graph
// into the binary. Keyed by path relative to the agent dir (portable).
import type { ExtensionFactory } from "./types.ts";

${imports}

export const BUNDLED_EXTENSIONS: Record<string, ExtensionFactory> = {
${mapLines}
};
`;

writeFileSync(args.out, out, "utf-8");
if (pairs.length > 0) {
	console.log(`Wrote ${args.out} with ${pairs.length} bundled extension(s):`);
	for (const p of pairs) console.log(`  ${path.relative(args.agentDir, p.keyAbs).split(path.sep).join("/")}`);
}
