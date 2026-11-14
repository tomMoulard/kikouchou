/**
 * @fileoverview Tests for the "Check for updates" control in Settings.
 *
 * @module features/settings/components/__tests__/AppUpdateControl.test
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';

import { render, screen, waitFor } from '@/test/utils';

const doubles = vi.hoisted(() => ({
  canCheck: true,
  canReload: true,
  check: vi.fn(),
  reloadFromServer: vi.fn(),
  capture: vi.fn(),
}));

vi.mock('@/lib/pwa/app-update', () => ({
  canCheckForAppUpdate: () => doubles.canCheck,
  canReloadFromServer: () => doubles.canReload,
  checkForAppUpdate: doubles.check,
  reloadFromServer: doubles.reloadFromServer,
}));

vi.mock('@/lib/posthog', () => ({ captureEvent: doubles.capture }));

import { AppUpdateControl } from '../AppUpdateControl';

beforeEach(() => {
  doubles.canCheck = true;
  doubles.canReload = true;
  doubles.check.mockReset();
  doubles.reloadFromServer.mockReset();
  doubles.capture.mockReset();
});

function checkButton(): HTMLElement {
  return screen.getByRole('button', { name: 'settings.update.check' });
}

describe('AppUpdateControl', () => {
  it('renders nothing where no update can arrive outside a release', () => {
    doubles.canCheck = false;

    render(<AppUpdateControl />);

    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('offers only the check before anything was asked', () => {
    render(<AppUpdateControl />);

    expect(checkButton()).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'settings.update.reload' })).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('');
  });

  it('disables the button while it checks', async () => {
    doubles.check.mockReturnValue(new Promise(() => undefined));
    render(<AppUpdateControl />);

    await userEvent.click(checkButton());

    expect(checkButton()).toBeDisabled();
  });

  it('says the app is current, reports it, and offers the hard reload', async () => {
    doubles.check.mockResolvedValue('current');
    render(<AppUpdateControl />);

    await userEvent.click(checkButton());

    expect(await screen.findByRole('status')).toHaveTextContent('settings.update.current');
    expect(screen.getByRole('button', { name: 'settings.update.reload' })).toBeEnabled();
    expect(doubles.capture).toHaveBeenCalledWith('app_update_checked', { outcome: 'current' });
  });

  it.each([
    ['failed', 'settings.update.failed', true],
    ['installing', 'settings.update.installing', true],
    ['offline', 'settings.update.offline', false],
    ['reloading', 'settings.update.reloading', false],
  ] as const)('after %s, says %s', async (outcome, message, offersReload) => {
    doubles.check.mockResolvedValue(outcome);
    render(<AppUpdateControl />);

    await userEvent.click(checkButton());

    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent(message);
    });
    expect(screen.queryByRole('button', { name: 'settings.update.reload' }) !== null).toBe(offersReload);
  });

  it('treats a check that throws as failed', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    doubles.check.mockRejectedValue(new Error('boom'));
    render(<AppUpdateControl />);

    await userEvent.click(checkButton());

    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent('settings.update.failed');
    });
    expect(doubles.capture).toHaveBeenCalledWith('app_update_checked', { outcome: 'failed' });
    warn.mockRestore();
  });

  it('never offers the hard reload in a store app', async () => {
    doubles.canReload = false;
    doubles.check.mockResolvedValue('current');
    render(<AppUpdateControl />);

    await userEvent.click(checkButton());

    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent('settings.update.current');
    });
    expect(screen.queryByRole('button', { name: 'settings.update.reload' })).not.toBeInTheDocument();
  });

  it('reloads from the server on the second button', async () => {
    doubles.check.mockResolvedValue('current');
    doubles.reloadFromServer.mockReturnValue(new Promise(() => undefined));
    render(<AppUpdateControl />);

    await userEvent.click(checkButton());
    await userEvent.click(await screen.findByRole('button', { name: 'settings.update.reload' }));

    expect(doubles.reloadFromServer).toHaveBeenCalledTimes(1);
    expect(doubles.capture).toHaveBeenCalledWith('app_reloaded_from_server');
    expect(screen.getByRole('status')).toHaveTextContent('settings.update.reloading');
    expect(checkButton()).toBeDisabled();
  });

  it('says offline when the hard reload refuses to run', async () => {
    doubles.check.mockResolvedValue('failed');
    doubles.reloadFromServer.mockResolvedValue(false);
    render(<AppUpdateControl />);

    await userEvent.click(checkButton());
    await userEvent.click(await screen.findByRole('button', { name: 'settings.update.reload' }));

    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent('settings.update.offline');
    });
  });
});
