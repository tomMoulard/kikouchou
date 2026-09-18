/**
 * @fileoverview Unit tests for assistant model preset helpers.
 * @module features/assistant/__tests__/models.test
 */

import { describe, expect, it } from 'vitest';

import { formatBytes } from '@/lib/utils/format-bytes';

import {
  ASSISTANT_MODEL_PRESETS,
  DEFAULT_ASSISTANT_MODEL_ID,
  getAssistantModelPreset,
  isAssistantModelId,
} from '../models';

describe('assistant model presets', () => {
  it('exposes the supported presets in increasing size order', () => {
    expect(ASSISTANT_MODEL_PRESETS.map((preset) => preset.id)).toEqual([
      'needle-v3',
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

  it('carries a download size for every preset, growing with the model', () => {
    const sizes = ASSISTANT_MODEL_PRESETS.map(
      (preset) => preset.approxDownloadBytes,
    );

    // A preset with no size would render "0.0 GB" next to its name, which is
    // worse than the silence this replaced.
    for (const size of sizes) {
      expect(size).toBeGreaterThan(1_000_000);
    }
    expect([...sizes].sort((a, b) => a - b)).toEqual(sizes);
  });

  it('announces a size the download counter can reach', () => {
    // The counter in `useWebLLM` prints its totals with `formatBytes`, so the
    // announced size has to come out of the same helper: a decimal-GB label
    // over a binary-GB counter would look like a broken promise near the end
    // of the download.
    expect(formatBytes(getAssistantModelPreset('gemma-4-e2b').approxDownloadBytes)).toBe(
      '2.92 GB',
    );
    expect(formatBytes(getAssistantModelPreset('gemma-3-1b').approxDownloadBytes)).toBe(
      '748 MB',
    );
  });

  it('validates persisted model ids', () => {
    expect(isAssistantModelId('needle-v3')).toBe(true);
    expect(isAssistantModelId('gemma-3-1b')).toBe(true);
    expect(isAssistantModelId('gemma-4-e2b')).toBe(true);
    expect(isAssistantModelId('gemma-4-e4b')).toBe(true);
    expect(isAssistantModelId('not-a-real-model')).toBe(false);
  });

  it('carries one Needle preset, on the v3 container', () => {
    const needlePresets = ASSISTANT_MODEL_PRESETS.filter(
      (preset) => preset.engine === 'needle',
    );

    expect(needlePresets).toHaveLength(1);
    expect(needlePresets[0]?.id).toBe('needle-v3');
    // The worker hands these bytes to `NeedleV3Wasm.load`, which returns
    // undefined for a v2 container rather than misreading it — so a v2 URL
    // here is a preset that can never load.
    expect(needlePresets[0]?.weightsUrl).toContain('needle3.cact');
  });

  it('resolves the retired needle-v2 setting to its replacement', () => {
    // Somebody who chose the small CPU preset must not be silently moved to a
    // 3 GB WebGPU one because the id they stored no longer exists.
    expect(
      getAssistantModelPreset('needle-v2' as Parameters<typeof getAssistantModelPreset>[0]).id,
    ).toBe('needle-v3');
  });
});
