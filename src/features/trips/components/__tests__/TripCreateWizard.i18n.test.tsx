/**
 * @fileoverview The first-trip wizard read in French, through the real catalogue.
 *
 * The sibling test file mocks i18next to return each call's English fallback,
 * which says what the wizard shows when a key is missing but nothing about
 * which key it asked for. French cannot come from a fallback, so every string
 * asserted here proves the wizard names a key the catalogue holds.
 *
 * @module features/trips/components/__tests__/TripCreateWizard.i18n.test
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { act, renderWithRealI18n, screen, userEvent, waitFor } from '@/test/utils';
import { announceStatus } from '@/lib/notifications';

import { TripCreateWizard } from '../TripCreateWizard';
import { createTripWithDetails } from '../../lib/create-trip-with-details';

// Hoisted above the imports, which lifts them above the mocks `setupFiles`
// registered, for this file only.
vi.unmock('i18next');
vi.unmock('react-i18next');

// ============================================================================
// Test doubles
// ============================================================================

vi.mock('@/components/shared/DateRangePicker', () => ({
  DateRangePicker: ({
    onChange,
    'aria-label': label,
  }: {
    onChange: (range: { from: Date; to: Date }) => void;
    'aria-label'?: string;
  }) => (
    <button
      type="button"
      aria-label={label}
      onClick={() => {
        onChange({ from: new Date(2026, 6, 15), to: new Date(2026, 6, 22) });
      }}
    >
      pick dates
    </button>
  ),
}));

vi.mock('../LocationAutocomplete', () => ({
  LocationAutocomplete: ({ id }: { id?: string }) => <input id={id} />,
}));

vi.mock('@/features/sharing/components/ShareDialog', () => ({
  ShareDialog: () => null,
}));

vi.mock('canvas-confetti', () => ({ default: vi.fn() }));
vi.mock('../../lib/create-trip-with-details', () => ({ createTripWithDetails: vi.fn() }));
vi.mock('@/lib/notifications', () => ({ announceStatus: vi.fn() }));
vi.mock('@/lib/google-tag', () => ({ pushDataLayerEvent: vi.fn() }));
vi.mock('@/lib/posthog', () => ({
  default: { capture: vi.fn() },
  captureEvent: vi.fn(),
  captureUsage: vi.fn(),
  reportError: vi.fn(),
}));

const mockedCreate = vi.mocked(createTripWithDetails);

const OUTCOME = {
  trip: { id: 'trip-1', shareId: 'share-1', name: 'Lac', startDate: '2026-07-15', endDate: '2026-07-22' },
  selfPersonId: undefined,
  counts: { guests: 0, importedGuests: 0, rooms: 0, importedRooms: false },
  warnings: [],
} as never;

async function renderInFrench(): Promise<ReturnType<typeof userEvent.setup>> {
  const { user } = await renderWithRealI18n(
    <TripCreateWizard currentUserName="Tom" onCreated={vi.fn()} onCancel={vi.fn()} />,
    { language: 'fr', withProviders: false },
  );
  return user;
}

beforeEach(() => {
  mockedCreate.mockResolvedValue(OUTCOME);
});

// ============================================================================
// Tests
// ============================================================================

describe('TripCreateWizard in French', () => {
  it('words the name and dates questions from the catalogue', async () => {
    const user = await renderInFrench();

    expect(screen.getByRole('list', { name: 'Étape 1 sur 5' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: "Comment s'appelle le séjour ?" })).toBeInTheDocument();
    expect(
      screen.getByText("La maison, la ville, l'occasion : le nom que le groupe lui donne."),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Nom du séjour')).toHaveAttribute(
      'placeholder',
      "L'été au bord du lac",
    );
    expect(screen.getByRole('button', { name: 'Retour' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Suivant' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Donnez un nom au séjour pour continuer.');

    await user.type(screen.getByLabelText('Nom du séjour'), 'Lac{Enter}');
    expect(screen.getByRole('heading', { name: "C'est quand ?" })).toBeInTheDocument();
    expect(
      screen.getByText(
        'Premier et dernier jour. Les invités peuvent arriver et partir entre les deux.',
      ),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Suivant' }));
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Choisissez le premier et le dernier jour pour continuer.',
    );

    await user.click(screen.getByRole('button', { name: 'Dates du séjour' }));
    await user.click(screen.getByRole('button', { name: 'Suivant' }));
    expect(screen.getByRole('heading', { name: 'Où est la maison ?' })).toBeInTheDocument();
    expect(
      screen.getByText(
        'Une ville ou une adresse. Choisissez un séjour précédent pour reprendre ses chambres.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByText('Lieu')).toBeInTheDocument();
  });

  it('words the guests, the rooms and the done screen from the catalogue', async () => {
    const user = await renderInFrench();
    await user.type(screen.getByLabelText('Nom du séjour'), 'Lac{Enter}');
    await user.click(screen.getByRole('button', { name: 'Dates du séjour' }));
    await user.click(screen.getByRole('button', { name: 'Suivant' }));
    await user.click(screen.getByRole('button', { name: "Passer pour l'instant" }));

    expect(screen.getByRole('heading', { name: 'Qui vient ?' })).toBeInTheDocument();
    expect(
      screen.getByText(
        'Un prénom à la fois, Entrée après chacun. Vous pourrez en ajouter plus tard.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'Qui vient ?' })).toBeInTheDocument();
    expect(screen.getByText('Vous')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retirer Tom' })).toBeInTheDocument();
    expect(screen.getByLabelText("Nom de l'invité")).toHaveAttribute('placeholder', 'Un prénom');
    expect(screen.getByRole('button', { name: 'Ajouter' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: "Passer pour l'instant" }));
    expect(screen.getByRole('heading', { name: 'Quelles sont les chambres ?' })).toBeInTheDocument();
    expect(
      screen.getByText("Nom et nombre de lits. Passez et ajoutez les chambres au fil de l'eau."),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Nom de la chambre')).toHaveAttribute(
      'placeholder',
      'Chambre parentale',
    );
    expect(screen.getByLabelText('Lits')).toBeInTheDocument();
    await user.type(screen.getByLabelText('Nom de la chambre'), 'Grenier{Enter}');
    expect(screen.getByRole('list', { name: 'Quelles sont les chambres ?' })).toHaveTextContent(
      'Grenier · 2 lits',
    );
    expect(screen.getByRole('button', { name: 'Retirer Grenier' })).toBeInTheDocument();
    // The visible Add button and the hidden one that gives Enter a submit.
    expect(screen.getAllByText('Ajouter')).toHaveLength(2);

    let settle: (value: never) => void = () => {};
    mockedCreate.mockImplementation(
      () =>
        new Promise((resolve) => {
          settle = resolve;
        }),
    );
    await user.click(screen.getByRole('button', { name: 'Créer le séjour' }));
    expect(screen.getByRole('button', { name: 'Création…' })).toBeDisabled();
    await act(async () => {
      settle(OUTCOME);
    });

    expect(await screen.findByRole('heading', { name: 'Lac est prêt' })).toBeInTheDocument();
    expect(
      screen.getByText(
        'Partagez le lien et les autres verront qui dort où et qui arrive quand.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ouvrir le calendrier' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Partager le séjour' })).toBeInTheDocument();
    expect(vi.mocked(announceStatus)).toHaveBeenCalledWith('Séjour Lac créé');
  });

  it('says in French that the trip could not be created', async () => {
    mockedCreate.mockRejectedValue(new Error('disk full'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const user = await renderInFrench();
    await user.type(screen.getByLabelText('Nom du séjour'), 'Lac{Enter}');
    await user.click(screen.getByRole('button', { name: 'Dates du séjour' }));
    await user.click(screen.getByRole('button', { name: 'Suivant' }));
    await user.click(screen.getByRole('button', { name: "Passer pour l'instant" }));
    await user.click(screen.getByRole('button', { name: "Passer pour l'instant" }));
    await user.click(screen.getByRole('button', { name: 'Créer le séjour' }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(
        "Le séjour n'a pas pu être créé. Réessayez.",
      );
    });
  });
});
