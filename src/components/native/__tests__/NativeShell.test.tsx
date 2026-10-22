/**
 * @fileoverview `NativeShell`: links, the back button, the system bars and the
 * splash screen in a store app, and nothing at all on the website.
 *
 * @module components/native/__tests__/NativeShell.test
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const platform = vi.hoisted(() => ({ value: 'android' as string }));

type Handler = (payload: never) => void;

const doubles = vi.hoisted(() => {
  const listeners = new Map<string, Handler>();
  return {
    listeners,
    getLaunchUrl: vi.fn(async (): Promise<{ url: string } | undefined> => undefined),
    minimizeApp: vi.fn(async () => undefined),
    addListener: vi.fn(async (event: string, handler: Handler) => {
      listeners.set(event, handler);
      return { remove: vi.fn(async () => undefined) };
    }),
    setStyle: vi.fn(async () => undefined),
    hideSplash: vi.fn(async () => undefined),
    navigate: vi.fn(async () => undefined),
    pathname: '/trips/t1/calendar',
    theme: 'dark' as string | undefined,
    notificationListener: undefined as ((open: { kind: string; url: string }) => void) | undefined,
    reportOpened: vi.fn(),
    deliver: vi.fn(() => true),
  };
});

vi.mock('@capacitor/core', () => ({
  Capacitor: { getPlatform: () => platform.value, isPluginAvailable: () => true },
  SystemBars: { setStyle: doubles.setStyle },
  SystemBarsStyle: { Dark: 'DARK', Light: 'LIGHT' },
}));
vi.mock('@capacitor/app', () => ({
  App: {
    getLaunchUrl: doubles.getLaunchUrl,
    minimizeApp: doubles.minimizeApp,
    addListener: doubles.addListener,
  },
}));
vi.mock('@capacitor/splash-screen', () => ({ SplashScreen: { hide: doubles.hideSplash } }));
vi.mock('next-themes', () => ({ useTheme: () => ({ resolvedTheme: doubles.theme }) }));
vi.mock('@/router', () => ({
  router: {
    navigate: doubles.navigate,
    get state() {
      return { location: { pathname: doubles.pathname } };
    },
  },
}));
vi.mock('@/lib/notifications/native-push', () => ({
  onNativeNotificationOpened: (listener: (open: { kind: string; url: string }) => void) => {
    doubles.notificationListener = listener;
    return () => undefined;
  },
}));
vi.mock('@/lib/notifications/opened', () => ({ reportNotificationOpened: doubles.reportOpened }));
vi.mock('@/lib/supabase/auth-callback', () => ({ deliverAuthCallbackUrl: doubles.deliver }));
const sheet = vi.hoisted(() => ({ close: vi.fn(), deliverOpenRouter: vi.fn(() => true) }));
vi.mock('@/lib/native/oauth', () => ({ closeBrowserSheet: sheet.close }));
vi.mock('@/features/assistant/openrouter/callback', () => ({
  deliverOpenRouterCallbackUrl: sheet.deliverOpenRouter,
}));

import { render } from '@testing-library/react';

import { NativeShell } from '@/components/native/NativeShell';
import { openDeepLink } from '@/components/native/open-deep-link';

const TOKEN = 'OMIMwxRIi6TF_KP6';

beforeEach(() => {
  vi.clearAllMocks();
  doubles.listeners.clear();
  platform.value = 'android';
  doubles.pathname = '/trips/t1/calendar';
  doubles.theme = 'dark';
  doubles.notificationListener = undefined;
  vi.stubEnv('VITE_SHARE_ORIGIN', 'https://share.kikouchou.app');
});

describe('openDeepLink', () => {
  it('turns a share link into the route its redirect would reach', () => {
    openDeepLink(`https://share.kikouchou.app/fr/${TOKEN}`);

    expect(doubles.navigate).toHaveBeenCalledWith(`/join/${TOKEN}?lng=fr`);
  });

  it('hands a sign-in answer to the auth layer, then shows the trips', () => {
    const url = 'https://app.kikouchou.app/auth/native?code=abc';

    openDeepLink(url);

    expect(doubles.deliver).toHaveBeenCalledWith(url);
    expect(doubles.navigate).toHaveBeenCalledWith('/trips', { replace: true });
  });

  it('keeps the page where it is for the OAuth sheet coming back', () => {
    openDeepLink('app.kikouchou://auth/callback?code=abc');

    expect(doubles.deliver).toHaveBeenCalled();
    expect(doubles.navigate).not.toHaveBeenCalled();
  });

  it('hands the OpenRouter sign-in to the assistant, never to Supabase', () => {
    const url = 'app.kikouchou://openrouter/callback?code=abc&state=s';

    openDeepLink(url);

    expect(sheet.close).toHaveBeenCalled();
    expect(sheet.deliverOpenRouter).toHaveBeenCalledWith(url);
    expect(doubles.deliver).not.toHaveBeenCalled();
  });

  it('ignores a link from anywhere else', () => {
    openDeepLink('https://evil.example/join/abc');

    expect(doubles.navigate).not.toHaveBeenCalled();
    expect(doubles.deliver).not.toHaveBeenCalled();
  });
});

describe('NativeShell', () => {
  it('does nothing at all on the website', async () => {
    platform.value = 'web';

    render(<NativeShell />);
    await Promise.resolve();

    expect(doubles.addListener).not.toHaveBeenCalled();
    expect(doubles.getLaunchUrl).not.toHaveBeenCalled();
    expect(doubles.hideSplash).not.toHaveBeenCalled();
    expect(doubles.setStyle).not.toHaveBeenCalled();
  });

  it('opens the link the app was launched with', async () => {
    doubles.getLaunchUrl.mockResolvedValueOnce({ url: `https://app.kikouchou.app/join/${TOKEN}` });

    render(<NativeShell />);

    await vi.waitFor(() => expect(doubles.navigate).toHaveBeenCalledWith(`/join/${TOKEN}`));
  });

  it('opens a link tapped while the app runs', async () => {
    render(<NativeShell />);
    await vi.waitFor(() => expect(doubles.listeners.has('appUrlOpen')).toBe(true));

    doubles.listeners.get('appUrlOpen')?.({ url: `https://share.kikouchou.app/en/t/${TOKEN}` } as never);

    expect(doubles.navigate).toHaveBeenCalledWith(`/template/${TOKEN}?lng=en`);
  });

  it('walks back through the history, and leaves the app from the trip list', async () => {
    render(<NativeShell />);
    await vi.waitFor(() => expect(doubles.listeners.has('backButton')).toBe(true));
    const back = doubles.listeners.get('backButton');

    back?.({ canGoBack: true } as never);
    expect(doubles.navigate).toHaveBeenCalledWith(-1);

    doubles.pathname = '/trips';
    back?.({ canGoBack: true } as never);
    expect(doubles.minimizeApp).toHaveBeenCalledTimes(1);

    doubles.pathname = '/trips/t1/rooms';
    back?.({ canGoBack: false } as never);
    expect(doubles.minimizeApp).toHaveBeenCalledTimes(2);
  });

  it('follows the theme with the system bars', () => {
    const { unmount } = render(<NativeShell />);
    expect(doubles.setStyle).toHaveBeenLastCalledWith({ style: 'DARK' });
    unmount();

    doubles.theme = 'light';
    render(<NativeShell />);
    expect(doubles.setStyle).toHaveBeenLastCalledWith({ style: 'LIGHT' });
  });

  it('waits for the theme before touching the bars', () => {
    doubles.theme = undefined;

    render(<NativeShell />);

    expect(doubles.setStyle).not.toHaveBeenCalled();
  });

  it('takes the splash screen down once painted', () => {
    render(<NativeShell />);

    expect(doubles.hideSplash).toHaveBeenCalled();
  });

  it('reports a reminder tap and opens what it names', () => {
    render(<NativeShell />);

    doubles.notificationListener?.({ kind: 'pickup', url: '' });
    expect(doubles.reportOpened).toHaveBeenCalledWith('pickup');
    expect(doubles.navigate).toHaveBeenCalledWith('/trips');

    doubles.notificationListener?.({ kind: 'trip_start', url: '/trips/t1/calendar' });
    expect(doubles.navigate).toHaveBeenCalledWith('/trips/t1/calendar');

    doubles.notificationListener?.({ kind: 'moved', url: `https://app.kikouchou.app/join/${TOKEN}` });
    expect(doubles.navigate).toHaveBeenCalledWith(`/join/${TOKEN}`);
  });
});
