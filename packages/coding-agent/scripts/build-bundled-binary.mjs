#!/usr/bin/env node
// Build a pi binary with selected extensions compiled INTO it (no sidecar, no
// jiti for those extensions). Hybrid: extensions not bundled still load via
// jiti at runtime exactly as before.
//
// Mechanism (Option E, robust variant for this repo's Node16 ESM tsconfig):
//   - bundled-extensions.ts (committed, empty) is always compiled by tsgo, so
//     the loader's import resolves cleanly in normal AND bundled builds.
//   - This script generates bundled-extensions.gen.ts (one static import per
//     extension) and EXCLUDES it from tsgo (see tsconfig.build.bundled.json),
//     then compiles JUST that file with Bun into dist/.../bundled-extensions.js,
//     overwriting tsgo's empty emit. Bun follows the external .ts imports and
//     embeds each extension's full graph.
//   - bun build --compile then bundles the real registry into the binary.
//
// Usage:
//   node scripts/build-bundled-binary.mjs [--agent-dir <dir>] [--compile] [--discover <ext-dir>]... [ext-entry.ts ...]
//
// The final `bun build --compile` only runs with --compile (it is heavy and
// produces the shippable binary). Without it, the script stops after writing
// the Bun-compiled dist/.../bundled-extensions.js so you can inspect it.
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const pkgRoot = path.resolve(scriptDir, "..");
const genTs = path.join(pkgRoot, "src/core/extensions/bundled-extensions.gen.ts");
const tempTsconfig = path.join(pkgRoot, "tsconfig.build.bundled.json");

function parseArgs(argv) {
	const args = { agentDir: null, compile: false, discover: [], exts: [] };
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a === "--agent-dir") args.agentDir = argv[++i];
		else if (a === "--compile") args.compile = true;
		else if (a === "--discover") args.discover.push(path.resolve(argv[++i]));
		else if (a === "--help" || a === "-h") {
			console.log("Usage: build-bundled-binary.mjs [--agent-dir <dir>] [--compile] [--discover <ext-dir>]... [ext-entry.ts ...]");
			process.exit(0);
		} else if (a.startsWith("--")) {
			console.error(`Unknown option: ${a}`);
			process.exit(1);
		} else {
			args.exts.push(path.resolve(a));
		}
	}
	if (!args.agentDir) {
		let configDir = ".pi";
		try {
			const pkg = JSON.parse(existsSync(path.join(pkgRoot, "package.json")) ? "" : "{}");
			configDir = pkg?.piConfig?.configDir || ".pi";
		} catch {
			/* default .pi */
		}
		args.agentDir = path.join(os.homedir(), configDir, "agent");
	}
	return args;
}

function run(cmd, step) {
	const binPath = path.resolve(pkgRoot, "../../node_modules/.bin");
	console.log(`\n== ${step} ==\n$ ${cmd}`);
	execSync(cmd, { cwd: pkgRoot, stdio: "inherit", env: { ...process.env, PATH: `${binPath}:${process.env.PATH}` } });
}

const args = parseArgs(process.argv.slice(2));

// Write the single-pass registry shim into dist so `bun build --compile` (step
// 5) bundles the extension graph — including native `.node` addons — in ONE
// pass, AND so the discovery `pi list` run (step 1) never crashes on a
// missing/stale generated source (see the resilient try/catch below). Called
// here (before gen) and again after tsgo emits its empty default (step 4).
function writeRegistryShim() {
	const registryOutdir = path.join(pkgRoot, "dist", "core", "extensions");
	mkdirSync(registryOutdir, { recursive: true });
	const shimPath = path.join(registryOutdir, "bundled-extensions.js");
	const relGen = path.relative(registryOutdir, genTs).split(path.sep).join("/");
	// Resilient re-export: `bun build --compile` still inlines the string-literal
	// dynamic import of the generated source (verified), bundling the full
	// extension graph — including native `.node` addons — in ONE pass. The
	// try/catch is essential: the discovery step (`pi list`, run by
	// gen-bundled-extensions.mjs) loads THIS shim via the local package, and at
	// that point the generated source may not yet exist (it is written by that
	// very step, then removed in the build's `finally`). Without the guard the
	// host `pi list` process crashes with ERR_MODULE_NOT_FOUND and the registry
	// ends up empty.
	writeFileSync(
		shimPath,
		`// AUTO-GENERATED shim. Re-exports the generated registry source so\n` +
			"// `bun build --compile` bundles the extension graph (native addons included)\n" +
			"// in a single pass. Resilient to a missing/stale generated source so a\n" +
			"// discovery `pi list` run before regeneration does not crash the host. See\n" +
			"// scripts/build-bundled-binary.mjs.\n" +
			`let BUNDLED_EXTENSIONS = {};\n` +
			`try {\n` +
			`  ({ BUNDLED_EXTENSIONS } = await import(${JSON.stringify(relGen)}));\n` +
			`} catch {}\n` +
			`export { BUNDLED_EXTENSIONS };\n`,
		"utf-8",
	);
}

try {
	// 0. Ensure a resilient registry shim exists in dist BEFORE discovery, so
	// the gen step's `pi list` can load the local package without crashing on a
	// missing generated source (the shim falls back to an empty registry).
	writeRegistryShim();

	// 1. Generate the Bun-compiled registry source (excluded from tsgo).
	const genArgs = ["node", path.join(scriptDir, "gen-bundled-extensions.mjs"), "--agent-dir", args.agentDir, "--out", genTs];
	for (const d of args.discover) genArgs.push("--discover", d);
	genArgs.push(...args.exts);
	run(genArgs.join(" "), "Generate bundled-extensions.gen.ts");

	// 2. Temp tsconfig that excludes the generated file from tsgo.
	writeFileSync(
		tempTsconfig,
		JSON.stringify(
			{
				extends: "./tsconfig.build.json",
				exclude: ["node_modules", "dist", "src/core/extensions/bundled-extensions.gen.ts"],
			},
			null,
			2,
		) + "\n",
		"utf-8",
	);

	// 3. Build sibling packages + this package with tsgo (gen file excluded).
	run("npm --prefix ../tui run build", "Build @earendil-works/pi-tui");
	run("npm --prefix ../ai run build", "Build @earendil-works/pi-ai");
	run("npm --prefix ../agent run build", "Build @earendil-works/pi-agent-core");
	run("tsgo -p tsconfig.build.bundled.json", "tsgo build (coding-agent, gen excluded)");
	run("shx chmod +x dist/cli.js dist/rpc-entry.js", "chmod entrypoints");
	run("npm run copy-assets", "Copy non-code assets");

	// 4. Re-wire the registry shim. Step 3's tsgo overwrote the shim (written
	// in step 0) with its empty default emit, so rewrite it here so the final
	// `bun build --compile` (step 5) embeds the extension graph — including any
	// native `.node` addons — in ONE pass at the correct virtual path.
	// Pre-bundling the registry with `bun build` (double-bundle) mis-roots the
	// native assets and breaks at runtime ("Cannot find module './ffi-rs...node'").
	writeRegistryShim();

	if (!args.compile) {
		console.log("\n--compile not set: stopping before `bun build --compile`.");
		console.log(`Inspect the generated registry source at ${genTs}`);
		process.exit(0);
	}

	// 5. Compile the full binary (mirrors the build:binary script).
	run(
		"bun build --compile ./dist/bun/cli.js ./src/utils/image-resize-worker.ts --outfile dist/pi",
		"bun build --compile -> dist/pi",
	);
	run("npm run copy-binary-assets", "Copy binary assets");
	console.log("\nBundled binary written to dist/pi");
} finally {
	// 6. Restore committed state: remove the generated file and temp tsconfig.
	for (const f of [genTs, tempTsconfig]) {
		if (existsSync(f)) rmSync(f, { force: true });
	}
}
