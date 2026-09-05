/**
 * @fileoverview Single source of truth for LLM action schemas.
 *
 * Defines the available actions, their fields, types, and constraints as
 * runtime data. Both the system prompt generation and the action executor
 * derive their behaviour from this schema, ensuring they never go out of sync.
 *
 * @module features/assistant/action-schema
 */

import { ACTIVITY_CATEGORIES } from '@/types';

// ============================================================================
// Schema Primitive Types
// ============================================================================

/**
 * JSON-serialisable field types the LLM can produce.
 * `string[]` accepts a JSON array of strings (a comma-separated string is
 * coerced, because small models often flatten arrays).
 */
type FieldType = 'string' | 'number' | 'boolean' | 'string[]';

/** Definition of a single field inside an action's `data` object. */
export interface ActionFieldDef {
  /** JSON-serialisable type */
  readonly type: FieldType;
  /** Whether this field must be present */
  readonly required: boolean;
  /** Human-readable description shown to the LLM */
  readonly description: string;
  /** Example value used in the generated prompt */
  readonly example: string | number | boolean | readonly string[];
  /** Allowed values (for string enums) */
  readonly enum?: readonly string[];
}

/** Definition of a single action the LLM can emit. */
export interface ActionDef {
  /** The value of the `"action"` key in the JSON block */
  readonly action: string;
  /** Human-readable label shown to the LLM */
  readonly label: string;
  /** Fields inside `"data"` */
  readonly fields: Record<string, ActionFieldDef>;
}

// ============================================================================
// Schema Definitions
// ============================================================================

/**
 * All available LLM actions.
 *
 * **This array is the single source of truth.**
 * - `useTripSystemPrompt` calls `generateActionPrompt()` to build the
 *   instruction section from these definitions.
 * - `useTripActions` calls `validateAction()` to check parsed JSON against
 *   these definitions before executing mutations.
 * - The TypeScript `LLMAction` type below is a loose union that the runtime
 *   validator narrows at execution time.
 */
export const ACTION_SCHEMAS: readonly ActionDef[] = [
  // ---- Trip ----------------------------------------------------------------
  {
    action: 'createTrip',
    label: 'Create a separate new trip and switch to it',
    fields: {
      name: {
        type: 'string',
        required: true,
        description: 'Trip display name',
        example: 'Paris weekend',
      },
      startDate: {
        type: 'string',
        required: true,
        description: 'Start date (YYYY-MM-DD)',
        example: '2026-04-15',
      },
      endDate: {
        type: 'string',
        required: true,
        description: 'End date (YYYY-MM-DD)',
        example: '2026-04-16',
      },
      location: {
        type: 'string',
        required: false,
        description: 'Trip location',
        example: 'Paris',
      },
      description: {
        type: 'string',
        required: false,
        description: 'Notes or description',
        example: '',
      },
    },
  },
  {
    action: 'selectTrip',
    label: 'Switch to an existing trip, by its id from All trips',
    fields: {
      tripId: {
        type: 'string',
        required: true,
        description: 'Trip id (copy from All trips)',
        example: '<trip id>',
      },
    },
  },
  {
    action: 'updateTrip',
    label:
      'Edit the selected trip — never creates a new one. Changing location clears the map pin',
    fields: {
      name: {
        type: 'string',
        required: false,
        description: 'New trip name',
        example: 'Summer Getaway',
      },
      location: {
        type: 'string',
        required: false,
        description: 'Trip location',
        example: 'Paris',
      },
      startDate: {
        type: 'string',
        required: false,
        description: 'Start date (YYYY-MM-DD)',
        example: '2026-04-20',
      },
      endDate: {
        type: 'string',
        required: false,
        description: 'End date (YYYY-MM-DD)',
        example: '2026-04-25',
      },
      description: {
        type: 'string',
        required: false,
        description: 'Trip description',
        example: 'A fun trip with friends',
      },
    },
  },

  // ---- Guests --------------------------------------------------------------
  {
    action: 'addGuest',
    label: 'Add a new guest',
    fields: {
      name: {
        type: 'string',
        required: true,
        description: 'Guest name',
        example: 'Alice',
      },
      stayStartDate: {
        type: 'string',
        required: false,
        description: 'Stay start date (YYYY-MM-DD)',
        example: '2026-04-20',
      },
      stayEndDate: {
        type: 'string',
        required: false,
        description: 'Stay end date (YYYY-MM-DD)',
        example: '2026-04-25',
      },
      headcount: {
        type: 'number',
        required: false,
        description:
          'How many real people this entry stands for (a couple is 2). Defaults to 1',
        example: 2,
      },
      phone: {
        type: 'string',
        required: false,
        description: 'Phone number, as given',
        example: '+33 6 12 34 56 78',
      },
      notes: {
        type: 'string',
        required: false,
        description: 'Allergies, diet, accessibility…',
        example: 'Vegetarian',
      },
    },
  },
  {
    action: 'importGuestGroup',
    label: 'Copy people from a saved group into this trip as guests',
    fields: {
      groupId: {
        type: 'string',
        required: true,
        description: 'Group id (from Guest groups)',
        example: '<group id>',
      },
      memberIds: {
        type: 'string[]',
        required: false,
        description: 'Which member ids to copy. Omit for everybody',
        example: ['<member id>'],
      },
    },
  },
  {
    action: 'removeGuest',
    label: 'Remove a guest by ID',
    fields: {
      personId: {
        type: 'string',
        required: true,
        description: 'ID of the guest (from the guests list)',
        example: '<id from guests list>',
      },
    },
  },

  // ---- Rooms ---------------------------------------------------------------
  {
    action: 'addRoom',
    label: 'Add a new room',
    fields: {
      name: {
        type: 'string',
        required: true,
        description: 'Room name',
        example: 'The Cozy Den',
      },
      capacity: {
        type: 'number',
        required: true,
        description: 'Number of beds (positive integer)',
        example: 2,
      },
      description: {
        type: 'string',
        required: false,
        description: 'Room description',
        example: 'A cozy room for two',
      },
    },
  },
  {
    action: 'removeRoom',
    label: 'Remove a room by ID',
    fields: {
      roomId: {
        type: 'string',
        required: true,
        description: 'ID of the room (from the rooms list)',
        example: '<id from rooms list>',
      },
    },
  },

  // ---- Room Assignments ----------------------------------------------------
  {
    action: 'assignRoom',
    label: 'Assign a guest to a room for a date range',
    fields: {
      personId: {
        type: 'string',
        required: true,
        description: 'Guest ID',
        example: '<guest id>',
      },
      roomId: {
        type: 'string',
        required: true,
        description: 'Room ID',
        example: '<room id>',
      },
      startDate: {
        type: 'string',
        required: true,
        description: 'First night (YYYY-MM-DD)',
        example: '2026-04-20',
      },
      endDate: {
        type: 'string',
        required: true,
        description: 'Last night (YYYY-MM-DD)',
        example: '2026-04-25',
      },
    },
  },
  {
    action: 'removeAssignment',
    label: 'Remove a room assignment by ID',
    fields: {
      assignmentId: {
        type: 'string',
        required: true,
        description: 'Assignment ID',
        example: '<assignment id>',
      },
    },
  },

  // ---- Transport -----------------------------------------------------------
  {
    action: 'addTransport',
    label: 'Add transport for a guest',
    fields: {
      personId: {
        type: 'string',
        required: true,
        description: 'Guest ID',
        example: '<guest id>',
      },
      type: {
        type: 'string',
        required: true,
        description: 'Transport direction',
        example: 'arrival',
        enum: ['arrival', 'departure'],
      },
      datetime: {
        type: 'string',
        required: true,
        description: 'Date and time (ISO 8601)',
        example: '2026-04-20T14:00:00',
      },
      location: {
        type: 'string',
        required: true,
        description: 'Location name (station, airport, etc.)',
        example: 'Airport',
      },
      transportMode: {
        type: 'string',
        required: false,
        description: 'Mode of transportation',
        example: 'plane',
        enum: ['train', 'plane', 'car', 'bus', 'other'],
      },
      transportNumber: {
        type: 'string',
        required: false,
        description: 'Train/flight number',
        example: 'AF123',
      },
      needsPickup: {
        type: 'boolean',
        required: false,
        description: 'Whether pickup/dropoff is needed',
        example: false,
      },
    },
  },
  {
    action: 'removeTransport',
    label: 'Remove a transport entry by ID',
    fields: {
      transportId: {
        type: 'string',
        required: true,
        description: 'Transport ID',
        example: '<transport id>',
      },
    },
  },

  // ---- Activities (shared agenda) ------------------------------------------
  {
    action: 'addActivity',
    label: 'Add an activity to the shared agenda (outing, meal, hike, market…)',
    fields: {
      title: {
        type: 'string',
        required: true,
        description: 'Short activity title',
        example: 'Plant fair',
      },
      category: {
        type: 'string',
        required: true,
        description: 'Kind of activity',
        example: 'horticulture',
        enum: ACTIVITY_CATEGORIES,
      },
      startDatetime: {
        type: 'string',
        required: true,
        description: 'Start date and time (ISO 8601)',
        example: '2026-04-20T09:00:00',
      },
      endDatetime: {
        type: 'string',
        required: false,
        description: 'End date and time (ISO 8601), on or after the start',
        example: '2026-04-20T12:00:00',
      },
      allDay: {
        type: 'boolean',
        required: false,
        description: 'True when the activity covers whole days (times ignored)',
        example: false,
      },
      location: {
        type: 'string',
        required: false,
        description: 'Place name (garden, market, restaurant…)',
        example: 'Château de Saint-Jean',
      },
      participantIds: {
        type: 'string[]',
        required: false,
        description: 'Guest IDs joining the activity',
        example: ['<guest id>'],
      },
      organizerId: {
        type: 'string',
        required: false,
        description: 'Guest ID of the person leading the activity',
        example: '<guest id>',
      },
      maxParticipants: {
        type: 'number',
        required: false,
        description: 'Cap on participants (whole number >= 1)',
        example: 6,
      },
      notes: {
        type: 'string',
        required: false,
        description: 'Booking link, price, what to bring…',
        example: '10 € entry, bring boots',
      },
    },
  },
  {
    action: 'updateActivity',
    label: 'Edit an existing agenda entry — never creates a new one',
    fields: {
      activityId: {
        type: 'string',
        required: true,
        description: 'Activity ID (from the activities list)',
        example: '<activity id>',
      },
      title: {
        type: 'string',
        required: false,
        description: 'New title',
        example: 'Plant fair',
      },
      category: {
        type: 'string',
        required: false,
        description: 'New category',
        example: 'horticulture',
        enum: ACTIVITY_CATEGORIES,
      },
      startDatetime: {
        type: 'string',
        required: false,
        description: 'New start date and time (ISO 8601)',
        example: '2026-04-20T09:00:00',
      },
      endDatetime: {
        type: 'string',
        required: false,
        description: 'New end date and time (ISO 8601)',
        example: '2026-04-20T12:00:00',
      },
      allDay: {
        type: 'boolean',
        required: false,
        description: 'Whether the activity covers whole days',
        example: false,
      },
      location: {
        type: 'string',
        required: false,
        description: 'New place name',
        example: 'Château de Saint-Jean',
      },
      organizerId: {
        type: 'string',
        required: false,
        description: 'Guest ID of the person leading the activity',
        example: '<guest id>',
      },
      maxParticipants: {
        type: 'number',
        required: false,
        description: 'Cap on participants (whole number >= 1)',
        example: 6,
      },
      notes: {
        type: 'string',
        required: false,
        description: 'Free-text notes',
        example: '10 € entry, bring boots',
      },
    },
  },
  {
    action: 'removeActivity',
    label: 'Remove an activity from the agenda by ID',
    fields: {
      activityId: {
        type: 'string',
        required: true,
        description: 'Activity ID (from the activities list)',
        example: '<activity id>',
      },
    },
  },
  {
    action: 'joinActivity',
    label: 'Sign a guest up for an activity',
    fields: {
      activityId: {
        type: 'string',
        required: true,
        description: 'Activity ID',
        example: '<activity id>',
      },
      personId: {
        type: 'string',
        required: true,
        description: 'Guest ID',
        example: '<guest id>',
      },
    },
  },
  {
    action: 'leaveActivity',
    label: 'Remove a guest from an activity',
    fields: {
      activityId: {
        type: 'string',
        required: true,
        description: 'Activity ID',
        example: '<activity id>',
      },
      personId: {
        type: 'string',
        required: true,
        description: 'Guest ID',
        example: '<guest id>',
      },
    },
  },
] as const;

// ============================================================================
// Action name union (derived from schema)
// ============================================================================

/** Union of all known action names. */
export type ActionName = (typeof ACTION_SCHEMAS)[number]['action'];

/** Set of valid action names for O(1) lookups. */
const VALID_ACTIONS = new Set<string>(
  ACTION_SCHEMAS.map((s) => s.action),
);

// ============================================================================
// Runtime type used by the executor
// ============================================================================

/**
 * Loose runtime type for a parsed LLM action.
 * The `data` values are `unknown` until validated against the schema.
 */
export interface LLMAction {
  readonly action: string;
  readonly data: Record<string, unknown>;
}

// ============================================================================
// Prompt Generation
// ============================================================================

/**
 * Build the example JSON object shown for one action.
 *
 * Only the **required** fields go in. Spelling out all sixteen actions with
 * every optional field set was the single biggest block of the system prompt,
 * and the prompt is re-tokenised on every turn: prefill memory on the browser
 * models is linear in prompt length, so a fixed cost paid per turn is worth
 * squeezing. The optional fields are still named on the line below, so nothing
 * the validator accepts goes undocumented.
 *
 * An action whose fields are all optional (`updateTrip`) has nothing required
 * to show, so its first field stands in as the example.
 */
function buildExample(def: ActionDef): string {
  const entries = Object.entries(def.fields);
  const required = entries.filter(([, field]) => field.required);
  const shown = required.length > 0 ? required : entries.slice(0, 1);

  const data: Record<string, unknown> = {};
  for (const [key, field] of shown) {
    data[key] = field.example;
  }
  return JSON.stringify({ action: def.action, data });
}

/**
 * Short type marker for an optional field, so dropping it from the example
 * does not also drop the fact that it is a number, a flag or a list.
 * Strings are the default and stay unmarked.
 */
function typeHint(type: FieldType): string {
  switch (type) {
    case 'number':
      return ' (num)';
    case 'boolean':
      return ' (bool)';
    case 'string[]':
      return ' (list)';
    default:
      return '';
  }
}

/**
 * Generate the "Modification Actions" section of the system prompt
 * directly from the schema definitions.
 *
 * @returns An array of prompt lines to be joined with `\n`.
 */
export function generateActionPrompt(): string[] {
  const lines: string[] = [
    '',
    '## Modification Actions',
    'To modify trip data, emit a fenced block tagged EXACTLY ```action (not ```json) holding only valid JSON — no comments, no trailing commas, plain string keys.',
    // "Questions, greetings and small talk" rather than the older "to answer a
    // question": a greeting is neither a change nor a question about the trip,
    // and with no line covering it the model reached for the catalogue below
    // and invented a trip to plan. Where the answer comes from is already
    // stated once, above the trip data.
    'One block per change. Questions, greetings and small talk get no block at all — answer in words.',
    '',
    // Small models copy the shape they are shown, so the rule "prose first,
    // then the block" is demonstrated rather than only stated.
    'I will add a room with 4 beds.',
    '```action',
    '{"action":"addRoom","data":{"name":"The Cozy Den","capacity":4}}',
    '```',
    '',
    'Actions — the example shows the required fields:',
  ];

  /** Enum lines already spelled out, so no value list is printed twice. */
  const emittedEnums = new Set<string>();

  for (const def of ACTION_SCHEMAS) {
    lines.push(`${def.action} — ${def.label}`);
    lines.push(`  ${buildExample(def)}`);

    const optional = Object.entries(def.fields).filter(
      ([, field]) => !field.required,
    );
    if (optional.length > 0) {
      const names = optional
        .map(([key, field]) => `${key}${typeHint(field.type)}`)
        .join(', ');
      // When nothing is required the example had to borrow an optional field,
      // so say so rather than letting it read as a mandatory one.
      const prefix =
        optional.length === Object.keys(def.fields).length
          ? 'all optional'
          : 'optional';
      lines.push(`  ${prefix}: ${names}`);
    }

    for (const [key, field] of Object.entries(def.fields)) {
      if (!field.enum) {
        continue;
      }

      // Each distinct enum is spelled out once. `category` is shared by
      // addActivity and updateActivity, and printing all ten values twice cost
      // 100 characters of a budget measured in memory the model has to
      // allocate — the "say it once" rule in AGENTS.md, applied to generated
      // text rather than hand-written text. Keyed on the rendered line, so two
      // fields that genuinely differ still both appear.
      const line = `  ${key}: ${field.enum.join(' | ')}`;
      if (!emittedEnums.has(line)) {
        emittedEnums.add(line);
        lines.push(line);
      }
    }
  }

  lines.push(
    '',
    // The ids above are the only ones that exist. Left unsaid, the model fills
    // a required field it was never given with a plausible-looking literal —
    // "I'll assume it's trip123" — and `validateAction` then rejects the block,
    // so the user sees a confident answer and no change.
    'Never invent an id, a name or a date the user did not give — ask for it instead.',
    'After createTrip, later actions in the same reply apply to the new trip.',
    'Change who is signed up with joinActivity / leaveActivity, never through updateActivity.',
  );

  return lines;
}

// ============================================================================
// Validation
// ============================================================================

/**
 * Coerce an LLM-produced value into an array of strings.
 *
 * Small models regularly emit `"a, b"` (or a single bare id) where the schema
 * asks for `["a", "b"]`, so both shapes are accepted.
 *
 * @param value - The raw value from the parsed action data
 * @returns The array of strings, or `null` when the value cannot be coerced
 */
function coerceStringArray(value: unknown): string[] | null {
  if (Array.isArray(value)) {
    return value.every((item) => typeof item === 'string')
      ? (value as string[])
      : null;
  }

  if (typeof value === 'string') {
    return value
      .split(',')
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
  }

  return null;
}

/**
 * Validate a parsed JSON object against the action schema.
 *
 * @returns The validated `LLMAction` if valid, or `null` with a reason logged.
 */
export function validateAction(
  parsed: unknown,
): LLMAction | null {
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    !('action' in parsed) ||
    !('data' in parsed)
  ) {
    return null;
  }

  const obj = parsed as { action: unknown; data: unknown };

  if (typeof obj.action !== 'string' || !VALID_ACTIONS.has(obj.action)) {
    console.warn('[AI Assistant] Unknown action:', obj.action);
    return null;
  }

  if (typeof obj.data !== 'object' || obj.data === null) {
    console.warn('[AI Assistant] Action data is not an object:', obj.data);
    return null;
  }

  const schema = ACTION_SCHEMAS.find((s) => s.action === obj.action);
  if (!schema) return null;

  const data = obj.data as Record<string, unknown>;

  // Check required fields are present
  for (const [key, field] of Object.entries(schema.fields)) {
    if (field.required && !(key in data)) {
      console.warn(
        `[AI Assistant] Missing required field "${key}" in action "${obj.action}"`,
      );
      return null;
    }
  }

  // Check field types
  for (const [key, value] of Object.entries(data)) {
    const fieldDef = schema.fields[key];
    if (!fieldDef) continue; // Allow extra fields (LLMs can be creative)

    // Array fields: accept a JSON array, coerce a comma-separated string
    if (fieldDef.type === 'string[]') {
      const coerced = coerceStringArray(value);
      if (coerced === null) {
        console.warn(
          `[AI Assistant] Field "${key}" in "${obj.action}" expected an array of strings, got ${typeof value}`,
        );
        return null;
      }
      data[key] = coerced;
      continue;
    }

    if (typeof value !== fieldDef.type) {
      console.warn(
        `[AI Assistant] Field "${key}" in "${obj.action}" expected ${fieldDef.type}, got ${typeof value}`,
      );
      // Attempt coercion for common mistakes
      if (fieldDef.type === 'number' && typeof value === 'string') {
        const num = Number(value);
        if (!isNaN(num)) {
          (data as Record<string, unknown>)[key] = num;
          continue;
        }
      }
      if (fieldDef.type === 'boolean' && typeof value === 'string') {
        (data as Record<string, unknown>)[key] = value === 'true';
        continue;
      }
      return null;
    }

    // Check enum constraints
    if (fieldDef.enum && typeof value === 'string' && !fieldDef.enum.includes(value)) {
      console.warn(
        `[AI Assistant] Field "${key}" value "${value}" not in allowed values: ${fieldDef.enum.join(', ')}`,
      );
      return null;
    }
  }

  return { action: obj.action, data };
}
