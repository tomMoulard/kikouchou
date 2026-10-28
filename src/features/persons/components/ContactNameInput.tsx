/**
 * @fileoverview The guest name field, with suggestions from the address book.
 *
 * In a store app, typing a name lists the matching contacts under the field,
 * the way the trip form lists places. Picking one fills the name and, when the
 * line carries one, the phone number. Nothing else has to be pressed: the
 * permission is asked for on the first letter typed, once per device (see
 * `lib/contacts/contact-search`).
 *
 * On the web, and in an app where the user refused access, it is a plain text
 * field. A combobox with nothing behind it would announce a list that never
 * comes.
 *
 * @module features/persons/components/ContactNameInput
 */

import {
  type ChangeEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  memo,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import { BookUser } from 'lucide-react';

import { Input } from '@/components/ui/input';
import {
  Command,
  CommandGroup,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from '@/components/ui/popover';
import {
  type ContactSuggestion,
  ensureContactsAccess,
  isContactSearchAvailable,
  searchContacts,
} from '@/lib/contacts';

// ============================================================================
// Constants
// ============================================================================

/** The address book is on the device, so a short pause is enough. */
const DEBOUNCE_MS = 150;

/**
 * The keys cmdk handles on its own root, sent on to it while focus stays in
 * the input. Same reason as in `LocationAutocomplete`.
 */
const FORWARDED_KEYS: ReadonlySet<string> = new Set([
  'ArrowDown',
  'ArrowUp',
  'Home',
  'End',
  'Enter',
]);

// ============================================================================
// Type Definitions
// ============================================================================

interface ContactNameInputProps {
  readonly id: string;
  readonly value: string;
  /** Called with the new text on every keystroke. */
  readonly onChange: (value: string) => void;
  /** Called when a contact is picked from the list. */
  readonly onPickContact: (contact: ContactSuggestion) => void;
  readonly onBlur?: () => void;
  readonly placeholder?: string;
  readonly disabled?: boolean;
  readonly autoFocus?: boolean;
  readonly 'aria-invalid'?: boolean;
  readonly 'aria-describedby'?: string;
}

// ============================================================================
// Component
// ============================================================================

const ContactNameInput = memo(function ContactNameInput({
  id,
  value,
  onChange,
  onPickContact,
  onBlur,
  placeholder,
  disabled = false,
  autoFocus = false,
  'aria-invalid': ariaInvalid,
  'aria-describedby': ariaDescribedBy,
}: ContactNameInputProps) {
  const { t } = useTranslation();
  // Read once: the plugin cannot appear or vanish while the form is open.
  const [isAvailable] = useState(isContactSearchAvailable);
  // `undefined` until the first letter asks; then the answer for this form.
  const [hasAccess, setHasAccess] = useState<boolean | undefined>(undefined);
  const [suggestions, setSuggestions] = useState<readonly ContactSuggestion[]>([]);
  const [isDismissed, setIsDismissed] = useState(true);
  const accessRef = useRef<Promise<boolean> | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchIdRef = useRef(0);
  const isMountedRef = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const commandRef = useRef<HTMLDivElement>(null);
  const listboxId = useId();

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, []);

  /**
   * Asks for access once per form, and searches when it is given.
   *
   * The latest query wins: a slower answer for an older one is dropped.
   */
  const runSearch = useCallback(async (query: string) => {
    const searchId = ++searchIdRef.current;
    accessRef.current ??= ensureContactsAccess();
    const granted = await accessRef.current;
    if (!isMountedRef.current) {
      return;
    }
    setHasAccess(granted);
    if (!granted || query.trim().length === 0) {
      setSuggestions([]);
      return;
    }
    const results = await searchContacts(query);
    if (isMountedRef.current && searchId === searchIdRef.current) {
      setSuggestions(results);
    }
  }, []);

  const handleChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const next = event.target.value;
      onChange(next);
      if (!isAvailable || hasAccess === false) {
        return;
      }
      setIsDismissed(false);
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
      // The first letter asks at once rather than after the pause, so the
      // permission prompt answers the keystroke that caused it.
      if (accessRef.current === null) {
        void runSearch(next);
        return;
      }
      debounceRef.current = setTimeout(() => {
        void runSearch(next);
      }, DEBOUNCE_MS);
    },
    [hasAccess, isAvailable, onChange, runSearch],
  );

  const handleSelect = useCallback(
    (contact: ContactSuggestion) => {
      searchIdRef.current++;
      setIsDismissed(true);
      setSuggestions([]);
      onPickContact(contact);
      inputRef.current?.focus();
    },
    [onPickContact],
  );

  const handleOpenChange = useCallback((open: boolean) => {
    if (!open) {
      setIsDismissed(true);
    }
  }, []);

  const isOpen = !isDismissed && suggestions.length > 0;

  const handleKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLInputElement>) => {
      if (!isOpen || !FORWARDED_KEYS.has(event.key)) {
        return;
      }
      event.preventDefault();
      commandRef.current?.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: event.key,
          code: event.code,
          bubbles: true,
          cancelable: true,
        }),
      );
    },
    [isOpen],
  );

  const input = (
    <Input
      ref={inputRef}
      id={id}
      type="text"
      value={value}
      onChange={handleChange}
      onKeyDown={handleKeyDown}
      onBlur={onBlur}
      placeholder={placeholder}
      aria-invalid={ariaInvalid}
      aria-describedby={ariaDescribedBy}
      disabled={disabled}
      // eslint-disable-next-line jsx-a11y/no-autofocus -- Passed through from PersonForm, which explains why.
      autoFocus={autoFocus}
      {...(isAvailable && hasAccess !== false
        ? {
            autoComplete: 'off',
            role: 'combobox',
            'aria-expanded': isOpen,
            'aria-haspopup': 'listbox' as const,
            'aria-autocomplete': 'list' as const,
            'aria-controls': isOpen ? listboxId : undefined,
          }
        : {})}
    />
  );

  // Branches on `isAvailable` alone, which never changes: switching the tree
  // when access is refused would remount the input under the user's finger
  // and drop the keyboard.
  if (!isAvailable) {
    return input;
  }

  return (
    <Popover open={isOpen} onOpenChange={handleOpenChange}>
      {/* An anchor, not a trigger: see the note in `LocationAutocomplete`. */}
      <PopoverAnchor asChild>
        <div>{input}</div>
      </PopoverAnchor>
      <PopoverContent
        className="w-[--radix-popover-trigger-width] p-0"
        align="start"
        onOpenAutoFocus={(event) => {
          // Keep the keyboard on the field.
          event.preventDefault();
        }}
      >
        <Command ref={commandRef} shouldFilter={false} id={listboxId}>
          <CommandList>
            <CommandGroup heading={t('persons.contactSuggestions', 'From your contacts')}>
              {suggestions.map((contact) => (
                <CommandItem
                  key={contact.id}
                  value={contact.id}
                  onSelect={() => handleSelect(contact)}
                  className="flex items-start gap-3 py-2"
                >
                  <BookUser
                    className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                    aria-hidden="true"
                  />
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="truncate font-medium">{contact.name}</span>
                    {contact.phone && (
                      <span className="truncate text-xs text-muted-foreground tabular-nums">
                        {contact.phone}
                      </span>
                    )}
                  </div>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
});

// ============================================================================
// Exports
// ============================================================================

export { ContactNameInput };
export type { ContactNameInputProps };
