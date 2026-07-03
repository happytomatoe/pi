import type { ProviderStreams } from "../types.ts";
import { lazyApi } from "./lazy.ts";

export const googleAiStudioApi = (): ProviderStreams => lazyApi(() => import("./google-ai-studio.ts"));