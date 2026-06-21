import assert from "node:assert";
import { describe, it } from "node:test";
import { Editor } from "../src/components/editor.ts";
import { type HardwareCursorSetting, ProcessTerminal, type Terminal } from "../src/terminal.ts";
import { CURSOR_MARKER, stripCursorMarker, TUI } from "../src/tui.ts";
import { defaultEditorTheme } from "./test-themes.ts";

const REVERSE_VIDEO_ON = "\x1b[7m";
const REVERSE_VIDEO_OFF = "\x1b[27m";
const SGR_RESET = "\x1b[0m";

class RecordingTerminal implements Terminal {
	showHardwareCursor: HardwareCursorSetting = false;

	private writes: string[] = [];
	private readonly width: number;
	private readonly height: number;

	constructor(width = 40, height = 6) {
		this.width = width;
		this.height = height;
	}

	start(_onInput: (data: string) => void, _onResize: () => void): void {}

	stop(): void {}

	async drainInput(_maxMs?: number, _idleMs?: number): Promise<void> {}

	write(data: string): void {
		this.writes.push(data);
	}

	get columns(): number {
		return this.width;
	}

	get rows(): number {
		return this.height;
	}

	get kittyProtocolActive(): boolean {
		return true;
	}

	moveBy(lines: number): void {
		if (lines > 0) this.write(`\x1b[${lines}B`);
		else if (lines < 0) this.write(`\x1b[${-lines}A`);
	}

	hideCursor(): void {
		this.write("\x1b[?25l");
	}

	showCursor(): void {
		this.write("\x1b[?25h");
	}

	clearLine(): void {
		this.write("\x1b[K");
	}

	clearFromCursor(): void {
		this.write("\x1b[J");
	}

	clearScreen(): void {
		this.write("\x1b[2J\x1b[H");
	}

	setTitle(title: string): void {
		this.write(`\x1b]0;${title}\x07`);
	}

	setProgress(_active: boolean): void {}

	allWrites(): string {
		return this.writes.join("");
	}

	async waitForRender(): Promise<void> {
		await new Promise<void>((resolve) => process.nextTick(resolve));
		await new Promise<void>((resolve) => setTimeout(resolve, 25));
	}
}

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
	it("parses PI_HARDWARE_CURSOR=native", () => {
		withHardwareCursorEnv("native", () => {
			const terminal = new ProcessTerminal();
			assert.strictEqual(terminal.showHardwareCursor, "native");
			assert.strictEqual(new TUI(terminal).getShowHardwareCursor(), "native");
		});
	});

	it("keeps existing boolean env semantics", () => {
		withHardwareCursorEnv(undefined, () => {
			assert.strictEqual(new ProcessTerminal().showHardwareCursor, false);
		});
		withHardwareCursorEnv("1", () => {
			assert.strictEqual(new ProcessTerminal().showHardwareCursor, true);
		});
	});

	it("accepts process terminal options", () => {
		assert.strictEqual(new ProcessTerminal({ showHardwareCursor: "native" }).showHardwareCursor, "native");
	});

	it("stores cursor mode on the terminal", () => {
		const terminal = new RecordingTerminal();
		const tui = new TUI(terminal);
		tui.setShowHardwareCursor("native");

		assert.strictEqual(terminal.showHardwareCursor, "native");
		assert.strictEqual(tui.getShowHardwareCursor(), "native");
	});
});

describe("stripCursorMarker", () => {
	it("keeps the software cursor outside native mode", () => {
		const line = `ab${CURSOR_MARKER}${REVERSE_VIDEO_ON}c${REVERSE_VIDEO_OFF}de`;
		assert.strictEqual(stripCursorMarker(line, false), `ab${REVERSE_VIDEO_ON}c${REVERSE_VIDEO_OFF}de`);
	});

	it("strips marker-adjacent reverse video in native mode", () => {
		const line = `ab${CURSOR_MARKER}${REVERSE_VIDEO_ON}c${REVERSE_VIDEO_OFF}de`;
		assert.strictEqual(stripCursorMarker(line, true), "abcde");
	});

	it("handles legacy full SGR reset cursor cells", () => {
		const line = `ab${CURSOR_MARKER}${REVERSE_VIDEO_ON}c${SGR_RESET}de`;
		assert.strictEqual(stripCursorMarker(line, true), `abc${SGR_RESET}de`);
	});
});

describe("native cursor rendering", () => {
	it("strips the software cursor and shows the hardware cursor in native mode", async () => {
		const terminal = new RecordingTerminal();
		terminal.showHardwareCursor = "native";
		const tui = new TUI(terminal);
		const editor = new Editor(tui, defaultEditorTheme);
		editor.setText("abc");
		tui.addChild(editor);
		tui.setFocus(editor);
		tui.start();
		await terminal.waitForRender();

		const output = terminal.allWrites();
		assert.ok(!output.includes(REVERSE_VIDEO_ON), "native mode should not paint a software cursor");
		assert.ok(output.includes("\x1b[?25h"), "native mode should show the hardware cursor");
		tui.stop();
	});

	it("keeps the software cursor when hardware cursor visibility is true", async () => {
		const terminal = new RecordingTerminal();
		terminal.showHardwareCursor = true;
		const tui = new TUI(terminal);
		const editor = new Editor(tui, defaultEditorTheme);
		editor.setText("abc");
		tui.addChild(editor);
		tui.setFocus(editor);
		tui.start();
		await terminal.waitForRender();

		assert.ok(terminal.allWrites().includes(REVERSE_VIDEO_ON), "true mode should keep the software cursor");
		tui.stop();
	});
});
