/**
 * @fileoverview Persistent local presence profile for Yjs awareness.
 * @module lib/yjs/presence
 */

import { nanoid } from 'nanoid';

import { db } from '@/lib/db/database';
import type { Trip } from '@/types';

const STORAGE_KEY = 'kikoushou:p2p-presence';
const DEFAULT_COLORS = [
  '#3b82f6',
  '#8b5cf6',
  '#10b981',
  '#f59e0b',
  '#ef4444',
  '#ec4899',
] as const;

export interface PresenceProfile {
  readonly name: string;
  readonly color: string;
}

interface StoredGuestIdentity {
  readonly personId?: string;
  readonly tripId?: string;
}

function createDefaultProfile(): PresenceProfile {
  return {
    name: `Guest ${nanoid(4)}`,
    color:
      DEFAULT_COLORS[Math.floor(Math.random() * DEFAULT_COLORS.length)] ??
      DEFAULT_COLORS[0],
  };
}

/**
 * Returns a stable per-browser presence profile used for awareness.
 */
export function getPresenceProfile(): PresenceProfile {
  if (typeof window === 'undefined') {
    return { name: 'Guest', color: DEFAULT_COLORS[0] };
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<PresenceProfile>;
      if (typeof parsed.name === 'string' && typeof parsed.color === 'string') {
        return { name: parsed.name, color: parsed.color };
      }
    }
  } catch {
    // Ignore localStorage parse failures and regenerate below.
  }

  const nextProfile = createDefaultProfile();

  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(nextProfile));
  } catch {
    // Ignore storage failures and just use the generated profile.
  }

  return nextProfile;
}

export const getOrCreateLocalPresenceProfile = getPresenceProfile;

/**
 * Prefer the current guest identity when available so awareness matches the
 * trip participant currently using this browser. Fall back to the stable
 * browser-local profile otherwise.
 */
export async function resolveTripPresenceProfile(
  trip: Trip,
): Promise<PresenceProfile> {
  const fallback = getPresenceProfile();

  if (typeof window === 'undefined') {
    return fallback;
  }

  try {
    const raw = window.localStorage.getItem(`kikoushou_guest_${trip.shareId}`);
    if (!raw) {
      return fallback;
    }

    const identity = JSON.parse(raw) as StoredGuestIdentity;
    if (identity.tripId !== trip.id || typeof identity.personId !== 'string') {
      return fallback;
    }

    const person = await db.persons.get(identity.personId);
    if (!person || person.tripId !== trip.id) {
      return fallback;
    }

    return {
      name: person.name,
      color: person.color,
    };
  } catch {
    return fallback;
  }
}
