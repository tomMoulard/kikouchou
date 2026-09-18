/**
 * @fileoverview The shared install prompt: one hook run, one request flag.
 *
 * @module contexts/__tests__/InstallPromptContext.test
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';

import { InstallPromptProvider, useInstallPromptState } from '../InstallPromptContext';
import { useInstallPrompt } from '@/hooks/useInstallPrompt';

vi.mock('@/hooks/useInstallPrompt', () => ({ useInstallPrompt: vi.fn() }));

const mockedUseInstallPrompt = vi.mocked(useInstallPrompt);

const HOOK_RESULT = {
  canInstall: true,
  isInstalled: false,
  isInstalling: false,
  installIntent: false,
  manualInstallPlatform: 'ios' as const,
  install: vi.fn(async () => true),
};

function Wrapper({ children }: { children: ReactNode }): ReactElement {
  return <InstallPromptProvider>{children}</InstallPromptProvider>;
}

beforeEach(() => {
  mockedUseInstallPrompt.mockReset();
  mockedUseInstallPrompt.mockReturnValue(HOOK_RESULT);
});

describe('useInstallPromptState', () => {
  it('hands the hook result to every consumer from one hook run', () => {
    const { result } = renderHook(
      () => ({ first: useInstallPromptState(), second: useInstallPromptState() }),
      { wrapper: Wrapper },
    );

    // Two consumers, one listener: a second `useInstallPrompt` would count
    // one `appinstalled` twice.
    expect(mockedUseInstallPrompt).toHaveBeenCalledTimes(1);
    expect(result.current.first.canInstall).toBe(true);
    expect(result.current.first.manualInstallPlatform).toBe('ios');
    expect(result.current.second.install).toBe(HOOK_RESULT.install);
  });

  it('turns a runtime request into install intent', () => {
    const { result } = renderHook(() => useInstallPromptState(), { wrapper: Wrapper });

    expect(result.current.installIntent).toBe(false);

    act(() => {
      result.current.requestInstall();
    });

    // What `?install=1` on arrival would have said, said later by the nudge.
    expect(result.current.installIntent).toBe(true);
  });

  it('keeps the intent an arrival parameter set', () => {
    mockedUseInstallPrompt.mockReturnValue({ ...HOOK_RESULT, installIntent: true });

    const { result } = renderHook(() => useInstallPromptState(), { wrapper: Wrapper });

    expect(result.current.installIntent).toBe(true);
  });

  it('reports nothing to install outside a provider', async () => {
    const { result } = renderHook(() => useInstallPromptState());

    expect(mockedUseInstallPrompt).not.toHaveBeenCalled();
    expect(result.current.canInstall).toBe(false);
    expect(result.current.isInstalled).toBe(false);
    expect(result.current.installIntent).toBe(false);
    await expect(result.current.install()).resolves.toBe(false);
    expect(() => {
      result.current.requestInstall();
    }).not.toThrow();
  });
});
