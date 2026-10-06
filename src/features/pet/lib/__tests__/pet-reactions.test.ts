/**
 * @fileoverview Tests for what the pet says, and that every line exists in
 * both languages.
 *
 * The keys are computed (`pet.tips.${key}`), so no grep for string literals
 * finds a missing one, and the suite's mocked i18next would echo it back.
 * This test reads both bundles instead.
 *
 * @module features/pet/lib/__tests__/pet-reactions.test
 */

import { describe, expect, it } from 'vitest';

import en from '@/locales/en/translation.json';
import fr from '@/locales/fr/translation.json';

import { PET_SLOTS, PET_SPECIES } from '../../constants';
import { randomOutfit } from '../pet-outfit';
import {
  PET_JOKES,
  PET_PHRASES,
  PET_TIPS,
  type PetReaction,
  pickReaction,
  reactionTextKey,
} from '../pet-reactions';

function lookup(bundle: unknown, key: string): unknown {
  return key.split('.').reduce<unknown>(
    (node, part) => (typeof node === 'object' && node !== null ? (node as Record<string, unknown>)[part] : undefined),
    bundle,
  );
}

function sequence(...values: number[]): () => number {
  let index = 0;

  return () => values[index++ % values.length] ?? 0;
}

describe('pickReaction', () => {
  it('maps the roll onto the five kinds', () => {
    expect(pickReaction(sequence(0)).kind).toBe('heart');
    expect(pickReaction(sequence(0.35)).kind).toBe('sound');
    expect(pickReaction(sequence(0.5, 0)).kind).toBe('phrase');
    expect(pickReaction(sequence(0.7, 0)).kind).toBe('joke');
    expect(pickReaction(sequence(0.9, 0)).kind).toBe('tip');
  });

  it('never says the same line twice in a row', () => {
    const first = pickReaction(sequence(0.9, 0));
    const second = pickReaction(sequence(0.9, 0), first);

    expect(first).toEqual({ kind: 'tip', key: PET_TIPS[0] });
    expect(second).toEqual({ kind: 'tip', key: PET_TIPS[1] });
  });
});

describe('the words', () => {
  const reactions: PetReaction[] = [
    { kind: 'heart' },
    { kind: 'sound' },
    ...PET_PHRASES.map((key) => ({ kind: 'phrase' as const, key })),
    ...PET_JOKES.map((key) => ({ kind: 'joke' as const, key })),
    ...PET_TIPS.map((key) => ({ kind: 'tip' as const, key })),
  ];

  const keys = [
    'pet.label',
    'pet.tipLabel',
    'pet.settings.title',
    'pet.settings.description',
    'pet.settings.enabled',
    'pet.settings.species',
    'pet.settings.surprise',
    ...PET_SPECIES.map((species) => `pet.species.${species}`),
    ...PET_SPECIES.flatMap((species) => reactions.map((reaction) => reactionTextKey(reaction, species))),
    ...Object.keys(PET_SLOTS).map((slot) => `pet.settings.slots.${slot}`),
    ...Object.values(PET_SLOTS).flatMap((items) => items.map((item) => `pet.items.${item}`)),
  ];

  it.each([
    ['en', en],
    ['fr', fr],
  ])('has every line in %s', (_language, bundle) => {
    const missing = [...new Set(keys)].filter((key) => typeof lookup(bundle, key) !== 'string');

    expect(missing).toEqual([]);
  });
});

describe('randomOutfit', () => {
  it('never answers with a bare pet', () => {
    expect(randomOutfit(() => 0)).toEqual({ hat: 'beret', coat: 'none', pants: 'none', shoes: 'none' });
  });

  it('picks from every slot', () => {
    expect(randomOutfit(() => 0.99)).toEqual({ hat: 'bow', coat: 'sweater', pants: 'tutu', shoes: 'socks' });
  });
});
