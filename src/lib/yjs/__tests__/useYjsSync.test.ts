/**
 * @fileoverview Tests for signaling endpoint resolution in useYjsSync.
 * @module lib/yjs/__tests__/useYjsSync
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import { resolveSignalingServer } from '../useYjsSync';

// ============================================================================
// Helpers
// ============================================================================

const originalLocation = window.location;

function mockHostname(hostname: string): void {
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: {
      ...originalLocation,
      hostname,
    },
    writable: true,
  });
}

// ============================================================================
// Tests
// ============================================================================

describe('resolveSignalingServer', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: originalLocation,
      writable: true,
    });
  });

  it('prefers VITE_SIGNALING_URL when provided', () => {
    vi.stubEnv('VITE_SIGNALING_URL', 'wss://custom.example.test');

    expect(resolveSignalingServer()).toBe('wss://custom.example.test');
  });

  it('uses the local relay when running on localhost', () => {
    vi.stubEnv('VITE_SIGNALING_URL', '');
    mockHostname('localhost');

    expect(resolveSignalingServer()).toBe('ws://localhost:4444');
  });

  it('uses the production signaling endpoint by default', () => {
    vi.stubEnv('VITE_SIGNALING_URL', '');
    mockHostname('example.com');

    expect(resolveSignalingServer()).toBe('wss://kikoushou.cyprin.eu');
  });
});
