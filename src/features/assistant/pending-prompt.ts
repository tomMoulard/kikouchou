/**
 * @fileoverview A question asked before signing in, kept until the account
 * exists.
 *
 * The account preset needs a session, and a web sign-in leaves the page: the
 * provider's redirect, or a magic link opened in a new tab, comes back to the
 * app's root. The question the visitor tapped would be lost on the way. It
 * waits here instead, and the assistant page sends it once it is ready.
 *
 * `localStorage` rather than `sessionStorage`, because a magic link opens a
 * new tab. It expires, so a question abandoned at the sign-in step does not
 * fire on a visit days later.
 *
 * @module features/assistant/pending-prompt
 */

import type { StarterKind } from './starters';

// ============================================================================
// Type Definitions
// ============================================================================

export interface PendingPrompt {
  readonly text: string;
  readonly kind: StarterKind;
}

// ============================================================================
// Constants
// ============================================================================

export const PENDING_PROMPT_STORAGE_KEY = 'kikouchou-assistant-pending-prompt';

/** Long enough to sign in by email, short enough not to surprise anybody. */
export const PENDING_PROMPT_TTL_MS = 30 * 60 * 1000;

/** Bounds what a stored value may be, since anything can write storage. */
const MAX_TEXT_LENGTH = 500;

// ============================================================================
// Public API
// ============================================================================

/**
 * Keeps a question until the account exists.
 */
export function storePendingPrompt(prompt: PendingPrompt, now = Date.now()): void {
  try {
    window.localStorage.setItem(
      PENDING_PROMPT_STORAGE_KEY,
      JSON.stringify({ ...prompt, at: now }),
    );
  } catch {
    // Storage refused: the question is lost, and the visitor taps it again.
  }
}

/**
 * Takes the stored question, if a fresh one is there, and forgets it either
 * way, so it is sent once.
 */
export function takePendingPrompt(now = Date.now()): PendingPrompt | null {
  let raw: string | null;
  try {
    raw = window.localStorage.getItem(PENDING_PROMPT_STORAGE_KEY);
    window.localStorage.removeItem(PENDING_PROMPT_STORAGE_KEY);
  } catch {
    return null;
  }
  if (raw === null) return null;

  try {
    const value = JSON.parse(raw) as { text?: unknown; kind?: unknown; at?: unknown };
    if (
      typeof value.text !== 'string' ||
      value.text.trim() === '' ||
      value.text.length > MAX_TEXT_LENGTH ||
      (value.kind !== 'create' && value.kind !== 'explore') ||
      typeof value.at !== 'number' ||
      now - value.at > PENDING_PROMPT_TTL_MS ||
      value.at > now
    ) {
      return null;
    }
    return { text: value.text, kind: value.kind };
  } catch {
    return null;
  }
}
