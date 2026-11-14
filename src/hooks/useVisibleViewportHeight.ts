/**
 * @fileoverview The height of what is actually on screen, keyboard included.
 *
 * `100dvh` is the window without the browser's own bars, but on Android it
 * does not shrink when the keyboard opens: Chrome's default only shrinks the
 * *visual* viewport, and browsers that do resize the page disagree on whether
 * the `dvh` unit follows. A page sized with it stays as tall as the whole
 * screen behind the keyboard, and the browser scrolls it to keep the focused
 * field in view: the header goes off the top and an empty band opens between
 * the field and the keyboard.
 *
 * `window.visualViewport` is the one measure every mobile browser gives: the
 * part of the page that can be seen. This hook publishes it, and how much of
 * the window the keyboard covers, as two CSS variables a full-height page
 * sizes itself with:
 *
 * - `--visible-viewport-height`: the visible height, in px;
 * - `--keyboard-overlap`: how far the keyboard reaches over the window's
 *   bottom edge, in px, 0 when it is closed or the page was resized around it.
 *
 * Both are removed on unmount, so a page that does not use the hook keeps
 * `100dvh` through the `var()` fallback.
 *
 * @module hooks/useVisibleViewportHeight
 */

import { useLayoutEffect } from 'react';

/** The variable the visible height is published as. */
export const VISIBLE_VIEWPORT_HEIGHT_VAR = '--visible-viewport-height';

/** The variable the keyboard's overlap is published as. */
export const KEYBOARD_OVERLAP_VAR = '--keyboard-overlap';

/**
 * Keeps the two viewport variables on `<html>` up to date while mounted.
 *
 * @param win - The window to measure; the real one by default
 */
export function useVisibleViewportHeight(win: Window = window): void {
  useLayoutEffect(() => {
    const viewport = win.visualViewport;
    const root = win.document.documentElement;
    if (!viewport) {
      return undefined;
    }

    const publish = (): void => {
      const height = viewport.height;
      // What the keyboard covers of the window's own bottom edge. A browser
      // that shrinks the page around the keyboard leaves this at 0, and its
      // bottom bar is then drawn above the keyboard, so the page still has to
      // clear it; one that overlays the keyboard hides the bar under it.
      const overlap = Math.max(0, win.innerHeight - (viewport.offsetTop + height));
      root.style.setProperty(VISIBLE_VIEWPORT_HEIGHT_VAR, `${Math.round(height)}px`);
      root.style.setProperty(KEYBOARD_OVERLAP_VAR, `${Math.round(overlap)}px`);
    };

    publish();
    viewport.addEventListener('resize', publish);
    viewport.addEventListener('scroll', publish);
    win.addEventListener('resize', publish);

    return () => {
      viewport.removeEventListener('resize', publish);
      viewport.removeEventListener('scroll', publish);
      win.removeEventListener('resize', publish);
      root.style.removeProperty(VISIBLE_VIEWPORT_HEIGHT_VAR);
      root.style.removeProperty(KEYBOARD_OVERLAP_VAR);
    };
  }, [win]);
}
