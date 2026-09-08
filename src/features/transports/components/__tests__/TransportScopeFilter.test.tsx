/**
 * @fileoverview Tests for the "only mine / everyone" control.
 *
 * The control's real job is the second half: a filter that empties a page
 * without saying so reads as data loss, so the hidden count has to be rendered,
 * announced, and undoable in one tap. Each of those is asserted separately
 * here, because a count that renders in a region nothing announces looks
 * identical in a screenshot and is useless to the person it was written for.
 *
 * @module features/transports/components/__tests__/TransportScopeFilter.test
 */

import { describe, expect, it, vi } from 'vitest';

import { render, screen } from '@/test/utils';
import { TransportScopeFilter } from '../TransportScopeFilter';

// ============================================================================
// Tests
// ============================================================================

describe('TransportScopeFilter', () => {
  it('offers both scopes under an accessible name', () => {
    render(
      <TransportScopeFilter
        scope="mine"
        canFilter={true}
        hiddenCount={0}
        onScopeChange={vi.fn()}
      />,
      { withProviders: false },
    );

    const group = screen.getByRole('radiogroup', {
      name: 'transports.scope.label',
    });

    expect(group).toBeInTheDocument();
    expect(
      screen.getByRole('radio', { name: 'identity.scopeMine' }),
    ).toHaveAttribute('aria-checked', 'true');
    expect(
      screen.getByRole('radio', { name: 'identity.scopeAll' }),
    ).toHaveAttribute('aria-checked', 'false');
  });

  it('reports the choice', async () => {
    const onScopeChange = vi.fn();
    const { user } = render(
      <TransportScopeFilter
        scope="mine"
        canFilter={true}
        hiddenCount={2}
        onScopeChange={onScopeChange}
      />,
      { withProviders: false },
    );

    await user.click(screen.getByRole('radio', { name: 'identity.scopeAll' }));

    expect(onScopeChange).toHaveBeenCalledWith('all');
  });

  it('announces what it is hiding, and offers the way back', async () => {
    const onScopeChange = vi.fn();
    const { user } = render(
      <TransportScopeFilter
        scope="mine"
        canFilter={true}
        hiddenCount={3}
        onScopeChange={onScopeChange}
      />,
      { withProviders: false },
    );

    // Announced, not merely drawn: the count sits inside a polite live region.
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('transports.scope.hidden');
    expect(status).toHaveAttribute('aria-live', 'polite');

    await user.click(screen.getByRole('button', { name: 'transports.scope.showAll' }));

    expect(onScopeChange).toHaveBeenCalledWith('all');
  });

  it('keeps the live region mounted while it has nothing to say', () => {
    // A region inserted in the same tick as its first message is announced by
    // roughly nothing, so it is mounted empty rather than conditionally.
    render(
      <TransportScopeFilter
        scope="all"
        canFilter={true}
        hiddenCount={4}
        onScopeChange={vi.fn()}
      />,
      { withProviders: false },
    );

    const status = screen.getByRole('status');
    expect(status).toBeInTheDocument();
    expect(status).toHaveTextContent('');
    expect(
      screen.queryByRole('button', { name: 'transports.scope.showAll' }),
    ).not.toBeInTheDocument();
  });

  it('points at Settings instead of a control nobody can use', () => {
    // No identity means no filtering, so there is no switch to offer — only
    // the one action that would make one possible.
    render(
      <TransportScopeFilter
        scope="all"
        canFilter={false}
        hiddenCount={0}
        onScopeChange={vi.fn()}
      />,
      { withProviders: false },
    );

    expect(screen.queryByRole('radiogroup')).not.toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'transports.scope.chooseIdentity' }),
    ).toHaveAttribute('href', '/settings');
  });
});
