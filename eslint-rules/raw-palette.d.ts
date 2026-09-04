/**
 * @fileoverview Types for `raw-palette.js`.
 *
 * The implementation is plain JavaScript because `eslint.config.js` imports it
 * from Node with no transpiler; this declaration is what lets the Vitest suite
 * import the same module under `tsc -b`.
 *
 * @module eslint-rules/raw-palette
 */

/** Any Tailwind palette shade — what the theme tokens exist to keep out. */
export declare const RAW_PALETTE: RegExp;

/** Every palette class in `text`, in source order, deduplicated. */
export declare function matchRawPalette(text: string): string[];
