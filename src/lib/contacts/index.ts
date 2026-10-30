/**
 * @fileoverview Device address book barrel export.
 *
 * @module lib/contacts
 */

export {
  CONTACT_SEARCH_PLUGIN,
  CONTACTS_ASKED_KEY,
  MAX_CONTACT_SUGGESTIONS,
  ensureContactsAccess,
  isContactSearchAvailable,
  searchContacts,
  toContactSuggestions,
} from './contact-search';
export type { ContactSuggestion } from './contact-search';
