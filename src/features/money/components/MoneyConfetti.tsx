/**
 * @fileoverview A shower of money emoji, for the reader who taps the title ten
 * times.
 *
 * Purely decorative: the overlay is `aria-hidden`, takes no pointer events and
 * lives above nothing that matters. It is not rendered at all when the viewer
 * asks for reduced motion, which is the honest reading of that setting for an
 * animation whose entire content is movement.
 *
 * @module features/money/components/MoneyConfetti
 */

import { type ReactElement, memo, useMemo } from 'react';

// ============================================================================
// Constants
// ============================================================================

/** What falls. */
const MONEY_EMOJI = ['💰', '💸', '🪙', '💶', '💵', '🧾', '🤑'] as const;

/** How many pieces. Enough to read as a shower, few enough to stay cheap. */
const PIECE_COUNT = 28;

/**
 * A pure pseudo-random source (mulberry32), seeded per run.
 *
 * `Math.random()` during render is impure — a re-render would redraw every
 * piece mid-fall — so the scatter is derived from the run instead. Same run,
 * same shower; a new run, a new one.
 *
 * @param seed - The run this shower belongs to
 * @returns A function handing out numbers in [0, 1)
 */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Props for {@link MoneyConfetti}.
 */
export interface MoneyConfettiProps {
  /**
   * Changes on every run, and is what makes each run a fresh set of pieces:
   * the positions are drawn once per value rather than on every render.
   */
  readonly runId: number;
}

// ============================================================================
// Component
// ============================================================================

/**
 * The falling money.
 *
 * @param props - The run this shower belongs to
 * @returns A full-screen decorative overlay
 */
const MoneyConfetti = memo(function MoneyConfetti({
  runId,
}: MoneyConfettiProps): ReactElement {
  const pieces = useMemo(() => {
    const random = seeded(runId);

    return Array.from({ length: PIECE_COUNT }, (_, index) => ({
      key: `${runId}-${index}`,
      emoji: MONEY_EMOJI[index % MONEY_EMOJI.length] ?? '💸',
      // Spread across the width, then jittered, so the pieces neither line up
      // in a grid nor clump in the middle.
      left: ((index + 0.5) / PIECE_COUNT) * 100 + (random() * 6 - 3),
      delay: random() * 0.8,
      duration: 2.2 + random() * 1.4,
      drift: random() * 80 - 40,
      spin: random() * 720 - 360,
      scale: 0.75 + random() * 0.75,
    }));
  }, [runId]);

  return (
    <div
      // `fixed` and above the app's own scale, but under the dialog layer: the
      // easter egg is a garnish, never something that covers a form.
      className="pointer-events-none fixed inset-0 z-40 overflow-hidden"
      aria-hidden="true"
    >
      {pieces.map((piece) => (
        <span
          key={piece.key}
          className="money-confetti-piece"
          // Inline custom properties: every value here is drawn per piece, so
          // there is no utility class that could express it.
          style={{
            left: `${piece.left}%`,
            animationDelay: `${piece.delay}s`,
            animationDuration: `${piece.duration}s`,
            ['--money-drift' as string]: `${piece.drift}px`,
            ['--money-spin' as string]: `${piece.spin}deg`,
            ['--money-scale' as string]: String(piece.scale),
          }}
        >
          {piece.emoji}
        </span>
      ))}
    </div>
  );
});

// ============================================================================
// Exports
// ============================================================================

export { MoneyConfetti };
