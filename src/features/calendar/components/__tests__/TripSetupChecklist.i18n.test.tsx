/**
 * @fileoverview The trip-setup checklist read through the real French bundle.
 *
 * The sibling test mocks `t` to return each inline English default, which
 * proves the counts are interpolated but cannot tell one key from another: a
 * key pointing at the wrong entry, or at none, still renders the English
 * default. Only the bundle can, so every line here is the French one.
 *
 * @module features/calendar/components/__tests__/TripSetupChecklist.i18n.test
 */

import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';

import { renderWithRealI18n } from '@/test/utils';

import { TripSetupChecklist } from '../TripSetupChecklist';
import type { TripSetupChecklist as TripSetupChecklistModel } from '../../utils/setup-checklist';

// Hoisted above the imports, which lifts them above the mocks `setupFiles`
// registered, for this file only.
vi.unmock('i18next');
vi.unmock('react-i18next');

// ============================================================================
// Helpers
// ============================================================================

async function renderInFrench(checklist: TripSetupChecklistModel): Promise<void> {
  await renderWithRealI18n(
    <TripSetupChecklist
      checklist={checklist}
      onAddGuests={vi.fn()}
      onAddRooms={vi.fn()}
      onAssignRooms={vi.fn()}
      onAddArrivals={vi.fn()}
    />,
    { language: 'fr', withProviders: false },
  );
}

// ============================================================================
// Tests
// ============================================================================

describe('TripSetupChecklist in French', () => {
  it('reads every step of a trip with nothing in it', async () => {
    await renderInFrench({
      steps: [
        { key: 'guests', count: 0, isDone: false },
        { key: 'rooms', count: 0, isDone: false },
        { key: 'assignments', count: 0, total: 0, isDone: false },
        { key: 'arrivals', count: 0, isDone: false },
      ],
      doneCount: 0,
      stepCount: 4,
      isComplete: false,
    });

    expect(screen.getByText('Configurez ce séjour')).toBeInTheDocument();
    expect(
      screen.getByText('Le calendrier se remplit à mesure que vous suivez ces étapes.'),
    ).toBeInTheDocument();
    expect(screen.getByText('Ajouter des invités')).toBeInTheDocument();
    expect(screen.getByText('Ajouter des chambres')).toBeInTheDocument();
    expect(screen.getByText('Installer les invités dans les chambres')).toBeInTheDocument();
    expect(screen.getByText('Ajouter des arrivées')).toBeInTheDocument();
    expect(screen.getByText('Personne dans la liste pour le moment')).toBeInTheDocument();
    expect(screen.getByText('Aucune chambre pour le moment')).toBeInTheDocument();
    expect(screen.getByText("Personne n'a encore de chambre")).toBeInTheDocument();
    expect(screen.getByText('Aucune arrivée pour le moment')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Nouveau participant' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Nouvelle chambre' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Attribuer les chambres' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Nouvelle arrivée' })).toBeInTheDocument();

    const progress = screen.getByRole('progressbar', {
      name: 'Progression de la configuration du séjour',
    });
    expect(progress).toHaveAttribute('aria-valuetext', '0 sur 4 terminées');
    expect(screen.getByText('0 sur 4 terminées')).toBeInTheDocument();
  });

  it('reads the counts of a trip part-way set up', async () => {
    await renderInFrench({
      steps: [
        { key: 'guests', count: 4, isDone: true },
        { key: 'rooms', count: 2, isDone: true },
        { key: 'assignments', count: 3, total: 4, isDone: false },
        { key: 'arrivals', count: 2, isDone: true },
      ],
      doneCount: 3,
      stepCount: 4,
      isComplete: false,
    });

    expect(screen.getByText('4 personnes dans la liste')).toBeInTheDocument();
    expect(screen.getByText('2 chambres')).toBeInTheDocument();
    expect(screen.getByText('3 sur 4 avec une chambre')).toBeInTheDocument();
    expect(screen.getByText('2 arrivées')).toBeInTheDocument();
    expect(screen.getAllByText('terminé')).toHaveLength(3);
  });
});
