/**
 * @fileoverview The ready-made first questions of an empty chat.
 * @module features/assistant/components/__tests__/StarterPrompts.test
 */

import { describe, expect, it, vi } from 'vitest';

import { render, screen } from '@/test/utils';

import { STARTER_PROMPTS } from '../../starters';
import { StarterPrompts } from '../StarterPrompts';

describe('StarterPrompts', () => {
  it('offers two ways to start a trip and two looks at the one on screen', () => {
    expect(STARTER_PROMPTS.filter((s) => s.kind === 'create')).toHaveLength(2);
    expect(STARTER_PROMPTS.filter((s) => s.kind === 'explore')).toHaveLength(2);

    render(<StarterPrompts onPick={vi.fn()} disabled={false} />, { withProviders: false });

    const group = screen.getByRole('group', { name: 'assistant.starters.label' });
    expect(group.querySelectorAll('button')).toHaveLength(4);
  });

  it('hands the question and its kind to the page', async () => {
    const onPick = vi.fn();
    const { user } = render(<StarterPrompts onPick={onPick} disabled={false} />, {
      withProviders: false,
    });

    await user.click(screen.getByRole('button', { name: 'assistant.starters.createWeekend' }));

    expect(onPick).toHaveBeenCalledWith('assistant.starters.createWeekend', 'create');
  });

  it('takes no tap while it is disabled', async () => {
    const onPick = vi.fn();
    const { user } = render(<StarterPrompts onPick={onPick} disabled />, {
      withProviders: false,
    });

    await user.click(screen.getByRole('button', { name: 'assistant.starters.exploreRooms' }));

    expect(onPick).not.toHaveBeenCalled();
  });
});
