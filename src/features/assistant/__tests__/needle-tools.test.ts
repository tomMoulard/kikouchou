/**
 * @fileoverview Tests for the bridge between the action schema and Needle.
 *
 * Two contracts are load-bearing here. The catalogue handed to Needle has to
 * stay derived from `ACTION_SCHEMAS`, or a new action becomes invisible to the
 * router while the prose presets keep offering it. And every call coming back
 * has to arrive as a ```action block, because that block is what puts Needle's
 * output through `validateAction` rather than around it.
 *
 * @module features/assistant/__tests__/needle-tools.test
 */

import { describe, expect, it } from 'vitest';

import { ACTION_SCHEMAS } from '../action-schema';
import {
  buildNeedleToolDescriptionsJson,
  buildNeedleTools,
  buildNeedleToolsJson,
  extractNeedleReasoning,
  needleToolCallsToActionBlocks,
  parseNeedleToolCalls,
  parseRetrievedActions,
} from '../needle-tools';

const addRoom = ACTION_SCHEMAS.find((def) => def.action === 'addRoom')!;

describe('buildNeedleTools', () => {
  it('offers every action the schema defines', () => {
    expect(buildNeedleTools().map((tool) => tool.name)).toEqual(
      ACTION_SCHEMAS.map((def) => def.action),
    );
  });

  it('carries each action label as the tool description', () => {
    const tool = buildNeedleTools([addRoom])[0]!;

    expect(tool.description).toBe(addRoom.label);
  });

  it('marks exactly the required fields as required', () => {
    const tool = buildNeedleTools([addRoom])[0]!;
    const expected = Object.entries(addRoom.fields)
      .filter(([, field]) => field.required)
      .map(([key]) => key);

    expect(tool.parameters.required).toEqual(expected);
  });

  it('gives a string list a typed array rather than a bare string', () => {
    // The decoder is held to the schema, so unlike the prose presets there is
    // no comma-separated fallback to coerce afterwards.
    const withList = ACTION_SCHEMAS.find((def) =>
      Object.values(def.fields).some((field) => field.type === 'string[]'),
    )!;
    const listField = Object.entries(withList.fields).find(
      ([, field]) => field.type === 'string[]',
    )!;

    const tool = buildNeedleTools([withList])[0]!;

    expect(tool.parameters.properties[listField[0]]).toMatchObject({
      type: 'array',
      items: { type: 'string' },
    });
  });

  it('passes an enum through so the grammar can hold the model to it', () => {
    const withEnum = ACTION_SCHEMAS.find((def) =>
      Object.values(def.fields).some((field) => field.enum),
    )!;
    const enumField = Object.entries(withEnum.fields).find(
      ([, field]) => field.enum,
    )!;

    const tool = buildNeedleTools([withEnum])[0]!;

    expect(tool.parameters.properties[enumField[0]]?.enum).toEqual(
      enumField[1].enum,
    );
  });

  it('serialises to JSON both Needle entry points accept', () => {
    expect(() => JSON.parse(buildNeedleToolsJson())).not.toThrow();
    expect(() => JSON.parse(buildNeedleToolDescriptionsJson())).not.toThrow();
  });

  it('keeps the descriptions index-aligned with the catalogue', () => {
    // `retrieve_tools` answers with indices into this array, so a shift here
    // would route every request to the wrong action.
    const descriptions = JSON.parse(
      buildNeedleToolDescriptionsJson(),
    ) as string[];

    expect(descriptions).toHaveLength(ACTION_SCHEMAS.length);
    expect(descriptions[0]).toContain(ACTION_SCHEMAS[0]!.action);
  });
});

describe('parseRetrievedActions', () => {
  it('reads the ranked pairs back into actions, in order', () => {
    const picked = parseRetrievedActions('[[2,0.9],[0,0.5]]');

    expect(picked).toEqual([ACTION_SCHEMAS[2], ACTION_SCHEMAS[0]]);
  });

  it('drops anything below the score floor', () => {
    expect(parseRetrievedActions('[[2,0.9],[0,0.05]]', ACTION_SCHEMAS, 0.1)).toEqual([
      ACTION_SCHEMAS[2],
    ]);
  });

  it('returns nothing it cannot trust, so the caller offers the full set', () => {
    expect(parseRetrievedActions('not json')).toEqual([]);
    expect(parseRetrievedActions('{}')).toEqual([]);
    expect(parseRetrievedActions('[[9999,0.9]]')).toEqual([]);
    expect(parseRetrievedActions('[["two",0.9]]')).toEqual([]);
  });
});

describe('parseNeedleToolCalls', () => {
  it('reads a call and its arguments', () => {
    expect(
      parseNeedleToolCalls('[{"name":"addRoom","arguments":{"name":"Attic"}}]'),
    ).toEqual([{ name: 'addRoom', arguments: { name: 'Attic' } }]);
  });

  it('treats a deliberate abstention as no call', () => {
    // `"[]"` is the model declining to guess, and `""` is no markers at all.
    expect(parseNeedleToolCalls('[]')).toEqual([]);
    expect(parseNeedleToolCalls('')).toEqual([]);
  });

  it('refuses a tool name the schema does not define', () => {
    expect(
      parseNeedleToolCalls('[{"name":"launchRocket","arguments":{}}]'),
    ).toEqual([]);
  });

  it('accepts a single object where an array was expected', () => {
    expect(parseNeedleToolCalls('{"name":"addRoom","arguments":{}}')).toEqual([
      { name: 'addRoom', arguments: {} },
    ]);
  });

  it('falls back to empty arguments rather than dropping the call', () => {
    expect(
      parseNeedleToolCalls('[{"name":"addRoom","arguments":"Attic"}]'),
    ).toEqual([{ name: 'addRoom', arguments: {} }]);
  });
});

describe('needleToolCallsToActionBlocks', () => {
  it('writes the block the executor already parses', () => {
    const blocks = needleToolCallsToActionBlocks([
      { name: 'addRoom', arguments: { name: 'Attic', capacity: 4 } },
    ]);

    expect(blocks).toBe(
      '```action\n{"action":"addRoom","data":{"name":"Attic","capacity":4}}\n```',
    );
  });

  it('separates two calls into two blocks', () => {
    const blocks = needleToolCallsToActionBlocks([
      { name: 'addRoom', arguments: {} },
      { name: 'addRoom', arguments: {} },
    ]);

    expect(blocks.match(/```action/g)).toHaveLength(2);
  });

  it('writes nothing when there was no call', () => {
    expect(needleToolCallsToActionBlocks([])).toBe('');
  });
});

describe('extractNeedleReasoning', () => {
  it('keeps what the model said around its call', () => {
    expect(
      extractNeedleReasoning(
        "'attic' -> room; 4 beds -> capacity <tool_call>[{\"name\":\"addRoom\"}]</tool_call>",
      ),
    ).toBe("'attic' -> room; 4 beds -> capacity");
  });

  it('is empty when the model only emitted the call', () => {
    expect(
      extractNeedleReasoning('<tool_call>[{"name":"addRoom"}]</tool_call>'),
    ).toBe('');
  });

  it('strips a marker that was cut off mid-payload', () => {
    // A truncated payload is not prose, and showing half a JSON object as the
    // model's reasoning reads as a bug.
    expect(extractNeedleReasoning('Adding it. <tool_call>[{"name":"add')).toBe(
      'Adding it.',
    );
  });
});
