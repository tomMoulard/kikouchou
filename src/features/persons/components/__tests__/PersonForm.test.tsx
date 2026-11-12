/**
 * @fileoverview Tests for PersonForm component.
 * Tests rendering, validation, and submission flows.
 *
 * @module features/persons/components/__tests__/PersonForm.test
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@/test/utils';
import type { Person, PersonFormData, Trip } from '@/types';

/**
 * The DOM APIs Radix's `Select` reaches for and jsdom does not implement.
 * Without them the child-seat picker throws the moment it is opened.
 */
function installSelectPolyfills(): void {
  const proto = window.HTMLElement.prototype as unknown as Record<string, unknown>;
  proto.hasPointerCapture ??= () => false;
  proto.setPointerCapture ??= () => undefined;
  proto.releasePointerCapture ??= () => undefined;
  proto.scrollIntoView ??= () => undefined;
}

installSelectPolyfills();

// ============================================================================
// Mocks
// ============================================================================

const mockTrip: Trip = {
  id: 'trip-1' as Trip['id'],
  shareId: 'share-1' as Trip['shareId'],
  name: 'Test Trip',
  location: 'Alps',
  startDate: '2026-06-01' as Trip['startDate'],
  endDate: '2026-06-10' as Trip['endDate'],
  description: '',
  createdAt: Date.now(),
  updatedAt: Date.now(),
};

const existingPerson: Person = {
  id: 'person-1' as Person['id'],
  tripId: mockTrip.id,
  name: 'Alice',
  color: '#3b82f6' as Person['color'],
  stayStartDate: '2026-06-02' as NonNullable<Person['stayStartDate']>,
  stayEndDate: '2026-06-08' as NonNullable<Person['stayEndDate']>,
};

vi.mock('@/contexts/TripContext', () => ({
  useTripContext: vi.fn(() => ({
    currentTrip: mockTrip,
  })),
}));

vi.mock('@/contexts/PersonContext', () => ({
  usePersonContext: vi.fn(() => ({
    persons: [existingPerson],
  })),
}));

vi.mock('@/hooks', () => ({
  useFormSubmission: <T,>(onSubmit: (data: T) => Promise<void>) => ({
    isSubmitting: false,
    submitError: null,
    handleSubmit: onSubmit,
  }),
}));

vi.mock('@/components/shared/color-palette', () => ({
  DEFAULT_COLORS: ['#3b82f6', '#ef4444', '#22c55e'],
}));

vi.mock('@/components/shared/ColorPicker', () => ({
  ColorPicker: ({ value, onChange }: { value: string; onChange: (c: string) => void }) => (
    <button
      type="button"
      data-testid="color-picker"
      data-value={value}
      onClick={() => onChange('#ef4444')}
    >
      Color: {value}
    </button>
  ),
}));

// A stand-in with the real picker's shape: a named group of two inputs. The
// real one has its own tests; this one lets a test fill a stay in.
vi.mock('@/components/shared/DateRangePicker', () => ({
  DateRangePicker: ({
    value,
    onChange,
    'aria-label': label,
  }: {
    value: { from?: Date; to?: Date } | undefined;
    onChange: (range: { from?: Date; to?: Date } | undefined) => void;
    'aria-label'?: string;
  }) => {
    const toKey = (date: Date | undefined): string =>
      date
        ? `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
        : '';
    const fromKey = (key: string): Date | undefined =>
      key ? new Date(`${key}T00:00:00`) : undefined;
    return (
      <div data-testid="date-range-picker" role="group" aria-label={label}>
        <input
          aria-label="dateRangePicker.start"
          value={toKey(value?.from)}
          onChange={(event) => {
            onChange({ from: fromKey(event.target.value), to: value?.to });
          }}
        />
        <input
          aria-label="dateRangePicker.end"
          value={toKey(value?.to)}
          onChange={(event) => {
            onChange({ from: value?.from, to: fromKey(event.target.value) });
          }}
        />
      </div>
    );
  },
}));

vi.mock('@/lib/contacts', () => ({
  isContactSearchAvailable: vi.fn(() => false),
  ensureContactsAccess: vi.fn(),
  searchContacts: vi.fn(),
}));

import { PersonForm } from '../PersonForm';
import { useTripContext } from '@/contexts/TripContext';
import { usePersonContext } from '@/contexts/PersonContext';
import { ensureContactsAccess, isContactSearchAvailable, searchContacts } from '@/lib/contacts';

// ============================================================================
// Tests
// ============================================================================

describe('PersonForm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useTripContext).mockReturnValue({
      currentTrip: mockTrip,
    } as unknown as ReturnType<typeof useTripContext>);
    vi.mocked(usePersonContext).mockReturnValue({
      persons: [existingPerson],
    } as unknown as ReturnType<typeof usePersonContext>);
    // The website is the default here: no address book, a plain name field.
    vi.mocked(isContactSearchAvailable).mockReturnValue(false);
    vi.mocked(ensureContactsAccess).mockResolvedValue(true);
    vi.mocked(searchContacts).mockResolvedValue([]);
  });

  it('renders create mode with empty name field', () => {
    render(
      <PersonForm onSubmit={vi.fn()} onCancel={vi.fn()} />,
      { withProviders: false },
    );
    const nameInput = screen.getByLabelText(/persons\.name/);
    expect(nameInput).toHaveValue('');
  });

  it('renders edit mode with pre-filled name', () => {
    render(
      <PersonForm person={existingPerson} onSubmit={vi.fn()} onCancel={vi.fn()} />,
      { withProviders: false },
    );
    const nameInput = screen.getByLabelText(/persons\.name/);
    expect(nameInput).toHaveValue('Alice');
  });

  it('renders color picker', () => {
    render(
      <PersonForm onSubmit={vi.fn()} onCancel={vi.fn()} />,
      { withProviders: false },
    );
    expect(screen.getByTestId('color-picker')).toBeInTheDocument();
  });

  it('renders stay dates picker when trip context exists', () => {
    render(
      <PersonForm onSubmit={vi.fn()} onCancel={vi.fn()} />,
      { withProviders: false },
    );
    expect(screen.getByTestId('date-range-picker')).toBeInTheDocument();
  });

  it('renders optional notes field', () => {
    render(
      <PersonForm onSubmit={vi.fn()} onCancel={vi.fn()} />,
      { withProviders: false },
    );
    expect(screen.getByLabelText(/persons\.notes/)).toBeInTheDocument();
  });

  it('hides stay dates picker when no current trip', () => {
    vi.mocked(useTripContext).mockReturnValue({
      currentTrip: null,
    } as unknown as ReturnType<typeof useTripContext>);
    render(
      <PersonForm onSubmit={vi.fn()} onCancel={vi.fn()} />,
      { withProviders: false },
    );
    expect(screen.queryByTestId('date-range-picker')).not.toBeInTheDocument();
  });

  it('renders cancel and save buttons', () => {
    render(
      <PersonForm onSubmit={vi.fn()} onCancel={vi.fn()} />,
      { withProviders: false },
    );
    expect(screen.getByText('common.cancel')).toBeInTheDocument();
    expect(screen.getByText('common.save')).toBeInTheDocument();
  });

  it('calls onCancel when cancel button is clicked', async () => {
    const onCancel = vi.fn();
    const { user } = render(
      <PersonForm onSubmit={vi.fn()} onCancel={onCancel} />,
      { withProviders: false },
    );
    await user.click(screen.getByText('common.cancel'));
    expect(onCancel).toHaveBeenCalled();
  });

  it('shows validation error when submitting empty name', async () => {
    const onSubmit = vi.fn();
    const { user } = render(
      <PersonForm onSubmit={onSubmit} onCancel={vi.fn()} />,
      { withProviders: false },
    );
    await user.click(screen.getByText('common.save'));
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText('common.required')).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('calls onSubmit with form data when valid', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const { user } = render(
      <PersonForm onSubmit={onSubmit} onCancel={vi.fn()} />,
      { withProviders: false },
    );
    const nameInput = screen.getByLabelText(/persons\.name/);
    await user.type(nameInput, 'Bob');
    await user.click(screen.getByText('common.save'));
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Bob' }),
    );
  });

  it('calls onSubmit with correct data in edit mode', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const { user } = render(
      <PersonForm person={existingPerson} onSubmit={onSubmit} onCancel={vi.fn()} />,
      { withProviders: false },
    );
    await user.click(screen.getByText('common.save'));
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Alice' }),
    );
  });

  it('shows name validation error on blur', async () => {
    const { user } = render(
      <PersonForm onSubmit={vi.fn()} onCancel={vi.fn()} />,
      { withProviders: false },
    );
    const nameInput = screen.getByLabelText(/persons\.name/);
    await user.click(nameInput);
    await user.tab(); // blur
    expect(screen.getByText('common.required')).toBeInTheDocument();
  });

  it('clears validation error when typing', async () => {
    const { user } = render(
      <PersonForm onSubmit={vi.fn()} onCancel={vi.fn()} />,
      { withProviders: false },
    );
    // Trigger error first
    await user.click(screen.getByText('common.save'));
    expect(screen.getByText('common.required')).toBeInTheDocument();
    // Type to clear
    const nameInput = screen.getByLabelText(/persons\.name/);
    await user.type(nameInput, 'A');
    expect(screen.queryByText('common.required')).not.toBeInTheDocument();
  });

  it('keeps the headcount field collapsed by default in create mode', () => {
    render(
      <PersonForm onSubmit={vi.fn()} onCancel={vi.fn()} />,
      { withProviders: false },
    );
    expect(screen.getByRole('button', { name: /persons\.moreDetails/ })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    expect(screen.queryByLabelText(/persons\.headcount/)).not.toBeInTheDocument();
  });

  it('reveals a headcount field defaulting to 1 when the section is opened', async () => {
    const { user } = render(
      <PersonForm onSubmit={vi.fn()} onCancel={vi.fn()} />,
      { withProviders: false },
    );
    await user.click(screen.getByRole('button', { name: /persons\.moreDetails/ }));
    expect(screen.getByLabelText(/persons\.headcount/)).toHaveValue(1);
  });

  it('submits the headcount entered in the collapsible section', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const { user } = render(
      <PersonForm onSubmit={onSubmit} onCancel={vi.fn()} />,
      { withProviders: false },
    );
    await user.type(screen.getByLabelText(/persons\.name/), 'Alice+Auré');
    await user.click(screen.getByRole('button', { name: /persons\.moreDetails/ }));

    const headcountInput = screen.getByLabelText(/persons\.headcount/);
    await user.clear(headcountInput);
    await user.type(headcountInput, '2');
    await user.click(screen.getByText('common.save'));

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Alice+Auré', headcount: 2 }),
    );
  });

  it('submits a headcount of 1 when the section is never opened', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const { user } = render(
      <PersonForm onSubmit={onSubmit} onCancel={vi.fn()} />,
      { withProviders: false },
    );
    await user.type(screen.getByLabelText(/persons\.name/), 'Tom');
    await user.click(screen.getByText('common.save'));

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Tom', headcount: 1 }),
    );
  });

  it('clamps an out-of-range headcount back into bounds on blur', async () => {
    const { user } = render(
      <PersonForm onSubmit={vi.fn()} onCancel={vi.fn()} />,
      { withProviders: false },
    );
    await user.click(screen.getByRole('button', { name: /persons\.moreDetails/ }));

    const headcountInput = screen.getByLabelText(/persons\.headcount/);
    await user.clear(headcountInput);
    await user.type(headcountInput, '0');
    await user.tab();

    expect(headcountInput).toHaveValue(1);
  });

  it('opens the section pre-filled when editing a multi-person guest', () => {
    render(
      <PersonForm
        person={{ ...existingPerson, headcount: 2 }}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
      />,
      { withProviders: false },
    );
    expect(screen.getByRole('button', { name: /persons\.moreDetails/ })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    expect(screen.getByLabelText(/persons\.headcount/)).toHaveValue(2);
  });

  it('submits no child seat when the picker is left on "none needed"', async () => {
    // Absent is the answer for every adult; a form that defaulted to a seat
    // would have every guest asking a car for a booster.
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const { user } = render(
      <PersonForm onSubmit={onSubmit} onCancel={vi.fn()} />,
      { withProviders: false },
    );
    await user.type(screen.getByLabelText(/persons\.name/), 'Tom');
    await user.click(screen.getByRole('button', { name: /persons\.moreDetails/ }));

    expect(screen.getByRole('combobox', { name: 'childSeats.label' })).toHaveTextContent(
      'childSeats.none',
    );

    await user.click(screen.getByText('common.save'));

    const submitted = onSubmit.mock.calls[0]?.[0] as PersonFormData;
    expect(submitted.name).toBe('Tom');
    expect(submitted.childSeat).toBeUndefined();
  });

  it('submits the child seat kind the user declares', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const { user } = render(
      <PersonForm onSubmit={onSubmit} onCancel={vi.fn()} />,
      { withProviders: false },
    );
    await user.type(screen.getByLabelText(/persons\.name/), 'Lila');
    await user.click(screen.getByRole('button', { name: /persons\.moreDetails/ }));
    await user.click(screen.getByRole('combobox', { name: 'childSeats.label' }));
    await user.click(await screen.findByRole('option', { name: 'childSeats.booster' }));
    await user.click(screen.getByText('common.save'));

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Lila', childSeat: 'booster' }),
    );
  });

  it('opens the section pre-filled when editing a guest who needs a seat', () => {
    render(
      <PersonForm
        person={{ ...existingPerson, childSeat: 'rearFacing' }}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
      />,
      { withProviders: false },
    );
    expect(screen.getByRole('button', { name: /persons\.moreDetails/ })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    expect(screen.getByRole('combobox', { name: 'childSeats.label' })).toHaveTextContent(
      'childSeats.rearFacing',
    );
  });

  it('clears the seat rather than storing one when "none needed" is picked back', async () => {
    // The seat a child needs changes as they grow; the form has to be able to
    // say "not any more" without leaving a fourth kind behind that means none.
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const { user } = render(
      <PersonForm
        person={{ ...existingPerson, childSeat: 'booster' }}
        onSubmit={onSubmit}
        onCancel={vi.fn()}
      />,
      { withProviders: false },
    );
    await user.click(screen.getByRole('combobox', { name: 'childSeats.label' }));
    await user.click(await screen.findByRole('option', { name: 'childSeats.none' }));
    await user.click(screen.getByText('common.save'));

    const submitted = onSubmit.mock.calls[0]?.[0] as PersonFormData;
    expect(submitted.name).toBe('Alice');
    expect(submitted.childSeat).toBeUndefined();
  });

  it('reports the form dirty when only the child seat changes', async () => {
    // The comparator scar, one layer up: a field missing from the dirty check
    // makes the unsaved-changes guard wave the edit away.
    const onDirtyChange = vi.fn();
    const { user } = render(
      <PersonForm
        person={existingPerson}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
        onDirtyChange={onDirtyChange}
      />,
      { withProviders: false },
    );
    await user.click(screen.getByRole('button', { name: /persons\.moreDetails/ }));
    await user.click(screen.getByRole('combobox', { name: 'childSeats.label' }));
    await user.click(await screen.findByRole('option', { name: 'childSeats.forwardFacing' }));

    expect(onDirtyChange).toHaveBeenLastCalledWith(true);
  });

  it('reports dirty state changes via onDirtyChange', async () => {
    const onDirtyChange = vi.fn();
    const { user } = render(
      <PersonForm
        person={existingPerson}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
        onDirtyChange={onDirtyChange}
      />,
      { withProviders: false },
    );
    const nameInput = screen.getByLabelText(/persons\.name/);
    await user.type(nameInput, 'X');
    expect(onDirtyChange).toHaveBeenCalledWith(true);
  });

  // ==========================================================================
  // Phone number
  // ==========================================================================

  describe('phone number', () => {
    it('renders the optional phone field', () => {
      render(<PersonForm onSubmit={vi.fn()} onCancel={vi.fn()} />, { withProviders: false });

      expect(screen.getByLabelText(/persons\.phone/)).toHaveValue('');
    });

    it('pre-fills the phone when editing a guest that has one', () => {
      render(
        <PersonForm
          person={{ ...existingPerson, phone: '+33 6 12 34 56 78' }}
          onSubmit={vi.fn()}
          onCancel={vi.fn()}
        />,
        { withProviders: false },
      );

      expect(screen.getByLabelText(/persons\.phone/)).toHaveValue('+33 6 12 34 56 78');
    });

    it('submits the trimmed phone', async () => {
      const onSubmit = vi.fn().mockResolvedValue(undefined);
      const { user } = render(<PersonForm onSubmit={onSubmit} onCancel={vi.fn()} />, {
        withProviders: false,
      });

      await user.type(screen.getByLabelText(/persons\.name/), 'Mary');
      await user.type(screen.getByLabelText(/persons\.phone/), '  0612345678  ');
      await user.click(screen.getByText('common.save'));

      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Mary', phone: '0612345678' }),
      );
    });

    it('submits no phone at all when the field is left empty', async () => {
      const onSubmit = vi.fn().mockResolvedValue(undefined);
      const { user } = render(<PersonForm onSubmit={onSubmit} onCancel={vi.fn()} />, {
        withProviders: false,
      });

      await user.type(screen.getByLabelText(/persons\.name/), 'Mary');
      await user.click(screen.getByText('common.save'));

      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Mary', phone: undefined }),
      );
    });

    it('counts a phone edit as a dirty change', async () => {
      // The unsaved-changes guard reads this; a field missing from the dirty
      // check lets an edit be discarded without a warning.
      const onDirtyChange = vi.fn();
      const { user } = render(
        <PersonForm
          person={existingPerson}
          onSubmit={vi.fn()}
          onCancel={vi.fn()}
          onDirtyChange={onDirtyChange}
        />,
        { withProviders: false },
      );

      await user.type(screen.getByLabelText(/persons\.phone/), '06');

      expect(onDirtyChange).toHaveBeenCalledWith(true);
    });
  });

  // ==========================================================================
  // Suggestions from the device address book
  // ==========================================================================

  describe('contact suggestions', () => {
    const MARY = { id: '0:0', name: 'Mary Poppins', phone: '+33 6 12 34 56 78' };
    const MARY_WORK = { id: '0:1', name: 'Mary Poppins', phone: '+44 20 7946 0000' };
    const MARIE = { id: '1', name: 'Marie Curie' };

    /** Lets the access answer and an empty search land inside act(). */
    async function flush(): Promise<void> {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
    }

    function inApp(): void {
      vi.mocked(isContactSearchAvailable).mockReturnValue(true);
    }

    it('is a plain text field on the web, and never asks for the contacts', async () => {
      const { user } = render(<PersonForm onSubmit={vi.fn()} onCancel={vi.fn()} />, {
        withProviders: false,
      });

      await user.type(screen.getByLabelText(/persons\.name/), 'Mar');

      expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
      expect(ensureContactsAccess).not.toHaveBeenCalled();
      expect(searchContacts).not.toHaveBeenCalled();
    });

    it('has no contacts button, in the app or on the web', () => {
      inApp();
      render(<PersonForm onSubmit={vi.fn()} onCancel={vi.fn()} />, { withProviders: false });

      expect(screen.queryByRole('button', { name: /contact/i })).not.toBeInTheDocument();
    });

    it('asks for access on the first letter, and only once', async () => {
      inApp();
      const { user } = render(<PersonForm onSubmit={vi.fn()} onCancel={vi.fn()} />, {
        withProviders: false,
      });

      await user.type(screen.getByRole('combobox'), 'M');
      await flush();
      expect(ensureContactsAccess).toHaveBeenCalledTimes(1);

      await user.type(screen.getByRole('combobox'), 'ary');
      await waitFor(() => expect(searchContacts).toHaveBeenLastCalledWith('Mary'));
      expect(ensureContactsAccess).toHaveBeenCalledTimes(1);
      await flush();
    });

    it('lists the matching contacts, one line per number', async () => {
      inApp();
      vi.mocked(searchContacts).mockResolvedValue([MARY, MARY_WORK, MARIE]);
      const { user } = render(<PersonForm onSubmit={vi.fn()} onCancel={vi.fn()} />, {
        withProviders: false,
      });

      await user.type(screen.getByRole('combobox'), 'Mar');

      expect(await screen.findByRole('option', { name: /\+33 6 12 34 56 78/ })).toBeInTheDocument();
      expect(screen.getByRole('option', { name: /\+44 20 7946 0000/ })).toBeInTheDocument();
      expect(screen.getByRole('option', { name: /Marie Curie/ })).toBeInTheDocument();
      expect(screen.getByText('persons.contactSuggestions')).toBeInTheDocument();
      expect(screen.getByRole('combobox')).toHaveAttribute('aria-expanded', 'true');
    });

    it('fills in the name and the number of the line the user picked', async () => {
      inApp();
      vi.mocked(searchContacts).mockResolvedValue([MARY, MARY_WORK]);
      const { user } = render(<PersonForm onSubmit={vi.fn()} onCancel={vi.fn()} />, {
        withProviders: false,
      });

      await user.type(screen.getByRole('combobox'), 'Mar');
      await user.click(await screen.findByRole('option', { name: /\+44 20 7946 0000/ }));

      expect(screen.getByLabelText(/persons\.name/)).toHaveValue('Mary Poppins');
      expect(screen.getByLabelText(/persons\.phone/)).toHaveValue('+44 20 7946 0000');
      expect(screen.queryByRole('option')).not.toBeInTheDocument();
    });

    it('picks with the keyboard, without leaving the field', async () => {
      inApp();
      vi.mocked(searchContacts).mockResolvedValue([MARY]);
      const { user } = render(<PersonForm onSubmit={vi.fn()} onCancel={vi.fn()} />, {
        withProviders: false,
      });

      await user.type(screen.getByRole('combobox'), 'Mar');
      await screen.findByRole('option', { name: /Mary Poppins/ });
      await user.keyboard('{Enter}');

      expect(screen.getByLabelText(/persons\.name/)).toHaveValue('Mary Poppins');
      expect(screen.getByLabelText(/persons\.phone/)).toHaveValue('+33 6 12 34 56 78');
    });

    it('keeps a typed number when the picked contact has none', async () => {
      inApp();
      vi.mocked(searchContacts).mockResolvedValue([MARIE]);
      const { user } = render(<PersonForm onSubmit={vi.fn()} onCancel={vi.fn()} />, {
        withProviders: false,
      });

      await user.type(screen.getByLabelText(/persons\.phone/), '0612345678');
      await user.type(screen.getByRole('combobox'), 'Mar');
      await user.click(await screen.findByRole('option', { name: /Marie Curie/ }));

      expect(screen.getByLabelText(/persons\.name/)).toHaveValue('Marie Curie');
      expect(screen.getByLabelText(/persons\.phone/)).toHaveValue('0612345678');
    });

    it('clears the required-name error a pick has just satisfied', async () => {
      inApp();
      vi.mocked(searchContacts).mockResolvedValue([MARY]);
      const { user } = render(<PersonForm onSubmit={vi.fn()} onCancel={vi.fn()} />, {
        withProviders: false,
      });

      await user.click(screen.getByText('common.save'));
      expect(screen.getByText('common.required')).toBeInTheDocument();

      await user.type(screen.getByRole('combobox'), 'M');
      await user.click(await screen.findByRole('option', { name: /Mary Poppins/ }));

      expect(screen.queryByText('common.required')).not.toBeInTheDocument();
    });

    it('stays a working text field when access is refused, and never searches', async () => {
      inApp();
      vi.mocked(ensureContactsAccess).mockResolvedValue(false);
      const { user } = render(<PersonForm onSubmit={vi.fn()} onCancel={vi.fn()} />, {
        withProviders: false,
      });

      const field = screen.getByLabelText(/persons\.name/);
      await user.type(field, 'Mary');

      expect(field).toHaveValue('Mary');
      // The refusal did not remount the field under the user's finger.
      expect(field).toHaveFocus();
      expect(searchContacts).not.toHaveBeenCalled();
      expect(ensureContactsAccess).toHaveBeenCalledTimes(1);
      expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    it('closes the list on Escape and opens it again on the next letter', async () => {
      inApp();
      vi.mocked(searchContacts).mockResolvedValue([MARY]);
      const { user } = render(<PersonForm onSubmit={vi.fn()} onCancel={vi.fn()} />, {
        withProviders: false,
      });

      await user.type(screen.getByRole('combobox'), 'Ma');
      await screen.findByRole('option', { name: /Mary Poppins/ });
      await user.keyboard('{Escape}');
      expect(screen.queryByRole('option')).not.toBeInTheDocument();

      await user.type(screen.getByRole('combobox'), 'r');
      expect(await screen.findByRole('option', { name: /Mary Poppins/ })).toBeInTheDocument();
    });

    it('drops an answer for an older query', async () => {
      inApp();
      let answerOld: (value: readonly (typeof MARY)[]) => void = () => undefined;
      vi.mocked(searchContacts).mockImplementation(async (query: string) =>
        query === 'M'
          ? new Promise((resolve) => {
              answerOld = resolve;
            })
          : [MARIE],
      );
      const { user } = render(<PersonForm onSubmit={vi.fn()} onCancel={vi.fn()} />, {
        withProviders: false,
      });

      await user.type(screen.getByRole('combobox'), 'M');
      await waitFor(() => expect(searchContacts).toHaveBeenCalledWith('M'));
      await user.type(screen.getByRole('combobox'), 'arie');
      await screen.findByRole('option', { name: /Marie Curie/ });

      answerOld([MARY]);
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(screen.queryByRole('option', { name: /Mary Poppins/ })).not.toBeInTheDocument();
    });
  });
});

// ============================================================================
// A guest who comes back
// ============================================================================

describe('PersonForm further stays', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useTripContext).mockReturnValue({
      currentTrip: mockTrip,
    } as unknown as ReturnType<typeof useTripContext>);
    vi.mocked(usePersonContext).mockReturnValue({
      persons: [existingPerson],
    } as unknown as ReturnType<typeof usePersonContext>);
    vi.mocked(isContactSearchAvailable).mockReturnValue(false);
  });

  /** The pickers of the further stays, in order. */
  const extraStayGroups = () => screen.getAllByRole('group', { name: 'persons.extraStayLabel' });

  function pick(group: HTMLElement, start: string, end: string): void {
    fireEvent.change(within(group).getByLabelText('dateRangePicker.start'), {
      target: { value: start },
    });
    fireEvent.change(within(group).getByLabelText('dateRangePicker.end'), {
      target: { value: end },
    });
  }

  it('adds a stay, and sends it after the first one', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const { user } = render(
      <PersonForm person={existingPerson} onSubmit={onSubmit} onCancel={vi.fn()} />,
      { withProviders: false },
    );

    await user.click(screen.getByRole('button', { name: 'persons.addStay' }));
    pick(extraStayGroups()[0]!, '2026-07-01', '2026-07-05');
    await user.click(screen.getByText('common.save'));

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        stayStartDate: '2026-06-02',
        stayEndDate: '2026-06-08',
        extraStays: [{ startDate: '2026-07-01', endDate: '2026-07-05' }],
      }),
    );
  });

  it('shows the stored further stays, and clears them when removed', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const returning: Person = {
      ...existingPerson,
      extraStays: [
        { startDate: '2026-07-01' as never, endDate: '2026-07-05' as never },
      ],
    };
    const { user } = render(
      <PersonForm person={returning} onSubmit={onSubmit} onCancel={vi.fn()} />,
      { withProviders: false },
    );

    expect(within(extraStayGroups()[0]!).getByLabelText('dateRangePicker.start')).toHaveValue(
      '2026-07-01',
    );
    await user.click(screen.getByRole('button', { name: 'persons.removeStay' }));
    await user.click(screen.getByText('common.save'));

    // Sent as `undefined`, which removes the stored list.
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ extraStays: undefined }));
  });

  it('refuses a further stay with only one day, and says so', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const { user } = render(
      <PersonForm person={existingPerson} onSubmit={onSubmit} onCancel={vi.fn()} />,
      { withProviders: false },
    );

    await user.click(screen.getByRole('button', { name: 'persons.addStay' }));
    fireEvent.change(within(extraStayGroups()[0]!).getByLabelText('dateRangePicker.start'), {
      target: { value: '2026-07-01' },
    });
    await user.click(screen.getByText('common.save'));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('persons.stayIncomplete');
  });

  it('reports an added stay as an unsaved change', async () => {
    const onDirtyChange = vi.fn();
    const { user } = render(
      <PersonForm
        person={existingPerson}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
        onDirtyChange={onDirtyChange}
      />,
      { withProviders: false },
    );

    await user.click(screen.getByRole('button', { name: 'persons.addStay' }));
    pick(extraStayGroups()[0]!, '2026-07-01', '2026-07-05');

    await waitFor(() => {
      expect(onDirtyChange).toHaveBeenLastCalledWith(true);
    });
  });
});
