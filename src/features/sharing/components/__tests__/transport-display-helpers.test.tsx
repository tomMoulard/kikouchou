import { describe, expect, it } from 'vitest';
import { render, screen } from '@/test/utils';
import { formatTransportDatetimeParts } from '@/lib/utils/datetime-format';
import { formatTime } from '@/features/calendar/utils/calendar-utils';
import { getTransportIcon, formatDatetime } from '../transport-display-helpers';

describe('getTransportIcon', () => {
  const t = (_key: string, fallback: string) => fallback;

  it.each([
    ['train', 'train'],
    ['plane', 'plane'],
    ['car', 'car'],
    ['bus', 'bus'],
  ] as const)('returns icon for mode %s', (mode, label) => {
    const icon = getTransportIcon(mode, t);
    const { container } = render(icon);
    expect(container.querySelector('svg')).toBeTruthy();
    expect(screen.getByText(label)).toBeInTheDocument();
  });

  it('returns MapPin icon for undefined mode', () => {
    const icon = getTransportIcon(undefined, t);
    const { container } = render(icon);
    expect(container.querySelector('svg')).toBeTruthy();
    expect(screen.getByText('other')).toBeInTheDocument();
  });

  it('returns MapPin icon for "other" mode', () => {
    const icon = getTransportIcon('other', t);
    const { container } = render(icon);
    expect(container.querySelector('svg')).toBeTruthy();
  });
});

describe('formatDatetime', () => {
  it('formats a valid datetime string', () => {
    const result = formatDatetime('2026-07-15T14:30:00Z', 'en-US');
    expect(result).toBeTruthy();
    expect(result).not.toBe('—');
  });

  it('returns dash for empty string', () => {
    expect(formatDatetime('', 'en-US')).toBe('—');
  });

  it('returns raw datetime for invalid date string', () => {
    expect(formatDatetime('not-a-date', 'en-US')).toBe('not-a-date');
  });

  it('formats with default locale when locale is undefined', () => {
    const result = formatDatetime('2026-07-15T14:30:00Z');
    expect(result).toBeTruthy();
    expect(result).not.toBe('—');
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
    expect(formatDatetime('2026-07-15T14:30:00', 'fr')).toContain('juillet');
    expect(formatDatetime('2026-07-15T14:30:00', 'en')).toContain('July');
  });
});
