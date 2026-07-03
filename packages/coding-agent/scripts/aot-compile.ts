#!/usr/bin/env node
import { build } from "esbuild";
import * as fs from "node:fs";
import * as path from "node:path";
import { join } from "node:path";

// Dependencies to keep external (shared across extensions)
const EXTERNAL_DEPS = [
    "@earendil-works/*",
    "@mariozechner/*",
    "typebox",
    "typebox/*",
    "@sinclair/typebox",
];

async function compileExtension(entryPoint: string): Promise<number> {
    console.log(`[AOT] Compiling entry point: ${entryPoint}`);
    const startTime = performance.now();
    
    // Find package root (where package.json is)
    let packageRoot = path.dirname(entryPoint);
    let found = false;
    while (packageRoot !== path.parse(packageRoot).root) {
        if (fs.existsSync(join(packageRoot, "package.json"))) {
            found = true;
            break;
        }
        packageRoot = path.dirname(packageRoot);
    }
    
    if (!found) {
        packageRoot = path.dirname(entryPoint);
    }
    
    const outDir = join(packageRoot, "build");
    const outFile = join(outDir, path.basename(entryPoint).replace(/\.ts$/, ".js"));

    fs.mkdirSync(outDir, { recursive: true });

    console.log(`[AOT] Writing output to: ${outFile}`);
    try {
        await build({
            entryPoints: [entryPoint],
            outfile: outFile,
            bundle: true,
            platform: "node",
            format: "esm",
            external: EXTERNAL_DEPS,
            target: "node22",
            minify: false,
            sourcemap: false,
        });
    } catch (err) {
        console.error(`[AOT] Build failed for ${entryPoint}:`, err);
        throw err;
    }

    const elapsed = performance.now() - startTime;
    console.log(`[AOT] Compiled ${path.basename(entryPoint)} in ${elapsed.toFixed(0)}ms`);
    return elapsed;
}

// CLI entry point
const entryPoint = process.argv[2];
if (entryPoint) {
    compileExtension(entryPoint).catch((err) => {
        console.error(err);
        process.exit(1);
    });
} else {
    console.error("Usage: node aot-compile.js <entry-point>");
    process.exit(1);
}
