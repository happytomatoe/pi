import { describe, expect, it } from "vitest";
import { SettingsManager } from "../src/core/settings-manager.ts";

function withHardwareCursorEnv<T>(value: string | undefined, fn: () => T): T {
	const previous = process.env.PI_HARDWARE_CURSOR;
	if (value === undefined) delete process.env.PI_HARDWARE_CURSOR;
	else process.env.PI_HARDWARE_CURSOR = value;
	try {
		return fn();
	} finally {
		if (previous === undefined) delete process.env.PI_HARDWARE_CURSOR;
		else process.env.PI_HARDWARE_CURSOR = previous;
	}
}

describe("hardware cursor setting", () => {
	it("supports native mode from settings", () => {
		const manager = SettingsManager.inMemory({ showHardwareCursor: "native" });
		expect(manager.getShowHardwareCursor()).toBe("native");
	});

	it("supports native mode from PI_HARDWARE_CURSOR", () => {
		withHardwareCursorEnv("native", () => {
			const manager = SettingsManager.inMemory();
			expect(manager.getShowHardwareCursor()).toBe("native");
		});
	});

	it("preserves existing boolean settings", () => {
		expect(SettingsManager.inMemory({ showHardwareCursor: true }).getShowHardwareCursor()).toBe(true);
		expect(SettingsManager.inMemory({ showHardwareCursor: false }).getShowHardwareCursor()).toBe(false);
	});
});
