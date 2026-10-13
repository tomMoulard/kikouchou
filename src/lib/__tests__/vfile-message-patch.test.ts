/**
 * Guards `patches/vfile-message@4.0.3.patch`.
 *
 * PostHog issue `01a11a12`: on a page whose `Error.prototype` has been frozen
 * — a browser extension running SES `lockdown()`, as wallet extensions do —
 * `vfile-message` throws "Cannot assign to read only property 'stack' of
 * object ''" while its module is being evaluated. It assigns defaults onto
 * its own prototype with `VFileMessage.prototype.stack = ''`, and an
 * assignment is refused when an inherited property of that name is
 * read-only. The module never finishes loading, and neither does the chunk it
 * shares with `react-markdown`, `LocationAutocomplete` and the trip form.
 *
 * The patch defines those defaults with `Object.defineProperty`, which an
 * inherited read-only property does not block.
 *
 * @module lib/__tests__/vfile-message-patch.test
 */
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);

/**
 * Evaluates the installed `vfile-message` afresh.
 *
 * Its body has to run again under each environment, and an `import()` of the
 * package returns the module evaluated the first time, whatever the query
 * string. So the installed file — patched, when the patch applied — is copied
 * to a path of its own under `node_modules/.cache`, where its one bare import
 * still resolves to the installed dependency.
 */
async function importFreshVFileMessage(): Promise<typeof import('vfile-message')> {
  const packageDir = dirname(require.resolve('vfile-message'));
  const cacheDir = join(dirname(packageDir), '.cache');
  mkdirSync(cacheDir, { recursive: true });
  const file = join(cacheDir, `vfile-message-${randomUUID()}.mjs`);
  writeFileSync(file, readFileSync(join(packageDir, 'lib', 'index.js'), 'utf8'));
  try {
    return (await import(/* @vite-ignore */ file)) as typeof import('vfile-message');
  } finally {
    rmSync(file, { force: true });
  }
}

/**
 * The read-only properties a frozen `Error.prototype` carries.
 *
 * Only `stack`, which is what the PostHog event names. SES tames `name` and
 * `message` into accessors that accept an override, and leaves `stack` a
 * read-only value.
 */
const FROZEN_KEYS = ['stack'] as const;

describe('vfile-message in an ordinary environment', () => {
  it('keeps the prototype defaults it documents', async () => {
    const { VFileMessage } = await importFreshVFileMessage();

    expect(VFileMessage.prototype.file).toBe('');
    expect(VFileMessage.prototype.stack).toBe('');
    expect(VFileMessage.prototype.fatal).toBeUndefined();
  });
});

describe('vfile-message under a frozen Error.prototype', () => {
  const saved = new Map<string, PropertyDescriptor | undefined>();

  beforeEach(() => {
    for (const key of FROZEN_KEYS) {
      const descriptor = Object.getOwnPropertyDescriptor(Error.prototype, key);
      saved.set(key, descriptor);
      Object.defineProperty(Error.prototype, key, {
        value: descriptor && 'value' in descriptor ? descriptor.value : '',
        writable: false,
        enumerable: false,
        configurable: true,
      });
    }
  });

  afterEach(() => {
    for (const key of FROZEN_KEYS) {
      const descriptor = saved.get(key);
      if (descriptor) {
        Object.defineProperty(Error.prototype, key, descriptor);
      } else {
        Reflect.deleteProperty(Error.prototype, key);
      }
    }
  });

  it('loads', async () => {
    await expect(importFreshVFileMessage()).resolves.toHaveProperty('VFileMessage');
  });

  it('still builds a message with its defaults', async () => {
    const { VFileMessage } = await importFreshVFileMessage();
    const message = new VFileMessage('Unexpected end of input');

    expect(message.reason).toBe('Unexpected end of input');
    expect(message.file).toBe('');
    expect(message).toBeInstanceOf(Error);
  });
});
