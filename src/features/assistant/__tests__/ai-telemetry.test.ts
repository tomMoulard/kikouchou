/**
 * What an `$ai_generation` event is allowed to carry.
 *
 * The system message is the trip: every guest's name, phone, notes, who sleeps
 * where and what everybody owes. Those people are not users of this app.
 *
 * @module features/assistant/__tests__/ai-telemetry.test
 */

import { describe, expect, it } from 'vitest';

import {
  aiUsageProperties,
  redactAiMessages,
  redactAiOutput,
} from '@/features/assistant/ai-telemetry';
import type { ChatMessage } from '@/features/assistant/hooks/useAssistantChat';

// ============================================================================
// Helpers
// ============================================================================

const TRIP_CONTEXT = [
  '## Guests',
  '- id: p1 — Marie Dupont, +33 6 12 34 56 78, peanut allergy',
  '- id: p2 — Tom Moulard, sleeps in the Attic',
].join('\n');

const MESSAGES: readonly ChatMessage[] = [
  { role: 'system', content: TRIP_CONTEXT },
  { role: 'user', content: 'Who is in the Attic?' },
  { role: 'assistant', content: 'Tom Moulard is in the Attic.' },
];

// ============================================================================
// Tests
// ============================================================================

describe('redactAiMessages', () => {
  it('keeps no part of the trip context', () => {
    const redacted = redactAiMessages(MESSAGES);

    expect(redacted[0]?.content).not.toContain('Marie Dupont');
    expect(redacted[0]?.content).not.toContain('+33 6 12 34 56 78');
    expect(redacted[0]?.content).not.toContain('peanut');
  });

  it('keeps the length, which is what the prefill question is about', () => {
    const redacted = redactAiMessages(MESSAGES);

    expect(redacted[0]?.content).toBe(`[redacted: ${TRIP_CONTEXT.length} chars]`);
  });

  it("keeps the user's own turn, the one exception this project decided on", () => {
    const redacted = redactAiMessages(MESSAGES);

    expect(redacted[1]).toEqual({ role: 'user', content: 'Who is in the Attic?' });
  });

  it("redacts the model's turns, which are composed from the trip", () => {
    const redacted = redactAiMessages(MESSAGES);

    expect(redacted[2]?.role).toBe('assistant');
    expect(redacted[2]?.content).not.toContain('Tom Moulard');
  });

  it('keeps every turn, so the shape of the exchange is still readable', () => {
    expect(redactAiMessages(MESSAGES)).toHaveLength(MESSAGES.length);
  });
});

describe('redactAiOutput', () => {
  it('reports the answer by its length and not by its text', () => {
    const answer = 'Marie sleeps in the Barn from the 2nd.';

    expect(redactAiOutput(answer)).toEqual([
      { role: 'assistant', content: `[redacted: ${answer.length} chars]` },
    ]);
  });
});

describe('aiUsageProperties', () => {
  it('names the tokens and the cost the way PostHog reads them', () => {
    expect(
      aiUsageProperties({ inputTokens: 1200, outputTokens: 80, costUsd: 0.00042 }),
    ).toEqual({
      $ai_input_tokens: 1200,
      $ai_output_tokens: 80,
      $ai_total_cost_usd: 0.00042,
    });
  });

  it('claims no cost when the stream reported none', () => {
    expect(aiUsageProperties(undefined)).toEqual({});
    expect(aiUsageProperties({ inputTokens: 5 })).toEqual({ $ai_input_tokens: 5 });
  });

  it('keeps a reported cost of zero, which is a free answer and not a missing one', () => {
    expect(aiUsageProperties({ costUsd: 0 })).toEqual({ $ai_total_cost_usd: 0 });
  });
});
