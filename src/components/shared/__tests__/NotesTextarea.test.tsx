/**
 * @fileoverview Tests for the shared guest notes field.
 */

import { describe, expect, it, vi } from 'vitest';

import { fireEvent, render, screen } from '@/test/utils';

import { MAX_LENGTHS } from '@/lib/db/sanitize';

import { NotesTextarea } from '../NotesTextarea';

const LIMIT = MAX_LENGTHS.personNotes;

describe('NotesTextarea', () => {
  it('stops at the length a guest can be saved with', () => {
    render(<NotesTextarea id="notes" aria-label="Notes" value="" onValueChange={vi.fn()} />, {
      withProviders: false,
    });

    expect(screen.getByLabelText('Notes')).toHaveAttribute('maxLength', String(LIMIT));
  });

  it('hands every keystroke to the form', () => {
    const onValueChange = vi.fn();
    render(<NotesTextarea id="notes" aria-label="Notes" value="" onValueChange={onValueChange} />, {
      withProviders: false,
    });

    fireEvent.change(screen.getByLabelText('Notes'), { target: { value: 'vegan' } });

    expect(onValueChange).toHaveBeenCalledWith('vegan');
  });

  it('describes the field with its hint, and counts nothing far from the limit', () => {
    render(
      <NotesTextarea
        id="notes"
        aria-label="Notes"
        value="vegan"
        onValueChange={vi.fn()}
        hint="Diet and allergies"
      />,
      { withProviders: false },
    );

    expect(screen.getByLabelText('Notes')).toHaveAttribute('aria-describedby', 'notes-hint');
    expect(screen.getByText('Diet and allergies')).toHaveAttribute('id', 'notes-hint');
    expect(screen.queryByText(`/ ${LIMIT}`, { exact: false })).not.toBeInTheDocument();
  });

  it('counts the characters near the limit, with or without a hint', () => {
    const nearly = 'a'.repeat(LIMIT - 10);
    render(<NotesTextarea id="notes" aria-label="Notes" value={nearly} onValueChange={vi.fn()} />, {
      withProviders: false,
    });

    expect(screen.getByText(`${LIMIT - 10} / ${LIMIT}`)).toBeInTheDocument();
  });

  it('adds nothing under a field with neither hint nor count', () => {
    const { container } = render(
      <NotesTextarea id="notes" aria-label="Notes" value="" onValueChange={vi.fn()} />,
      { withProviders: false },
    );

    expect(container.querySelectorAll('p')).toHaveLength(0);
  });
});
