/**
 * UnsavedChangesDialog Tests
 *
 * @module components/shared/__tests__/UnsavedChangesDialog.test
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@/test/utils';

import { UnsavedChangesDialog } from '@/components/shared/UnsavedChangesDialog';

// ============================================================================
// Tests
// ============================================================================

describe('UnsavedChangesDialog', () => {
  it('renders dialog when open is true', () => {
    render(
      <UnsavedChangesDialog open={true} onStay={vi.fn()} onLeave={vi.fn()} />,
      { withProviders: false }
    );

    expect(screen.getByText('unsaved.title')).toBeInTheDocument();
    expect(screen.getByText('unsaved.description')).toBeInTheDocument();
  });

  it('does not render dialog when open is false', () => {
    render(
      <UnsavedChangesDialog open={false} onStay={vi.fn()} onLeave={vi.fn()} />,
      { withProviders: false }
    );

    expect(screen.queryByText('unsaved.title')).not.toBeInTheDocument();
  });

  it('calls onLeave when confirm button is clicked', async () => {
    const onLeave = vi.fn();
    const onStay = vi.fn();

    const { user } = render(
      <UnsavedChangesDialog open={true} onStay={onStay} onLeave={onLeave} />,
      { withProviders: false }
    );

    const leaveButton = screen.getByRole('button', { name: 'unsaved.leave' });
    await user.click(leaveButton);

    expect(onLeave).toHaveBeenCalledTimes(1);
    // onStay should NOT be called when leaving
    expect(onStay).not.toHaveBeenCalled();
  });

  it('calls onStay when cancel button is clicked', async () => {
    const onLeave = vi.fn();
    const onStay = vi.fn();

    const { user } = render(
      <UnsavedChangesDialog open={true} onStay={onStay} onLeave={onLeave} />,
      { withProviders: false }
    );

    const stayButton = screen.getByRole('button', { name: 'unsaved.stay' });
    await user.click(stayButton);

    expect(onStay).toHaveBeenCalledTimes(1);
    expect(onLeave).not.toHaveBeenCalled();
  });

  it('treats Escape as staying, not as silently leaving', async () => {
    const onLeave = vi.fn();
    const onStay = vi.fn();

    const { user } = render(
      <UnsavedChangesDialog open={true} onStay={onStay} onLeave={onLeave} />,
      { withProviders: false }
    );

    await user.keyboard('{Escape}');

    // Dismissing the warning is not consent to discard the work; the safe
    // reading of "go away" is that the navigation is cancelled.
    expect(onStay).toHaveBeenCalledTimes(1);
    expect(onLeave).not.toHaveBeenCalled();
  });

  it('answers a second prompt correctly after the first was left', async () => {
    const onLeave = vi.fn();
    const onStay = vi.fn();

    const { user } = render(
      <UnsavedChangesDialog open={true} onStay={onStay} onLeave={onLeave} />,
      { withProviders: false }
    );

    // Leaving raises the `isLeavingRef` flag that suppresses the `onStay` the
    // auto-close would otherwise fire. If the flag were never lowered again,
    // every later cancel would be swallowed and the block would never reset —
    // the user would be stuck unable to say "stay".
    await user.click(screen.getByRole('button', { name: 'unsaved.leave' }));
    expect(onLeave).toHaveBeenCalledTimes(1);
    expect(onStay).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'unsaved.stay' }));

    expect(onStay).toHaveBeenCalledTimes(1);
    expect(onLeave).toHaveBeenCalledTimes(1);
  });

  it('does not call onStay or onLeave when dialog opens', () => {
    const onLeave = vi.fn();
    const onStay = vi.fn();

    // Render closed first, then rerender as open
    const { rerender } = render(
      <UnsavedChangesDialog open={false} onStay={onStay} onLeave={onLeave} />,
      { withProviders: false }
    );

    rerender(
      <UnsavedChangesDialog open={true} onStay={onStay} onLeave={onLeave} />
    );

    // handleOpenChange(true) should be a no-op — neither callback is called
    expect(onStay).not.toHaveBeenCalled();
    expect(onLeave).not.toHaveBeenCalled();
  });
});
