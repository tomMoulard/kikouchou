/**
 * Component tests for the Dialog primitive.
 *
 * These pin the three deliberate deviations from stock shadcn in `dialog.tsx`
 * and `dialog.variants.ts`, so a later `shadcn add dialog` that regenerates the
 * file cannot silently revert them: a translated close label, a close button big
 * enough to hit, a focus ring that only appears for keyboard users, and a body
 * that scrolls instead of clipping off both edges of a short viewport.
 *
 * @module components/ui/__tests__/dialog.test
 */
import { describe, it, expect } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

function renderDialog(props: { readonly showCloseButton?: boolean } = {}) {
  render(
    <Dialog open>
      <DialogContent {...props}>
        <DialogHeader>
          <DialogTitle>Edit room</DialogTitle>
          <DialogDescription>Change the room details.</DialogDescription>
        </DialogHeader>
        <p>Body</p>
        <DialogFooter>
          <button type="button">Save</button>
        </DialogFooter>
      </DialogContent>
    </Dialog>,
  );
}

describe('DialogContent close button', () => {
  it('names itself through t(), not a hardcoded English string', () => {
    renderDialog();

    // The i18n mock echoes keys, so the key itself is the assertion: a literal
    // "Close" here would mean the label never reaches the French bundle.
    expect(
      screen.getByRole('button', { name: 'common.dialogClose' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Close' })).toBeNull();
  });

  it('is a 44px target on mobile rather than a bare 16px icon', () => {
    renderDialog();

    const close = screen.getByRole('button', { name: 'common.dialogClose' });

    // size-11 = 44px, the mobile touch target; md:size-9 = 36px on pointers,
    // still over WCAG 2.5.8's 24px floor.
    expect(close).toHaveClass('size-11');
    expect(close).toHaveClass('md:size-9');
  });

  it('rings on focus-visible only, so a mouse click leaves nothing behind', () => {
    renderDialog();

    const close = screen.getByRole('button', { name: 'common.dialogClose' });

    expect(close).toHaveClass('focus-visible:ring-2');
    expect(close).toHaveClass('focus-visible:ring-ring');
    expect(close.className).not.toMatch(/(^|\s)focus:ring-2/);
  });

  it('hides its icon from screen readers, leaving one accessible name', () => {
    renderDialog();

    const icon = screen
      .getByRole('button', { name: 'common.dialogClose' })
      .querySelector('svg');

    expect(icon).toHaveAttribute('aria-hidden', 'true');
  });

  it('closes the dialog when activated', async () => {
    const user = userEvent.setup();
    // Uncontrolled: `open` alone would pin the dialog open whatever the button
    // does, and the assertion below could never fail.
    render(
      <Dialog defaultOpen>
        <DialogContent>
          <DialogTitle>Edit room</DialogTitle>
          <DialogDescription>Change the room details.</DialogDescription>
        </DialogContent>
      </Dialog>,
    );

    await user.click(screen.getByRole('button', { name: 'common.dialogClose' }));

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  });

  it('is omitted when showCloseButton is false', () => {
    renderDialog({ showCloseButton: false });

    expect(
      screen.queryByRole('button', { name: 'common.dialogClose' }),
    ).toBeNull();
  });
});

describe('DialogContent height', () => {
  it('caps its own height and scrolls, so no call site can forget to', () => {
    renderDialog();

    const content = screen.getByRole('dialog');
    const body = content.querySelector('[data-slot="dialog-body"]');

    // Without the cap the box is centred on the viewport unconstrained, so a
    // tall dialog on a short screen clips off the top AND the bottom at once,
    // with no way to reach either. 14 of 20 call sites used to forget it.
    expect(content).toHaveClass('max-h-[calc(100dvh-2rem)]');
    expect(body).toHaveClass('overflow-y-auto');
  });

  it('scrolls the body, not the box, so the close button stays pinned', () => {
    renderDialog();

    const close = screen.getByRole('button', { name: 'common.dialogClose' });

    // The close button is positioned against the box. If the box were the
    // scroll container, scrolling down to reach the footer would carry the
    // close button off the top of it.
    expect(close.closest('[data-slot="dialog-body"]')).toBeNull();
    expect(screen.getByRole('dialog')).not.toHaveClass('overflow-y-auto');
  });

  it('carries the call site\'s gap through the body wrapper', () => {
    render(
      <Dialog open>
        <DialogContent className="gap-0">
          <DialogTitle>Tight</DialogTitle>
          <DialogDescription>Body</DialogDescription>
        </DialogContent>
      </Dialog>,
    );

    const body = screen
      .getByRole('dialog')
      .querySelector('[data-slot="dialog-body"]');

    // `[gap:inherit]` is what keeps a call site's own gap meaningful now that
    // its children sit one level down.
    expect(body).toHaveClass('[gap:inherit]');
  });

  it('still lets a call site override the cap', () => {
    render(
      <Dialog open>
        <DialogContent className="max-h-[50vh]">
          <DialogTitle>Tall</DialogTitle>
          <DialogDescription>Body</DialogDescription>
        </DialogContent>
      </Dialog>,
    );

    const content = screen.getByRole('dialog');

    expect(content).toHaveClass('max-h-[50vh]');
    expect(content).not.toHaveClass('max-h-[calc(100dvh-2rem)]');
  });
});
