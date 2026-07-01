import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnProcess, waitForChildProcess } from "../../utils/child-process.ts";
import { DefaultPackageManager } from "../package-manager.ts";
import type { SettingsManager } from "../settings-manager.ts";
import { resolveExtensionEntries } from "./loader.ts";

export async function rebuildExtensions(
	settingsManager: SettingsManager,
	cwd: string,
	agentDir: string,
): Promise<void> {
	const packageManager = new DefaultPackageManager({
		cwd,
		agentDir,
		settingsManager,
	});
	const configuredPackages = packageManager.listConfiguredPackages();

	let compiled = 0;
	let failed = 0;

	const __dirname = dirname(fileURLToPath(import.meta.url));
	const scriptPath = join(__dirname, "..", "..", "..", "scripts", "aot-compile.ts");

	for (const pkg of configuredPackages) {
		const installedPath = pkg.installedPath;
		if (!installedPath) continue;

		const entries = resolveExtensionEntries(installedPath);
		if (!entries) continue;

		for (const entry of entries) {
			if (entry.endsWith(".ts")) {
				try {
					const child = spawnProcess("npx", ["tsx", scriptPath, entry], { stdio: "inherit" });
					const exitCode = await waitForChildProcess(child);
					if (exitCode !== 0) {
						throw new Error(`Compilation exited with code ${exitCode}`);
					}
					compiled++;
				} catch (err) {
					console.error(`Failed to compile ${pkg.source} (${entry}): ${err}`);
					failed++;
				}
			}
		}
	}

	console.log(`[AOT] Compiled ${compiled} extensions, ${failed} failed`);
}
