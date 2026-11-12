/**
 * @fileoverview A trip or room photo that opens full screen when clicked.
 *
 * The thumbnail is a button, and the button opens a dialog that fills the
 * viewport with the whole photo, letterboxed on black. A photo on a card is
 * cropped to a strip (`object-cover`), so the viewer is the only place a
 * guest sees the whole room.
 *
 * A click anywhere in the viewer closes it, and so do Escape and the corner
 * close button. Radix's own trigger wiring gives the button `aria-haspopup`
 * and `aria-expanded`, and its name is the photo's `alt`.
 *
 * @module components/shared/ZoomablePhoto
 */

import { memo, useCallback, useState, type SyntheticEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { XIcon } from 'lucide-react';

import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';

import { cn } from '@/lib/utils';

// ============================================================================
// Type Definitions
// ============================================================================

interface ZoomablePhotoProps {
  /** The photo's address. */
  readonly src: string;
  /** Text for the photo's `alt`, which also names the button and the viewer. */
  readonly alt: string;
  /** Classes for the button around the thumbnail: its place in the layout. */
  readonly className?: string;
  /** Classes for the thumbnail itself: its size, crop and corners. */
  readonly imageClassName?: string;
  /** Lazy-load the thumbnail, for photos in a long list. */
  readonly lazy?: boolean;
}

// ============================================================================
// Constants
// ============================================================================

/**
 * The viewer's box, laid over `dialogContentClassName`: the whole viewport,
 * with no padding, border or corner. `cn()` merges last-wins, so each class
 * here replaces the one it conflicts with.
 */
const VIEWER_CONTENT_CLASS_NAME = cn(
  'inset-0 top-0 h-dvh max-h-none w-screen max-w-none translate-y-0 rounded-none border-0 p-0 shadow-none sm:max-w-none',
  // eslint-disable-next-line kikouchou/no-raw-palette-class -- A photo viewer letterboxes on black in both themes, like the dialog scrim: a theme token would put a light photo on a white ground and lose its edges.
  'bg-black',
);

// ============================================================================
// Component
// ============================================================================

/**
 * Shows a photo as a thumbnail, and full screen on a click.
 */
const ZoomablePhoto = memo(function ZoomablePhoto({
  src,
  alt,
  className,
  imageClassName,
  lazy = false,
}: ZoomablePhotoProps) {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);

  // The thumbnail often sits inside a card whose own click opens something
  // else, and a portal does not change that: React bubbles an event through
  // the component tree, not the DOM, so a click on the close button or the
  // full-screen photo reached the trip card and opened the trip. Every click
  // and key press stops at the thumbnail and at the viewer's edge.
  const stopAtEdge = useCallback((event: SyntheticEvent): void => {
    event.stopPropagation();
  }, []);

  const handleViewerClick = useCallback((): void => {
    setIsOpen(false);
  }, []);

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <button
          type="button"
          className={cn(
            'block cursor-zoom-in',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
            className,
          )}
          onClick={stopAtEdge}
          onKeyDown={stopAtEdge}
        >
          <img
            src={src}
            alt={alt}
            {...(lazy ? { loading: 'lazy' as const } : {})}
            decoding="async"
            className={imageClassName}
          />
        </button>
      </DialogTrigger>
      <DialogContent
        className={VIEWER_CONTENT_CLASS_NAME}
        aria-describedby={undefined}
        showCloseButton={false}
        onClick={stopAtEdge}
        onKeyDown={stopAtEdge}
      >
        <DialogTitle className="sr-only">{alt}</DialogTitle>
        {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- A shortcut for the pointer only: Escape and the close button already close the viewer from the keyboard. */}
        <div
          className="flex size-full cursor-zoom-out items-center justify-center"
          onClick={handleViewerClick}
        >
          <img src={src} alt={alt} className="max-h-full max-w-full object-contain" />
        </div>
        {/*
          The stock close button is a bare icon that turns `bg-accent` on hover,
          which reads as a grey smudge on black. This one carries its own
          ground, the way the card corner buttons do over a photo.
        */}
        <DialogClose
          className={cn(
            'absolute top-2 right-2 inline-flex size-11 items-center justify-center rounded-md',
            'bg-background/80 text-foreground backdrop-blur-sm hover:bg-background',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            'md:top-4 md:right-4',
          )}
        >
          <XIcon className="size-5" aria-hidden="true" />
          <span className="sr-only">{t('common.dialogClose', 'Close dialog')}</span>
        </DialogClose>
      </DialogContent>
    </Dialog>
  );
});

// ============================================================================
// Exports
// ============================================================================

export { ZoomablePhoto };
export type { ZoomablePhotoProps };
