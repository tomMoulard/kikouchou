/**
 * @fileoverview Device address book barrel export.
 *
 * @module lib/contacts
 */

export {
  isContactPickerSupported,
  pickContact,
  toPickedContact,
} from './contact-picker';
export type { ContactPickOutcome, PickedContact } from './contact-picker';
