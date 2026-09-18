/**
 * @fileoverview Tests for the reasoning / answer split.
 *
 * The split runs on every streamed chunk, so the cases that matter are the
 * partial ones: a block that has opened and not closed is what the user looks
 * at for most of a slow turn.
 *
 * @module features/assistant/__tests__/reasoning.test
 */

import { describe, expect, it } from 'vitest';

import { hasReasoning, splitReasoning } from '../reasoning';

describe('splitReasoning', () => {
  it('leaves an answer with no reasoning untouched', () => {
    expect(splitReasoning('I added two rooms.')).toEqual({
      reasoning: '',
      answer: 'I added two rooms.',
      thinking: false,
    });
  });

  it('separates a closed block from the answer that follows it', () => {
    expect(
      splitReasoning('<think>Two nights, so two rooms.</think>I added them.'),
    ).toEqual({
      reasoning: 'Two nights, so two rooms.',
      answer: 'I added them.',
      thinking: false,
    });
  });

  it('reports a block that has not closed yet as still thinking', () => {
    expect(splitReasoning('<think>Counting the beds')).toEqual({
      reasoning: 'Counting the beds',
      answer: '',
      thinking: true,
    });
  });

  it('keeps the answer written before an open block', () => {
    // A model that talks, then thinks again, must not lose the first half.
    expect(splitReasoning('One moment. <think>checking the dates')).toEqual({
      reasoning: 'checking the dates',
      answer: 'One moment.',
      thinking: true,
    });
  });

  it('joins several blocks into one section', () => {
    const { reasoning, answer } = splitReasoning(
      '<think>First.</think>Word one. <think>Second.</think>Word two.',
    );

    expect(reasoning).toBe('First.\n\nSecond.');
    expect(answer).toBe('Word one. Word two.');
  });

  it('accepts the tags a small model improvises', () => {
    expect(splitReasoning('<reasoning>Picked addRoom.</reasoning>').reasoning).toBe(
      'Picked addRoom.',
    );
    expect(splitReasoning('<thinking>Picked addRoom.</thinking>').reasoning).toBe(
      'Picked addRoom.',
    );
  });

  it('drops an empty block rather than opening a blank section', () => {
    expect(splitReasoning('<think></think>Done.')).toEqual({
      reasoning: '',
      answer: 'Done.',
      thinking: false,
    });
  });

  it('keeps an action block in the answer, where the executor reads it', () => {
    // Action blocks travel in the answer: moving one into the reasoning would
    // silently stop the change from ever being applied.
    const response =
      '<think>They want a room.</think>Adding it.\n```action\n{"action":"addRoom","data":{"name":"Attic"}}\n```';

    expect(splitReasoning(response).answer).toContain('"action":"addRoom"');
  });

  it('does not mistake ordinary angle brackets for a block', () => {
    expect(splitReasoning('Budget < 200 and > 100.')).toEqual({
      reasoning: '',
      answer: 'Budget < 200 and > 100.',
      thinking: false,
    });
  });
});

describe('hasReasoning', () => {
  it('answers for both shapes', () => {
    expect(hasReasoning('plain answer')).toBe(false);
    expect(hasReasoning('<think>because</think>answer')).toBe(true);
  });
});
