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
});
