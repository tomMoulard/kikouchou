/**
 * @fileoverview The carry-over that keeps a stale tab's chunks resolvable.
 *
 * `actions/deploy-pages` publishes a full snapshot, so the deploy that ships
 * build N deletes build N-1's hashed files. Between 2026-09-14 and 2026-09-20
 * five sessions asked for a chunk that had been deleted under them and got the
 * 404 page instead; one of them was the Supabase client, loaded outside any
 * React boundary, where the tab simply stayed broken.
 *
 * What is pinned here is the bounded part — which files a build carries, and
 * which it stops carrying — because that is where the site either stops growing
 * or does not.
 *
 * @module scripts/__tests__/carry-previous-assets
 */

import { describe, expect, it } from 'vitest';

import {
  GENERATIONS_KEPT,
  isCarryablePath,
  manifestToPublish,
  planCarryOver,
  readManifest,
} from '../carry-previous-assets.js';

/** A manifest as the live site publishes one. */
const manifest = (generations) =>
  JSON.stringify({ version: 1, sha: generations[0].sha, generations });

describe('isCarryablePath', () => {
  it('accepts a flat file under assets/', () => {
    expect(isCarryablePath('assets/TripEditPage-CfPSMXkw.js')).toBe(true);
    expect(isCarryablePath('assets/index-vIT0szVx.css')).toBe(true);
  });

  /**
   * The manifest arrives over the network. Nothing in it is allowed to name a
   * path outside `dist`, whatever the site that served it had in mind.
   */
  it('refuses anything that could write outside dist', () => {
    expect(isCarryablePath('assets/../../etc/passwd')).toBe(false);
    expect(isCarryablePath('/etc/passwd')).toBe(false);
    expect(isCarryablePath('assets/nested/deep.js')).toBe(false);
    expect(isCarryablePath('sw.js')).toBe(false);
    expect(isCarryablePath(undefined)).toBe(false);
  });

  /** Source maps are stripped before upload; a manifest naming one is wrong. */
  it('refuses a source map', () => {
    expect(isCarryablePath('assets/index-vIT0szVx.js.map')).toBe(false);
  });
});

describe('readManifest', () => {
  it('reads a published manifest', () => {
    const read = readManifest(manifest([{ sha: 'aaa', assets: ['assets/a.js'] }]));

    expect(read?.generations).toEqual([{ sha: 'aaa', assets: ['assets/a.js'] }]);
  });

  /**
   * The first deploy after this lands has no manifest, and Pages answers that
   * with the 404 page's HTML rather than with nothing. Both are the same
   * non-event: build this one from scratch.
   */
  it('returns nothing for a body that is not a manifest', () => {
    expect(readManifest('<!doctype html><title>404</title>')).toBeNull();
    expect(readManifest('')).toBeNull();
    expect(readManifest('[]')).toBeNull();
  });

  it('returns nothing for a version it predates', () => {
    expect(readManifest(JSON.stringify({ version: 99, generations: [] }))).toBeNull();
  });

  it('drops a path it would refuse to write', () => {
    const read = readManifest(
      manifest([{ sha: 'aaa', assets: ['assets/a.js', '../../evil.js'] }]),
    );

    expect(read?.generations[0].assets).toEqual(['assets/a.js']);
  });
});

describe('planCarryOver', () => {
  it('downloads what the previous build had and this one does not', () => {
    const plan = planCarryOver({
      previous: readManifest(manifest([{ sha: 'old', assets: ['assets/old.js', 'assets/shared.js'] }])),
      ownAssets: ['assets/new.js', 'assets/shared.js'],
      sha: 'new',
    });

    expect(plan.download).toEqual(['assets/old.js']);
  });

  it('carries nothing on the first deploy', () => {
    const plan = planCarryOver({ previous: null, ownAssets: ['assets/new.js'], sha: 'new' });

    expect(plan.download).toEqual([]);
    expect(plan.generations).toEqual([{ sha: 'new', assets: ['assets/new.js'] }]);
  });

  /**
   * The bound. Without it every deploy inherits every deploy before it and the
   * site grows without end — which is a slower, quieter version of the outage
   * this script exists to prevent.
   */
  it('keeps only the newest generations', () => {
    const previous = readManifest(
      manifest([
        { sha: 'n1', assets: ['assets/n1.js'] },
        { sha: 'n2', assets: ['assets/n2.js'] },
        { sha: 'n3', assets: ['assets/n3.js'] },
      ]),
    );

    const plan = planCarryOver({ previous, ownAssets: ['assets/new.js'], sha: 'new' });

    expect(plan.generations.length).toBe(GENERATIONS_KEPT);
    expect(plan.generations.map((g) => g.sha)).toEqual(['new', 'n1', 'n2']);
    // `n3` fell off the end, so its files are neither downloaded nor published.
    expect(plan.download).toEqual(['assets/n1.js', 'assets/n2.js']);
  });

  /**
   * A re-run of the same commit emits the same hashes. Keeping it beside this
   * build would spend one of the three slots saying nothing new.
   */
  it('drops a previous generation built from the same sha', () => {
    const previous = readManifest(
      manifest([
        { sha: 'same', assets: ['assets/same.js'] },
        { sha: 'older', assets: ['assets/older.js'] },
      ]),
    );

    const plan = planCarryOver({ previous, ownAssets: ['assets/same.js'], sha: 'same' });

    expect(plan.generations.map((g) => g.sha)).toEqual(['same', 'older']);
    expect(plan.download).toEqual(['assets/older.js']);
  });

  it('asks for a file shared by two old builds once', () => {
    const previous = readManifest(
      manifest([
        { sha: 'n1', assets: ['assets/vendor-react-stable.js'] },
        { sha: 'n2', assets: ['assets/vendor-react-stable.js'] },
      ]),
    );

    const plan = planCarryOver({ previous, ownAssets: [], sha: 'new' });

    expect(plan.download).toEqual(['assets/vendor-react-stable.js']);
  });
});

describe('manifestToPublish', () => {
  /**
   * A file that has fallen off the site for good must not be chased on every
   * deploy from here to eternity.
   */
  it('forgets a path whose download failed', () => {
    const published = manifestToPublish({
      sha: 'new',
      generations: [
        { sha: 'new', assets: ['assets/new.js'] },
        { sha: 'old', assets: ['assets/here.js', 'assets/gone.js'] },
      ],
      missing: ['assets/gone.js'],
      builtAt: '2026-09-21T00:00:00.000Z',
    });

    expect(published.generations).toEqual([
      { sha: 'new', assets: ['assets/new.js'] },
      { sha: 'old', assets: ['assets/here.js'] },
    ]);
  });

  it('drops a generation that lost every file', () => {
    const published = manifestToPublish({
      sha: 'new',
      generations: [
        { sha: 'new', assets: ['assets/new.js'] },
        { sha: 'old', assets: ['assets/gone.js'] },
      ],
      missing: ['assets/gone.js'],
      builtAt: '2026-09-21T00:00:00.000Z',
    });

    expect(published.generations.map((g) => g.sha)).toEqual(['new']);
  });
});
