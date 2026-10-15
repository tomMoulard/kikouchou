/**
 * @fileoverview Human-readable byte sizes.
 *
 * There were two of these — one in `features/assistant/hooks/useWebLLM.ts` and
 * an exported-but-never-imported one in `lib/map/tile-cache.ts` — and they
 * disagreed: the tile-cache copy printed `500.0 B` and `1.00 GB` as `1.0 GB`.
 * This is the assistant's version, the only one anybody ever saw, because it is
 * the one that keeps a download counter readable: whole bytes, and more decimals
 * the larger the unit gets.
 *
 * @module lib/utils/format-bytes
 */

/** Bytes per kibibyte, and per step of the unit ladder. */
const STEP = 1024;

/**
 * Formats a byte count for a short progress line.
 *
 * Precision varies with magnitude on purpose: `847 B` and `2.4 GB` both read
 * at a glance, whereas a fixed one decimal gives `847.0 B` and a fixed two give
 * `2.40 GB`. A value under 10 in its unit keeps a decimal so a progress line
 * does not jump from `9 MB` to `10 MB` in one visible step.
 *
 * @param bytes - The number of bytes; negative, NaN and Infinity yield `''`
 * @returns The formatted size, e.g. `'512 B'`, `'1.5 KB'`, `'340 MB'`, `'2.40 GB'`
 *
 * @example
 * ```ts
 * formatBytes(0);          // '0 B'
 * formatBytes(1536);       // '1.5 KB'
 * formatBytes(48 * 1024);  // '48 KB'
 * ```
 */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) {return '';}
  if (bytes < STEP) {return `${Math.round(bytes)} B`;}

  const kb = bytes / STEP;
  if (kb < STEP) {return `${kb < 10 ? kb.toFixed(1) : Math.round(kb)} KB`;}

  const mb = kb / STEP;
  if (mb < STEP) {return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;}

  const gb = mb / STEP;
  return `${gb.toFixed(2)} GB`;
}
