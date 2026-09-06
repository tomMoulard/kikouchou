/**
 * Action schema tests
 *
 * Covers the activity actions added for the shared agenda, plus the
 * `string[]` field type used by `addActivity.participantIds`.
 *
 * @module features/assistant/__tests__/action-schema.test
 */

import { describe, expect, it, vi } from 'vitest';

import { ACTION_SCHEMAS, generateActionPrompt, validateAction } from '../action-schema';

// ============================================================================
// Tests
// ============================================================================

describe('action-schema', () => {
  describe('activity coverage', () => {
    it('exposes every agenda action to the LLM', () => {
      const names = ACTION_SCHEMAS.map((schema) => schema.action);

      expect(names).toEqual(
        expect.arrayContaining([
          'addActivity',
          'updateActivity',
          'removeActivity',
          'joinActivity',
          'leaveActivity',
        ]),
      );
    });

    it('documents the activity actions in the generated prompt', () => {
      const prompt = generateActionPrompt().join('\n');

      expect(prompt).toContain('addActivity');
      expect(prompt).toContain('joinActivity');
      expect(prompt).toContain('horticulture');
    });
  });

  describe('validateAction — addActivity', () => {
    it('accepts a minimal activity', () => {
      const result = validateAction({
        action: 'addActivity',
        data: {
          title: 'Plant fair',
          category: 'horticulture',
          startDatetime: '2026-04-20T09:00:00',
        },
      });

      expect(result).not.toBeNull();
      expect(result?.action).toBe('addActivity');
      expect(result?.data.title).toBe('Plant fair');
    });

    it('rejects a category outside the enum', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

      expect(
        validateAction({
          action: 'addActivity',
          data: {
            title: 'Plant fair',
            category: 'gardening',
            startDatetime: '2026-04-20T09:00:00',
          },
        }),
      ).toBeNull();

      warn.mockRestore();
    });

    it('rejects an activity without a start datetime', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

      expect(
        validateAction({
          action: 'addActivity',
          data: { title: 'Plant fair', category: 'visit' },
        }),
      ).toBeNull();

      warn.mockRestore();
    });
  });

  describe('validateAction — addGuest', () => {
    it('accepts a guest with a phone number', () => {
      const result = validateAction({
        action: 'addGuest',
        data: { name: 'Mary', phone: '+33 6 12 34 56 78' },
      });

      expect(result).not.toBeNull();
      expect(result?.data.phone).toBe('+33 6 12 34 56 78');
    });

    it('accepts a guest without one — the field is optional', () => {
      const result = validateAction({ action: 'addGuest', data: { name: 'Mary' } });

      expect(result).not.toBeNull();
      expect(result?.data.phone).toBeUndefined();
    });

    it('accepts a child seat kind', () => {
      const result = validateAction({
        action: 'addGuest',
        data: { name: 'Lila', childSeat: 'booster' },
      });

      expect(result).not.toBeNull();
      expect(result?.data.childSeat).toBe('booster');
    });
  });

  describe('validateAction — string[] fields', () => {
    it('keeps a JSON array of ids as-is', () => {
      const result = validateAction({
        action: 'addActivity',
        data: {
          title: 'Hike',
          category: 'hike',
          startDatetime: '2026-04-20T09:00:00',
          participantIds: ['p1', 'p2'],
        },
      });

      expect(result?.data.participantIds).toEqual(['p1', 'p2']);
    });

    it('coerces a comma-separated string into an array', () => {
      const result = validateAction({
        action: 'addActivity',
        data: {
          title: 'Hike',
          category: 'hike',
          startDatetime: '2026-04-20T09:00:00',
          participantIds: 'p1, p2',
        },
      });

      expect(result?.data.participantIds).toEqual(['p1', 'p2']);
    });

    it('rejects a non-string array', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

      expect(
        validateAction({
          action: 'addActivity',
          data: {
            title: 'Hike',
            category: 'hike',
            startDatetime: '2026-04-20T09:00:00',
            participantIds: [1, 2],
          },
        }),
      ).toBeNull();

      warn.mockRestore();
    });
  });

  describe('validateAction — participation', () => {
    it('accepts joinActivity with both ids', () => {
      const result = validateAction({
        action: 'joinActivity',
        data: { activityId: 'act1', personId: 'p1' },
      });

      expect(result).not.toBeNull();
    });

    it('rejects leaveActivity without a personId', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

      expect(
        validateAction({
          action: 'leaveActivity',
          data: { activityId: 'act1' },
        }),
      ).toBeNull();

      warn.mockRestore();
    });
  });
});

// ============================================================================
// Prompt Budget
// ============================================================================

/**
 * The action prompt is paid on **every** turn, before a single byte of trip
 * data, and it is the largest fixed cost in the system prompt.
 *
 * On a model whose ONNX export does not slice the logits — `gemma-3-1b` has no
 * `num_logits_to_keep` input — prefill computes logits for *every* prompt
 * position, so each prompt token costs `vocab_size` floats of GPU-to-CPU
 * readback. At Gemma's 262144-token vocabulary that is half a mebibyte per
 * prompt token in fp16, and a 2401-token prompt is what took the WebGPU device
 * down with "Failed to allocate memory for buffer mapping".
 *
 * Characters rather than tokens, so the guard runs without downloading a
 * tokenizer; the Gemma tokenizer averages ~3.6 chars per token on this text,
 * which puts this budget at roughly 1000 tokens — down from the ~1650 that
 * spelling out every optional field of all sixteen actions used to cost.
 *
 * Adding an action is expected to eat into it. Rewriting the section to fit
 * again is the right response to hitting the ceiling; raising it is not.
 */
const MAX_ACTION_PROMPT_CHARS = 3700;

describe('action-schema prompt budget', () => {
  it('documents every action within the prompt character budget', () => {
    const prompt = generateActionPrompt().join('\n');

    expect(prompt.length).toBeLessThanOrEqual(MAX_ACTION_PROMPT_CHARS);
  });

  it('still names every action in ACTION_SCHEMAS', () => {
    const prompt = generateActionPrompt().join('\n');

    for (const schema of ACTION_SCHEMAS) {
      expect(prompt).toContain(schema.action);
    }
  });

  it('still names every field of every action', () => {
    const prompt = generateActionPrompt().join('\n');

    for (const schema of ACTION_SCHEMAS) {
      for (const field of Object.keys(schema.fields)) {
        expect(prompt).toContain(field);
      }
    }
  });

  it('still lists every enum value the validator accepts', () => {
    const prompt = generateActionPrompt().join('\n');

    for (const schema of ACTION_SCHEMAS) {
      for (const field of Object.values(schema.fields)) {
        for (const value of field.enum ?? []) {
          expect(prompt).toContain(value);
        }
      }
    }
  });

  it('spells out each enum once, however many actions share it', () => {
    const lines = generateActionPrompt(),
      // `category` belongs to both addActivity and updateActivity. Printing all
      // ten values twice cost 100 characters of the budget above for a list the
      // model had just read.
      categoryLines = lines.filter((line) => line.trim().startsWith('category:'));

    expect(categoryLines).toHaveLength(1);
    expect(categoryLines[0]).toContain('horticulture');
  });
});

// ============================================================================
// Guest groups
// ============================================================================

describe('action-schema — importGuestGroup', () => {
  it('is offered to the LLM', () => {
    const prompt = generateActionPrompt().join('\n');

    expect(ACTION_SCHEMAS.map((schema) => schema.action)).toContain(
      'importGuestGroup',
    );
    expect(prompt).toContain('importGuestGroup');
  });

  it('accepts a group id on its own — that means everybody', () => {
    const result = validateAction({
      action: 'importGuestGroup',
      data: { groupId: 'group-1' },
    });

    expect(result).not.toBeNull();
    expect(result?.data.groupId).toBe('group-1');
    expect(result?.data.memberIds).toBeUndefined();
  });

  it('keeps a JSON array of member ids', () => {
    const result = validateAction({
      action: 'importGuestGroup',
      data: { groupId: 'group-1', memberIds: ['m1', 'm2'] },
    });

    expect(result?.data.memberIds).toEqual(['m1', 'm2']);
  });

  it('coerces the comma-separated list small models emit', () => {
    const result = validateAction({
      action: 'importGuestGroup',
      data: { groupId: 'group-1', memberIds: 'm1, m2' },
    });

    expect(result?.data.memberIds).toEqual(['m1', 'm2']);
  });

  it('rejects an import with no group id', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const result = validateAction({
      action: 'importGuestGroup',
      data: { memberIds: ['m1'] },
    });

    expect(result).toBeNull();
    warn.mockRestore();
  });
});

// ============================================================================
// When Not To Act
// ============================================================================

/**
 * The catalogue is the bulk of the prompt, so it pulls the model towards using
 * it. What stops that is the handful of lines saying when *not* to — without
 * them, "Salut, que penses-tu des gens qui vibe code ?" was answered with
 * "Okay, let's tackle this trip planning request!", a trip nobody asked for and
 * an id the model made up on the spot.
 */
describe('action-schema restraint rules', () => {
  it('says greetings and small talk get no block', () => {
    const prompt = generateActionPrompt().join('\n');

    expect(prompt).toContain(
      'Questions, greetings and small talk get no block at all',
    );
  });

  it('forbids inventing an id, a name or a date', () => {
    const prompt = generateActionPrompt().join('\n');

    expect(prompt).toContain('Never invent an id, a name or a date');
  });
});
