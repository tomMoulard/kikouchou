import { describe, expect, it } from 'vitest';
import { render, screen } from '@/test/utils';
import { formatTransportDatetimeParts } from '@/lib/utils/datetime-format';
import { formatTime } from '@/features/calendar/utils/calendar-utils';
import { getTransportIcon, formatDatetime } from '../transport-display-helpers';

describe('getTransportIcon', () => {
  const t = (_key: string, fallback: string) => fallback;

  // The class is how the icon is identified: `container.querySelector('svg')`
  // is satisfied by *any* icon, so a Plane drawn for a train passes it. Lucide
  // stamps the icon's own kebab-case name onto the `<svg>`, which is the one
  // thing in the DOM that says which glyph was drawn. `Train` renders
  // `lucide-tram-front` — the component is lucide's alias for TramFront — so
  // these are read off the rendered output rather than guessed from the import.
  it.each([
    ['train', 'train', 'lucide-tram-front'],
    ['plane', 'plane', 'lucide-plane'],
    ['car', 'car', 'lucide-car'],
    ['bus', 'bus', 'lucide-bus'],
  ] as const)('draws the %s glyph, labelled for screen readers', (mode, label, iconClass) => {
    const { container } = render(getTransportIcon(mode, t));

    expect(container.querySelector('svg')).toHaveClass(iconClass);
    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByText(label)).toHaveClass('sr-only');
  });

  it('draws the neutral marker for an unset mode', () => {
    const { container } = render(getTransportIcon(undefined, t));

    // Not a person and not a map pin: the two glyphs the other two copies of
    // this mapping used to draw for `other` before they were merged.
    expect(container.querySelector('svg')).toHaveClass('lucide-circle-dot');
    expect(screen.getByText('other')).toBeInTheDocument();
  });

  it('draws the same neutral marker for an explicit "other"', () => {
    const { container } = render(getTransportIcon('other', t));

    expect(container.querySelector('svg')).toHaveClass('lucide-circle-dot');
    expect(screen.getByText('other')).toBeInTheDocument();
  });
});

describe('formatDatetime', () => {
  it('spells the date out and clocks the time, in the review step’s roomiest variant', () => {
    // Offset-less, so this is a wall clock and reads the same in every
    // timezone the suite may run in. `toBeTruthy()` — what this used to assert
    // — cannot tell `fullDayAndTime` from `dayAndTime`, nor 14:30 from 2:30 PM.
    expect(formatDatetime('2026-07-15T14:30:00', 'en-US')).toBe('July 15th, 2026, 14:30');
  });

  it('returns dash for empty string', () => {
    expect(formatDatetime('', 'en-US')).toBe('—');
  });

  it('returns raw datetime for invalid date string', () => {
    expect(formatDatetime('not-a-date', 'en-US')).toBe('not-a-date');
  });

  it('falls back to English, not to a different variant, when no locale is passed', () => {
    expect(formatDatetime('2026-07-15T14:30:00')).toBe('July 15th, 2026, 14:30');
  });

  it('renders a stored UTC instant on the viewer’s clock', () => {
    // The stored value is an instant; the review step shows it where the
    // viewer is. Deriving the expected clock from the same Date keeps this
    // honest in any TZ the suite runs under — including one whose offset is
    // not a whole number of hours.
    const instant = new Date(Date.UTC(2026, 6, 15, 12, 30));
    const pad = (value: number): string => String(value).padStart(2, '0');
    const localClock = `${pad(instant.getHours())}:${pad(instant.getMinutes())}`;

    const result = formatDatetime(instant.toISOString(), 'en');

    // The day goes in the pattern, not through `toContain`: a bare
    // `toContain('2')` is satisfied by the 2 in "2026", and a `toContain('5')`
    // by the clock, so a third of possible dates would pass on the wrong day.
    const dayPattern = new RegExp(
      `^[A-Z][a-z]+ ${instant.getDate()}(st|nd|rd|th), 2026, ${localClock}$`,
    );
    expect(result).toMatch(dayPattern);
  });

  it('uses a 24-hour clock, like every other transport surface', () => {
    // No offset, so this reads as 14:30 wherever the test runs.
    const result = formatDatetime('2026-07-15T14:30:00', 'en');
    expect(result).toContain('14:30');
    expect(result).not.toMatch(/[AP]M/i);
  });

  it('shows the same clock time as the list, map and calendar', () => {
    const stored = '2026-07-15T12:30:00.000Z';
    const canonical = formatTransportDatetimeParts(stored, undefined, 'dayAndTime').time;

    expect(formatDatetime(stored, 'en')).toContain(canonical);
    expect(formatTime(stored)).toBe(canonical);
  });

  it('renders the date in the active language', () => {
    expect(formatDatetime('2026-07-15T14:30:00', 'fr')).toBe('15 juillet 2026, 14:30');
    expect(formatDatetime('2026-07-15T14:30:00', 'en')).toBe('July 15th, 2026, 14:30');
  });
});
