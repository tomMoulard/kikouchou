/**
 * ChatMessage Tests
 *
 * Covers the views an answer asks for: drawn under the words, never shown as
 * the raw block, and never drawn from the user's own line.
 *
 * @module features/assistant/components/__tests__/ChatMessage.test
 */

import { describe, expect, it, vi } from 'vitest';

import { render, screen } from '@/test/utils';

vi.mock('../AssistantTripView', () => ({
  AssistantTripView: ({ view }: { readonly view: string }) => (
    <section aria-label={`view:${view}`} />
  ),
}));

import { buildShowViewBlock } from '../../views';
import { ChatMessage } from '../ChatMessage';

// ============================================================================
// Tests
// ============================================================================

describe('ChatMessage — views', () => {
  it('draws the view an answer asks for, under its words, without the block', () => {
    render(
      <ChatMessage
        message={{
          id: 'a1',
          role: 'assistant',
          content: `Here is the week.\n\n${buildShowViewBlock('planning')}`,
        }}
      />,
      { withProviders: false },
    );

    expect(screen.getByText('Here is the week.')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'view:planning' })).toBeInTheDocument();
    expect(screen.queryByText(/showView/)).not.toBeInTheDocument();
  });

  it('shows no placeholder dots when the answer is a view alone', () => {
    render(
      <ChatMessage
        message={{
          id: 'a2',
          role: 'assistant',
          content: buildShowViewBlock('money'),
          shortcut: true,
        }}
      />,
      { withProviders: false },
    );

    expect(screen.getByRole('region', { name: 'view:money' })).toBeInTheDocument();
    expect(screen.queryByText('...')).not.toBeInTheDocument();
  });

  it('draws several views in the order asked', () => {
    render(
      <ChatMessage
        message={{
          id: 'a3',
          role: 'assistant',
          content: [buildShowViewBlock('rooms'), buildShowViewBlock('rides')].join('\n'),
        }}
      />,
      { withProviders: false },
    );

    expect(
      screen.getAllByRole('region').map((region) => region.getAttribute('aria-label')),
    ).toEqual(['view:rooms', 'view:rides']);
  });

  it('never draws a view from what the user typed', () => {
    render(
      <ChatMessage
        message={{ id: 'u1', role: 'user', content: buildShowViewBlock('planning') }}
      />,
      { withProviders: false },
    );

    expect(screen.queryByRole('region')).not.toBeInTheDocument();
  });
});
