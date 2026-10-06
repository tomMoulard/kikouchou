/**
 * @fileoverview The settings card for the pet: turn it on, pick the animal,
 * dress it.
 *
 * The preview and the pickers are shown whether the pet is on or off. Seeing
 * the Pomeranian in its beret is the reason to turn it on.
 *
 * @module features/pet/components/PetSettingsCard
 */

import {
  type KeyboardEvent,
  type ReactElement,
  type ReactNode,
  memo,
  useCallback,
  useRef,
} from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Dices, PawPrint } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { captureEvent } from '@/lib/posthog';
import { cn } from '@/lib/utils';

import {
  PET_SLOTS,
  PET_SPECIES,
  type PetOutfit,
  type PetSlot,
  type PetSpecies,
} from '../constants';
import { usePetPreferences } from '../hooks/usePetPreferences';
import {
  storePetEnabled,
  storePetOutfit,
  storePetOutfitItem,
  storePetSpecies,
} from '../lib/pet-preferences';
import { randomOutfit } from '../lib/pet-outfit';
import { PetSprite } from './PetSprite';

// ============================================================================
// Type Definitions
// ============================================================================

interface OptionGroupProps<T extends string> {
  readonly label: string;
  readonly options: readonly T[];
  readonly value: T;
  readonly onChange: (value: T) => void;
  readonly renderOption: (option: T, checked: boolean) => ReactNode;
  readonly className?: string;
  readonly optionClassName?: string;
}

// ============================================================================
// Constants
// ============================================================================

const SWITCH_ID = 'pet-enabled';

const SLOT_ORDER = Object.keys(PET_SLOTS) as PetSlot[];

// ============================================================================
// Sub-Components
// ============================================================================

/**
 * A radio group of buttons, with a roving `tabIndex` and arrow keys, as
 * `PalettePicker` does it.
 */
function OptionGroup<T extends string>({
  label,
  options,
  value,
  onChange,
  renderOption,
  className,
  optionClassName,
}: OptionGroupProps<T>): ReactElement {
  const refs = useRef(new Map<T, HTMLButtonElement>());

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>): void => {
      const delta =
        event.key === 'ArrowRight' || event.key === 'ArrowDown'
          ? 1
          : event.key === 'ArrowLeft' || event.key === 'ArrowUp'
            ? -1
            : 0;

      if (delta === 0) {
        return;
      }

      event.preventDefault();
      const next = options[(options.indexOf(value) + delta + options.length) % options.length];

      if (next !== undefined) {
        onChange(next);
        refs.current.get(next)?.focus();
      }
    },
    [onChange, options, value],
  );

  return (
    // eslint-disable-next-line jsx-a11y/interactive-supports-focus -- APG's radio-group pattern puts a roving `tabIndex` on the radios and leaves the group itself out of the tab order, as `PalettePicker` does.
    <div role="radiogroup" aria-label={label} className={className} onKeyDown={handleKeyDown}>
      {options.map((option) => {
        const checked = option === value;

        return (
          <button
            key={option}
            ref={(node) => {
              if (node) {
                refs.current.set(option, node);
              } else {
                refs.current.delete(option);
              }
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={checked ? 0 : -1}
            onClick={() => onChange(option)}
            className={cn(
              'rounded-lg border text-sm transition-colors',
              'hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              checked ? 'border-primary ring-1 ring-primary' : 'border-border',
              optionClassName,
            )}
          >
            {renderOption(option, checked)}
          </button>
        );
      })}
    </div>
  );
}

// ============================================================================
// Component
// ============================================================================

/**
 * The pet's settings card.
 *
 * @returns The card
 */
export const PetSettingsCard = memo(function PetSettingsCard(): ReactElement {
  const { t } = useTranslation(),
    { enabled, species, outfit } = usePetPreferences();

  const handleToggle = useCallback((next: boolean): void => {
    captureEvent('pet_toggled', { enabled: next });
    storePetEnabled(next);
  }, []);

  const handleSpecies = useCallback((next: PetSpecies): void => {
    captureEvent('pet_customized', { slot: 'species', value: next });
    storePetSpecies(next);
  }, []);

  const handleSlot = useCallback(<S extends PetSlot>(slot: S, item: PetOutfit[S]): void => {
    captureEvent('pet_customized', { slot, value: item });
    storePetOutfitItem(slot, item);
  }, []);

  const handleSurprise = useCallback((): void => {
    captureEvent('pet_customized', { slot: 'random' });
    storePetOutfit(randomOutfit());
  }, []);

  const speciesName = t(`pet.species.${species}`, species);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10">
            <PawPrint className="size-5 text-primary" aria-hidden="true" />
          </div>
          <div>
            <CardTitle className="text-base">{t('pet.settings.title', 'Pet')}</CardTitle>
            <CardDescription>
              {t(
                'pet.settings.description',
                'A little friend who walks around the app. Tap it to play, drag it to move it.',
              )}
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="flex items-center justify-between gap-4">
          <Label htmlFor={SWITCH_ID} className="text-sm font-medium">
            {t('pet.settings.enabled', 'Show my pet')}
          </Label>
          <Switch id={SWITCH_ID} checked={enabled} onCheckedChange={handleToggle} />
        </div>

        <div className="flex flex-col gap-5 sm:flex-row sm:items-start">
          <div
            className="flex shrink-0 flex-col items-center gap-2 self-center rounded-2xl bg-muted/60 px-6 pb-3 pt-6 sm:self-start"
          >
            <PetSprite species={species} outfit={outfit} className="size-28" />
            <span className="font-display text-sm font-semibold">{speciesName}</span>
          </div>

          <div className="min-w-0 flex-1 space-y-4">
            <div className="space-y-2">
              <p className="text-sm font-medium">{t('pet.settings.species', 'Animal')}</p>
              <OptionGroup
                label={t('pet.settings.species', 'Animal')}
                options={PET_SPECIES}
                value={species}
                onChange={handleSpecies}
                className="grid grid-cols-2 gap-2 sm:grid-cols-4"
                optionClassName="flex flex-col items-center gap-1 p-2"
                renderOption={(option, checked) => (
                  <>
                    <PetSprite species={option} outfit={outfit} className="size-12" />
                    <span className="flex items-center gap-1 text-center text-xs font-medium leading-tight">
                      {t(`pet.species.${option}`, option)}
                      {checked && <Check className="size-3.5 shrink-0 text-primary" aria-hidden="true" />}
                    </span>
                  </>
                )}
              />
            </div>

            {SLOT_ORDER.map((slot) => (
              <div key={slot} className="space-y-2">
                <p className="text-sm font-medium">{t(`pet.settings.slots.${slot}`, slot)}</p>
                <OptionGroup<string>
                  label={t(`pet.settings.slots.${slot}`, slot)}
                  options={PET_SLOTS[slot]}
                  value={outfit[slot]}
                  onChange={(item) => handleSlot(slot, item as PetOutfit[typeof slot])}
                  className="flex flex-wrap gap-2"
                  optionClassName="px-3 py-1.5"
                  renderOption={(item) => t(`pet.items.${item}`, item)}
                />
              </div>
            ))}

            <Button type="button" variant="outline" size="sm" onClick={handleSurprise}>
              <Dices className="size-4" aria-hidden="true" />
              {t('pet.settings.surprise', 'Surprise me')}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
});
