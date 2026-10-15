/**
 * @fileoverview Tests for the pet on screen: the mount switch, a tap, the
 * keyboard, and reduced motion.
 *
 * jsdom has no layout, so every box is zero-sized and the pet stands on the
 * bottom of the screen. The walking and landing rules are covered by
 * `pet-physics.test.ts`; the real page is covered by `e2e/pet.spec.ts`.
 *
 * @module features/pet/components/__tests__/PetOverlay.test
 */

import { act } from 'react';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { fireEvent, render, screen } from '@/test/utils';
import { installLocalStorageDouble } from '@/test/local-storage';

import { storePetEnabled, storePetSpecies } from '../../lib/pet-preferences';
import { PetMount } from '../PetMount';
import { PetOverlay } from '../PetOverlay';

const captureEvent = vi.hoisted(() => vi.fn());

vi.mock('@/lib/posthog', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/posthog')>()),
  captureEvent,
}));

const storage = installLocalStorageDouble();

function petTransform(): string {
  return screen.getByTestId('pet').style.transform;
}

function reduceMotion(reduce: boolean): void {
  vi.spyOn(window, 'matchMedia').mockImplementation(
    (query: string) =>
      ({
        matches: reduce && query.includes('reduce'),
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }) as unknown as MediaQueryList,
  );
}

describe('PetMount', () => {
  beforeEach(() => {
    storage.clear();
  });

  it('draws nothing while the pet is off', () => {
    render(<PetMount />, { withProviders: false });

    expect(screen.queryByTestId('pet')).not.toBeInTheDocument();
  });

  it('brings the pet in when it is turned on, and takes it away again', async () => {
    render(<PetMount />, { withProviders: false });

    act(() => storePetEnabled(true));
    expect(await screen.findByTestId('pet')).toBeInTheDocument();

    act(() => storePetEnabled(false));
    expect(screen.queryByTestId('pet')).not.toBeInTheDocument();
  });
});

describe('PetOverlay', () => {
  beforeEach(() => {
    storage.clear();
    captureEvent.mockClear();
    storePetEnabled(true);
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame', 'performance'] });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('names itself for a screen reader', () => {
    storePetSpecies('beaver');
    render(<PetOverlay />, { withProviders: false });

    expect(screen.getByRole('button', { name: 'pet.label' })).toBeInTheDocument();
  });

  it('drops in from the top and lands on the bottom of the screen', () => {
    reduceMotion(false);
    render(<PetOverlay />, { withProviders: false });

    expect(screen.getByTestId('pet')).toHaveAttribute('data-pet-pose', 'fall');

    act(() => {
      vi.advanceTimersByTime(2000);
    });

    expect(screen.getByTestId('pet')).not.toHaveAttribute('data-pet-pose', 'fall');
    expect(petTransform()).toContain(`${window.innerHeight - 60}px`);
  });

  it('answers a tap with a bubble, then puts it away', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.9);
    render(<PetOverlay />, { withProviders: false });

    act(() => {
      screen.getByRole('button', { name: 'pet.label' }).click();
    });

    expect(screen.getByText('pet.tipLabel')).toBeInTheDocument();
    expect(screen.getAllByText('pet.tips.drag').length).toBeGreaterThan(0);

    act(() => {
      vi.advanceTimersByTime(4100);
    });

    expect(screen.queryByText('pet.tipLabel')).not.toBeInTheDocument();
  });

  it('reports the first tap of a visit only', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    render(<PetOverlay />, { withProviders: false });
    const pet = screen.getByRole('button', { name: 'pet.label' });

    act(() => pet.click());
    act(() => pet.click());

    expect(captureEvent.mock.calls.filter(([event]) => event === 'pet_interacted')).toEqual([
      ['pet_interacted', { species: 'pomeranian', reaction: 'heart' }],
    ]);
  });

  it('walks with the arrow keys', () => {
    reduceMotion(true);
    render(<PetOverlay />, { withProviders: false });

    act(() => {
      vi.advanceTimersByTime(100);
    });
    const before = petTransform();

    act(() => {
      screen.getByRole('button', { name: 'pet.label' }).focus();
    });
    act(() => {
      screen
        .getByRole('button', { name: 'pet.label' })
        .dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    });

    expect(petTransform()).not.toBe(before);
  });

  it('stands still under reduced motion, and never falls asleep mid-air', () => {
    reduceMotion(true);
    render(<PetOverlay />, { withProviders: false });

    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(screen.getByTestId('pet')).toHaveAttribute('data-pet-pose', 'idle');
    const resting = petTransform();

    act(() => {
      vi.advanceTimersByTime(20_000);
    });

    expect(petTransform()).toBe(resting);
    expect(screen.getByTestId('pet')).toHaveAttribute('data-pet-pose', 'idle');
  });

  it('falls asleep after a minute alone, and a tap wakes it', () => {
    reduceMotion(true);
    render(<PetOverlay />, { withProviders: false });

    act(() => {
      vi.advanceTimersByTime(61_000);
    });
    expect(screen.getByTestId('pet')).toHaveAttribute('data-pet-pose', 'sleep');

    act(() => screen.getByRole('button', { name: 'pet.label' }).click());
    expect(screen.getByTestId('pet')).toHaveAttribute('data-pet-pose', 'idle');
  });

  it('is carried by a drag, lands where it is dropped, and a drag is not a tap', () => {
    reduceMotion(false);
    render(<PetOverlay />, { withProviders: false });
    act(() => {
      vi.advanceTimersByTime(2000);
    });

    const pet = screen.getByRole('button', { name: 'pet.label' }),
      floor = window.innerHeight;

    fireEvent.pointerDown(pet, { pointerId: 1, button: 0, clientX: 200, clientY: floor - 30 });
    fireEvent.pointerMove(pet, { pointerId: 1, clientX: 202, clientY: floor - 31 });
    expect(screen.getByTestId('pet')).not.toHaveAttribute('data-pet-pose', 'held');

    fireEvent.pointerMove(pet, { pointerId: 1, clientX: 150, clientY: 300 });
    expect(screen.getByTestId('pet')).toHaveAttribute('data-pet-pose', 'held');

    fireEvent.pointerUp(pet, { pointerId: 1, clientX: 150, clientY: 300 });
    fireEvent.click(pet);
    expect(screen.getByTestId('pet')).toHaveAttribute('data-pet-pose', 'fall');
    expect(screen.queryByText('pet.heart')).not.toBeInTheDocument();
    expect(captureEvent).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(screen.getByTestId('pet')).not.toHaveAttribute('data-pet-pose', 'fall');
    expect(petTransform()).toContain(`${floor - 60}px`);
  });

  it('hops up with the up arrow and comes back down', () => {
    reduceMotion(false);
    render(<PetOverlay />, { withProviders: false });
    act(() => {
      vi.advanceTimersByTime(2000);
    });

    act(() => {
      screen
        .getByRole('button', { name: 'pet.label' })
        .dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
    });
    expect(screen.getByTestId('pet')).toHaveAttribute('data-pet-pose', 'fall');

    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(screen.getByTestId('pet')).not.toHaveAttribute('data-pet-pose', 'fall');
  });

  it('walks by itself when left alone', () => {
    reduceMotion(false);
    vi.spyOn(Math, 'random').mockReturnValue(0.4);
    render(<PetOverlay />, { withProviders: false });

    act(() => {
      vi.advanceTimersByTime(4000);
    });

    expect(screen.getByTestId('pet')).toHaveAttribute('data-pet-pose', 'walk');
  });
});
