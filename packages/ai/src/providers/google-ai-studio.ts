import { googleAiStudioApi } from "../api/google-ai-studio.lazy.ts";
import type { ApiKeyAuth } from "../auth/types.ts";
import { createProvider, type Provider } from "../models.ts";
import { GOOGLE_AI_STUDIO_MODELS } from "./google-ai-studio.models.ts";

/**
 * Google AI Studio provider authentication.
 * Uses OAuth2 credentials from the Google Gemini CLI / Antigravity flow.
 * The apiKey is expected to be a JSON string: { token: string, projectId: string }
 */
const aiStudioAuth: ApiKeyAuth = {
	name: "Google AI Studio credentials",
	resolve: async ({ ctx, credential }) => {
		const key = credential?.key;
		if (key) {
			try {
				const parsed = JSON.parse(key) as { token?: string; projectId?: string };
				if (parsed.token && parsed.projectId) {
					return { auth: { apiKey: key }, source: "stored credential" };
				}
			} catch {
				// Not valid JSON, fall through
			}
		}
		return undefined;
	},
};

export function googleAiStudioProvider(): Provider<"google-ai-studio"> {
	return createProvider({
		id: "google-ai-studio",
		name: "Google AI Studio",
		auth: { apiKey: aiStudioAuth },
		models: Object.values(GOOGLE_AI_STUDIO_MODELS),
		api: googleAiStudioApi(),
	});
}