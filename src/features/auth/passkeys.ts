/**
 * @fileoverview Whether this browser can do a passkey at all.
 *
 * The project's own answer — `passkeys_enabled` at `/auth/v1/settings` — says
 * only that the *server* will verify one. WebAuthn is the other half, and it is
 * missing in more places than you would expect: an old browser, an embedded
 * webview, and any page not served over a secure context (`http://` on a LAN
 * address, which is exactly how a phone reaches a dev server). Offering the
 * button there produces a `NotSupportedError` from `navigator.credentials`,
 * which reads as the app being broken.
 *
 * So both halves are required, the same rule wallet sign-in follows.
 *
 * ## The part that surprises people
 *
 * A passkey is bound to an origin. One enrolled on `kikoushou.app` does not
 * exist on `tommoulard.github.io`, and vice versa — nothing here can paper over
 * that, and it is why the account panel offers enrolment per device rather than
 * treating a passkey as an account-wide property.
 *
 * Reading `window` here is deliberate and allowed: this is feature code, not
 * `lib/`, which may not touch it.
 *
 * @module features/auth/passkeys
 */

// ============================================================================
// Public API
// ============================================================================

/**
 * Whether the browser exposes a usable WebAuthn implementation.
 *
 * `isSecureContext` is checked first because `navigator.credentials` exists but
 * refuses to work outside one, and the refusal arrives as an exception rather
 * than as a capability flag.
 *
 * @example
 * ```ts
 * const offerPasskey = settings.passkeys && isPasskeySupported();
 * ```
 */
export function isPasskeySupported(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }
  if (!window.isSecureContext) {
    return false;
  }
  return (
    typeof window.PublicKeyCredential === 'function' &&
    window.navigator.credentials !== undefined
  );
}
