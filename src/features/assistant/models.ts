/**
 * @fileoverview Assistant model presets for local/browser inference.
 *
 * These presets map stable app-level IDs to concrete Hugging Face
 * Transformers.js-compatible model identifiers and runtime options.
 *
 * @module features/assistant/models
 */

import type { AssistantModelId } from '@/types';

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Runtime configuration for one assistant model preset.
 */
export interface AssistantModelPreset {
  /** Stable app-level identifier persisted in settings. */
  readonly id: AssistantModelId;
  /** Hugging Face model identifier used by Transformers.js. */
  readonly modelId: string;
  /** Quantization / precision option passed to Transformers.js. */
  readonly dtype: 'fp32' | 'q4' | 'q4f16';
  /**
   * Optional execution device.
   * When omitted, Transformers.js uses the browser default (WASM/CPU).
   */
  readonly device?: 'webgpu';
  /** Translation key for the preset display name. */
  readonly nameKey: string;
  /** Translation key for the preset description. */
  readonly descriptionKey: string;
  /** Translation key for the preset load/runtime hint. */
  readonly hintKey: string;
  /** Short human-readable fallback name. */
  readonly fallbackName: string;
  /** Short human-readable fallback description. */
  readonly fallbackDescription: string;
  /** Human-readable fallback hint. */
  readonly fallbackHint: string;
}

// ============================================================================
// Constants
// ============================================================================

/**
 * Keep the current shipping model as the default so existing users keep the
 * same quality/performance profile unless they explicitly opt into another one.
 */
export const DEFAULT_ASSISTANT_MODEL_ID: AssistantModelId = 'gemma-4-e2b';

/**
 * Available assistant model presets, ordered from smallest to largest.
 *
 * Notes:
 * - All presets currently target WebGPU for practical browser-side generation.
 * - Gemma 3 1B is the lightest option in the curated lineup requested by the user.
 */
export const ASSISTANT_MODEL_PRESETS: readonly AssistantModelPreset[] = [
  {
    id: 'gemma-3-1b',
    modelId: 'onnx-community/gemma-3-1b-it-ONNX',
    // q4f16 rather than q4, and not for the download size.
    //
    // This export has no `num_logits_to_keep` graph input — unlike the two
    // Gemma 4 decoders below — so Transformers.js cannot ask it for the last
    // token's logits only (see `decoder_forward` in modeling_utils.js). Prefill
    // therefore materialises logits for *every* prompt position and hands the
    // whole `prompt_tokens × 262144` tensor back to the CPU in one buffer.
    // Under q4 those are fp32: 1 MiB per prompt token, so a 2401-token prompt
    // asked WebGPU for a 2.34 GiB mappable buffer and got "Failed to allocate
    // memory for buffer mapping", killing the session. q4f16 halves it.
    //
    // Halving is not a licence to grow the prompt again: this preset is still
    // the one that runs out of GPU first, which is why the system prompt has a
    // character budget (action-schema.test.ts) and the history has a cap.
    dtype: 'q4f16',
    device: 'webgpu',
    nameKey: 'assistant.models.gemma-3-1b.name',
    descriptionKey: 'assistant.models.gemma-3-1b.description',
    hintKey: 'assistant.models.gemma-3-1b.hint',
    fallbackName: 'Light',
    fallbackDescription: 'Smallest option in the lineup, aimed at lighter devices.',
    fallbackHint: 'Needs WebGPU. Best chance of running smoothly on modest hardware.',
  },
  {
    id: 'gemma-4-e2b',
    modelId: 'onnx-community/gemma-4-E2B-it-ONNX',
    dtype: 'q4f16',
    device: 'webgpu',
    nameKey: 'assistant.models.gemma-4-e2b.name',
    descriptionKey: 'assistant.models.gemma-4-e2b.description',
    hintKey: 'assistant.models.gemma-4-e2b.hint',
    fallbackName: 'Balanced',
    fallbackDescription: 'Stronger reasoning and quality while staying lighter than E4B.',
    fallbackHint: 'Needs WebGPU. Good default for recent laptops and desktops.',
  },
  {
    id: 'gemma-4-e4b',
    modelId: 'onnx-community/gemma-4-E4B-it-ONNX',
    dtype: 'q4f16',
    device: 'webgpu',
    nameKey: 'assistant.models.gemma-4-e4b.name',
    descriptionKey: 'assistant.models.gemma-4-e4b.description',
    hintKey: 'assistant.models.gemma-4-e4b.hint',
    fallbackName: 'Best quality',
    fallbackDescription: 'Largest preset with the strongest reasoning quality in this app.',
    fallbackHint: 'Needs a stronger WebGPU-capable device and the biggest download.',
  },
] as const;

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Type guard for values restored from settings/UI events.
 */
export function isAssistantModelId(value: string): value is AssistantModelId {
  return ASSISTANT_MODEL_PRESETS.some((preset) => preset.id === value);
}

/**
 * Resolves a preset by ID, falling back to the app default when missing.
 */
export function getAssistantModelPreset(
  id: AssistantModelId | undefined,
): AssistantModelPreset {
  return (
    ASSISTANT_MODEL_PRESETS.find((preset) => preset.id === id) ??
    ASSISTANT_MODEL_PRESETS.find(
      (preset) => preset.id === DEFAULT_ASSISTANT_MODEL_ID,
    )!
  );
}
