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
 *
 * `needle` means Needle 3 specifically: it is the generation this app ships,
 * and its container is the only one `NeedleV3Wasm` loads.
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
   * Extra variables handed to the repository's Jinja chat template.
   *
   * Transformers.js forwards `tokenizer_encode_kwargs` into
   * `apply_chat_template`, which spreads whatever it does not recognise into
   * the template's render context. A template ignores a variable it never
   * names, so this is safe to leave set on a preset whose template does not
   * read it.
   *
   * What it exists for is `enable_thinking`. Qwen3 emits a `<think>` block by
   * default and that block is not free: generation is capped at 1024 new
   * tokens, and a chain of thought that long leaves nothing for the ```action
   * block the app parses, so the turn ends having reasoned and done nothing.
   */
  readonly chatTemplateOptions?: Readonly<Record<string, boolean>>;
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
   * and the single `model` file for Qwen3 1.7B, which is text-only and exports
   * one session. The Gemma vision and audio encoders stay on the server.
   * Numbers come from the Hugging Face blob sizes of those
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
 * - Every `transformers` preset targets WebGPU for practical browser-side
 *   generation. Needle does not: it is small enough to run on the CPU through
 *   WASM, which is why it is also the only preset a device without WebGPU can
 *   use.
 * - Needle is first because it is the smallest by two orders of magnitude, and
 *   last in capability: it performs actions and never answers in words.
 */
export const ASSISTANT_MODEL_PRESETS: readonly AssistantModelPreset[] = [
  {
    id: 'needle-v3',
    engine: 'needle',
    cacheName: NEEDLE_CACHE_NAME,
    modelId: 'Cactus-Compute/needle3',
    weightsUrl:
      'https://huggingface.co/Cactus-Compute/needle3/resolve/main/needle3.cact',
    // No `device`: the runtime is single-threaded WASM on the CPU by design,
    // and leaving this unset is what stops the page gating the preset behind a
    // WebGPU check it does not need.
    //
    // needle3.cact carries the weights, the geometry and the tokenizer in one
    // file. The 537 KB WASM runtime ships in the app bundle, so it is not part
    // of the first download the user is warned about.
    //
    // 121M parameters, an 8192-token context, and a reasoning trace on
    // essentially every request. What it does not carry is a contrastive head,
    // so there is no tool ranking to be had from this engine at any size of
    // catalogue: every request is offered the whole of `ACTION_SCHEMAS`.
    //
    // The weights are Apache-2.0; the runtime is MIT.
    approxDownloadBytes: 35_300_000,
    nameKey: 'assistant.models.needle-v3.name',
    descriptionKey: 'assistant.models.needle-v3.description',
    hintKey: 'assistant.models.needle-v3.hint',
    fallbackName: 'Tiny',
    fallbackDescription:
      'Makes changes only, and reasons first. It cannot answer questions in words.',
    fallbackHint:
      'Runs on any device, no WebGPU needed, and downloads about 40x less than the Light preset.',
  },
  {
    // `qwen3-1-7b`, not `qwen3-1.7b`: the id is spliced into the translation
    // keys below, and i18next reads a dot as one more level of nesting — so the
    // dotted spelling looks up `models.qwen3-1.7b.name` and finds nothing.
    id: 'qwen3-1-7b',
    engine: 'transformers',
    cacheName: TRANSFORMERS_CACHE_NAME,
    modelId: 'onnx-community/Qwen3-1.7B-ONNX',
    // Replaces `gemma-3-1b`, which held this slot and answered badly enough to
    // be worth 650 MB more download.
    //
    // q4f16 rather than q4, and not for the download size.
    //
    // This export has no `num_logits_to_keep` graph input — the same gap the
    // Gemma 3 1B export had, and unlike the two Gemma 4 decoders below — so
    // Transformers.js cannot ask it for the last token's logits only (see
    // `decoder_forward` in modeling_utils.js). Prefill therefore materialises
    // logits for *every* prompt position and hands the whole
    // `prompt_tokens × 151936` tensor back to the CPU in one buffer. Under q4
    // those are fp32: 594 KiB per prompt token. q4f16 halves it to 297 KiB,
    // against 512 KiB for Gemma 3 1B at the same dtype, because this vocabulary
    // is 151936 entries rather than 262144.
    //
    // More headroom is not a licence to grow the prompt: this preset is still
    // the one that runs out of GPU first, which is why the system prompt has a
    // character budget (action-schema.test.ts) and the history has a cap.
    dtype: 'q4f16',
    device: 'webgpu',
    // Qwen3 is a hybrid thinking model and thinks by default. See
    // `chatTemplateOptions` above for why this preset does not.
    chatTemplateOptions: { enable_thinking: false },
    // onnx/model_q4f16.onnx + tokenizer.json. One file, no `_data` sidecar.
    approxDownloadBytes: 1_435_000_000,
    nameKey: 'assistant.models.qwen3-1-7b.name',
    descriptionKey: 'assistant.models.qwen3-1-7b.description',
    hintKey: 'assistant.models.qwen3-1-7b.hint',
    fallbackName: 'Light',
    fallbackDescription: 'Smallest option that answers in words, aimed at lighter devices.',
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
 * Preset IDs that no longer exist, and what they became.
 *
 * `needle-v2` was the Needle 2 preset, which this app replaced with Needle 3
 * rather than kept beside it. Without this the setting reads as unknown and
 * falls back to the default — a multi-gigabyte WebGPU preset, handed to the one
 * user who explicitly chose the small CPU one. The stored value is left alone;
 * only what it resolves to changes.
 *
 * `gemma-3-1b` held the Light slot and lost it to Qwen3 1.7B for the same
 * reason: one small preset, replaced rather than kept beside its successor.
 * A user who picked Light keeps Light, and pays a larger second download the
 * first time the new one loads.
 */
const REPLACED_ASSISTANT_MODEL_IDS: Readonly<Record<string, AssistantModelId>> =
  {
    'needle-v2': 'needle-v3',
    'gemma-3-1b': 'qwen3-1-7b',
  };

/**
 * Type guard for values restored from settings/UI events.
 */
export function isAssistantModelId(value: string): value is AssistantModelId {
  return ASSISTANT_MODEL_PRESETS.some((preset) => preset.id === value);
}

/**
 * Resolves a preset by ID, falling back to the app default when missing.
 *
 * Settings restored from a device that ran an older build can name a preset
 * this build no longer has, so a replaced ID resolves to its successor before
 * the fallback is reached.
 */
export function getAssistantModelPreset(
  id: AssistantModelId | undefined,
): AssistantModelPreset {
  const resolvedId =
    id !== undefined ? (REPLACED_ASSISTANT_MODEL_IDS[id] ?? id) : id;

  return (
    ASSISTANT_MODEL_PRESETS.find((preset) => preset.id === resolvedId) ??
    ASSISTANT_MODEL_PRESETS.find(
      (preset) => preset.id === DEFAULT_ASSISTANT_MODEL_ID,
    )!
  );
}
