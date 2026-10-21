/**
 * @fileoverview When a press on a timeline chip opens its room menu.
 *
 * A chip is both a drag handle and a button. A press that travels is a drag,
 * and the click that ends it must not also open the menu; a press that stays
 * put is a tap, and it must. These pin where that line is drawn.
 *
 * @module features/rooms/hooks/__tests__/useRoomPickerMenu.test
 */

import type { MouseEvent, PointerEvent } from 'react';
import { act, renderHook } from '@/test/utils';
import { describe, expect, it } from 'vitest';

import { useRoomPickerMenu } from '../useRoomPickerMenu';

// ============================================================================
// Helpers
// ============================================================================

type Hook = ReturnType<typeof renderHook<ReturnType<typeof useRoomPickerMenu>, boolean>>;

function press(hook: Hook, x: number, y: number): void {
  act(() => {
    hook.result.current.tapHandlers.onPointerDown({
      clientX: x,
      clientY: y,
    } as PointerEvent<HTMLElement>);
  });
}

function release(hook: Hook, x: number, y: number): void {
  act(() => {
    hook.result.current.tapHandlers.onClick({ clientX: x, clientY: y } as MouseEvent<HTMLElement>);
  });
}

function chip(enabled = true): Hook {
  return renderHook((on: boolean) => useRoomPickerMenu(on), { initialProps: enabled });
}

// ============================================================================
// Tests
// ============================================================================

describe('useRoomPickerMenu', () => {
  it('starts closed', () => {
    expect(chip().result.current.isOpen).toBe(false);
  });

  it('opens on a tap that stays put', () => {
    const hook = chip();

    press(hook, 10, 10);
    release(hook, 12, 12);

    expect(hook.result.current.isOpen).toBe(true);
  });

  it('opens on a click with no press before it, as from a keyboard', () => {
    const hook = chip();

    release(hook, 300, 300);

    expect(hook.result.current.isOpen).toBe(true);
  });

  it('still opens at exactly the tolerance', () => {
    const hook = chip();

    press(hook, 100, 100);
    release(hook, 108, 100);

    expect(hook.result.current.isOpen).toBe(true);
  });

  it.each([
    ['sideways', 120, 100],
    ['up and down', 100, 120],
    ['diagonally', 107, 107],
  ])('stays shut after a press that travelled %s, which was a drag', (_way, x, y) => {
    const hook = chip();

    press(hook, 100, 100);
    release(hook, x, y);

    expect(hook.result.current.isOpen).toBe(false);
  });

  it('forgets the press once its click has been handled', () => {
    const hook = chip();

    press(hook, 0, 0);
    release(hook, 50, 0);
    // A keyboard click later must not be measured against the old press.
    release(hook, 50, 0);

    expect(hook.result.current.isOpen).toBe(true);
  });

  it('never opens on a chip without a menu', () => {
    const hook = chip(false);

    press(hook, 10, 10);
    release(hook, 10, 10);

    expect(hook.result.current.isOpen).toBe(false);
  });

  it('closes when asked', () => {
    const hook = chip();
    release(hook, 0, 0);

    act(() => {
      hook.result.current.setIsOpen(false);
    });

    expect(hook.result.current.isOpen).toBe(false);
  });
});
