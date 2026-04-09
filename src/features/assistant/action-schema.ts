/**
 * @fileoverview Single source of truth for LLM action schemas.
 *
 * Defines the available actions, their fields, types, and constraints as
 * runtime data. Both the system prompt generation and the action executor
 * derive their behaviour from this schema, ensuring they never go out of sync.
 *
 * @module features/assistant/action-schema
 */

// ============================================================================
// Schema Primitive Types
// ============================================================================

/** JSON-serialisable field types the LLM can produce. */
type FieldType = 'string' | 'number' | 'boolean';

/** Definition of a single field inside an action's `data` object. */
export interface ActionFieldDef {
  /** JSON-serialisable type */
  readonly type: FieldType;
  /** Whether this field must be present */
  readonly required: boolean;
  /** Human-readable description shown to the LLM */
  readonly description: string;
  /** Example value used in the generated prompt */
  readonly example: string | number | boolean;
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
    label:
      'Create a NEW trip and switch the app to it. Use when the user wants a new trip — never use updateTrip for that',
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
    label:
      'Switch the app to an existing trip using its id from the "All trips" list in the system prompt',
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
    label: 'Update the currently selected trip name, location, dates, or description (does not create a new trip)',
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
 * Build an example JSON object for an action schema, using the example values.
 */
function buildExample(def: ActionDef): string {
  const data: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(def.fields)) {
    data[key] = field.example;
  }
  return JSON.stringify({ action: def.action, data });
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
    'When the user asks you to modify trip data, respond with a fenced JSON code block using the ```action tag.',
    'The app parses these blocks and executes the mutations automatically.',
    'IMPORTANT: Use EXACTLY the ```action tag (not ```json or ```).',
    'IMPORTANT: Do NOT include question marks in JSON keys. All keys are plain strings.',
    'IMPORTANT: Output ONLY valid JSON inside the action block — no comments, no trailing commas.',
    '',
    'Available actions and their exact JSON schemas:',
  ];

  ACTION_SCHEMAS.forEach((def, index) => {
    lines.push('');
    lines.push(`${index + 1}. ${def.action} — ${def.label}:`);
    lines.push(`   ${buildExample(def)}`);

    // Note which fields are optional
    const optionalFields = Object.entries(def.fields)
      .filter(([, f]) => !f.required)
      .map(([key]) => key);

    if (optionalFields.length > 0) {
      if (optionalFields.length === Object.keys(def.fields).length) {
        lines.push('   All fields inside data are optional — include only the ones to change.');
      } else {
        lines.push(`   ${optionalFields.join(', ')} ${optionalFields.length === 1 ? 'is' : 'are'} optional.`);
      }
    }

    // Note enum constraints
    for (const [key, field] of Object.entries(def.fields)) {
      if (field.enum) {
        lines.push(
          `   ${key} must be one of: ${field.enum.map((v) => `"${v}"`).join(', ')}.`,
        );
      }
    }
  });

  // Concrete example
  lines.push(
    '',
    'Example of a correct response when the user asks to add a room:',
    'Sure! I\'ll create a room called "The Cozy Den" with 4 beds.',
    '',
    '```action',
    '{"action":"addRoom","data":{"name":"The Cozy Den","capacity":4,"description":"A cozy room for four"}}',
    '```',
    '',
    'Rules:',
    '- Always explain what you are doing BEFORE the action block.',
    '- You can output multiple ```action blocks if the user requests multiple changes.',
    '- Be concise and helpful.',
    '- If the user asks a question about the trip, answer based on the data above without any action block.',
    '',
    'Trip creation vs editing:',
    '- If the user asks to **create a new trip**, you MUST use **createTrip**, not updateTrip.',
    '- **updateTrip** only edits the trip that is currently selected; it never creates a separate trip.',
    '- After **createTrip**, further actions in the same reply (guests, rooms, …) apply to that new trip.',
    '- Use **selectTrip** with a trip id from **All trips** when the user wants to work on a different existing trip.',
  );

  return lines;
}

// ============================================================================
// Validation
// ============================================================================

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
