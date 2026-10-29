/**
 * @fileoverview Tests for telling when the visitor types or drags.
 *
 * @module features/pet/lib/__tests__/pet-busy.test
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import { LEAFLET_DRAGGING_CLASS, isDragging, isTextEntry, watchBusy } from '../pet-busy';

function input(type: string): HTMLInputElement {
  const element = document.createElement('input');

  element.type = type;
  document.body.append(element);
  return element;
}

/** Lets the MutationObserver callbacks run. */
async function flushObservers(): Promise<void> {
  await Promise.resolve();
}

afterEach(() => {
  document.body.replaceChildren();
  document.body.className = '';
});

describe('isTextEntry', () => {
  it('takes a field the visitor types in', () => {
    expect(isTextEntry(input('text'))).toBe(true);
    expect(isTextEntry(input('email'))).toBe(true);
    expect(isTextEntry(input('date'))).toBe(true);
    expect(isTextEntry(document.createElement('textarea'))).toBe(true);
  });

  it('takes something contenteditable', () => {
    const element = document.createElement('div');

    element.contentEditable = 'true';
    // jsdom does not derive isContentEditable from the attribute.
    Object.defineProperty(element, 'isContentEditable', { value: true });
    expect(isTextEntry(element)).toBe(true);
  });

  it('leaves out a control that takes focus without text', () => {
    expect(isTextEntry(input('checkbox'))).toBe(false);
    expect(isTextEntry(input('radio'))).toBe(false);
    expect(isTextEntry(input('range'))).toBe(false);
    expect(isTextEntry(document.createElement('button'))).toBe(false);
    expect(isTextEntry(null)).toBe(false);
    expect(isTextEntry(window)).toBe(false);
  });
});

describe('isDragging', () => {
  it('sees the node dnd-kit is dragging', () => {
    const node = document.createElement('div');

    node.setAttribute('aria-roledescription', 'draggable');
    document.body.append(node);
    expect(isDragging(document)).toBe(false);

    node.setAttribute('aria-pressed', 'true');
    expect(isDragging(document)).toBe(true);
  });

  it('does not take a pressed toggle button for a drag', () => {
    const toggle = document.createElement('button');

    toggle.setAttribute('aria-pressed', 'true');
    document.body.append(toggle);
    expect(isDragging(document)).toBe(false);
  });

  it('sees a Leaflet drag on the body', () => {
    document.body.classList.add(LEAFLET_DRAGGING_CLASS);
    expect(isDragging(document)).toBe(true);
  });
});

describe('watchBusy', () => {
  it('answers at once, then on every change, and not twice for the same answer', async () => {
    const onChange = vi.fn(),
      name = input('text'),
      email = input('email'),
      box = input('checkbox'),
      stop = watchBusy(document, onChange);

    expect(onChange.mock.calls).toEqual([[false]]);

    name.focus();
    email.focus();
    expect(onChange.mock.calls).toEqual([[false], [true]]);

    box.focus();
    expect(onChange.mock.calls).toEqual([[false], [true], [false]]);

    document.body.classList.add(LEAFLET_DRAGGING_CLASS);
    await flushObservers();
    expect(onChange.mock.calls).toEqual([[false], [true], [false], [true]]);

    document.body.classList.remove(LEAFLET_DRAGGING_CLASS);
    await flushObservers();
    expect(onChange.mock.calls.at(-1)).toEqual([false]);

    stop();
    name.focus();
    expect(onChange).toHaveBeenCalledTimes(5);
  });

  it('follows a dnd-kit drag through aria-pressed', async () => {
    const onChange = vi.fn(),
      node = document.createElement('div');

    node.setAttribute('aria-roledescription', 'draggable');
    document.body.append(node);
    const stop = watchBusy(document, onChange);

    node.setAttribute('aria-pressed', 'true');
    await flushObservers();
    expect(onChange.mock.calls.at(-1)).toEqual([true]);

    node.removeAttribute('aria-pressed');
    await flushObservers();
    expect(onChange.mock.calls.at(-1)).toEqual([false]);

    stop();
  });

  it('starts busy when a field already has focus', () => {
    const onChange = vi.fn();

    input('text').focus();
    watchBusy(document, onChange)();

    expect(onChange.mock.calls).toEqual([[true]]);
  });
});
