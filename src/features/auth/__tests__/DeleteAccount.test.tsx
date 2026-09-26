/**
 * @fileoverview Deleting the account from Settings: asked twice, and honest
 * about what it keeps.
 *
 * @module features/auth/__tests__/DeleteAccount.test
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { render, screen, userEvent, waitFor } from '@/test/utils';

const doubles = vi.hoisted(() => ({
  deleteAccount: vi.fn(async () => true),
  success: vi.fn(),
  error: vi.fn(),
}));

vi.mock('@/features/auth/AuthContext', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/auth/AuthContext')>()),
  useAuth: () => ({ deleteAccount: doubles.deleteAccount }),
}));
vi.mock('@/lib/notifications', () => ({
  notify: { success: doubles.success, error: doubles.error },
}));

import { DeleteAccount } from '@/features/auth/components/DeleteAccount';

beforeEach(() => {
  vi.clearAllMocks();
  doubles.deleteAccount.mockResolvedValue(true);
});

async function confirmDeletion(): Promise<void> {
  const user = userEvent.setup();
  render(<DeleteAccount />, { withProviders: false });

  await user.click(screen.getByRole('button', { name: /auth\.account\.deleteAction/ }));
  expect(await screen.findByText('auth.account.deleteDescription')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'auth.account.deleteConfirm' }));
}

describe('DeleteAccount', () => {
  it('asks before deleting anything', async () => {
    const user = userEvent.setup();
    render(<DeleteAccount />, { withProviders: false });

    await user.click(screen.getByRole('button', { name: /auth\.account\.deleteAction/ }));

    expect(await screen.findByText('auth.account.deleteTitle')).toBeInTheDocument();
    expect(doubles.deleteAccount).not.toHaveBeenCalled();
  });

  it('deletes on the second answer and says so', async () => {
    await confirmDeletion();

    await waitFor(() => expect(doubles.deleteAccount).toHaveBeenCalledTimes(1));
    expect(doubles.success).toHaveBeenCalledWith('auth.account.deleted');
  });

  it('says so in the page when the server refused', async () => {
    doubles.deleteAccount.mockResolvedValue(false);

    await confirmDeletion();

    await waitFor(() => expect(doubles.error).toHaveBeenCalledWith('auth.account.deleteFailed'));
    expect(doubles.success).not.toHaveBeenCalled();
  });
});
