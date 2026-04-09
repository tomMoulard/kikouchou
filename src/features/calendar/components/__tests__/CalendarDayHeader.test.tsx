/**
 * @fileoverview Tests for CalendarDayHeader component.
 * @module features/calendar/components/__tests__/CalendarDayHeader.test
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CalendarDayHeader } from '../CalendarDayHeader';
import { enUS, fr } from 'date-fns/locale';

// ============================================================================
// Tests
// ============================================================================

describe('CalendarDayHeader', () => {
  it('renders 7 day column headers', () => {
    render(<CalendarDayHeader dateLocale={enUS} />);
    const headers = screen.getAllByRole('columnheader');
    expect(headers).toHaveLength(7);
  });

  it('renders within a rowgroup and row', () => {
    render(<CalendarDayHeader dateLocale={enUS} />);
    expect(screen.getByRole('rowgroup')).toBeInTheDocument();
    expect(screen.getByRole('row')).toBeInTheDocument();
  });

  it('renders English day abbreviations', () => {
    render(<CalendarDayHeader dateLocale={enUS} />);
    // Mon, Tue, Wed, Thu, Fri, Sat, Sun
    expect(screen.getByText('Mon')).toBeInTheDocument();
    expect(screen.getByText('Tue')).toBeInTheDocument();
    expect(screen.getByText('Wed')).toBeInTheDocument();
    expect(screen.getByText('Thu')).toBeInTheDocument();
    expect(screen.getByText('Fri')).toBeInTheDocument();
    expect(screen.getByText('Sat')).toBeInTheDocument();
    expect(screen.getByText('Sun')).toBeInTheDocument();
  });

  it('renders French day abbreviations', () => {
    render(<CalendarDayHeader dateLocale={fr} />);
    // lun., mar., mer., jeu., ven., sam., dim. — check the first letter at least
    expect(screen.getByLabelText('lundi')).toBeInTheDocument();
    expect(screen.getByLabelText('mardi')).toBeInTheDocument();
    expect(screen.getByLabelText('dimanche')).toBeInTheDocument();
  });

  it('provides full day name as aria-label', () => {
    render(<CalendarDayHeader dateLocale={enUS} />);
    expect(screen.getByLabelText('Monday')).toBeInTheDocument();
    expect(screen.getByLabelText('Tuesday')).toBeInTheDocument();
    expect(screen.getByLabelText('Sunday')).toBeInTheDocument();
  });

  it('starts the week on Monday', () => {
    render(<CalendarDayHeader dateLocale={enUS} />);
    const headers = screen.getAllByRole('columnheader');
    expect(headers[0]).toHaveAttribute('aria-label', 'Monday');
    expect(headers[6]).toHaveAttribute('aria-label', 'Sunday');
  });

  it('renders short and single-char versions of day names', () => {
    render(<CalendarDayHeader dateLocale={enUS} />);
    const headers = screen.getAllByRole('columnheader');
    // Each header should have both a full abbreviation (hidden on mobile)
    // and a single char visible on mobile
    for (const header of headers) {
      // Should have at least 2 span children
      const spans = header.querySelectorAll('span');
      expect(spans.length).toBe(2);
      // One hidden on small screens, one shown
      expect(spans[0]).toHaveClass('hidden', 'sm:inline');
      expect(spans[1]).toHaveClass('sm:hidden');
    }
  });
});
