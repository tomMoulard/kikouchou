/**
 * Tests for the device contact picker.
 *
 * @module lib/contacts/__tests__/contact-picker.test
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import { isContactPickerSupported, pickContact, toPickedContact } from '../contact-picker';

// ============================================================================
// Test Helpers
// ============================================================================

interface FakeManager {
  getProperties: ReturnType<typeof vi.fn>;
  select: ReturnType<typeof vi.fn>;
}

/**
 * Installs a fake `ContactsManager` on the jsdom globals.
 *
 * jsdom ships neither `navigator.contacts` nor `window.ContactsManager`, which
 * is exactly the unsupported browser — so every supported-path test has to put
 * both in place, and the detection reads them back.
 */
function installPicker(manager: Partial<FakeManager> = {}): FakeManager {
  const fake: FakeManager = {
    getProperties: manager.getProperties ?? vi.fn().mockResolvedValue(['name', 'tel', 'email']),
    select: manager.select ?? vi.fn().mockResolvedValue([]),
  };

  vi.stubGlobal('ContactsManager', class {});
  Object.defineProperty(navigator, 'contacts', {
    value: fake,
    configurable: true,
  });
  Object.defineProperty(window, 'isSecureContext', {
    value: true,
    configurable: true,
  });

  return fake;
}

/** Removes whatever {@link installPicker} put in place. */
function uninstallPicker(): void {
  vi.unstubAllGlobals();
  Reflect.deleteProperty(navigator, 'contacts');
}

afterEach(() => {
  uninstallPicker();
});

// ============================================================================
// Feature Detection
// ============================================================================

describe('isContactPickerSupported', () => {
  it('is false on a browser without the API — the iOS and desktop case', () => {
    expect(isContactPickerSupported()).toBe(false);
  });

  it('is true once navigator.contacts and ContactsManager are both present', () => {
    installPicker();

    expect(isContactPickerSupported()).toBe(true);
  });

  it('is false on an insecure origin, which the API refuses outright', () => {
    installPicker();
    Object.defineProperty(window, 'isSecureContext', {
      value: false,
      configurable: true,
    });

    expect(isContactPickerSupported()).toBe(false);
  });

  it('is false when navigator.contacts exists but ContactsManager does not', () => {
    // The shape of the unrelated legacy `navigator.contacts` some older mobile
    // browsers shipped: present, but not this API.
    Object.defineProperty(navigator, 'contacts', {
      value: { find: vi.fn() },
      configurable: true,
    });
    Object.defineProperty(window, 'isSecureContext', {
      value: true,
      configurable: true,
    });

    expect(isContactPickerSupported()).toBe(false);
  });
});

// ============================================================================
// Normalization
// ============================================================================

describe('toPickedContact', () => {
  it('keeps the first name and the first number', () => {
    expect(
      toPickedContact({
        name: ['Mary Poppins', 'Aunt Mary'],
        tel: ['+33 6 12 34 56 78', '+33 1 23 45 67 89'],
      }),
    ).toEqual({ name: 'Mary Poppins', phone: '+33 6 12 34 56 78' });
  });

  it('collapses the ragged whitespace address books hold', () => {
    expect(toPickedContact({ name: ['  Mary   Poppins \n'] })).toEqual({
      name: 'Mary Poppins',
    });
  });

  it('skips blank entries rather than returning an empty string', () => {
    expect(toPickedContact({ name: ['', '   ', 'Mary'], tel: ['  ', '0612345678'] })).toEqual({
      name: 'Mary',
      phone: '0612345678',
    });
  });

  it('omits a field the contact does not have', () => {
    // A contact filed under a company has no person name; a name with no number
    // is just as ordinary. Both leave the matching form field for the user.
    expect(toPickedContact({ tel: ['0612345678'] })).toEqual({ phone: '0612345678' });
    expect(toPickedContact({ name: ['Mary'] })).toEqual({ name: 'Mary' });
    expect(toPickedContact({})).toEqual({});
  });

  it('ignores non-string entries a hostile or broken implementation could return', () => {
    expect(
      toPickedContact({ name: [null as unknown as string, 'Mary'] }),
    ).toEqual({ name: 'Mary' });
  });
});

// ============================================================================
// Picking
// ============================================================================

describe('pickContact', () => {
  it('reports unsupported without touching the API', async () => {
    await expect(pickContact()).resolves.toEqual({ status: 'unsupported' });
  });

  it('returns the contact the user chose', async () => {
    installPicker({
      select: vi.fn().mockResolvedValue([{ name: ['Mary'], tel: ['0612345678'] }]),
    });

    await expect(pickContact()).resolves.toEqual({
      status: 'picked',
      contact: { name: 'Mary', phone: '0612345678' },
    });
  });

  it('asks for one contact, and only for properties the browser supports', async () => {
    // `select()` throws on an unknown property, so a browser without `tel` must
    // be asked for `name` alone rather than for both.
    const fake = installPicker({
      getProperties: vi.fn().mockResolvedValue(['name', 'address']),
      select: vi.fn().mockResolvedValue([{ name: ['Mary'] }]),
    });

    await pickContact();

    expect(fake.select).toHaveBeenCalledWith(['name'], { multiple: false });
  });

  it('reports unsupported when the browser offers neither name nor tel', async () => {
    installPicker({
      getProperties: vi.fn().mockResolvedValue(['address', 'icon']),
    });

    await expect(pickContact()).resolves.toEqual({ status: 'unsupported' });
  });

  it('reads a dismissed sheet as cancelled, not as a failure', async () => {
    // The API resolves with an empty list when the user backs out; treating
    // that as an error would put a toast on the most common outcome.
    installPicker({ select: vi.fn().mockResolvedValue([]) });

    await expect(pickContact()).resolves.toEqual({ status: 'cancelled' });
  });

  it('reports a rejection as failed and carries the error', async () => {
    // What a missing user gesture, a second picker, or a nested frame produce.
    const error = new DOMException('Contacts Picker is already in use.', 'InvalidStateError');
    installPicker({ select: vi.fn().mockRejectedValue(error) });

    await expect(pickContact()).resolves.toEqual({ status: 'failed', error });
  });
});
