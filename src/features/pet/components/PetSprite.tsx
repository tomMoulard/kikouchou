/**
 * @fileoverview The pet, drawn: one of four animals in whatever it wears.
 *
 * Every animal shares one chibi skeleton in a 100 x 100 box: a big head on a
 * small body, two stubby legs, two arms held in front. Sharing it is what lets
 * one hat, one coat, one pair of pants and one pair of shoes fit every animal.
 * The animal decides the fur, the ears, the tail and the face details.
 *
 * The fills are literal colours, and that is deliberate. An illustration has
 * its own palette: a ginger Pomeranian stays ginger in the ocean palette and
 * in dark mode. The outline is dark enough to read on both backgrounds.
 *
 * The groups carry class names, and the SVG its `data-pet-species`, (`pet-tail`, `pet-eyes`, `pet-leg-left`, ...)
 * that `src/index.css` animates according to the `data-pet-pose` on an
 * ancestor, inside `prefers-reduced-motion: no-preference`.
 *
 * @module features/pet/components/PetSprite
 */

import { type ReactElement, type ReactNode, memo, useId } from 'react';

import { cn } from '@/lib/utils';

import { type PetOutfit, type PetSpecies } from '../constants';

// ============================================================================
// Type Definitions
// ============================================================================

/** The face the pet is making. */
export type PetExpression = 'normal' | 'happy' | 'sleep' | 'surprised';

interface PetSpriteProps {
  readonly species: PetSpecies;
  readonly outfit: PetOutfit;
  readonly expression?: PetExpression;
  readonly className?: string;
}

interface Look {
  readonly fur: string;
  readonly shade: string;
  readonly light: string;
  readonly paw: string;
  /** The `y` just under the nose, where the mouth starts. */
  readonly mouthY: number;
}

// ============================================================================
// Constants
// ============================================================================

const OUTLINE = '#4A3426';
const EYE = '#2B1D14';
const NOSE = '#3B2A20';
const CHEEK = '#FF8FA3';
const MOUTH = '#7A2E2E';
const EAR_PINK = '#F6B3BF';

const LOOKS: Readonly<Record<PetSpecies, Look>> = {
  pomeranian: {
    fur: '#F5A442',
    shade: '#D9822B',
    light: '#FFE7C4',
    paw: '#FFE7C4',
    mouthY: 52,
  },
  papillon: {
    fur: '#FFFDF8',
    shade: '#8B4F2A',
    light: '#FFFDF8',
    paw: '#FFFDF8',
    mouthY: 52,
  },
  beaver: {
    fur: '#A06A3C',
    shade: '#7A4C27',
    light: '#E0B98F',
    paw: '#5C3A1E',
    mouthY: 52,
  },
  cat: {
    fur: '#AEB6C0',
    shade: '#7F8994',
    light: '#F2F4F6',
    paw: '#F2F4F6',
    mouthY: 51.5,
  },
};

/** The coats that cover the arms, and in what. */
const SLEEVES: Readonly<Partial<Record<PetOutfit['coat'], string>>> = {
  raincoat: '#FFD23F',
  sweater: '#E86A5A',
};

/** Mirrors a group left to right across the middle of the box. */
const MIRROR = 'matrix(-1 0 0 1 100 0)';

// ============================================================================
// Geometry helpers
// ============================================================================

function round(value: number): number {
  return Math.round(value * 10) / 10;
}

/**
 * A fluffy outline: an ellipse whose edge is a ring of bumps. The Pomeranian's
 * ruff, tail and chest are all this shape.
 */
function scallop(cx: number, cy: number, rx: number, ry: number, bumps: number, depth: number): string {
  const parts: string[] = [];

  for (let i = 0; i <= bumps; i++) {
    const angle = (i / bumps) * 2 * Math.PI - Math.PI / 2,
      x = round(cx + rx * Math.cos(angle)),
      y = round(cy + ry * Math.sin(angle));

    if (i === 0) {
      parts.push(`M${x} ${y}`);
      continue;
    }

    const mid = ((i - 0.5) / bumps) * 2 * Math.PI - Math.PI / 2;
    parts.push(
      `Q${round(cx + (rx + depth) * Math.cos(mid))} ${round(cy + (ry + depth) * Math.sin(mid))} ${x} ${y}`,
    );
  }

  return `${parts.join(' ')}Z`;
}

const POM_RUFF = scallop(50, 40, 31, 27, 16, 4.5);
const POM_TAIL = scallop(27, 64, 11, 10, 9, 3.5);
const POM_CHEST = scallop(50, 64, 10, 6, 8, 2.5);

// ============================================================================
// Animal parts
// ============================================================================

/** The tail, drawn first, behind everything. */
function Tail({ species, look }: { readonly species: PetSpecies; readonly look: Look }): ReactNode {
  switch (species) {
    case 'pomeranian':
      return (
        <>
          <path d={POM_TAIL} fill={look.fur} stroke={OUTLINE} strokeWidth={2} />
          <circle cx={25} cy={62} r={5} fill={look.light} opacity={0.7} />
        </>
      );
    case 'papillon':
      // A plume, not a blade: long locks fan out from the base and fall away.
      return (
        <>
          <path
            d="M36 74 C28 70 24 60 26 47 C22 45 17 44 13 46 C16 48 18 50 17 53 C12 51 7 52 4 55 C8 56 11 58 11 61 C7 62 3 65 2 69 C6 69 10 70 12 72 C9 74 7 77 7 81 C12 78 18 78 22 79 C23 81 24 83 26 85 C29 81 32 79 36 78 Z"
            fill={look.fur}
            stroke={OUTLINE}
            strokeWidth={2}
            strokeLinejoin="round"
          />
          <path
            d="M32 70 C26 66 23 59 22 52 M30 73 C23 70 17 64 13 58 M30 76 C24 75 17 73 11 70 M31 78 C27 79 23 80 19 80"
            fill="none"
            stroke="#E2D6C6"
            strokeWidth={1.3}
            strokeLinecap="round"
          />
        </>
      );
    case 'beaver':
      return (
        <g transform="rotate(-25 24 84)">
          <ellipse cx={22} cy={84} rx={15} ry={6.5} fill="#5C3A1E" stroke={OUTLINE} strokeWidth={2} />
          <path d="M11 84 H33 M17 79.5 V88.5 M23 78.5 V89.5 M29 79.5 V88.5" stroke="#7E5534" strokeWidth={1.1} />
        </g>
      );
    case 'cat':
      return (
        <>
          <path d="M36 82 C16 87 7 70 15 58 C18 53 24 54 23 59" fill="none" stroke={OUTLINE} strokeWidth={9} strokeLinecap="round" />
          <path d="M36 82 C16 87 7 70 15 58 C18 53 24 54 23 59" fill="none" stroke={look.fur} strokeWidth={5} strokeLinecap="round" />
          <path d="M17 71 L12 70 M20 79 L16 81" stroke={look.shade} strokeWidth={2} strokeLinecap="round" />
        </>
      );
  }
}

/** One ear, the left one; the right is the same group mirrored. */
function Ear({ species, look }: { readonly species: PetSpecies; readonly look: Look }): ReactNode {
  switch (species) {
    case 'pomeranian':
      return (
        <>
          <path d="M27 24 L31 3 L45 15 Z" fill={look.fur} stroke={OUTLINE} strokeWidth={2} strokeLinejoin="round" />
          <path d="M31 18 L33 8 L40 14 Z" fill={EAR_PINK} />
        </>
      );
    case 'papillon':
      // Large, upright and triangular, with long fringe falling off the outer
      // edge. The leather carries no outline on that edge, so the fringe reads
      // as hair growing from it rather than a second shape behind it.
      return (
        <>
          <path
            d="M12 0 C7 -1 3 1 1 5 C5 5 9 6 13 7 C8 9 4 13 3 18 C8 16 12 15 16 14 C11 18 8 23 7 28 C12 25 16 23 19 21 C15 26 13 31 13 37 C18 34 22 32 28 32 Z"
            fill={look.shade}
            stroke={OUTLINE}
            strokeWidth={2}
            strokeLinejoin="round"
          />
          <path d="M43 19 C36 10 22 3 12 0 C13 12 18 25 28 33 Z" fill={look.shade} />
          <path d="M43 19 C36 10 22 3 12 0" fill="none" stroke={OUTLINE} strokeWidth={2} strokeLinecap="round" />
          <path d="M39 21 C33 14 24 9 17 6 C18 14 22 22 29 28 Z" fill="#C98B5E" />
          <path
            d="M13 10 C10 12 7 15 6 18 M16 17 C13 20 11 23 10 27 M20 24 C18 27 16 30 16 34"
            fill="none"
            stroke="#6E3D20"
            strokeWidth={1.2}
            strokeLinecap="round"
          />
        </>
      );
    case 'beaver':
      return (
        <>
          <circle cx={26} cy={22} r={7} fill={look.fur} stroke={OUTLINE} strokeWidth={2} />
          <circle cx={26} cy={22} r={3.5} fill={look.shade} />
        </>
      );
    case 'cat':
      return (
        <>
          <path d="M24 34 L25 5 L47 20 Z" fill={look.fur} stroke={OUTLINE} strokeWidth={2} strokeLinejoin="round" />
          <path d="M29 27 L29.5 12 L41 21 Z" fill={EAR_PINK} />
        </>
      );
  }
}

/** What sits on the face under the eyes: markings, muzzle, nose, teeth. */
function Markings({
  species,
  look,
  clipId,
}: {
  readonly species: PetSpecies;
  readonly look: Look;
  readonly clipId: string;
}): ReactNode {
  switch (species) {
    case 'pomeranian':
      return <ellipse cx={50} cy={51} rx={11} ry={8} fill={look.light} />;
    case 'papillon':
      // The brown patches over both eyes leave the white blaze down the middle.
      return (
        <>
          <g clipPath={`url(#${clipId})`}>
            <ellipse cx={34} cy={34} rx={14.5} ry={17} fill={look.shade} />
            <ellipse cx={66} cy={34} rx={14.5} ry={17} fill={look.shade} />
          </g>
          <ellipse cx={50} cy={52} rx={11} ry={8} fill={look.light} />
        </>
      );
    case 'beaver':
      return <ellipse cx={50} cy={53} rx={13} ry={9} fill={look.light} />;
    case 'cat':
      return (
        <>
          <path d="M50 16 V24 M43 17.5 L44.5 23 M57 17.5 L55.5 23" stroke={look.shade} strokeWidth={2.5} strokeLinecap="round" />
          <ellipse cx={45.5} cy={53} rx={5.5} ry={4} fill={look.light} />
          <ellipse cx={54.5} cy={53} rx={5.5} ry={4} fill={look.light} />
          <path
            d="M36 50 L23 47.5 M36 53 L23 54 M64 50 L77 47.5 M64 53 L77 54"
            stroke={OUTLINE}
            strokeWidth={1.1}
            strokeLinecap="round"
          />
        </>
      );
  }
}

function Nose({ species }: { readonly species: PetSpecies }): ReactNode {
  if (species === 'cat') {
    return <path d="M47.5 48.5 H52.5 L50 51.5 Z" fill="#F08DA0" stroke={OUTLINE} strokeWidth={0.8} strokeLinejoin="round" />;
  }

  return <path d="M46 48 Q50 46 54 48 Q53 51.5 50 52 Q47 51.5 46 48 Z" fill={NOSE} />;
}

// ============================================================================
// Face
// ============================================================================

function Eyes({ expression }: { readonly expression: PetExpression }): ReactNode {
  if (expression === 'happy') {
    return (
      <path
        d="M35 43 Q39 37.5 43 43 M57 43 Q61 37.5 65 43"
        fill="none"
        stroke={EYE}
        strokeWidth={2.6}
        strokeLinecap="round"
      />
    );
  }

  if (expression === 'sleep') {
    return (
      <path
        d="M35 42 Q39 46 43 42 M57 42 Q61 46 65 42"
        fill="none"
        stroke={EYE}
        strokeWidth={2.4}
        strokeLinecap="round"
      />
    );
  }

  const big = expression === 'surprised';

  return (
    <g className="pet-eyes">
      <ellipse cx={39} cy={42} rx={big ? 5 : 4.2} ry={big ? 5.8 : 5} fill={EYE} />
      <ellipse cx={61} cy={42} rx={big ? 5 : 4.2} ry={big ? 5.8 : 5} fill={EYE} />
      <circle cx={40.6} cy={40} r={1.7} fill="#FFFFFF" />
      <circle cx={62.6} cy={40} r={1.7} fill="#FFFFFF" />
    </g>
  );
}

function Mouth({ expression, y }: { readonly expression: PetExpression; readonly y: number }): ReactNode {
  if (expression === 'surprised') {
    return <ellipse cx={50} cy={y + 4} rx={2.4} ry={3} fill={MOUTH} />;
  }

  if (expression === 'happy') {
    return (
      <>
        <path d={`M50 ${y} V${y + 1.5}`} stroke={OUTLINE} strokeWidth={1.5} strokeLinecap="round" />
        <path d={`M45 ${y + 1.5} Q50 ${y + 9} 55 ${y + 1.5} Z`} fill={MOUTH} stroke={OUTLINE} strokeWidth={1.2} strokeLinejoin="round" />
        <ellipse cx={50} cy={y + 5.5} rx={2.6} ry={1.8} fill="#FF8FA3" />
      </>
    );
  }

  return (
    <path
      d={`M50 ${y} V${y + 2.5} M45 ${y + 2.5} Q47.5 ${y + 5} 50 ${y + 2.5} Q52.5 ${y + 5} 55 ${y + 2.5}`}
      fill="none"
      stroke={OUTLINE}
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  );
}

// ============================================================================
// Outfit
// ============================================================================

function Hat({ hat }: { readonly hat: PetOutfit['hat'] }): ReactNode {
  switch (hat) {
    case 'none':
      return null;
    case 'beret':
      return (
        <>
          <circle cx={46} cy={8} r={2.2} fill="#2D3A6B" stroke={OUTLINE} strokeWidth={1.5} />
          <ellipse cx={47} cy={15} rx={21} ry={7} transform="rotate(-10 47 15)" fill="#2D3A6B" stroke={OUTLINE} strokeWidth={2} />
          <path d="M31 18 Q46 21 63 13" fill="none" stroke="#46558C" strokeWidth={1.4} strokeLinecap="round" />
        </>
      );
    case 'party':
      return (
        <g transform="rotate(10 50 17)">
          <path d="M39 17 L50 -4 L61 17 Z" fill="#FF6FA8" stroke={OUTLINE} strokeWidth={2} strokeLinejoin="round" />
          <path d="M45.3 5 H54.7 M42.1 11 H57.9" stroke="#FFD84D" strokeWidth={2.4} />
          <ellipse cx={50} cy={17} rx={12} ry={2.6} fill="#FF6FA8" stroke={OUTLINE} strokeWidth={1.6} />
          <circle cx={50} cy={-4} r={3.6} fill="#FFD84D" stroke={OUTLINE} strokeWidth={1.5} />
        </g>
      );
    case 'crown':
      return (
        <>
          <path
            d="M36 19 L35 6 L42.5 12 L50 2 L57.5 12 L65 6 L64 19 Z"
            fill="#FFCB3D"
            stroke={OUTLINE}
            strokeWidth={2}
            strokeLinejoin="round"
          />
          <path d="M36 15.5 H64" stroke="#E0A800" strokeWidth={2} />
          <circle cx={50} cy={11} r={2} fill="#E4574B" />
          <circle cx={42.5} cy={14} r={1.4} fill="#3FA7D6" />
          <circle cx={57.5} cy={14} r={1.4} fill="#3FA7D6" />
        </>
      );
    case 'beanie':
      return (
        <>
          <circle cx={50} cy={4} r={5} fill="#FFFFFF" stroke={OUTLINE} strokeWidth={1.6} />
          <path d="M26 26 Q26 6 50 6 Q74 6 74 26 Z" fill="#E4574B" stroke={OUTLINE} strokeWidth={2} strokeLinejoin="round" />
          <rect x={25} y={20} width={50} height={8} rx={4} fill="#C63D33" stroke={OUTLINE} strokeWidth={2} />
          <path d="M32 21.5 V26.5 M39 21.5 V26.5 M46 21.5 V26.5 M53 21.5 V26.5 M60 21.5 V26.5 M67 21.5 V26.5" stroke="#A8322A" strokeWidth={1.2} />
        </>
      );
    case 'bow':
      return (
        <>
          <path d="M63 19 L55 12 Q52.5 19 55 26 Z" fill="#FF7EB6" stroke={OUTLINE} strokeWidth={1.8} strokeLinejoin="round" />
          <path d="M63 19 L71 12 Q73.5 19 71 26 Z" fill="#FF7EB6" stroke={OUTLINE} strokeWidth={1.8} strokeLinejoin="round" />
          <circle cx={63} cy={19} r={3} fill="#E0559A" stroke={OUTLINE} strokeWidth={1.5} />
        </>
      );
  }
}

/** The body of a coat, drawn over the torso. The scarf is drawn later, under the chin. */
function CoatBody({ coat }: { readonly coat: PetOutfit['coat'] }): ReactNode {
  switch (coat) {
    case 'raincoat':
      return (
        <>
          <path d="M33 62 Q34 56 50 56 Q66 56 67 62 L70 84 Q50 89 30 84 Z" fill="#FFD23F" stroke={OUTLINE} strokeWidth={2} strokeLinejoin="round" />
          <path d="M50 60 V87" stroke="#E0A800" strokeWidth={1.3} />
          <circle cx={53.5} cy={70} r={1.5} fill={OUTLINE} />
          <circle cx={53.5} cy={78} r={1.5} fill={OUTLINE} />
        </>
      );
    case 'sweater':
      return (
        <>
          <path d="M32 64 Q33 56 50 56 Q67 56 68 64 L68.5 81 Q50 85 31.5 81 Z" fill="#E86A5A" stroke={OUTLINE} strokeWidth={2} strokeLinejoin="round" />
          <path d="M32.5 70 Q50 73 67.5 70 M32 76 Q50 79 68 76" fill="none" stroke="#FFF4E8" strokeWidth={1.8} opacity={0.85} />
        </>
      );
    default:
      return null;
  }
}

function Scarf(): ReactNode {
  return (
    <>
      <rect x={55} y={64} width={8} height={17} rx={2} transform="rotate(-10 59 64)" fill="#3FA7D6" stroke={OUTLINE} strokeWidth={1.8} />
      <path d="M31 61 Q50 69 69 61 L69 67 Q50 75 31 67 Z" fill="#3FA7D6" stroke={OUTLINE} strokeWidth={2} strokeLinejoin="round" />
      <path d="M40 66 L42 71.5 M50 67.5 V73 M60 66 L58 71.5" stroke="#FFFFFF" strokeWidth={1.6} opacity={0.8} />
    </>
  );
}

/** The seat of the pants, over the bottom of the body. */
function PantsSeat({ pants }: { readonly pants: PetOutfit['pants'] }): ReactNode {
  switch (pants) {
    case 'jeans':
    case 'shorts': {
      const fill = pants === 'jeans' ? '#4A78C2' : '#C9A66B';

      return (
        <>
          <path d="M31.6 76 L68.4 76 A19 16 0 0 1 31.6 76 Z" fill={fill} stroke={OUTLINE} strokeWidth={2} strokeLinejoin="round" />
          <path d="M32 77.5 H68" stroke={pants === 'jeans' ? '#35599A' : '#A8864E'} strokeWidth={1.6} />
          <circle cx={50} cy={80} r={1.3} fill="#E0A800" />
        </>
      );
    }
    case 'tutu':
      return (
        <path
          d="M30 76 H70 L77 84 L70 82 L66 88 L60 83 L55 89 L50 83.5 L45 89 L40 83 L34 88 L30 82 L23 84 Z"
          fill="#FFB3D1"
          stroke={OUTLINE}
          strokeWidth={1.6}
          strokeLinejoin="round"
        />
      );
    default:
      return null;
  }
}

/** One leg, with its pant leg and its shoe, centred on `cx`. */
function Leg({
  cx,
  look,
  outfit,
}: {
  readonly cx: number;
  readonly look: Look;
  readonly outfit: PetOutfit;
}): ReactNode {
  const pantFill = outfit.pants === 'jeans' ? '#4A78C2' : '#C9A66B',
    pantHeight = outfit.pants === 'jeans' ? 10 : 5;

  return (
    <>
      <rect x={cx - 5} y={79} width={10} height={14} rx={4} fill={look.fur} stroke={OUTLINE} strokeWidth={2} />
      {(outfit.pants === 'jeans' || outfit.pants === 'shorts') && (
        <rect x={cx - 6} y={79} width={12} height={pantHeight} rx={3} fill={pantFill} stroke={OUTLINE} strokeWidth={2} />
      )}
      <Shoe cx={cx} look={look} shoes={outfit.shoes} />
    </>
  );
}

function Shoe({
  cx,
  look,
  shoes,
}: {
  readonly cx: number;
  readonly look: Look;
  readonly shoes: PetOutfit['shoes'];
}): ReactNode {
  switch (shoes) {
    case 'sneakers':
      return (
        <>
          <ellipse cx={cx} cy={92.5} rx={8.5} ry={5} fill="#FFFFFF" stroke={OUTLINE} strokeWidth={2} />
          <rect x={cx - 8.5} y={94} width={17} height={3.2} rx={1.6} fill="#E4574B" stroke={OUTLINE} strokeWidth={1.4} />
          <path d={`M${cx - 2.5} 90 H${cx + 2.5}`} stroke="#E4574B" strokeWidth={1.4} strokeLinecap="round" />
        </>
      );
    case 'boots':
      return (
        <>
          <rect x={cx - 7} y={83} width={14} height={11} rx={3} fill="#FFD23F" stroke={OUTLINE} strokeWidth={2} />
          <ellipse cx={cx} cy={93.5} rx={8.5} ry={4.5} fill="#FFD23F" stroke={OUTLINE} strokeWidth={2} />
          <path d={`M${cx - 6.5} 86.5 H${cx + 6.5}`} stroke="#E0A800" strokeWidth={1.6} />
        </>
      );
    case 'socks':
      return (
        <>
          <rect x={cx - 5.5} y={84} width={11} height={9} rx={2} fill="#FFFFFF" stroke={OUTLINE} strokeWidth={1.6} />
          <rect x={cx - 5.5} y={85.5} width={11} height={2.2} fill="#E4574B" />
          <ellipse cx={cx} cy={93} rx={7.5} ry={4.5} fill="#FFFFFF" stroke={OUTLINE} strokeWidth={2} />
        </>
      );
    default:
      return (
        <>
          <ellipse cx={cx} cy={93} rx={7.5} ry={4.5} fill={look.paw} stroke={OUTLINE} strokeWidth={2} />
          <path d={`M${cx - 2} 91 V94 M${cx + 2} 91 V94`} stroke={OUTLINE} strokeWidth={1} opacity={0.45} strokeLinecap="round" />
        </>
      );
  }
}

// ============================================================================
// Component
// ============================================================================

/**
 * Draws the pet.
 *
 * Decorative on its own (`aria-hidden`): whatever holds it says what it is.
 *
 * @param props - The animal, its outfit and its expression
 * @returns The SVG
 */
export const PetSprite = memo(function PetSprite({
  species,
  outfit,
  expression = 'normal',
  className,
}: PetSpriteProps): ReactElement {
  const look = LOOKS[species],
    clipId = `pet-head-${useId().replace(/:/g, '')}`,
    sleeve = SLEEVES[outfit.coat] ?? look.fur;

  return (
    <svg
      viewBox="0 0 100 100"
      data-pet-species={species}
      className={cn('pet-sprite overflow-visible', className)}
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <clipPath id={clipId}>
          <ellipse cx={50} cy={40} rx={28} ry={25} />
        </clipPath>
      </defs>

      <g className="pet-tail">
        <Tail species={species} look={look} />
      </g>

      <g className="pet-body">
        <g className="pet-leg-left">
          <Leg cx={41} look={look} outfit={outfit} />
        </g>
        <g className="pet-leg-right">
          <Leg cx={59} look={look} outfit={outfit} />
        </g>

        <ellipse cx={50} cy={72} rx={19} ry={16} fill={look.fur} stroke={OUTLINE} strokeWidth={2} />
        <ellipse cx={50} cy={75} rx={11} ry={9.5} fill={look.light} />
        <PantsSeat pants={outfit.pants} />
        <CoatBody coat={outfit.coat} />
      </g>

      <g className="pet-head">
        <Ear species={species} look={look} />
        <g transform={MIRROR}>
          <Ear species={species} look={look} />
        </g>

        {species === 'pomeranian' ? (
          <>
            <path d={POM_RUFF} fill={look.fur} stroke={OUTLINE} strokeWidth={2} strokeLinejoin="round" />
            <ellipse cx={50} cy={40} rx={27} ry={24} fill={look.fur} />
            <path d={POM_CHEST} fill={look.light} />
          </>
        ) : (
          <ellipse cx={50} cy={40} rx={28} ry={25} fill={look.fur} stroke={OUTLINE} strokeWidth={2} />
        )}

        <Markings species={species} look={look} clipId={clipId} />
        <Eyes expression={expression} />
        <ellipse cx={31} cy={50} rx={4.5} ry={3} fill={CHEEK} opacity={0.5} />
        <ellipse cx={69} cy={50} rx={4.5} ry={3} fill={CHEEK} opacity={0.5} />
        <Nose species={species} />
        <Mouth expression={expression} y={look.mouthY} />
        {species === 'beaver' && (
          <>
            <rect x={46.5} y={look.mouthY + 3.6} width={7} height={6} rx={1.2} fill="#FFFFFF" stroke={OUTLINE} strokeWidth={1.3} />
            <path d={`M50 ${look.mouthY + 3.6} V${look.mouthY + 9.6}`} stroke={OUTLINE} strokeWidth={1} />
          </>
        )}

        <Hat hat={outfit.hat} />
      </g>

      {outfit.coat === 'scarf' && <Scarf />}

      <ellipse cx={31.5} cy={71} rx={5} ry={8} transform="rotate(18 31.5 71)" fill={sleeve} stroke={OUTLINE} strokeWidth={2} />
      <ellipse cx={68.5} cy={71} rx={5} ry={8} transform="rotate(-18 68.5 71)" fill={sleeve} stroke={OUTLINE} strokeWidth={2} />

      {expression === 'sleep' && (
        <g className="pet-zzz" fill="none" stroke={OUTLINE} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
          <path d="M74 10 H80 L74 16 H80" />
          <path d="M84 0 H88 L84 4 H88" />
        </g>
      )}
    </svg>
  );
});
