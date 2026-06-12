import { describe, expect, it } from "vitest";
import { prepareBranchEntries } from "../src/core/compaction/branch-summarization.ts";
import type { CustomMessageEntry, SessionMessageEntry } from "../src/core/session-manager.ts";

function userEntry(id: string, parentId: string | null, text: string): SessionMessageEntry {
	return {
		type: "message",
		id,
		parentId,
		timestamp: "2025-01-01T00:00:00Z",
		message: {
			role: "user",
			content: [{ type: "text", text }],
			timestamp: 1,
		},
	};
}

function customEntry(
	id: string,
	parentId: string | null,
	content: string,
	excludeFromContext: boolean,
): CustomMessageEntry {
	return {
		type: "custom_message",
		id,
		parentId,
		timestamp: "2025-01-01T00:00:00Z",
		customType: "status",
		content,
		display: true,
		excludeFromContext,
	};
}

describe("branch summarization", () => {
	it("skips excluded custom messages before token budgeting", () => {
		const user = userEntry("user", null, "keep");
		const excluded = customEntry("custom", user.id, "x".repeat(1000), true);

		const preparation = prepareBranchEntries([user, excluded], 10);

		expect(preparation.messages.map((message) => message.role)).toEqual(["user"]);
		expect(preparation.totalTokens).toBe(1);
	});
});
