/**
 * @fileoverview `missingAuthEnvVars` — the check that stands between a
 * `supabase config push` and the outage of 2026-09-04.
 *
 * That push sent `[auth.external.google]` to the hosted project with
 * `SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID` unset. The CLI does not skip an
 * unresolved `env(...)`, and does not blank it: it pushes the string
 * `env(SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID)` verbatim, overwriting the real
 * credential, which existed nowhere else. Google answered every sign-in with
 * `401 invalid_client`; Spotify went the same way in the same push. The last
 * test here pins that exact pair of providers, against the real config.toml.
 *
 * @module scripts/__tests__/supabase-config-push
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { missingAuthEnvVars } from '../supabase-config-push.js';

/** Names only — most assertions below do not care which key held the reference. */
const names = (toml, env) => missingAuthEnvVars(toml, env).map((v) => v.name);

describe('missingAuthEnvVars', () => {
  it('reports both halves of an enabled provider whose vars are unset', () => {
    const toml = `
[auth.external.google]
enabled = true
client_id = "env(GOOGLE_CLIENT_ID)"
secret = "env(GOOGLE_SECRET)"
`;

    expect(names(toml, {})).toEqual(['GOOGLE_CLIENT_ID', 'GOOGLE_SECRET']);
  });

  it('says nothing when every referenced var is set', () => {
    const toml = `
[auth.external.google]
enabled = true
client_id = "env(GOOGLE_CLIENT_ID)"
secret = "env(GOOGLE_SECRET)"
`;
    const env = { GOOGLE_CLIENT_ID: '123.apps.googleusercontent.com', GOOGLE_SECRET: 'x' };

    expect(names(toml, env)).toEqual([]);
  });

  /**
   * An exported-but-empty var is the failure this guard exists to stop, not a
   * pass: it is what an unset var looks like once a shell has expanded it, and
   * the push writes the empty string over the credential just the same.
   */
  it('treats an empty var as missing', () => {
    const toml = `
[auth.external.google]
enabled = true
client_id = "env(GOOGLE_CLIENT_ID)"
`;

    expect(names(toml, { GOOGLE_CLIENT_ID: '' })).toEqual(['GOOGLE_CLIENT_ID']);
  });

  /**
   * `[auth.external.apple]` ships disabled and still carries an `env(...)`
   * secret. Requiring it would make the guard refuse every push forever, and a
   * guard that always says no gets bypassed within the week.
   */
  it('ignores a provider that is disabled', () => {
    const toml = `
[auth.external.apple]
enabled = false
secret = "env(APPLE_SECRET)"
`;

    expect(names(toml, {})).toEqual([]);
  });

  it('covers an enabled non-provider auth block, such as SMS', () => {
    const toml = `
[auth.sms.twilio]
enabled = true
auth_token = "env(TWILIO_AUTH_TOKEN)"
`;

    expect(names(toml, {})).toEqual(['TWILIO_AUTH_TOKEN']);
  });

  /**
   * `config push` sends auth, and only auth. `[studio]` and `[experimental]`
   * describe the local stack, so demanding an OpenAI key or S3 credentials
   * before pushing auth settings would be a lie about what the command does.
   */
  it('ignores blocks that config push does not send', () => {
    const toml = `
[studio]
enabled = true
openai_api_key = "env(OPENAI_API_KEY)"

[experimental]
s3_access_key = "env(S3_ACCESS_KEY)"
`;

    expect(names(toml, {})).toEqual([]);
  });

  it('ignores a commented-out reference', () => {
    const toml = `
[auth.email.smtp]
enabled = true
# pass = "env(SENDGRID_API_KEY)"
`;

    expect(names(toml, {})).toEqual([]);
  });

  /** A block with no `enabled` key at all is live; `[auth]` itself is one. */
  it('treats a block with no enabled key as live', () => {
    const toml = `
[auth]
secret = "env(AUTH_SECRET)"
`;

    expect(names(toml, {})).toEqual(['AUTH_SECRET']);
  });

  /** Per-remote overrides are auth too, once the `remotes.<name>.` prefix is off. */
  it('follows auth blocks nested under a remote', () => {
    const toml = `
[remotes.production.auth.external.google]
enabled = true
secret = "env(PROD_GOOGLE_SECRET)"
`;

    expect(names(toml, {})).toEqual(['PROD_GOOGLE_SECRET']);
  });

  it('names the block and key alongside the variable, so the message can point somewhere', () => {
    const toml = `
[auth.external.google]
enabled = true
client_id = "env(GOOGLE_CLIENT_ID)"
`;

    expect(missingAuthEnvVars(toml, {})).toEqual([
      { name: 'GOOGLE_CLIENT_ID', block: 'auth.external.google', key: 'client_id' },
    ]);
  });

  /**
   * The regression test. Against the config.toml actually in the tree and an
   * empty environment, the guard must name exactly the four credentials that
   * the 2026-09-04 push destroyed — and must not name Apple's, which sat in the
   * same file, disabled, the whole time.
   */
  it('names exactly Google and Spotify for the real config.toml', () => {
    const configPath = resolve(import.meta.dirname, '..', '..', 'supabase', 'config.toml');

    expect(names(readFileSync(configPath, 'utf8'), {}).sort()).toEqual([
      'SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID',
      'SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET',
      'SUPABASE_AUTH_EXTERNAL_SPOTIFY_CLIENT_ID',
      'SUPABASE_AUTH_EXTERNAL_SPOTIFY_SECRET',
    ]);
  });
});
