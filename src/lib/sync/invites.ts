/**
 * @fileoverview Creating, listing, redeeming and revoking share links.
 *
 * An invite replaces the old scheme, where a room id and encryption key sat in a
 * URL fragment forever with no way to withdraw them. This one can expire, be
 * capped, and be revoked — and the token, while readable by members so the share
 * dialog can show the link again, is invisible to anyone outside the trip.
 *
 * Redemption and revocation go through `security definer` RPCs rather than table
 * writes: the person redeeming is by definition not yet a member, so no policy
 * could admit them, and keeping `uses` out of reach of a direct UPDATE is what
 * makes a use cap mean anything.
 *
 * @module lib/sync/invites
 */

import type { TypedSupabaseClient } from '@/lib/supabase/client';
import { nanoid } from 'nanoid';

// ============================================================================
// Constants
// ============================================================================

/**
 * Token length.
 *
 * nanoid's alphabet is 64 characters, so 16 of them is 96 bits — far past
 * guessing, and short enough to stay comfortable in a QR code alongside the
 * origin. The server's check constraint accepts 16 to 64.
 */
const TOKEN_LENGTH = 16;

/** Path an invite link points at. */
const JOIN_PATH = 'join';

// ============================================================================
// Type Definitions
// ============================================================================

export interface TripInvite {
  readonly token: string;
  readonly createdAt: string;
  readonly expiresAt: string | null;
  readonly maxUses: number | null;
  readonly uses: number;
  readonly revokedAt: string | null;
}

export type CreateInviteResult =
  | { readonly status: 'created'; readonly invite: TripInvite }
  | { readonly status: 'error'; readonly message: string };

export type RedeemInviteResult =
  | { readonly status: 'joined'; readonly remoteTripId: string }
  | { readonly status: 'not-found' }
  | { readonly status: 'revoked' }
  | { readonly status: 'expired' }
  | { readonly status: 'exhausted' }
  | { readonly status: 'unauthenticated' }
  | { readonly status: 'error'; readonly message: string };

// ============================================================================
// Links
// ============================================================================

/**
 * Builds the URL to hand somebody.
 *
 * Takes the origin and base path as arguments rather than reading
 * `window.location`, because `lib/` must not — reading the URL fragment there is
 * what once let the a11y skip link `#main-content` overwrite a trip's encryption
 * key. Callers in components pass them in.
 *
 * @param origin - e.g. `https://kikouchou.app`
 * @param basePath - Vite's `BASE_URL`, e.g. `/`
 * @param token - The invite token
 */
export function buildInviteUrl(
  origin: string,
  basePath: string,
  token: string,
): string {
  const base = basePath.endsWith('/') ? basePath : `${basePath}/`;
  return `${origin}${base}${JOIN_PATH}/${encodeURIComponent(token)}`;
}

/**
 * Extracts a token from a scanned QR payload or a pasted link.
 *
 * Accepts a full URL, a bare path, or the token on its own — a QR scanner may
 * hand back any of them, and someone pasting a link may include or trim the
 * origin.
 *
 * @returns The token, or `null` if the payload is not an invite
 */
export function extractInviteToken(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return null;
  }

  // The token alone: nanoid's URL-safe alphabet, at the length we mint.
  if (new RegExp(`^[A-Za-z0-9_-]{${TOKEN_LENGTH}}$`).test(trimmed)) {
    return trimmed;
  }

  const path = /^https?:\/\//i.test(trimmed)
    ? safePathname(trimmed)
    : trimmed;
  if (path === null) {
    return null;
  }

  const match = new RegExp(`/${JOIN_PATH}/([A-Za-z0-9_-]{8,64})/?$`).exec(path);
  if (!match?.[1]) {
    return null;
  }

  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
}

function safePathname(url: string): string | null {
  try {
    return new URL(url).pathname;
  } catch {
    return null;
  }
}

// ============================================================================
// Server operations
// ============================================================================

/**
 * Mints a new invite for a trip.
 *
 * @param client - Authenticated Supabase client
 * @param remoteTripId - Server `trips.id`
 * @param userId - The creator, recorded for provenance
 * @param options - Optional expiry and use cap
 */
export async function createInvite(
  client: TypedSupabaseClient,
  remoteTripId: string,
  userId: string,
  options: { readonly expiresAt?: Date; readonly maxUses?: number } = {},
): Promise<CreateInviteResult> {
  const token = nanoid(TOKEN_LENGTH);

  try {
    const { data, error } = await client
      .from('trip_invites')
      .insert({
        token,
        trip_id: remoteTripId,
        created_by: userId,
        ...(options.expiresAt ? { expires_at: options.expiresAt.toISOString() } : {}),
        ...(options.maxUses !== undefined ? { max_uses: options.maxUses } : {}),
      })
      .select('token, created_at, expires_at, max_uses, uses, revoked_at')
      .single();

    if (error) {
      return { status: 'error', message: error.message };
    }
    return { status: 'created', invite: toInvite(data) };
  } catch (error: unknown) {
    return { status: 'error', message: toMessage(error) };
  }
}

/**
 * Live invites for a trip, newest first.
 *
 * Revoked and expired ones are filtered out client-side rather than in the
 * query, so the caller can still show them if it wants to explain why an old
 * link stopped working.
 */
export async function listInvites(
  client: TypedSupabaseClient,
  remoteTripId: string,
): Promise<TripInvite[]> {
  try {
    const { data, error } = await client
      .from('trip_invites')
      .select('token, created_at, expires_at, max_uses, uses, revoked_at')
      .eq('trip_id', remoteTripId)
      .order('created_at', { ascending: false });

    if (error || !data) {
      return [];
    }
    return (data as Record<string, unknown>[]).map(toInvite);
  } catch {
    // Offline: the share dialog still has to render.
    return [];
  }
}

/** Whether an invite would be accepted right now. */
export function isInviteUsable(invite: TripInvite, now = new Date()): boolean {
  if (invite.revokedAt !== null) {
    return false;
  }
  if (invite.expiresAt !== null && new Date(invite.expiresAt) <= now) {
    return false;
  }
  if (invite.maxUses !== null && invite.uses >= invite.maxUses) {
    return false;
  }
  return true;
}

/**
 * Joins the caller to the invite's trip.
 *
 * The RPC signals each way an invite can be unusable through a `hint`, mapped
 * here to a discriminated result so the UI can explain what happened rather than
 * showing a raw Postgres message.
 */
export async function redeemInvite(
  client: TypedSupabaseClient,
  token: string,
): Promise<RedeemInviteResult> {
  try {
    const { data, error } = await client.rpc('redeem_invite', {
      invite_token: token,
    });

    if (error) {
      return mapRedeemError(error);
    }
    if (typeof data !== 'string' || data.length === 0) {
      return { status: 'error', message: 'server did not return a trip id' };
    }
    return { status: 'joined', remoteTripId: data };
  } catch (error: unknown) {
    return { status: 'error', message: toMessage(error) };
  }
}

/** Withdraws an invite. Any member of the trip may. */
export async function revokeInvite(
  client: TypedSupabaseClient,
  token: string,
): Promise<{ readonly ok: boolean; readonly message?: string }> {
  try {
    const { error } = await client.rpc('revoke_invite', { invite_token: token });
    if (error) {
      return { ok: false, message: error.message };
    }
    return { ok: true };
  } catch (error: unknown) {
    return { ok: false, message: toMessage(error) };
  }
}

// ============================================================================
// Internals
// ============================================================================

function toInvite(row: unknown): TripInvite {
  const record = (row ?? {}) as Record<string, unknown>;
  return {
    token: String(record.token ?? ''),
    createdAt: String(record.created_at ?? ''),
    expiresAt: typeof record.expires_at === 'string' ? record.expires_at : null,
    maxUses: typeof record.max_uses === 'number' ? record.max_uses : null,
    uses: typeof record.uses === 'number' ? record.uses : 0,
    revokedAt: typeof record.revoked_at === 'string' ? record.revoked_at : null,
  };
}

/**
 * Maps the RPC's failure signals to a result.
 *
 * `hint` is matched before `message`, because the hints are a deliberate
 * contract set by the migration while the messages are prose that could
 * reasonably be reworded.
 */
function mapRedeemError(error: {
  readonly message?: string;
  readonly hint?: string | null;
  readonly code?: string;
}): RedeemInviteResult {
  switch (error.hint) {
    case 'invite_not_found':
      return { status: 'not-found' };
    case 'invite_revoked':
      return { status: 'revoked' };
    case 'invite_expired':
      return { status: 'expired' };
    case 'invite_exhausted':
      return { status: 'exhausted' };
    default:
      break;
  }

  if (error.code === '28000') {
    return { status: 'unauthenticated' };
  }
  return { status: 'error', message: error.message ?? 'unknown error' };
}

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
