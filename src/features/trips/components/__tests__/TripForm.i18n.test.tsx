/**
 * @fileoverview The create form's guest and room rows, read in French.
 *
 * Every row control is named after its position ("room 2"), and the
 * suite-wide i18n mock drops the options that carry that number, so it cannot
 * tell room 1 from room 2. French also cannot come from an inline fallback,
 * so each name here proves the form asked the catalogue for the right key.
 *
 * @module features/trips/components/__tests__/TripForm.i18n.test
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithRealI18n, screen, within } from '@/test/utils';

import { TripForm } from '../TripForm';

vi.unmock('i18next');
vi.unmock('react-i18next');

beforeEach(() => {
  // Typing in the location field triggers a place lookup; keep it off the wire.
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve([]) }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function renderInFrench() {
  return renderWithRealI18n(<TripForm onSubmit={vi.fn()} onCancel={vi.fn()} />, {
    language: 'fr',
    withProviders: false,
  });
}

describe('TripForm in French', () => {
  it('names each room row by its number', async () => {
    const { user } = await renderInFrench();
    const rooms = screen.getByRole('group', { name: /Chambres/ });

    await user.click(within(rooms).getByRole('button', { name: 'Ajouter une chambre' }));
    await user.click(within(rooms).getByRole('button', { name: 'Ajouter une chambre' }));

    expect(within(rooms).getByText('(facultatif)')).toBeInTheDocument();
    expect(
      within(rooms).getByText(
        'Nommez chaque chambre et indiquez son nombre de lits. Vous pourrez en ajouter plus tard.',
      ),
    ).toBeInTheDocument();
    const second = within(rooms).getByRole('textbox', { name: 'Chambre 2' });
    expect(second).toHaveAttribute('placeholder', 'Ex : Lit double');
    expect(within(rooms).getByRole('textbox', { name: 'Chambre 1' })).toBeInTheDocument();
    expect(
      within(rooms).getByRole('button', { name: 'Icône de la chambre 2' }),
    ).toBeInTheDocument();
    expect(within(rooms).getByLabelText('Lits dans la chambre 2')).toBeInTheDocument();
    expect(
      within(rooms).getByRole('button', { name: 'Retirer un lit de la chambre 2' }),
    ).toBeInTheDocument();
    expect(
      within(rooms).getByRole('button', { name: 'Ajouter un lit à la chambre 2' }),
    ).toBeInTheDocument();
    expect(within(rooms).getByRole('button', { name: 'Retirer la chambre 2' })).toBeInTheDocument();
  });

  it('names each guest row by its number, the first one as you', async () => {
    const { user } = await renderInFrench();
    const guests = screen.getByRole('group', { name: /Invités/ });

    await user.click(within(guests).getByRole('button', { name: 'Ajouter un invité' }));

    const you = within(guests).getByRole('textbox', { name: 'Votre nom' });
    expect(you).toHaveAttribute('placeholder', 'Votre nom');
    expect(within(guests).getByText('Vous')).toBeInTheDocument();
    const second = within(guests).getByRole('textbox', { name: 'Invité 2' });
    expect(second).toHaveAttribute('placeholder', 'Ex : Marie');
    expect(within(guests).getByRole('button', { name: "Retirer l'invité 2" })).toBeInTheDocument();
    expect(
      within(guests).getByText(
        "Qui vient ? Effacez votre nom si vous n'y allez pas. Vous pourrez ajouter des invités plus tard.",
      ),
    ).toBeInTheDocument();
  });
});
