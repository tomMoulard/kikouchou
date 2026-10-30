/**
 * @fileoverview Small render helpers the rooms tests share.
 *
 * @module features/rooms/__tests__/harness
 */

import { act, render, waitForDb } from '@/test/utils';

/**
 * Renders under the shared harness's router only.
 *
 * The rooms dialog and timeline tests mock the contexts they read, so the
 * real providers would only get in the way.
 */
export function renderPlain(ui: Parameters<typeof render>[0]): ReturnType<typeof render> {
  return render(ui, { withProviders: false });
}

/**
 * Lets a conflict check that is still answering land inside act().
 *
 * The assignment forms start a check as soon as they hold a guest and two
 * dates, and its answer comes a tick later. A test that ends on a synchronous
 * assertion would otherwise leave it to arrive after the test, as an update
 * outside act().
 */
export async function settle(): Promise<void> {
  await act(async () => {
    await waitForDb(0);
  });
}
