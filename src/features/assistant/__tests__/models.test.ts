/**
 * @fileoverview Unit tests for assistant model preset helpers.
 * @module features/assistant/__tests__/models.test
 */

import { describe, expect, it } from 'vitest';

import {
  ASSISTANT_MODEL_PRESETS,
  DEFAULT_ASSISTANT_MODEL_ID,
  getAssistantModelPreset,
  isAssistantModelId,
} from '../models';

describe('assistant model presets', () => {
  it('exposes the supported presets in increasing size order', () => {
    expect(ASSISTANT_MODEL_PRESETS.map((preset) => preset.id)).toEqual([
      'gemma-3-1b',
      'gemma-4-e2b',
      'gemma-4-e4b',
    ]);
  });

  it('resolves the configured default preset', () => {
    const preset = getAssistantModelPreset(DEFAULT_ASSISTANT_MODEL_ID);

    expect(preset.id).toBe(DEFAULT_ASSISTANT_MODEL_ID);
    expect(preset.modelId).toBe('onnx-community/gemma-4-E2B-it-ONNX');
  });

  it('falls back to the default preset for unknown or missing ids', () => {
    expect(getAssistantModelPreset(undefined).id).toBe(DEFAULT_ASSISTANT_MODEL_ID);
  });

  it('validates persisted model ids', () => {
    expect(isAssistantModelId('gemma-3-1b')).toBe(true);
    expect(isAssistantModelId('gemma-4-e2b')).toBe(true);
    expect(isAssistantModelId('gemma-4-e4b')).toBe(true);
    expect(isAssistantModelId('not-a-real-model')).toBe(false);
  });
});
