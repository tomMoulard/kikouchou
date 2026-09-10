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

  describe('money coverage', () => {
    it('exposes every money action to the LLM', () => {
      const names = ACTION_SCHEMAS.map((schema) => schema.action);

      expect(names).toEqual(
        expect.arrayContaining(['addExpense', 'updateExpense', 'removeExpense']),
      );
    });

    it('documents the money actions in the generated prompt', () => {
      const prompt = generateActionPrompt().join('\n');

      expect(prompt).toContain('addExpense');
      expect(prompt).toContain('removeExpense');
      // The split rules, which are the part the model has to pick from.
      expect(prompt).toContain('nights');
      expect(prompt).toContain('transfer');
    });
  });

  describe('validateAction — addExpense', () => {
    it('accepts a minimal line', () => {
      expect(
        validateAction({
          action: 'addExpense',
          data: { title: 'Shopping', amount: 84.2, payerId: 'p1' },
        }),
      ).toMatchObject({ action: 'addExpense' });
    });

    it('refuses a line with no amount', () => {
      expect(
        validateAction({
          action: 'addExpense',
          data: { title: 'Shopping', payerId: 'p1' },
        }),
      ).toBeNull();
    });

    it('refuses an amount that is not a number', () => {
      expect(
        validateAction({
          action: 'addExpense',
          data: { title: 'Shopping', amount: 'a lot', payerId: 'p1' },
        }),
      ).toBeNull();
    });

    it('refuses a split rule it does not have', () => {
      expect(
        validateAction({
          action: 'addExpense',
          data: {
            title: 'Shopping',
            amount: 10,
            payerId: 'p1',
            splitMode: 'by-horoscope',
          },
        }),
      ).toBeNull();
    });
  });

  describe('validateAction — removeExpense', () => {
    it('accepts an id', () => {
      expect(
        validateAction({ action: 'removeExpense', data: { expenseId: 'e1' } }),
      ).toMatchObject({ action: 'removeExpense' });
    });

    it('refuses a block with no id', () => {
      expect(validateAction({ action: 'removeExpense', data: {} })).toBeNull();
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
 * Adding an action is expected to eat into it, and rewriting the section to fit
 * is the first response to hitting the ceiling — that is how seven ride and car
 * actions landed with 12 characters left: every label lost the words its action
 * name already said, and roughly half the catalogue, every action carrying
 * nothing but ids, became one line each under a single shared example instead of
 * a three-line block apiece.
 *
 * The three money actions are the first time that was not enough. Rewriting had
 * already been done, the catalogue was 39 characters from the ceiling, and the
 * only rewrites left were to other features' tuned wording — so the number moved
 * instead. What it buys is worth naming: without them the assistant can read the
 * accounts and answer "who owes Marie?" but cannot write down the answer, which
 * is the one thing a person asks it to do while standing in a supermarket.
 *
 * The cost is measurable rather than notional. At ~3.6 characters per token the
 * catalogue went from ~1030 tokens to ~1160, and at half a mebibyte of logits
 * per prompt token that is roughly 65 MiB more readback per turn, against the
 * ~1.9 GiB that actually failed. The ceiling is still a real one: it is 100
 * characters above what the catalogue costs today, so the next action pays for
 * itself by trimming, exactly as the ride actions did.
 */
const MAX_ACTION_PROMPT_CHARS = 4300;

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

  it('spends one line, not one block, on an action that carries only ids', () => {
    const lines = generateActionPrompt();

    // `removeRoom` and friends differ only in their name and their id field.
    // A block each spent ~100 characters restating an envelope and a label the
    // action name already gives.
    const compact = lines.filter((line) => line.includes('removeRoom roomId'));
    expect(compact).toHaveLength(1);
    expect(compact[0]).toContain('joinRide transportId+rideId');
    expect(compact[0]).toContain('leaveActivity activityId+personId');

    // …and no example of its own, which is where the saving comes from.
    expect(
      lines.filter((line) => line.includes('"action":"removeRoom"')),
    ).toHaveLength(0);
  });

  it('still shows the envelope those compact lines are wrapped in', () => {
    const prompt = generateActionPrompt().join('\n');

    // The one thing the compact list cannot say for itself. Without a JSON
    // example beside it the model has only field names to copy, and a payload
    // with no `"action"` key is dropped by `validateAction` in silence.
    expect(prompt).toContain('"action":"selectTrip","data":{"tripId"');
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
// Rides and cars
// ============================================================================

describe('action-schema — rides', () => {
  it('offers every ride and car mutation to the LLM', () => {
    const names = ACTION_SCHEMAS.map((schema) => schema.action);

    expect(names).toEqual(
      expect.arrayContaining([
        'addRide',
        'updateRide',
        'removeRide',
        'addVehicle',
        'joinRide',
        'leaveRide',
      ]),
    );
  });

  it('documents them in the generated prompt', () => {
    const prompt = generateActionPrompt().join('\n');

    for (const name of [
      'addRide',
      'updateRide',
      'removeRide',
      'addVehicle',
      'joinRide',
      'leaveRide',
    ]) {
      expect(prompt).toContain(name);
    }
    // Without the directions spelled out the model guesses "pickUp"/"toAirport"
    // and `validateAction` throws the block away.
    expect(prompt).toContain('pickup | dropoff');
    expect(prompt).toContain('rearFacing | forwardFacing | booster');
  });

  it('accepts a minimal ride', () => {
    const result = validateAction({
      action: 'addRide',
      data: {
        direction: 'pickup',
        meetDatetime: '2026-04-20T15:00:00',
        location: 'Lyon Part-Dieu',
      },
    });

    expect(result).not.toBeNull();
    expect(result?.data.direction).toBe('pickup');
  });

  it('rejects a direction outside the enum', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    expect(
      validateAction({
        action: 'addRide',
        data: {
          direction: 'toTheAirport',
          meetDatetime: '2026-04-20T15:00:00',
          location: 'Lyon Part-Dieu',
        },
      }),
    ).toBeNull();

    warn.mockRestore();
  });

  it('rejects a ride with no meeting point', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    expect(
      validateAction({
        action: 'addRide',
        data: { direction: 'pickup', meetDatetime: '2026-04-20T15:00:00' },
      }),
    ).toBeNull();

    warn.mockRestore();
  });

  it('coerces a lead time the model sent as a string', () => {
    const result = validateAction({
      action: 'addRide',
      data: {
        direction: 'dropoff',
        meetDatetime: '2026-04-20T15:00:00',
        location: 'Airport',
        leadTimeMinutes: '45',
      },
    });

    expect(result?.data.leadTimeMinutes).toBe(45);
  });

  it('takes the child seats a car carries as a list', () => {
    const result = validateAction({
      action: 'addVehicle',
      data: { name: 'Hired Espace', childSeats: ['booster', 'booster'] },
    });

    // One entry per seat, so the repeat is the point rather than a duplicate.
    expect(result?.data.childSeats).toEqual(['booster', 'booster']);
  });

  it('drops a child seat kind outside the enum, keeping the rest', () => {
    const result = validateAction({
      action: 'addVehicle',
      data: { name: 'Kangoo', childSeats: ['booster', 'siège auto'] },
    });

    // An enum on a list filters rather than refuses: refusing would throw the
    // whole car away over one word, and a rejected action is dropped in
    // silence. The `string[]` branch used to `continue` past the enum check
    // altogether, so this field was documented but never enforced.
    expect(result).not.toBeNull();
    expect(result?.data.childSeats).toEqual(['booster']);
  });

  it('lets the car be corrected by removing and re-adding it', () => {
    expect(ACTION_SCHEMAS.map((schema) => schema.action)).toContain(
      'removeVehicle',
    );
    expect(
      validateAction({ action: 'removeVehicle', data: { vehicleId: 'v1' } }),
    ).not.toBeNull();
  });

  it('lets a pickup entered as a dropoff be corrected in place', () => {
    // Without `direction` on updateRide the only fix is removeRide + addRide,
    // and removing a ride detaches every passenger.
    const result = validateAction({
      action: 'updateRide',
      data: { rideId: 'r1', direction: 'dropoff' },
    });

    expect(result?.data.direction).toBe('dropoff');
  });

  it('needs both ids to put a leg in a car', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    expect(
      validateAction({
        action: 'joinRide',
        data: { transportId: 'trans1', rideId: 'ride1' },
      }),
    ).not.toBeNull();
    expect(
      validateAction({ action: 'joinRide', data: { transportId: 'trans1' } }),
    ).toBeNull();

    warn.mockRestore();
  });

  it('takes the leg alone to get out of a car', () => {
    const result = validateAction({
      action: 'leaveRide',
      data: { transportId: 'trans1' },
    });

    expect(result).not.toBeNull();
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
