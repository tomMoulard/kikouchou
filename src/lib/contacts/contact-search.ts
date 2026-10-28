/**
 * @fileoverview Searches the device address book from the guest name field.
 *
 * Only the store apps can do this. The web's one door onto the address book,
 * the Contact Picker API, draws the browser's own sheet and never lets a page
 * read a list, so a type-ahead cannot be built on it (an installed PWA is a web
 * page too). The apps carry a small read-only plugin of their own,
 * `ContactSearch` (`android/.../ContactSearchPlugin.java`,
 * `ios/App/App/ContactSearchPlugin.swift`), that answers one question: which
 * contacts match these letters, with their phone numbers.
 *
 * The permission is asked for once per device, on the first letter typed into
 * a name field, and never again. A refusal leaves the field a plain text field:
 * the search answers nothing and says nothing.
 *
 * @module lib/contacts/contact-search
 */

import { registerPlugin } from '@capacitor/core';

import { MAX_LENGTHS } from '@/lib/db/sanitize';
import { hasNativePlugin } from '@/lib/platform';

// ============================================================================
// Type Definitions
// ============================================================================

/** One contact as the native plugin returns it. */
interface NativeContact {
  readonly name?: unknown;
  readonly phones?: unknown;
}

/** The permission states Capacitor reports, plus iOS 18's partial access. */
type ContactsPermissionState =
  | 'granted'
  | 'denied'
  | 'prompt'
  | 'prompt-with-rationale'
  | 'limited';

interface ContactSearchPlugin {
  checkPermissions(): Promise<{ readonly contacts: ContactsPermissionState }>;
  requestPermissions(): Promise<{ readonly contacts: ContactsPermissionState }>;
  search(options: {
    readonly query: string;
    readonly limit: number;
  }): Promise<{ readonly contacts?: unknown }>;
}

/**
 * One line of the suggestion list: a contact, and one of its numbers.
 *
 * A contact with two numbers is two suggestions, so the user picks the number
 * by picking the line. A contact with none is one suggestion with no phone.
 */
export interface ContactSuggestion {
  /** Stable within one answer, for React keys and list values. */
  readonly id: string;
  readonly name: string;
  readonly phone?: string;
}

// ============================================================================
// Constants
// ============================================================================

/** The name the native plugins register under. */
export const CONTACT_SEARCH_PLUGIN = 'ContactSearch';

/**
 * Set once the permission was asked for on this device. A refused prompt is
 * not asked again: the user said no, and a field that keeps asking is worse
 * than a field with no suggestions.
 */
export const CONTACTS_ASKED_KEY = 'kikouchou-contacts-asked';

/** How many contacts the plugin reads per search. */
const MAX_CONTACTS = 8;

/** How many suggestion lines a search returns. */
export const MAX_CONTACT_SUGGESTIONS = 6;

const ContactSearch = registerPlugin<ContactSearchPlugin>(CONTACT_SEARCH_PLUGIN);

// ============================================================================
// Availability and Permission
// ============================================================================

/**
 * Whether this build can search the address book: a store app that carries
 * the plugin. Always `false` on the web.
 */
export function isContactSearchAvailable(): boolean {
  return hasNativePlugin(CONTACT_SEARCH_PLUGIN);
}

function hasAsked(): boolean {
  try {
    return localStorage.getItem(CONTACTS_ASKED_KEY) === '1';
  } catch {
    return false;
  }
}

function rememberAsked(): void {
  try {
    localStorage.setItem(CONTACTS_ASKED_KEY, '1');
  } catch {
    // Storage blocked: the OS remembers a refusal on its own anyway.
  }
}

function isReadable(state: ContactsPermissionState): boolean {
  return state === 'granted' || state === 'limited';
}

/**
 * Resolves whether the address book may be read, asking for it at most once
 * per device.
 *
 * Called on the first letter typed into a name field. A granted permission is
 * read back from the OS every time, so access given later in the system
 * settings works without a reload.
 */
export async function ensureContactsAccess(): Promise<boolean> {
  if (!isContactSearchAvailable()) {
    return false;
  }
  try {
    const { contacts } = await ContactSearch.checkPermissions();
    if (isReadable(contacts)) {
      return true;
    }
    if (contacts === 'denied' || hasAsked()) {
      return false;
    }
    rememberAsked();
    const requested = await ContactSearch.requestPermissions();
    return isReadable(requested.contacts);
  } catch (error) {
    console.error('Failed to get access to the contacts:', error);
    return false;
  }
}

// ============================================================================
// Normalization
// ============================================================================

/** Trims, collapses whitespace runs and caps the length. */
function clean(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const collapsed = value.trim().replace(/\s+/gu, ' ').slice(0, maxLength).trim();
  return collapsed.length > 0 ? collapsed : undefined;
}

/**
 * Turns the plugin's answer into suggestion lines.
 *
 * The address book is the user's own, but its values are as ragged as any
 * typed text, so each one is cleaned and capped to what a guest can store.
 * A contact with no name is dropped: the name is what the user is typing.
 * One number stored twice with different spacing is offered once.
 *
 * Exported for tests.
 */
export function toContactSuggestions(raw: unknown): readonly ContactSuggestion[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  const suggestions: ContactSuggestion[] = [];
  raw.forEach((entry: unknown, contactIndex) => {
    if (typeof entry !== 'object' || entry === null) {
      return;
    }
    const contact = entry as NativeContact;
    const name = clean(contact.name, MAX_LENGTHS.personName);
    if (name === undefined) {
      return;
    }

    const seen = new Set<string>();
    const phones: string[] = [];
    if (Array.isArray(contact.phones)) {
      for (const value of contact.phones as unknown[]) {
        const phone = clean(value, MAX_LENGTHS.personPhone);
        if (phone === undefined) {
          continue;
        }
        const digits = phone.replace(/[^\d+]/gu, '');
        if (seen.has(digits)) {
          continue;
        }
        seen.add(digits);
        phones.push(phone);
      }
    }

    if (phones.length === 0) {
      suggestions.push({ id: `${contactIndex}`, name });
      return;
    }
    phones.forEach((phone, phoneIndex) => {
      suggestions.push({ id: `${contactIndex}:${phoneIndex}`, name, phone });
    });
  });

  return suggestions.slice(0, MAX_CONTACT_SUGGESTIONS);
}

// ============================================================================
// Search
// ============================================================================

/**
 * Returns the contacts whose name matches the query.
 *
 * Call {@link ensureContactsAccess} first: this function never asks. Any
 * failure answers an empty list, because the field still works without it.
 *
 * @param query - What the user typed in the name field
 */
export async function searchContacts(query: string): Promise<readonly ContactSuggestion[]> {
  const trimmed = query.trim();
  if (trimmed.length === 0 || !isContactSearchAvailable()) {
    return [];
  }
  try {
    const result = await ContactSearch.search({ query: trimmed, limit: MAX_CONTACTS });
    return toContactSuggestions(result.contacts);
  } catch (error) {
    console.error('Failed to search the contacts:', error);
    return [];
  }
}
