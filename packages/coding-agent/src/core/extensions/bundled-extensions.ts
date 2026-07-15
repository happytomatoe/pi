/**
 * Registry of extensions compiled INTO the binary at build time.
 *
 * This is the committed default: an empty registry. Normal builds (and the
 * default `build:binary`) leave it empty, so every extension misses here and
 * falls through to the existing jiti loader exactly as before.
 *
 * The `build:binary:bundled` script overwrites `dist/.../bundled-extensions.js`
 * (after tsgo emits this empty default) with a bun-compiled module generated
 * from `bundled-extensions.gen.ts`, which statically imports the chosen
 * extensions so the compiler embeds their whole graph. See
 * `scripts/build-bundled-binary.mjs`.
 *
 * Keyed by the extension path RELATIVE to the agent dir (computed at runtime in
 * the loader via `path.relative(getAgentDir(), extensionPath)`), so the embedded
 * factories are found regardless of where the binary or its agent folder land.
 */
import type { ExtensionFactory } from "./types.ts";

export const BUNDLED_EXTENSIONS: Record<string, ExtensionFactory> = {};
