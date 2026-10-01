/**
 * @fileoverview Why a camera did not start, in terms a visitor can act on.
 *
 * `getUserMedia` refuses for reasons that are not faults of this app — a
 * permission the visitor turned down, a device with no camera, a camera another
 * app is already holding — and each one has a different way out. The browser
 * says which through a `DOMException` name, so the scanner can say something
 * better than the library's own sentence.
 *
 * Its own module rather than a helper inside the component, because a component
 * file that also exports a function loses fast refresh.
 *
 * @module lib/utils/camera-failure
 */

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Why the camera did not start, as far as the browser was willing to say.
 *
 * Only `unknown` is a bug in this app. The other three are states of the device
 * the visitor is holding.
 */
export type CameraFailure = 'blocked' | 'missing' | 'busy' | 'unknown';

// ============================================================================
// Constants
// ============================================================================

/** The `DOMException` names each failure is known by, across browsers. */
const FAILURE_PATTERNS: readonly (readonly [CameraFailure, RegExp])[] = [
  ['blocked', /notallowederror|permissiondenied|permission denied|securityerror/],
  ['missing', /notfounderror|devicesnotfounderror|overconstrainederror/],
  ['busy', /notreadableerror|trackstarterror|aborterror/],
];

// ============================================================================
// Functions
// ============================================================================

/**
 * Which failure this is.
 *
 * html5-qrcode does not re-throw the `DOMException` it was given: it rejects
 * with a plain `Error getting userMedia, error = NotAllowedError: …`, and on
 * some paths with a bare string. So the name is read out of the text as well as
 * off the error, and anything unrecognised stays `unknown` rather than being
 * guessed at — a wrong guess sends the visitor to a browser setting that was
 * never the problem.
 */
export function classifyCameraFailure(error: unknown): CameraFailure {
  const name = error instanceof Error ? error.name : '';
  const text = `${name} ${String(error)}`.toLowerCase();
  for (const [failure, pattern] of FAILURE_PATTERNS) {
    if (pattern.test(text)) {
      return failure;
    }
  }
  return 'unknown';
}
