/**
 * TUI session selector for --resume flag
 */

import { ProcessTerminal, type ProcessTerminalOptions, setKeybindings, TUI } from "@earendil-works/pi-tui";
import { KeybindingsManager } from "../core/keybindings.ts";
import type { SessionInfo, SessionListProgress } from "../core/session-manager.ts";
import { SessionSelectorComponent } from "../modes/interactive/components/session-selector.ts";

type SessionsLoader = (onProgress?: SessionListProgress) => Promise<SessionInfo[]>;

export interface SessionPickerTuiOptions extends ProcessTerminalOptions {
	clearOnShrink?: boolean;
}

/** Show TUI session selector and return selected session path or null if cancelled */
export async function selectSession(
	currentSessionsLoader: SessionsLoader,
	allSessionsLoader: SessionsLoader,
	tuiOptions: SessionPickerTuiOptions = {},
): Promise<string | null> {
	return new Promise((resolve) => {
		const { clearOnShrink, ...terminalOptions } = tuiOptions;
		const ui = new TUI(new ProcessTerminal(terminalOptions));
		if (clearOnShrink !== undefined) {
			ui.setClearOnShrink(clearOnShrink);
		}
		const keybindings = KeybindingsManager.create();
		setKeybindings(keybindings);
		let resolved = false;

		const selector = new SessionSelectorComponent(
			currentSessionsLoader,
			allSessionsLoader,
			(path: string) => {
				if (!resolved) {
					resolved = true;
					ui.stop();
					resolve(path);
				}
			},
			() => {
				if (!resolved) {
					resolved = true;
					ui.stop();
					resolve(null);
				}
			},
			() => {
				ui.stop();
				process.exit(0);
			},
			() => ui.requestRender(),
			{ showRenameHint: false, keybindings },
		);

		ui.addChild(selector);
		ui.setFocus(selector.getSessionList());
		ui.start();
	});
}
