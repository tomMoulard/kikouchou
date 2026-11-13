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

// The panel words itself and has its own French test. Here it only moves the
// screen between the signed-out and the link states.
vi.mock('@/features/sharing/components/ShareLinkPanel', () => ({
  ShareLinkPanel: ({ onStateChange }: { onStateChange: (kind: string) => void }) => (
    <div>
      <button type="button" onClick={() => onStateChange('needs-account')}>
        signed out
      </button>
      <button type="button" onClick={() => onStateChange('invite')}>
        link ready
      </button>
    </div>
  ),
}));

vi.mock('@/features/sharing/utils/pending-invite', () => ({
  rememberPendingInvite: vi.fn(),
  forgetPendingInvite: vi.fn(),
}));

vi.mock('canvas-confetti', () => ({ default: { create: () => vi.fn() } }));
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
  trip: { id: 'trip-1', shareId: 'share-1', name: 'Lac' },
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
  it('words the name question from the catalogue', async () => {
    const user = await renderInFrench();

    expect(screen.getByRole('list', { name: 'Étape 1 sur 2' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: "Comment s'appelle le séjour ?" })).toBeInTheDocument();
    expect(
      screen.getByText("La maison, la ville, l'occasion : le nom que le groupe lui donne."),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Nom du séjour')).toHaveAttribute(
      'placeholder',
      "L'été au bord du lac",
    );
    expect(screen.getByRole('button', { name: 'Retour' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Créer le séjour' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Donnez un nom au séjour pour continuer.');
  });

  it('words the invite screen from the catalogue', async () => {
    const user = await renderInFrench();
    await user.type(screen.getByLabelText('Nom du séjour'), 'Lac');

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

    expect(
      await screen.findByRole('heading', { name: 'Lac est prêt : invitez le groupe' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Envoyez ce lien. Chacun ajoute son prénom et son jour d'arrivée, et les chambres se remplissent à partir de là.",
      ),
    ).toBeInTheDocument();
    expect(vi.mocked(announceStatus)).toHaveBeenCalledWith('Séjour Lac créé');

    await user.click(screen.getByRole('button', { name: 'signed out' }));
    expect(screen.getByRole('button', { name: 'Plus tard, ouvrir le séjour' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'link ready' }));
    expect(screen.getByRole('button', { name: 'Ouvrir le calendrier' })).toBeInTheDocument();
  });

  it('says in French that the trip could not be created', async () => {
    mockedCreate.mockRejectedValue(new Error('disk full'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const user = await renderInFrench();
    await user.type(screen.getByLabelText('Nom du séjour'), 'Lac');
    await user.click(screen.getByRole('button', { name: 'Créer le séjour' }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(
        "Le séjour n'a pas pu être créé. Réessayez.",
      );
    });
  });
});
