/**
 * @fileoverview Binary codec for encoding/decoding changesets to/from QR-ready payloads.
 * Uses protobuf for efficient binary serialization.
 *
 * Format: [version byte][protobuf binary data]
 * The version byte allows future format changes without breaking existing QR codes.
 *
 * @module lib/sharing/codec
 */

import { fromBinary, toBinary } from '@bufbuild/protobuf';
import { TripChangesetSchema } from '@/gen/changeset_pb';
import { changesetToProto, protoToChangeset } from '@/lib/sharing/mappers';
import type { AppChangeset } from '@/lib/sharing/types';
import { MAX_QR_BYTES, QR_PAYLOAD_VERSION } from '@/lib/sharing/types';
import type { QRFrame } from '@/lib/sharing/types';

// ============================================================================
// Encoding
// ============================================================================

/**
 * Encodes an AppChangeset to a binary payload suitable for QR codes.
 * Returns a base64url string prefixed with a version byte.
 *
 * @param changeset - The changeset to encode
 * @returns Base64url-encoded string
 */
export function encodeChangeset(changeset: AppChangeset): string {
  const protoMessage = changesetToProto(changeset);
  const binaryData = toBinary(TripChangesetSchema, protoMessage);

  // Prepend version byte
  const payload = new Uint8Array(1 + binaryData.length);
  payload[0] = QR_PAYLOAD_VERSION;
  payload.set(binaryData, 1);

  return uint8ArrayToBase64Url(payload);
}

/**
 * Splits an encoded payload into QR frames if it exceeds the max size.
 * Each frame is a self-contained string with frame metadata prefix.
 *
 * Frame format: "F{index}/{total}:{data}"
 *
 * @param encoded - The base64url-encoded payload
 * @returns Array of frame strings, or single-element array if it fits in one QR
 */
export function splitIntoFrames(encoded: string): string[] {
  // Account for frame prefix overhead: "F0/1:" = 5 chars, "F99/100:" = 8 chars
  // Use conservative overhead estimate of 10 chars
  const frameOverhead = 10;
  const maxDataPerFrame = MAX_QR_BYTES - frameOverhead;

  if (encoded.length <= MAX_QR_BYTES) {
    return [encoded];
  }

  const frames: string[] = [];
  const totalFrames = Math.ceil(encoded.length / maxDataPerFrame);

  for (let i = 0; i < totalFrames; i++) {
    const start = i * maxDataPerFrame;
    const end = Math.min(start + maxDataPerFrame, encoded.length);
    const chunk = encoded.slice(start, end);
    frames.push(`F${i}/${totalFrames}:${chunk}`);
  }

  return frames;
}

// ============================================================================
// Decoding
// ============================================================================

/**
 * Decodes a base64url-encoded payload back to an AppChangeset.
 *
 * @param encoded - The base64url-encoded string (with version byte)
 * @returns The decoded changeset
 * @throws Error if the format is invalid or version is unsupported
 */
export function decodeChangeset(encoded: string): AppChangeset {
  const payload = base64UrlToUint8Array(encoded);

  if (payload.length < 2) {
    throw new Error('Invalid changeset payload: too short');
  }

  const version = payload[0];
  if (version !== QR_PAYLOAD_VERSION) {
    throw new Error(`Unsupported changeset version: ${version}. Expected: ${QR_PAYLOAD_VERSION}`);
  }

  const binaryData = payload.slice(1);
  const protoMessage = fromBinary(TripChangesetSchema, binaryData);
  return protoToChangeset(protoMessage);
}

/**
 * Parses a QR frame string to extract frame metadata and data.
 *
 * @param frame - A frame string like "F0/3:data..." or a raw payload
 * @returns Parsed QR frame, or null if not a multi-frame string
 */
export function parseFrame(frame: string): QRFrame | null {
  const match = /^F(\d+)\/(\d+):(.+)$/.exec(frame);
  if (!match) {
    return null;
  }

  const index = parseInt(match[1]!, 10);
  const total = parseInt(match[2]!, 10);
  const data = match[3]!;

  return { index, total, data };
}

/**
 * Reassembles frames into the original encoded payload.
 *
 * @param frames - Map of frame index to data string
 * @param totalFrames - Expected total number of frames
 * @returns The reassembled payload, or null if frames are incomplete
 */
export function reassembleFrames(frames: Map<number, string>, totalFrames: number): string | null {
  if (frames.size !== totalFrames) {
    return null;
  }

  const parts: string[] = [];
  for (let i = 0; i < totalFrames; i++) {
    const data = frames.get(i);
    if (data === undefined) {
      return null;
    }
    parts.push(data);
  }

  return parts.join('');
}

// ============================================================================
// Base64url Utilities
// ============================================================================

/**
 * Converts a Uint8Array to a base64url-encoded string.
 * Uses the URL-safe alphabet (no padding, +/→-_).
 */
function uint8ArrayToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]!);
  }
  const base64 = btoa(binary);
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Regex matching a valid base64url string (URL-safe alphabet, no padding).
 * Rejects strings containing characters outside [A-Za-z0-9_-].
 */
const BASE64URL_RE = /^[A-Za-z0-9_-]+$/;

/**
 * Converts a base64url-encoded string to a Uint8Array.
 * @throws Error if the string contains characters outside the base64url alphabet
 */
function base64UrlToUint8Array(base64url: string): Uint8Array {
  if (!base64url || !BASE64URL_RE.test(base64url)) {
    throw new Error('Invalid base64url payload: contains characters outside the expected alphabet');
  }

  // Restore standard base64
  let base64 = base64url.replace(/-/g, '+').replace(/_/g, '/');

  // Add padding
  const padLength = (4 - (base64.length % 4)) % 4;
  base64 += '='.repeat(padLength);

  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
