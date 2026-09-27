/**
 * @fileoverview Tests for the trip description card: rendered by default,
 * edited in place, saved on its own.
 *
 * @module features/trips/components/__tests__/TripDescriptionCard.test
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import userEvent from '@testing-library/user-event';

import { render, screen, waitFor } from '@/test/utils';
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
});
