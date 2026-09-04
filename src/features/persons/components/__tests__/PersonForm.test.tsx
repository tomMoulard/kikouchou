/**
 * @fileoverview Tests for PersonForm component.
 * Tests rendering, validation, and submission flows.
 *
 * @module features/persons/components/__tests__/PersonForm.test
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@/test/utils';
import type { Person, Trip } from '@/types';

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

vi.mock('@/components/shared/ColorPicker', () => ({
  DEFAULT_COLORS: ['#3b82f6', '#ef4444', '#22c55e'],
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

vi.mock('@/components/shared/DateRangePicker', () => ({
  DateRangePicker: () => <div data-testid="date-range-picker" />,
}));

vi.mock('@/lib/contacts', () => ({
  isContactPickerSupported: vi.fn(() => false),
  pickContact: vi.fn(),
}));

import { PersonForm } from '../PersonForm';
import { useTripContext } from '@/contexts/TripContext';
import { usePersonContext } from '@/contexts/PersonContext';
import { isContactPickerSupported, pickContact } from '@/lib/contacts';

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
    // The browsers without the Contact Picker API — every one on iOS, and every
    // desktop — are the default here, so the manual field is what most tests see.
    vi.mocked(isContactPickerSupported).mockReturnValue(false);
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
  // Importing from the device address book
  // ==========================================================================

  describe('import from contacts', () => {
    it('hides the button on a browser without the Contact Picker API', () => {
      render(<PersonForm onSubmit={vi.fn()} onCancel={vi.fn()} />, { withProviders: false });

      expect(
        screen.queryByRole('button', { name: /persons\.importFromContacts/ }),
      ).not.toBeInTheDocument();
    });

    it('fills in the name and the phone of the contact the user picked', async () => {
      vi.mocked(isContactPickerSupported).mockReturnValue(true);
      vi.mocked(pickContact).mockResolvedValue({
        status: 'picked',
        contact: { name: 'Mary Poppins', phone: '+33 6 12 34 56 78' },
      });
      const { user } = render(<PersonForm onSubmit={vi.fn()} onCancel={vi.fn()} />, {
        withProviders: false,
      });

      await user.click(screen.getByRole('button', { name: /persons\.importFromContacts/ }));

      expect(screen.getByLabelText(/persons\.name/)).toHaveValue('Mary Poppins');
      expect(screen.getByLabelText(/persons\.phone/)).toHaveValue('+33 6 12 34 56 78');
    });

    it('leaves a field the contact has nothing for alone', async () => {
      // Importing a number-less contact must not wipe a name already typed.
      vi.mocked(isContactPickerSupported).mockReturnValue(true);
      vi.mocked(pickContact).mockResolvedValue({
        status: 'picked',
        contact: { name: 'Mary' },
      });
      const { user } = render(<PersonForm onSubmit={vi.fn()} onCancel={vi.fn()} />, {
        withProviders: false,
      });

      await user.type(screen.getByLabelText(/persons\.phone/), '0612345678');
      await user.click(screen.getByRole('button', { name: /persons\.importFromContacts/ }));

      expect(screen.getByLabelText(/persons\.name/)).toHaveValue('Mary');
      expect(screen.getByLabelText(/persons\.phone/)).toHaveValue('0612345678');
    });

    it('clears the required-name error the import has just satisfied', async () => {
      vi.mocked(isContactPickerSupported).mockReturnValue(true);
      vi.mocked(pickContact).mockResolvedValue({
        status: 'picked',
        contact: { name: 'Mary' },
      });
      const { user } = render(<PersonForm onSubmit={vi.fn()} onCancel={vi.fn()} />, {
        withProviders: false,
      });

      await user.click(screen.getByText('common.save'));
      expect(screen.getByRole('alert')).toHaveTextContent('common.required');

      await user.click(screen.getByRole('button', { name: /persons\.importFromContacts/ }));

      expect(screen.queryByText('common.required')).not.toBeInTheDocument();
    });

    it('says nothing when the user dismisses the picker', async () => {
      // Backing out is the most common outcome; a message on it would be noise.
      vi.mocked(isContactPickerSupported).mockReturnValue(true);
      vi.mocked(pickContact).mockResolvedValue({ status: 'cancelled' });
      const { user } = render(<PersonForm onSubmit={vi.fn()} onCancel={vi.fn()} />, {
        withProviders: false,
      });

      await user.type(screen.getByLabelText(/persons\.name/), 'Typed by hand');
      await user.click(screen.getByRole('button', { name: /persons\.importFromContacts/ }));

      expect(screen.getByLabelText(/persons\.name/)).toHaveValue('Typed by hand');
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    it('explains a failure and points at the manual fields', async () => {
      vi.mocked(isContactPickerSupported).mockReturnValue(true);
      vi.mocked(pickContact).mockResolvedValue({
        status: 'failed',
        error: new Error('Contacts Picker is already in use.'),
      });
      const { user } = render(<PersonForm onSubmit={vi.fn()} onCancel={vi.fn()} />, {
        withProviders: false,
      });

      await user.click(screen.getByRole('button', { name: /persons\.importFromContacts/ }));

      // Queried by message rather than by role: leaving the autofocused empty
      // name field also raises its own `role="alert"`, as it does for any click.
      expect(screen.getByText('persons.contactFailed')).toBeInTheDocument();
    });

    it('reports a contact that carries neither a name nor a number', async () => {
      vi.mocked(isContactPickerSupported).mockReturnValue(true);
      vi.mocked(pickContact).mockResolvedValue({ status: 'picked', contact: {} });
      const { user } = render(<PersonForm onSubmit={vi.fn()} onCancel={vi.fn()} />, {
        withProviders: false,
      });

      await user.click(screen.getByRole('button', { name: /persons\.importFromContacts/ }));

      expect(screen.getByText('persons.contactEmpty')).toBeInTheDocument();
    });
  });
});
