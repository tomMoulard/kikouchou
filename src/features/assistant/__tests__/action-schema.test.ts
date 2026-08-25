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
