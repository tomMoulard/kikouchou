/**
 * @fileoverview Tests for ZoomablePhoto.
 *
 * The thumbnail opens the photo full screen, the click stays out of the card
 * around it, and the viewer closes from a click, the close button or Escape.
 *
 * @module components/shared/__tests__/ZoomablePhoto.test
 */

import { describe, expect, it, vi } from 'vitest';
import { render, screen, userEvent, waitFor, within } from '@/test/utils';

import { ZoomablePhoto } from '../ZoomablePhoto';

// ============================================================================
// Helpers
// ============================================================================

function renderPhoto(onCardClick = vi.fn()) {
  render(
    // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- Stands for a card whose own click opens something else.
    <div onClick={onCardClick}>
      <ZoomablePhoto src="blob:room" alt="Red room" imageClassName="h-28" />
    </div>,
    { withProviders: false },
  );
  return { onCardClick };
}

async function openViewer(): Promise<HTMLElement> {
  await userEvent.click(screen.getByRole('button', { name: 'Red room' }));
  return screen.findByRole('dialog');
}

// ============================================================================
// Tests
// ============================================================================

describe('ZoomablePhoto', () => {
  it('shows the thumbnail inside a button named by the photo', () => {
    renderPhoto();

    const button = screen.getByRole('button', { name: 'Red room' });
    expect(button).toHaveAttribute('aria-haspopup', 'dialog');
    expect(within(button).getByRole('img', { name: 'Red room' })).toHaveAttribute('src', 'blob:room');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('opens the whole photo full screen, and keeps the click from the card', async () => {
    const { onCardClick } = renderPhoto();

    const viewer = await openViewer();

    expect(viewer).toHaveAccessibleName('Red room');
    const photo = within(viewer).getByRole('img', { name: 'Red room' });
    expect(photo).toHaveAttribute('src', 'blob:room');
    expect(photo).toHaveClass('object-contain');
    expect(viewer).toHaveClass('inset-0', 'h-dvh', 'w-screen', 'max-w-none');
    expect(onCardClick).not.toHaveBeenCalled();
  });

  it('closes on a click on the photo', async () => {
    renderPhoto();
    const viewer = await openViewer();

    await userEvent.click(within(viewer).getByRole('img', { name: 'Red room' }));

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  });

  it('closes with its close button', async () => {
    renderPhoto();
    const viewer = await openViewer();

    await userEvent.click(within(viewer).getByRole('button', { name: 'common.dialogClose' }));

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  });

  it('keeps every click and key inside the viewer from the card', async () => {
    const onCardKeyDown = vi.fn();
    const onCardClick = vi.fn();
    render(
      // eslint-disable-next-line jsx-a11y/no-static-element-interactions -- Stands for a card whose own click opens something else.
      <div onClick={onCardClick} onKeyDown={onCardKeyDown}>
        <ZoomablePhoto src="blob:room" alt="Red room" />
      </div>,
      { withProviders: false },
    );

    // The viewer is portaled out of the card, but React still bubbles its
    // events through the component tree into the card.
    const viewer = await openViewer();
    await userEvent.keyboard('{Tab}');
    await userEvent.click(within(viewer).getByRole('img', { name: 'Red room' }));

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    expect(onCardClick).not.toHaveBeenCalled();
    expect(onCardKeyDown).not.toHaveBeenCalled();
  });

  it('closes with Escape, and gives the focus back to the thumbnail', async () => {
    renderPhoto();
    await openViewer();

    await userEvent.keyboard('{Escape}');

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: 'Red room' })).toHaveFocus();
  });
});
