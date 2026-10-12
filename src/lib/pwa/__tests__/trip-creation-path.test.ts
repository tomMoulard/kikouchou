import { describe, expect, it } from 'vitest';

import { isTripCreationPath } from '../trip-creation-path';

describe('isTripCreationPath', () => {
  it('matches the trip creation form at the root', () => {
    expect(isTripCreationPath('/trips/new', '/')).toBe(true);
    expect(isTripCreationPath('/trips/new/', '/')).toBe(true);
  });

  it('matches the form under a deployment base path', () => {
    expect(isTripCreationPath('/kikoushou/trips/new', '/kikoushou/')).toBe(true);
    expect(isTripCreationPath('/kikoushou/trips/new', '/kikoushou')).toBe(true);
  });

  it('does not match the other trip pages', () => {
    expect(isTripCreationPath('/trips', '/')).toBe(false);
    expect(isTripCreationPath('/trips/abc123/calendar', '/')).toBe(false);
    expect(isTripCreationPath('/trips/abc123/edit', '/')).toBe(false);
    expect(isTripCreationPath('/trips/new-ideas', '/')).toBe(false);
  });

  it('does not match a path outside the base path', () => {
    expect(isTripCreationPath('/other/trips/new', '/kikoushou/')).toBe(false);
  });
});
