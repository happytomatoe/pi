import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { loadExtensions } from "../src/core/extensions/loader.ts";
import { DefaultPackageManager } from "../src/core/package-manager.ts";
import { SettingsManager } from "../src/core/settings-manager.ts";

describe("AOT Integration Tests", () => {
	const tempDir = join(tmpdir(), `pi-aot-integration-${Date.now()}`);

	afterAll(() => {
		if (existsSync(tempDir)) {
			rmSync(tempDir, { recursive: true, force: true });
		}
	});

	it("should create .js file when installing a TS extension", async () => {
		const extDir = join(tempDir, "my-ext");
		mkdirSync(extDir, { recursive: true });
		const entryPath = join(extDir, "index.ts");
		writeFileSync(entryPath, "export default async function(pi: any) { console.log('hello'); }");

		const settingsManager = SettingsManager.create(tempDir, tempDir);
		const packageManager = new DefaultPackageManager({
			cwd: tempDir,
			agentDir: tempDir,
			settingsManager,
		});

		await packageManager.install(extDir);

		const buildPath = join(extDir, "build", "index.js");
		expect(existsSync(buildPath)).toBe(true);
	});

	it("should load the compiled .js extension and execute its factory", async () => {
		const extDir = join(tempDir, "my-ext-load");
		mkdirSync(extDir, { recursive: true });
		const entryPath = join(extDir, "index.ts");
		writeFileSync(
			entryPath,
			"export default async function(pi: any) { pi.registerCommand('test-cmd', { handler: async () => 'ok' }); }",
		);

		const settingsManager = SettingsManager.create(tempDir, tempDir);
		const packageManager = new DefaultPackageManager({
			cwd: tempDir,
			agentDir: tempDir,
			settingsManager,
		});

		await packageManager.install(extDir);

		const { extensions } = await loadExtensions([entryPath], tempDir);
		expect(extensions.length).toBe(1);

		// Verify the command was registered (proving the factory ran)
		const ext = extensions[0];
		expect(ext.commands.has("test-cmd")).toBe(true);
	});
});
