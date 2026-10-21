/**
 * @fileoverview Tests for the trip description card: rendered by default,
 * edited in place, saved on its own.
 *
 * @module features/trips/components/__tests__/TripDescriptionCard.test
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import userEvent from '@testing-library/user-event';

import { act, fireEvent, render, screen, waitFor } from '@/test/utils';
import { TripDescriptionCard } from '@/features/trips/components/TripDescriptionCard';

const mockErrorToast = vi.fn();

vi.mock('@/lib/notifications', () => ({
  notify: { error: (...args: unknown[]) => mockErrorToast(...args) },
}));

const EDIT = { name: 'trips.descriptionEdit.editAria' };
const EDITOR = { name: 'trips.description' };

describe('TripDescriptionCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the description as Markdown', () => {
    render(
      <TripDescriptionCard description="Code **1234**" canEdit onSave={vi.fn()} />,
      { withProviders: false },
    );
    expect(screen.getByText('1234').tagName).toBe('STRONG');
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('invites a member to write one when there is none', () => {
    render(<TripDescriptionCard description={undefined} canEdit onSave={vi.fn()} />, {
      withProviders: false,
    });
    expect(screen.getByText('trips.descriptionEdit.emptyEditable')).toBeInTheDocument();
  });

  it('shows a viewer the text and no edit button', () => {
    render(
      <TripDescriptionCard description="   " canEdit={false} onSave={vi.fn()} />,
      { withProviders: false },
    );
    expect(screen.getByText('trips.descriptionEdit.empty')).toBeInTheDocument();
    expect(screen.queryByRole('button', EDIT)).toBeNull();
  });

  it('swaps the text for the editor, and Cancel puts it back untouched', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    const onDirtyChange = vi.fn();
    render(
      <TripDescriptionCard
        description="Old"
        canEdit
        onSave={onSave}
        onDirtyChange={onDirtyChange}
      />,
      { withProviders: false },
    );

    await user.click(screen.getByRole('button', EDIT));
    const editor = screen.getByRole('textbox', EDITOR);
    expect(editor).toHaveValue('Old');
    expect(editor).toHaveFocus();

    await user.type(editor, ' draft');
    expect(onDirtyChange).toHaveBeenLastCalledWith(true);

    await user.click(screen.getByRole('button', { name: 'common.cancel' }));
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.getByText('Old')).toBeInTheDocument();
    expect(onSave).not.toHaveBeenCalled();
    expect(onDirtyChange).toHaveBeenLastCalledWith(false);
    // Focus goes back where the user left from.
    expect(screen.getByRole('button', EDIT)).toHaveFocus();

    // Opening again starts from what is stored, not from the abandoned draft.
    await user.click(screen.getByRole('button', EDIT));
    expect(screen.getByRole('textbox', EDITOR)).toHaveValue('Old');
  });

  it('cancels on Escape', async () => {
    const user = userEvent.setup();
    render(<TripDescriptionCard description="Old" canEdit onSave={vi.fn()} />, {
      withProviders: false,
    });
    await user.click(screen.getByRole('button', EDIT));
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('saves the trimmed draft and closes the editor', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<TripDescriptionCard description="" canEdit onSave={onSave} />, {
      withProviders: false,
    });

    await user.click(screen.getByRole('button', EDIT));
    await user.type(screen.getByRole('textbox', EDITOR), '  New note  ');
    await user.click(screen.getByRole('button', { name: 'common.save' }));

    expect(onSave).toHaveBeenCalledWith('New note');
    await waitFor(() => {
      expect(screen.queryByRole('textbox')).toBeNull();
    });
  });

  it('saves with Cmd+Enter', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<TripDescriptionCard description="a" canEdit onSave={onSave} />, {
      withProviders: false,
    });
    await user.click(screen.getByRole('button', EDIT));
    await user.type(screen.getByRole('textbox', EDITOR), 'b');
    await user.keyboard('{Meta>}{Enter}{/Meta}');
    expect(onSave).toHaveBeenCalledWith('ab');
  });

  it('closes without writing when nothing changed', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(<TripDescriptionCard description="Same" canEdit onSave={onSave} />, {
      withProviders: false,
    });
    await user.click(screen.getByRole('button', EDIT));
    await user.type(screen.getByRole('textbox', EDITOR), '  ');
    await user.click(screen.getByRole('button', { name: 'common.save' }));
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('keeps the draft open and says so when the save fails', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockRejectedValue(new Error('Dexie is closed'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    render(<TripDescriptionCard description="" canEdit onSave={onSave} />, {
      withProviders: false,
    });

    await user.click(screen.getByRole('button', EDIT));
    await user.type(screen.getByRole('textbox', EDITOR), 'Draft');
    await user.click(screen.getByRole('button', { name: 'common.save' }));

    await waitFor(() => {
      expect(mockErrorToast).toHaveBeenCalledWith('errors.saveFailed');
    });
    expect(screen.getByRole('textbox', EDITOR)).toHaveValue('Draft');
    expect(screen.getByRole('button', { name: 'common.save' })).toBeEnabled();
  });

  it('disables the controls while saving and ignores a second save', async () => {
    const user = userEvent.setup();
    let resolve: () => void = () => {};
    const onSave = vi.fn(
      () =>
        new Promise<void>((done) => {
          resolve = done;
        }),
    );
    render(<TripDescriptionCard description="" canEdit onSave={onSave} />, {
      withProviders: false,
    });

    await user.click(screen.getByRole('button', EDIT));
    const editor = screen.getByRole('textbox', EDITOR);
    await user.type(editor, 'x');
    await user.click(screen.getByRole('button', { name: 'common.save' }));

    expect(screen.getByRole('button', { name: 'common.save' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'common.cancel' })).toBeDisabled();
    // Escape and the shortcut reach the handlers even with the buttons off.
    editor.focus();
    await user.keyboard('{Escape}');
    await user.keyboard('{Control>}{Enter}{/Control}');
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('textbox', EDITOR)).toBeInTheDocument();

    resolve();
    await waitFor(() => {
      expect(screen.queryByRole('textbox')).toBeNull();
    });
  });

  it('titles the card and labels the controls', async () => {
    const user = userEvent.setup();
    render(<TripDescriptionCard description="Old" canEdit onSave={vi.fn()} />, {
      withProviders: false,
    });

    expect(screen.getByText('trips.description')).toHaveClass('font-display');
    const edit = screen.getByRole('button', EDIT);
    expect(edit).toHaveTextContent('common.edit');
    // Nothing was closed yet, so nothing hands focus back.
    expect(edit).not.toHaveFocus();

    await user.click(edit);
    expect(screen.getByRole('textbox', EDITOR)).toHaveAttribute(
      'placeholder',
      'trips.descriptionPlaceholder',
    );
  });

  it('opens on what is stored now, not what was loaded first', async () => {
    const user = userEvent.setup();
    const onDirtyChange = vi.fn();
    const { rerender } = render(
      <TripDescriptionCard description="Old" canEdit onSave={vi.fn()} onDirtyChange={onDirtyChange} />,
      { withProviders: false },
    );

    // A member changed it over sync while the card sat closed.
    rerender(
      <TripDescriptionCard description="New" canEdit onSave={vi.fn()} onDirtyChange={onDirtyChange} />,
    );
    expect(onDirtyChange).toHaveBeenLastCalledWith(false);

    await user.click(screen.getByRole('button', EDIT));
    expect(screen.getByRole('textbox', EDITOR)).toHaveValue('New');
    // Opening is not a change.
    expect(onDirtyChange).toHaveBeenLastCalledWith(false);
  });

  it('hands focus back to Edit after a save, and after a save with no change', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<TripDescriptionCard description="Same  " canEdit onSave={onSave} />, {
      withProviders: false,
    });

    await user.click(screen.getByRole('button', EDIT));
    await user.click(screen.getByRole('button', { name: 'common.save' }));
    // Trailing spaces on the stored text are not a change.
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByRole('button', EDIT)).toHaveFocus();

    await user.click(screen.getByRole('button', EDIT));
    await user.type(screen.getByRole('textbox', EDITOR), '!');
    await user.click(screen.getByRole('button', { name: 'common.save' }));
    await waitFor(() => {
      expect(screen.getByRole('button', EDIT)).toHaveFocus();
    });
    expect(onSave).toHaveBeenCalledWith('Same  !');
  });

  it('shows a spinner on Save only while it saves', async () => {
    const user = userEvent.setup();
    let resolve: () => void = () => {};
    const onSave = vi.fn(
      () =>
        new Promise<void>((done) => {
          resolve = done;
        }),
    );
    render(<TripDescriptionCard description="" canEdit onSave={onSave} />, {
      withProviders: false,
    });
    await user.click(screen.getByRole('button', EDIT));
    expect(
      screen.getByRole('button', { name: 'common.save' }).querySelector('.animate-spin'),
    ).toBeNull();
    await user.type(screen.getByRole('textbox', EDITOR), 'x');

    await user.click(screen.getByRole('button', { name: 'common.save' }));
    expect(
      screen.getByRole('button', { name: 'common.save' }).querySelector('.animate-spin'),
    ).not.toBeNull();

    // Keys still reach a disabled field's handlers: they must not cancel or save again.
    const editor = screen.getByRole('textbox', EDITOR);
    fireEvent.keyDown(editor, { key: 'Escape' });
    fireEvent.keyDown(editor, { key: 'Enter', ctrlKey: true });
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('textbox', EDITOR)).toBeInTheDocument();

    await act(async () => {
      resolve();
    });
  });

  it('logs a failed save with its cause', async () => {
    const user = userEvent.setup();
    const failure = new Error('Dexie is closed');
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(
      <TripDescriptionCard description="" canEdit onSave={vi.fn().mockRejectedValue(failure)} />,
      { withProviders: false },
    );
    await user.click(screen.getByRole('button', EDIT));
    await user.type(screen.getByRole('textbox', EDITOR), 'Draft');
    await user.click(screen.getByRole('button', { name: 'common.save' }));

    await waitFor(() => {
      expect(consoleError).toHaveBeenCalledWith('Failed to save trip description:', failure);
    });
  });

  it('raises no error toast for a save that fails after the card is gone', async () => {
    const user = userEvent.setup();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    let fail: (error: Error) => void = () => {};
    const onSave = vi.fn(
      () =>
        new Promise<void>((_, reject) => {
          fail = reject;
        }),
    );
    const { unmount } = render(
      <TripDescriptionCard description="" canEdit onSave={onSave} />,
      { withProviders: false },
    );
    await user.click(screen.getByRole('button', EDIT));
    await user.type(screen.getByRole('textbox', EDITOR), 'Draft');
    await user.click(screen.getByRole('button', { name: 'common.save' }));

    unmount();
    await act(async () => {
      fail(new Error('too late'));
    });

    expect(mockErrorToast).not.toHaveBeenCalled();
  });

  it('closes safely when editing was taken away mid-edit', async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <TripDescriptionCard description="Old" canEdit onSave={vi.fn()} />,
      { withProviders: false },
    );
    await user.click(screen.getByRole('button', EDIT));

    // The trip turned read-only: there is no Edit button to hand focus to.
    rerender(<TripDescriptionCard description="Old" canEdit={false} onSave={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: 'common.cancel' }));

    expect(screen.getByText('Old')).toBeInTheDocument();
    expect(screen.queryByRole('button', EDIT)).toBeNull();
  });
});
