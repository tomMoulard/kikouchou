/**
 * @fileoverview Reads a guest's name and phone number from the device address book.
 *
 * The web platform offers exactly one door onto the address book: the
 * [Contact Picker API](https://developer.mozilla.org/en-US/docs/Web/API/Contact_Picker_API).
 * It is deliberately narrow, and two of its limits shape everything above it:
 *
 * 1. **The page never sees the contact list.** `select()` hands control to the
 *    browser, which draws its own picker — with its own search field — and
 *    returns only the entries the user tapped. There is no enumeration, so an
 *    in-app type-ahead over the address book cannot be built; the filtering the
 *    user does while typing "Mary" happens inside the browser's own sheet.
 * 2. **Chromium on Android only** (plus Samsung Internet). No iOS Safari, no
 *    desktop. Every caller must therefore treat the picker as a shortcut and
 *    keep the manual field it fills as the real input.
 *
 * The picker *is* the permission prompt: there is no `navigator.permissions`
 * entry to query and nothing is granted persistently, so each import costs one
 * user gesture and the user re-picks every time.
 *
 * @module lib/contacts/contact-picker
 */

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * A single entry returned by the browser's contact picker.
 *
 * Every property is a *list*, because one contact can carry several names or
 * numbers, and every property is optional, because the browser fills only the
 * ones it was asked for and the ones the contact actually has.
 */
interface ContactInfo {
  readonly name?: readonly string[];
  readonly tel?: readonly string[];
  readonly email?: readonly string[];
}

/**
 * The subset of `ContactsManager` this module uses.
 * Not part of TypeScript's DOM library, so it is declared here.
 */
interface ContactsManagerLike {
  getProperties(): Promise<readonly string[]>;
  select(
    properties: readonly string[],
    options?: { readonly multiple?: boolean },
  ): Promise<readonly ContactInfo[]>;
}

declare global {
  interface Navigator {
    readonly contacts?: ContactsManagerLike;
  }
}

/**
 * A contact reduced to the two fields a guest entry needs.
 *
 * Both are optional: a contact filed under a company with no person name, and a
 * name with no number, are both ordinary. The caller fills what it got and
 * leaves the rest for the user to type.
 */
export interface PickedContact {
  /** Display name, whitespace-collapsed. Absent when the contact has none. */
  readonly name?: string;
  /** First phone number on the contact, trimmed. Absent when it has none. */
  readonly phone?: string;
}

/**
 * The result of asking for one contact.
 *
 * `cancelled` and `failed` are kept apart on purpose: dismissing the sheet is
 * the most common outcome and must stay silent, while a real failure is worth
 * telling the user about.
 */
export type ContactPickOutcome =
  | { readonly status: 'picked'; readonly contact: PickedContact }
  | { readonly status: 'cancelled' }
  | { readonly status: 'unsupported' }
  | { readonly status: 'failed'; readonly error: unknown };

// ============================================================================
// Constants
// ============================================================================

/** Properties requested from the picker. */
const WANTED_PROPERTIES = ['name', 'tel'] as const;

// ============================================================================
// Feature Detection
// ============================================================================

/**
 * Whether this browser exposes the Contact Picker API.
 *
 * `ContactsManager` on `window` is checked alongside `navigator.contacts`
 * because the latter alone also matches the unrelated legacy `navigator.contacts`
 * that shipped on some older mobile browsers.
 *
 * The API requires a secure context; `window.isSecureContext` covers HTTPS and
 * `localhost` alike, so a dev server is not excluded.
 *
 * @returns `true` when {@link pickContact} can do anything useful
 */
export function isContactPickerSupported(): boolean {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') {
    return false;
  }
  // Coerced rather than returned raw: `isSecureContext` is typed `boolean` but
  // is absent in some environments (jsdom among them), and `undefined && …`
  // would hand back `undefined` from a function that promises a boolean.
  return Boolean(
    window.isSecureContext &&
      'contacts' in navigator &&
      navigator.contacts !== undefined &&
      'ContactsManager' in window,
  );
}

// ============================================================================
// Normalization
// ============================================================================

/**
 * Picks the first usable string out of a contact property list.
 *
 * Entries are trimmed and internal whitespace runs collapsed, so the ragged
 * values address books hold ("  Mary   Poppins ") arrive as one clean line.
 * Empty and whitespace-only entries are skipped rather than returned blank.
 */
function firstNonEmpty(values: readonly string[] | undefined): string | undefined {
  if (!values) {
    return undefined;
  }
  for (const value of values) {
    if (typeof value !== 'string') {
      continue;
    }
    const collapsed = value.trim().replace(/\s+/gu, ' ');
    if (collapsed.length > 0) {
      return collapsed;
    }
  }
  return undefined;
}

/**
 * Reduces a picker entry to the fields a guest needs.
 *
 * Exported so the normalization can be tested without a picker, and for any
 * future flow that reads several contacts at once.
 *
 * @param info - One entry as the browser returned it
 * @returns The name and phone worth keeping, each absent when the contact has none
 */
export function toPickedContact(info: ContactInfo): PickedContact {
  const contact: { name?: string; phone?: string } = {};

  const name = firstNonEmpty(info.name);
  if (name !== undefined) {
    contact.name = name;
  }

  const phone = firstNonEmpty(info.tel);
  if (phone !== undefined) {
    contact.phone = phone;
  }

  return contact;
}

// ============================================================================
// Picking
// ============================================================================

/**
 * Opens the browser's contact picker and returns the single contact chosen.
 *
 * Must be called from a user gesture: the API requires transient activation and
 * rejects otherwise. It also rejects when a picker is already open or when the
 * page is not the top-level frame — both surface as `failed`.
 *
 * Only properties the browser reports as supported are requested, because
 * `select()` throws outright on an unknown one. A browser offering neither
 * `name` nor `tel` has nothing to give and is reported as `unsupported`.
 *
 * @returns What the user did — see {@link ContactPickOutcome}
 *
 * @example
 * ```typescript
 * const outcome = await pickContact();
 * if (outcome.status === 'picked') {
 *   setName(outcome.contact.name ?? name);
 *   setPhone(outcome.contact.phone ?? phone);
 * }
 * ```
 */
export async function pickContact(): Promise<ContactPickOutcome> {
  if (!isContactPickerSupported()) {
    return { status: 'unsupported' };
  }

  const manager = navigator.contacts;
  if (!manager) {
    return { status: 'unsupported' };
  }

  try {
    const available = await manager.getProperties();
    const requested = WANTED_PROPERTIES.filter((property) => available.includes(property));
    if (requested.length === 0) {
      return { status: 'unsupported' };
    }

    const selected = await manager.select(requested, { multiple: false });

    // Dismissing the sheet resolves with an empty list rather than rejecting.
    const first = selected[0];
    if (!first) {
      return { status: 'cancelled' };
    }

    return { status: 'picked', contact: toPickedContact(first) };
  } catch (error) {
    return { status: 'failed', error };
  }
}
