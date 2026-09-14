/**
 * @fileoverview Putting one string on the clipboard, wherever the app runs.
 *
 * `navigator.clipboard` needs a secure context. The app is served over HTTPS,
 * but it is also opened from a phone on a LAN address during development, from
 * a file, and inside webviews that report themselves insecure — and in every
 * one of those the promise rejects. The old selection trick still works there,
 * so it is the fallback rather than an error message.
 *
 * @module lib/utils/clipboard
 */

/**
 * Copies text, and says whether it landed.
 *
 * @param value - What to put on the clipboard
 * @returns True when the text was copied by either route
 */
export async function copyText(value: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    return copyBySelection(value);
  }
}

/**
 * The pre-clipboard-API route: a hidden field, selected and copied.
 *
 * @param value - What to put on the clipboard
 * @returns True when the browser reported the copy as done
 */
function copyBySelection(value: string): boolean {
  try {
    const textarea = document.createElement('textarea');
    textarea.value = value;
    document.body.appendChild(textarea);
    textarea.select();
    const copied = document.execCommand('copy');
    document.body.removeChild(textarea);
    return copied;
  } catch {
    return false;
  }
}
