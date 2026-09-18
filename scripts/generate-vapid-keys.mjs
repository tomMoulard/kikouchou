#!/usr/bin/env node
/**
 * Prints a fresh VAPID key pair for trip reminders (Web Push, RFC 8292).
 *
 * The public key goes into the app's build as `VITE_VAPID_PUBLIC_KEY`. The
 * private key goes into the share-preview service's environment as
 * `VAPID_PRIVATE_KEY`, and nowhere else: not in a commit, not in a build arg,
 * not in a chat. Both are base64url without padding, the form the `web-push`
 * crate and `PushManager.subscribe()` read.
 *
 * Node's own `crypto` is enough: a P-256 key, exported as JWK, gives the
 * private scalar `d` directly and the public point as `x` and `y`.
 *
 * Usage:
 *   node scripts/generate-vapid-keys.mjs
 */

import { generateKeyPairSync } from 'node:crypto';

const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });

const publicJwk = publicKey.export({ format: 'jwk' });
const privateJwk = privateKey.export({ format: 'jwk' });

/** base64url of the uncompressed point `0x04 || x || y`, 65 bytes. */
const publicRaw = Buffer.concat([
  Buffer.from([0x04]),
  Buffer.from(publicJwk.x, 'base64url'),
  Buffer.from(publicJwk.y, 'base64url'),
]);

console.log('# The app (build time, public):');
console.log(`VITE_VAPID_PUBLIC_KEY=${publicRaw.toString('base64url')}`);
console.log('');
console.log('# The share-preview service (run time, secret):');
console.log(`VAPID_PRIVATE_KEY=${privateJwk.d}`);
console.log('VAPID_SUBJECT=mailto:admin@kikouchou.app');
