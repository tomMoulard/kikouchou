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
 * Which runtime executes the preset.
 *
 * `transformers` is a Hugging Face ONNX text-generation pipeline: it writes
 * prose and emits action blocks inside it. `needle` is the Needle WASM runtime,
 * a tool-calling router with no chat channel at all — it turns one request into
 * one action and cannot answer a question in words. Anything that reads a
 * preset and expects an answer has to branch on this.
 */
export type AssistantEngine = 'transformers' | 'needle';

/**
 * Runtime configuration for one assistant model preset.
 */
export interface AssistantModelPreset {
  /** Stable app-level identifier persisted in settings. */
  readonly id: AssistantModelId;
  /** Which runtime loads and runs this preset. */
  readonly engine: AssistantEngine;
  /** Hugging Face model identifier — the repository the weights come from. */
  readonly modelId: string;
  /**
   * Quantization / precision option passed to Transformers.js.
   * Absent on `needle`, whose single `.cact` image carries its own precision.
   */
  readonly dtype?: 'fp32' | 'q4' | 'q4f16';
  /**
   * Optional execution device.
   * When omitted, the runtime uses the browser default (WASM/CPU) — which is
   * also what tells the page not to gate this preset behind a WebGPU check.
   */
  readonly device?: 'webgpu';
  /**
   * Direct URL of the weights file, for engines that fetch it themselves
   * rather than resolving a repository. Required on `needle`.
   */
  readonly weightsUrl?: string;
  /**
   * Cache Storage bucket holding this preset's downloaded files, so the
   * "already downloaded" probe looks where the files actually landed:
   * Transformers.js owns `transformers-cache`, and the Needle worker writes
   * its one `.cact` into a bucket of its own.
   */
  readonly cacheName: string;
  /** Translation key for the preset display name. */
  readonly nameKey: string;
  /** Translation key for the preset description. */
  readonly descriptionKey: string;
  /** Translation key for the preset load/runtime hint. */
  readonly hintKey: string;
  /**
   * Approximate size of the first download, in bytes.
   *
   * Transformers.js loads a `text-generation` pipeline, so it fetches the
   * text-only sessions of the repository plus the tokenizer: `embed_tokens`
   * and `decoder_model_merged` at the preset `dtype` for the Gemma 4 presets,
   * and the single `model` file for Gemma 3 1B. The vision and audio encoders
   * stay on the server. Numbers come from the Hugging Face blob sizes of those
   * files, so they move when a repository is re-exported: they are a size
   * order to warn the user with, not a promise. Rendered with `formatBytes`,
   * the same helper the download counter uses, so the announced size and the
   * counter agree on units.
   */
  readonly approxDownloadBytes: number;
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

/** Cache Storage bucket Transformers.js downloads its own files into. */
export const TRANSFORMERS_CACHE_NAME = 'transformers-cache';

/** Cache Storage bucket the Needle worker writes its `.cact` image into. */
export const NEEDLE_CACHE_NAME = 'needle-cache';

/**
 * Keep the current shipping model as the default so existing users keep the
 * same quality/performance profile unless they explicitly opt into another one.
 */
export const DEFAULT_ASSISTANT_MODEL_ID: AssistantModelId = 'gemma-4-e2b';

/**
 * Available assistant model presets, ordered from smallest to largest.
 *
 * Notes:
 * - Every Gemma preset targets WebGPU for practical browser-side generation.
 *   Needle does not: it is small enough to run on the CPU through WASM, which
 *   is why it is also the only preset a device without WebGPU can use.
 * - Needle is first because it is the smallest by two orders of magnitude, and
 *   last in capability: it performs actions and never answers in words.
 */
export const ASSISTANT_MODEL_PRESETS: readonly AssistantModelPreset[] = [
  {
    id: 'needle-v2',
    engine: 'needle',
    cacheName: NEEDLE_CACHE_NAME,
    modelId: 'Cactus-Compute/needle2',
    weightsUrl:
      'https://huggingface.co/Cactus-Compute/needle2/resolve/main/needle2.cact',
    // No `device`: the runtime is single-threaded WASM on the CPU by design,
    // and leaving this unset is what stops the page gating the preset behind a
    // WebGPU check it does not need.
    //
    // needle2.cact carries the weights, the geometry and the tokenizer in one
    // file. The 423 KB WASM runtime ships in the app bundle, so it is not part
    // of the first download the user is warned about.
    approxDownloadBytes: 13_700_000,
    nameKey: 'assistant.models.needle-v2.name',
    descriptionKey: 'assistant.models.needle-v2.description',
    hintKey: 'assistant.models.needle-v2.hint',
    fallbackName: 'Tiny',
    fallbackDescription:
      'Performs changes only — it cannot answer questions in words.',
    fallbackHint:
      'Runs on any device, no WebGPU needed, and downloads about 60x less than the Light preset.',
  },
  {
    id: 'gemma-3-1b',
    engine: 'transformers',
    cacheName: TRANSFORMERS_CACHE_NAME,
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
    // onnx/model_q4f16.onnx(_data) + tokenizer.json
    approxDownloadBytes: 784_000_000,
    nameKey: 'assistant.models.gemma-3-1b.name',
    descriptionKey: 'assistant.models.gemma-3-1b.description',
    hintKey: 'assistant.models.gemma-3-1b.hint',
    fallbackName: 'Light',
    fallbackDescription: 'Smallest option in the lineup, aimed at lighter devices.',
    fallbackHint: 'Needs WebGPU. Best chance of running smoothly on modest hardware.',
  },
  {
    id: 'gemma-4-e2b',
    engine: 'transformers',
    cacheName: TRANSFORMERS_CACHE_NAME,
    modelId: 'onnx-community/gemma-4-E2B-it-ONNX',
    dtype: 'q4f16',
    device: 'webgpu',
    // embed_tokens + decoder_model_merged at q4f16 + tokenizer.json
    approxDownloadBytes: 3_131_000_000,
    nameKey: 'assistant.models.gemma-4-e2b.name',
    descriptionKey: 'assistant.models.gemma-4-e2b.description',
    hintKey: 'assistant.models.gemma-4-e2b.hint',
    fallbackName: 'Balanced',
    fallbackDescription: 'Stronger reasoning and quality while staying lighter than E4B.',
    fallbackHint: 'Needs WebGPU. Good default for recent laptops and desktops.',
  },
  {
    id: 'gemma-4-e4b',
    engine: 'transformers',
    cacheName: TRANSFORMERS_CACHE_NAME,
    modelId: 'onnx-community/gemma-4-E4B-it-ONNX',
    dtype: 'q4f16',
    device: 'webgpu',
    // embed_tokens + decoder_model_merged (two data files) + tokenizer.json
    approxDownloadBytes: 4_925_000_000,
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
