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

  // One button: a second "Reload from the server" sat under it whenever a
  // check ended without the page moving onto the new build.
  it('is one button, before and after a check', async () => {
    doubles.check.mockResolvedValue('current');
    render(<AppUpdateControl />);

    expect(screen.getAllByRole('button')).toEqual([checkButton()]);
    expect(screen.getByRole('status')).toHaveTextContent('');

    await userEvent.click(checkButton());

    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent('settings.update.current');
    });
    expect(screen.getAllByRole('button')).toEqual([checkButton()]);
  });

  it('disables the button while it checks', async () => {
    doubles.check.mockReturnValue(new Promise(() => undefined));
    render(<AppUpdateControl />);

    await userEvent.click(checkButton());

    expect(checkButton()).toBeDisabled();
  });

  it('says the app is current, reports it, and reloads nothing', async () => {
    doubles.check.mockResolvedValue('current');
    render(<AppUpdateControl />);

    await userEvent.click(checkButton());

    expect(await screen.findByRole('status')).toHaveTextContent('settings.update.current');
    expect(doubles.capture).toHaveBeenCalledWith('app_update_checked', { outcome: 'current' });
    expect(doubles.reloadFromServer).not.toHaveBeenCalled();
  });

  it.each([
    ['failed', 'settings.update.failed'],
    ['offline', 'settings.update.offline'],
    ['reloading', 'settings.update.reloading'],
  ] as const)('after %s, says %s and reloads nothing more', async (outcome, message) => {
    doubles.check.mockResolvedValue(outcome);
    render(<AppUpdateControl />);

    await userEvent.click(checkButton());

    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent(message);
    });
    expect(doubles.reloadFromServer).not.toHaveBeenCalled();
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

  // Reported from the app: "a new version is installing, the app restarts
  // when it is ready", and it did not. A found build is loaded now.
  it('loads a newer build from the server when it is found but does not take over', async () => {
    doubles.check.mockResolvedValue('installing');
    doubles.reloadFromServer.mockReturnValue(new Promise(() => undefined));
    render(<AppUpdateControl />);

    await userEvent.click(checkButton());

    await waitFor(() => {
      expect(doubles.reloadFromServer).toHaveBeenCalledTimes(1);
    });
    expect(doubles.capture).toHaveBeenCalledWith('app_reloaded_from_server');
    expect(screen.getByRole('status')).toHaveTextContent('settings.update.reloading');
    expect(checkButton()).toBeDisabled();
  });

  it('says offline when that reload refuses to run', async () => {
    doubles.check.mockResolvedValue('installing');
    doubles.reloadFromServer.mockResolvedValue(false);
    render(<AppUpdateControl />);

    await userEvent.click(checkButton());

    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent('settings.update.offline');
    });
  });

  it('waits for the store app to restart rather than reloading a page it does not have', async () => {
    doubles.canReload = false;
    doubles.check.mockResolvedValue('installing');
    render(<AppUpdateControl />);

    await userEvent.click(checkButton());

    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent('settings.update.installing');
    });
    expect(doubles.reloadFromServer).not.toHaveBeenCalled();
  });
});
