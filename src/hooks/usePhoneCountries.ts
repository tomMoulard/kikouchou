/**
 * @fileoverview Where a phone number typed without a "+" may be from.
 *
 * @module hooks/usePhoneCountries
 */

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { type CountryCode } from 'libphonenumber-js/min';

import { phoneCountriesFor } from '@/lib/phone';

/**
 * The countries a number typed without a "+" is likeliest from: the phone's
 * own region, the app's language, then France.
 *
 * @returns The countries, likeliest first
 */
export function usePhoneCountries(): readonly CountryCode[] {
  const { i18n } = useTranslation();
  return useMemo(
    () =>
      phoneCountriesFor(
        typeof navigator === 'undefined' ? undefined : navigator.language,
        i18n.language,
      ),
    [i18n.language],
  );
}
