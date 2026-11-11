/**
 * Tests for the screen shown when the device has no storage left for the
 * database to open.
 *
 * Rendered through the real locale files: this screen replaces the whole app,
 * so a missing key would leave the user with nothing readable at all.
 *
 * @module components/shared/__tests__/StorageFullScreen.test
 */
import { describe, expect, it, vi } from 'vitest';

import { renderWithRealI18n, screen } from '@/test/utils';

import { StorageFullScreen } from '../StorageFullScreen';

vi.unmock('i18next');
vi.unmock('react-i18next');

describe('StorageFullScreen', () => {
  it('says the storage is full and how to get out of it', async () => {
    await renderWithRealI18n(<StorageFullScreen onRetry={vi.fn()} />, {
      withProviders: false,
    });

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent("Your device's storage is full");
    expect(alert).toHaveTextContent(/free some space/i);
  });

  it('says it in French', async () => {
    await renderWithRealI18n(<StorageFullScreen onRetry={vi.fn()} />, {
      language: 'fr',
      withProviders: false,
    });

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Le stockage de votre appareil est plein');
    expect(alert).toHaveTextContent(/libérez de l'espace/i);
    expect(screen.getByRole('button', { name: 'Réessayer' })).toBeInTheDocument();
  });

  it('retries when asked', async () => {
    const onRetry = vi.fn();
    const { user } = await renderWithRealI18n(<StorageFullScreen onRetry={onRetry} />, {
      withProviders: false,
    });

    await user.click(screen.getByRole('button', { name: 'Retry' }));

    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
