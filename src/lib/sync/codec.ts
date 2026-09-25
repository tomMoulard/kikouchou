/**
 * @fileoverview Base64 for Yjs binary updates.
 *
 * The server column is `text` holding base64 rather than `bytea`, because
 * PostgREST and Realtime render `bytea` as hex-escaped `\x…` — a third encoding
 * to get right across the REST read, the Realtime payload and the insert. The
 * ~33% size premium is irrelevant against a quota this is using under 1% of.
 *
 * `btoa`/`atob` are the right primitives here and the wrong ones to use naively:
 * they work in *latin-1 code units*, so they must only ever be handed a string
 * whose char codes are all ≤ 0xFF. Building that string with
 * `String.fromCharCode(...bytes)` blows the argument limit on a large update
 * (`RangeError: Maximum call stack size exceeded`), which is exactly the kind of
 * failure that shows up only once someone's trip gets big. Both directions here
 * work in chunks for that reason.
 *
 * @module lib/sync/codec
 */

// ============================================================================
// Constants
// ============================================================================

/**
 * Bytes converted per `String.fromCharCode` call.
 *
 * Comfortably under the engine's argument-count limit while still amortising the
 * call overhead. A 1 MiB update becomes 128 calls rather than one that throws.
 */
const CHUNK_SIZE = 8192;

/** What the server's check constraint accepts: standard base64, no line breaks. */
const BASE64_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/;

// ============================================================================
// Public API
// ============================================================================

/**
 * Encodes a Yjs update for the `trip_doc_updates.update` column.
 *
 * @param bytes - Raw Yjs binary update
 * @returns Standard base64, matching the server's check constraint
 */
export function encodeUpdate(bytes: Uint8Array): string {
  let latin1 = '';
  for (let offset = 0; offset < bytes.length; offset += CHUNK_SIZE) {
    // subarray, not slice: a view rather than a copy per chunk.
    latin1 += String.fromCharCode(...bytes.subarray(offset, offset + CHUNK_SIZE));
  }
  return btoa(latin1);
}

/**
 * Decodes a value read back from the server.
 *
 * Returns `null` rather than throwing on anything malformed. This is the
 * untrusted-input boundary for the sync transport: one unreadable row must be
 * skippable, not fatal to the whole pull — the same rule the QR and WebRTC paths
 * follow in `lib/yjs`.
 *
 * @param value - Base64 from the server
 * @returns The bytes, or `null` if the value is not decodable base64
 */
export function decodeUpdate(value: unknown): Uint8Array | null {
  if (typeof value !== 'string' || value.length === 0) {
    return null;
  }
  if (!BASE64_PATTERN.test(value)) {
    return null;
  }

  let latin1: string;
  try {
    latin1 = atob(value);
  } catch {
    // Valid alphabet but an impossible length (e.g. one leftover char).
    return null;
  }

  const bytes = new Uint8Array(latin1.length);
  for (let index = 0; index < latin1.length; index += 1) {
    bytes[index] = latin1.charCodeAt(index);
  }
  return bytes;
}

/**
 * Whether an update carries no changes.
 *
 * Yjs encodes an empty update as two bytes, so a byte-length check would work
 * but would bake in a magic number. Comparing state vectors is the honest
 * question — "does the far side already have everything?" — and this helper
 * exists so callers ask it that way.
 *
 * @param left - A state vector
 * @param right - Another state vector
 * @returns Whether the two vectors are byte-identical
 */
export function areStateVectorsEqual(
  left: Uint8Array | undefined,
  right: Uint8Array | undefined,
): boolean {
  if (!left || !right) {
    return false;
  }
  if (left.length !== right.length) {
    return false;
  }
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) {
      return false;
    }
  }
  return true;
}
