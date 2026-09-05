/**
 * @fileoverview The single letter that stands in for a guest when there is no
 * room for their name.
 *
 * @module features/persons/utils/guest-initial
 */

/**
 * The initial to show for a guest once the label column has folded.
 *
 * Takes the first character of the name rather than of every word: the column
 * is 40px wide at that point, which is one letter's worth of space. The name
 * itself stays on the row's `title` and `aria-label`, so nothing is lost —
 * this is a marker to find your row by, next to the guest's own colour.
 *
 * Split by code point, not by `charAt`, so a name starting outside the basic
 * plane yields its whole first character instead of half a surrogate pair.
 *
 * @param name - The guest's name, possibly blank
 * @returns One upper-case character, or an empty string when there is no name
 */
export function guestInitial(name: string): string {
  const trimmed = name.trim();
  if (trimmed.length === 0) {
    return '';
  }

  return (Array.from(trimmed)[0] ?? '').toLocaleUpperCase();
}
