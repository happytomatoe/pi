import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { loadExtensionModule } from "../src/core/extensions/loader.ts";
import { rebuildExtensions } from "../src/core/extensions/rebuild.ts";
import { SettingsManager } from "../src/core/settings-manager.ts";

describe("AOT Compilation", () => {
	const tempDir = join(tmpdir(), `pi-aot-test-${Date.now()}`);

	afterAll(() => {
		if (existsSync(tempDir)) {
			rmSync(tempDir, { recursive: true, force: true });
		}
	});

	it("compiles .ts extension to .js", async () => {
		const extDir = join(tempDir, "my-extension");
		mkdirSync(extDir, { recursive: true });
		const entryPath = join(extDir, "index.ts");
		writeFileSync(entryPath, "export default async function(pi: any) { console.log('hello'); }");

		const settingsManager = SettingsManager.create(tempDir, tempDir);
		// Add package to settings so rebuildExtensions finds it
		settingsManager.setPackages([{ source: "local:my-extension" }]);

		// Use the real package manager's resolve logic via rebuildExtensions
		// But wait, rebuildExtensions uses listConfiguredPackages().
		// We need to make sure the package is actually "installed" at the path.

		// Instead of relying on a complex setup, let's just mock the package manager or
		// manually create the structure.

		// Actually, rebuildExtensions calls packageManager.listConfiguredPackages()
		// which uses getInstalledPath().
		// Let's just use the real rebuildExtensions and set up the environment.

		// For this test to work, the package must be recognized as installed.
		// Let's manually create the "installed" directory.
		const installedPath = join(tempDir, "npm", "node_modules", "my-extension");
		mkdirSync(installedPath, { recursive: true });
		writeFileSync(
			join(installedPath, "index.ts"),
			"export default async function(pi: any) { console.log('hello'); }",
		);

		settingsManager.setPackages([{ source: "npm:my-extension" }]);

		await rebuildExtensions(settingsManager, tempDir, tempDir);

		const buildPath = join(installedPath, "..", "build", "index.js");
		expect(existsSync(buildPath)).toBe(true);

		const content = readFileSync(buildPath, "utf-8");
		expect(content).toContain(`console.log("hello")`);
	});

	it("loads AOT compiled .js extension via native import", async () => {
		const installedPath = join(tempDir, "npm", "node_modules", "my-extension-2");
		mkdirSync(installedPath, { recursive: true });
		const entryPath = join(installedPath, "index.ts");
		writeFileSync(entryPath, "export default async function(pi: any) { return 'loaded'; }");

		const settingsManager = SettingsManager.create(tempDir, tempDir);
		settingsManager.setPackages([{ source: "npm:my-extension-2" }]);

		await rebuildExtensions(settingsManager, tempDir, tempDir);

		const factory = await loadExtensionModule(entryPath);
		expect(typeof factory).toBe("function");
	});

	it("falls back to jiti for .ts extensions without build", async () => {
		const installedPath = join(tempDir, "npm", "node_modules", "my-extension-3");
		mkdirSync(installedPath, { recursive: true });
		const entryPath = join(installedPath, "index.ts");
		writeFileSync(entryPath, "export default async function(pi: any) { return 'jiti'; }");

		// No rebuild call here
		const factory = await loadExtensionModule(entryPath);
		expect(typeof factory).toBe("function");
	});
});
