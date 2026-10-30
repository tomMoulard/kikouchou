/**
 * @fileoverview Whether the visitor is busy with the page: typing in a field,
 * or dragging something.
 *
 * In the test arm of the `onboarding-small-pet` experiment the pet steps aside
 * while either is true. The hypothesis, from the activation benchmark of
 * 2026-10-29: a pet walking across the first-trip wizard gets in the way of
 * its first question, which 379 of 389 visitors never answered.
 *
 * Both answers are read from the DOM rather than reported by each screen, so a
 * new form or a new drag is covered without touching the pet:
 *
 * - **Typing** is a focused text field: an `input` that takes text, a
 *   `textarea`, or anything `contenteditable`. A checkbox, a radio or a button
 *   takes focus without asking anyone to type.
 * - **Dragging** is a dnd-kit drag, whose active node carries
 *   `aria-pressed="true"` beside its `aria-roledescription`, or a Leaflet drag
 *   (a map pin, a pan), which puts `leaflet-dragging` on `<body>`.
 *
 * @module features/pet/lib/pet-busy
 */

// ============================================================================
// Constants
// ============================================================================

/** `input` types that take focus without taking text. */
const NON_TEXT_INPUT_TYPES: ReadonlySet<string> = new Set([
  'button',
  'checkbox',
  'color',
  'file',
  'hidden',
  'image',
  'radio',
  'range',
  'reset',
  'submit',
]);

/** The node dnd-kit is dragging, by the attributes it sets on it. */
export const DND_DRAGGING_SELECTOR = '[aria-roledescription][aria-pressed="true"]';

/** The class Leaflet puts on `<body>` while anything on a map is dragged. */
export const LEAFLET_DRAGGING_CLASS = 'leaflet-dragging';

// ============================================================================
// Functions
// ============================================================================

/**
 * Whether an element is somewhere the visitor types.
 *
 * @param target - The focused element, or whatever an event names
 * @returns `true` for a text field
 */
export function isTextEntry(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  if (target.isContentEditable || target instanceof HTMLTextAreaElement) {
    return true;
  }
  return target instanceof HTMLInputElement && !NON_TEXT_INPUT_TYPES.has(target.type);
}

/**
 * Whether something on the page is being dragged.
 *
 * @param doc - The document to look in
 * @returns `true` during a drag
 */
export function isDragging(doc: Document): boolean {
  return (
    doc.body.classList.contains(LEAFLET_DRAGGING_CLASS) ||
    doc.querySelector(DND_DRAGGING_SELECTOR) !== null
  );
}

/**
 * Calls `onChange` whenever the visitor starts or stops being busy, and once
 * at the start with the answer as it is now.
 *
 * Focus is read from the event, not from `document.activeElement`: during a
 * `focusout` the active element is already `<body>`, and `relatedTarget` is
 * where focus is going.
 *
 * @param doc - The document to watch
 * @param onChange - Receives `true` while the visitor types or drags
 * @returns A function that stops watching
 */
export function watchBusy(doc: Document, onChange: (busy: boolean) => void): () => void {
  let typing = isTextEntry(doc.activeElement),
    dragging = isDragging(doc),
    last = typing || dragging;

  const publish = (): void => {
    const busy = typing || dragging;

    if (busy !== last) {
      last = busy;
      onChange(busy);
    }
  };

  const handleFocusIn = (event: FocusEvent): void => {
    typing = isTextEntry(event.target);
    publish();
  };

  const handleFocusOut = (event: FocusEvent): void => {
    typing = isTextEntry(event.relatedTarget);
    publish();
  };

  const handleMutation = (): void => {
    dragging = isDragging(doc);
    publish();
  };

  // Two narrow observers rather than one over every class in the page: a
  // class changes on almost every render, `aria-pressed` almost never.
  const pressed = new MutationObserver(handleMutation),
    body = new MutationObserver(handleMutation);

  pressed.observe(doc.body, { subtree: true, attributes: true, attributeFilter: ['aria-pressed'] });
  body.observe(doc.body, { attributes: true, attributeFilter: ['class'] });
  doc.addEventListener('focusin', handleFocusIn);
  doc.addEventListener('focusout', handleFocusOut);

  onChange(last);

  return () => {
    pressed.disconnect();
    body.disconnect();
    doc.removeEventListener('focusin', handleFocusIn);
    doc.removeEventListener('focusout', handleFocusOut);
  };
}
