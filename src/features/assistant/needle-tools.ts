/**
 * @fileoverview Translates between the app's action schema and Needle's
 * tool-calling interface.
 *
 * Needle is not a chat model: one query plus a tool catalogue goes in, one JSON
 * tool call comes out. `action-schema.ts` already describes every mutation the
 * assistant may perform, so this module derives the catalogue from it rather
 * than restating it — the same "single source of truth" rule that
 * `generateActionPrompt()` follows for the prose presets.
 *
 * The output is converted back into the ```action fenced block the rest of the
 * feature already understands, so `useTripActions` executes a Needle call and a
 * Gemma call through exactly the same path, and `validateAction()` remains the
 * only gate on what reaches the database.
 *
 * @module features/assistant/needle-tools
 */

import { ACTION_SCHEMAS, type ActionDef } from './action-schema';

// ============================================================================
// Type Definitions
// ============================================================================

/** JSON Schema fragment for one action field, as Needle expects it. */
interface NeedleParameterSchema {
  readonly type: 'string' | 'number' | 'boolean' | 'array';
  readonly description: string;
  readonly items?: { readonly type: 'string' };
  readonly enum?: readonly string[];
}

/** One tool in the catalogue handed to Needle. */
export interface NeedleTool {
  readonly name: string;
  readonly description: string;
  readonly parameters: {
    readonly type: 'object';
    readonly properties: Readonly<Record<string, NeedleParameterSchema>>;
    readonly required: readonly string[];
  };
}

/** One call Needle produced, before it is validated against the schema. */
export interface NeedleToolCall {
  readonly name: string;
  readonly arguments: Readonly<Record<string, unknown>>;
}

// ============================================================================
// Constants
// ============================================================================

/**
 * The markers Needle wraps its call payload in. Anything outside them is text
 * the model emitted around its decision, which the UI shows as reasoning.
 */
const TOOL_CALL_BLOCK_REGEX = /<tool_call>[\s\S]*?(?:<\/tool_call>|$)/g;

/** Action names that exist, for rejecting a hallucinated tool name early. */
const KNOWN_ACTION_NAMES: ReadonlySet<string> = new Set(
  ACTION_SCHEMAS.map((def) => def.action),
);

// ============================================================================
// Catalogue
// ============================================================================

/**
 * Maps one schema field type onto its JSON Schema equivalent.
 *
 * `string[]` becomes a typed array rather than a comma-separated string: the
 * constrained decoder holds Needle to the shape it is given, so unlike the
 * prose presets there is nothing here to coerce afterwards.
 */
function toParameterSchema(field: ActionDef['fields'][string]): NeedleParameterSchema {
  if (field.type === 'string[]') {
    return {
      type: 'array',
      description: field.description,
      items: { type: 'string' },
    };
  }

  return {
    type: field.type,
    description: field.description,
    ...(field.enum ? { enum: field.enum } : {}),
  };
}

/**
 * Converts one action definition into a Needle tool.
 */
function toNeedleTool(def: ActionDef): NeedleTool {
  const properties: Record<string, NeedleParameterSchema> = {};
  const required: string[] = [];

  for (const [key, field] of Object.entries(def.fields)) {
    properties[key] = toParameterSchema(field);
    if (field.required) required.push(key);
  }

  return {
    name: def.action,
    description: def.label,
    parameters: { type: 'object', properties, required },
  };
}

/**
 * The full tool catalogue, derived from the action schema.
 *
 * @param defs - Actions to include; defaults to every action
 */
export function buildNeedleTools(
  defs: readonly ActionDef[] = ACTION_SCHEMAS,
): readonly NeedleTool[] {
  return defs.map(toNeedleTool);
}

/**
 * The catalogue as the JSON string `run` and `generate` take.
 *
 * Needle compacts tool schemas internally, so formatting has no effect on the
 * output — this stays minified only to keep the WASM copy small.
 */
export function buildNeedleToolsJson(
  defs: readonly ActionDef[] = ACTION_SCHEMAS,
): string {
  return JSON.stringify(buildNeedleTools(defs));
}

// ============================================================================
// Output
// ============================================================================

/**
 * Reads Needle's call payload into tool calls.
 *
 * `run_json` returns `"[]"` when no tool applies — a deliberate abstention, and
 * a normal outcome for a question that changes nothing — and `""` only when no
 * markers were emitted at all. Both yield an empty list here.
 */
export function parseNeedleToolCalls(payload: string): readonly NeedleToolCall[] {
  const trimmed = payload.trim();
  if (trimmed.length === 0) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return [];
  }

  const entries = Array.isArray(parsed) ? parsed : [parsed];
  const calls: NeedleToolCall[] = [];

  for (const entry of entries) {
    if (typeof entry !== 'object' || entry === null) continue;
    const record = entry as Record<string, unknown>;
    const name = record.name;
    if (typeof name !== 'string' || !KNOWN_ACTION_NAMES.has(name)) continue;

    const args = record.arguments;
    calls.push({
      name,
      arguments:
        typeof args === 'object' && args !== null && !Array.isArray(args)
          ? (args as Record<string, unknown>)
          : {},
    });
  }

  return calls;
}

/**
 * Renders tool calls as the ```action blocks the executor parses.
 *
 * Nothing is validated here: `validateAction()` owns that, and running Needle's
 * output through the same gate as a Gemma's is the point of this conversion.
 */
export function needleToolCallsToActionBlocks(
  calls: readonly NeedleToolCall[],
): string {
  return calls
    .map(
      (call) =>
        '```action\n' +
        JSON.stringify({ action: call.name, data: call.arguments }) +
        '\n```',
    )
    .join('\n\n');
}

/**
 * The text Needle emitted around its call, which is the closest thing it has to
 * a rationale.
 *
 * Needle exposes no reasoning field of its own — `run()` returns the full
 * decoded text and `run_json()` returns just the payload, so what the model
 * said about its decision is whatever sits outside the `<tool_call>` markers.
 * An unterminated marker is stripped too: a truncated payload is not prose.
 */
export function extractNeedleReasoning(fullOutput: string): string {
  return fullOutput.replace(TOOL_CALL_BLOCK_REGEX, ' ').replace(/\s+/g, ' ').trim();
}
