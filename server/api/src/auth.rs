//! Who is asking: the Supabase access token, verified here.
//!
//! The hosted project signs its access tokens with ES256 and publishes the
//! public keys at `/auth/v1/.well-known/jwks.json`, so a token is checked with
//! no secret at all: the signature against those keys, then the issuer, the
//! audience and the expiry.
//!
//! An anonymous session is refused. Every answer is paid for by the project,
//! and the daily limit counts accounts; a session anybody can mint without a
//! form would make that limit count nothing.

use std::time::{Duration, Instant};

use jsonwebtoken::jwk::JwkSet;
use jsonwebtoken::{decode, decode_header, Algorithm, DecodingKey, Validation};
use serde::Deserialize;
use tokio::sync::RwLock;

// ============================================================================
// Types
// ============================================================================

/// The account behind a verified token.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Identity {
    /// `auth.users.id`, the token's `sub`.
    pub user_id: String,
}

#[derive(Debug, PartialEq, Eq)]
pub enum AuthError {
    /// No `Authorization: Bearer …` header.
    Missing,
    /// Bad signature, wrong issuer or audience, expired, or unreadable.
    Invalid,
    /// A valid token for an anonymous session.
    Anonymous,
    /// The project's keys could not be fetched.
    KeysUnavailable,
}

#[derive(Debug, Deserialize)]
struct Claims {
    sub: String,
    #[serde(default)]
    is_anonymous: bool,
}

/// The project's public keys, fetched on first use and again when a token
/// names a key that is not in them (a rotation).
pub struct KeyStore {
    jwks_url: String,
    issuer: String,
    client: reqwest::Client,
    cached: RwLock<Option<(JwkSet, Instant)>>,
}

// ============================================================================
// Constants
// ============================================================================

/// The audience Supabase puts on a signed-in user's token.
const AUDIENCE: &str = "authenticated";

/// A token naming an unknown key refetches the set at most this often, so a
/// stream of forged `kid`s cannot turn into a stream of requests to Supabase.
const REFETCH_INTERVAL: Duration = Duration::from_secs(60);

// ============================================================================
// Verification
// ============================================================================

/// Reads the token out of an `Authorization` header value.
pub fn bearer_token(header: Option<&str>) -> Result<&str, AuthError> {
    let value = header.ok_or(AuthError::Missing)?.trim();
    let (scheme, token) = value.split_once(' ').ok_or(AuthError::Missing)?;
    if !scheme.eq_ignore_ascii_case("bearer") || token.trim().is_empty() {
        return Err(AuthError::Missing);
    }
    Ok(token.trim())
}

/// Verifies `token` against `keys`. Pure, so the tests need no network.
pub fn verify_with(keys: &JwkSet, token: &str, issuer: &str) -> Result<Identity, AuthError> {
    let header = decode_header(token).map_err(|_| AuthError::Invalid)?;
    if header.alg != Algorithm::ES256 {
        return Err(AuthError::Invalid);
    }
    let kid = header.kid.ok_or(AuthError::Invalid)?;
    let jwk = keys.find(&kid).ok_or(AuthError::Invalid)?;
    let key = DecodingKey::from_jwk(jwk).map_err(|_| AuthError::Invalid)?;

    let mut validation = Validation::new(Algorithm::ES256);
    validation.set_audience(&[AUDIENCE]);
    validation.set_issuer(&[issuer]);

    let claims = decode::<Claims>(token, &key, &validation)
        .map_err(|_| AuthError::Invalid)?
        .claims;
    if claims.is_anonymous {
        return Err(AuthError::Anonymous);
    }
    if claims.sub.is_empty() {
        return Err(AuthError::Invalid);
    }
    Ok(Identity {
        user_id: claims.sub,
    })
}

/// The `kid` a token names, or `None` when its header is unreadable.
fn token_kid(token: &str) -> Option<String> {
    decode_header(token).ok().and_then(|header| header.kid)
}

impl KeyStore {
    pub fn new(supabase_url: &str, client: reqwest::Client) -> Self {
        Self {
            jwks_url: format!("{supabase_url}/auth/v1/.well-known/jwks.json"),
            issuer: format!("{supabase_url}/auth/v1"),
            client,
            cached: RwLock::new(None),
        }
    }

    /// Verifies a token, fetching the keys when they are missing or stale.
    pub async fn verify(&self, token: &str) -> Result<Identity, AuthError> {
        let kid = token_kid(token).ok_or(AuthError::Invalid)?;

        let needs_fetch = match &*self.cached.read().await {
            None => true,
            Some((keys, fetched_at)) => {
                keys.find(&kid).is_none() && fetched_at.elapsed() >= REFETCH_INTERVAL
            }
        };
        if needs_fetch {
            match self.fetch().await {
                Ok(keys) => *self.cached.write().await = Some((keys, Instant::now())),
                Err(error) => {
                    println!("jwks fetch failed: {error}");
                    if self.cached.read().await.is_none() {
                        return Err(AuthError::KeysUnavailable);
                    }
                }
            }
        }

        let cached = self.cached.read().await;
        let (keys, _) = cached.as_ref().ok_or(AuthError::KeysUnavailable)?;
        verify_with(keys, token, &self.issuer)
    }

    async fn fetch(&self) -> Result<JwkSet, reqwest::Error> {
        self.client
            .get(&self.jwks_url)
            .timeout(Duration::from_secs(10))
            .send()
            .await?
            .error_for_status()?
            .json()
            .await
    }
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
pub mod tests {
    use super::*;
    use jsonwebtoken::{encode, EncodingKey, Header};
    use serde_json::json;

    /// A throwaway P-256 key made for these tests. It signs nothing real.
    const TEST_PRIVATE_KEY: &str = "-----BEGIN PRIVATE KEY-----
MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgIn9xRFoUfK6KZdpe
7X66D0MMUMU3k2EWMBdApFDECT2hRANCAATQF3b+uqveXRJLtPXSQ52ewETBv4W5
Qfa1gHd4t8chDJglHKdjb15Hc67Q98T64CPGmQ51c4l2krwblDWZtadF
-----END PRIVATE KEY-----
";

    pub const TEST_ISSUER: &str = "https://ref.supabase.co/auth/v1";
    pub const TEST_KID: &str = "test-key";

    pub fn test_keys() -> JwkSet {
        serde_json::from_value(json!({
            "keys": [{
                "kty": "EC",
                "crv": "P-256",
                "alg": "ES256",
                "use": "sig",
                "kid": TEST_KID,
                "x": "0Bd2_rqr3l0SS7T10kOdnsBEwb-FuUH2tYB3eLfHIQw",
                "y": "mCUcp2NvXkdzrtD3xPrgI8aZDnVziXaSvBuUNZm1p0U"
            }]
        }))
        .unwrap()
    }

    fn now() -> u64 {
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs()
    }

    pub fn sign(claims: serde_json::Value) -> String {
        let mut header = Header::new(Algorithm::ES256);
        header.kid = Some(TEST_KID.to_owned());
        let key = EncodingKey::from_ec_pem(TEST_PRIVATE_KEY.as_bytes()).unwrap();
        encode(&header, &claims, &key).unwrap()
    }

    pub fn user_token(sub: &str) -> String {
        sign(json!({
            "sub": sub,
            "aud": "authenticated",
            "iss": TEST_ISSUER,
            "exp": now() + 3600,
            "role": "authenticated",
            "is_anonymous": false,
        }))
    }

    #[test]
    fn accepts_a_signed_in_user() {
        let identity = verify_with(&test_keys(), &user_token("user-1"), TEST_ISSUER).unwrap();
        assert_eq!(identity.user_id, "user-1");
    }

    #[test]
    fn refuses_an_anonymous_session() {
        let token = sign(json!({
            "sub": "anon-1",
            "aud": "authenticated",
            "iss": TEST_ISSUER,
            "exp": now() + 3600,
            "is_anonymous": true,
        }));
        assert_eq!(
            verify_with(&test_keys(), &token, TEST_ISSUER),
            Err(AuthError::Anonymous)
        );
    }

    #[test]
    fn refuses_an_expired_token() {
        let token = sign(json!({
            "sub": "user-1",
            "aud": "authenticated",
            "iss": TEST_ISSUER,
            "exp": now() - 600,
        }));
        assert_eq!(
            verify_with(&test_keys(), &token, TEST_ISSUER),
            Err(AuthError::Invalid)
        );
    }

    #[test]
    fn refuses_another_projects_token() {
        let token = sign(json!({
            "sub": "user-1",
            "aud": "authenticated",
            "iss": "https://other.supabase.co/auth/v1",
            "exp": now() + 3600,
        }));
        assert_eq!(
            verify_with(&test_keys(), &token, TEST_ISSUER),
            Err(AuthError::Invalid)
        );
    }

    #[test]
    fn refuses_the_anon_key_audience() {
        let token = sign(json!({
            "sub": "user-1",
            "aud": "anon",
            "iss": TEST_ISSUER,
            "exp": now() + 3600,
        }));
        assert_eq!(
            verify_with(&test_keys(), &token, TEST_ISSUER),
            Err(AuthError::Invalid)
        );
    }

    #[test]
    fn refuses_a_tampered_token() {
        let token = user_token("user-1");
        let mut parts: Vec<&str> = token.split('.').collect();
        let forged_payload = user_token("user-2");
        parts[1] = forged_payload.split('.').nth(1).unwrap();
        let forged = format!("{}.{}.{}", parts[0], parts[1], "AAAA");
        assert_eq!(
            verify_with(&test_keys(), &forged, TEST_ISSUER),
            Err(AuthError::Invalid)
        );
    }

    #[test]
    fn refuses_garbage() {
        assert_eq!(
            verify_with(&test_keys(), "not-a-token", TEST_ISSUER),
            Err(AuthError::Invalid)
        );
    }

    #[test]
    fn reads_the_bearer_header() {
        assert_eq!(bearer_token(Some("Bearer abc")), Ok("abc"));
        assert_eq!(bearer_token(Some("bearer  abc ")), Ok("abc"));
        assert_eq!(bearer_token(None), Err(AuthError::Missing));
        assert_eq!(bearer_token(Some("Basic abc")), Err(AuthError::Missing));
        assert_eq!(bearer_token(Some("Bearer ")), Err(AuthError::Missing));
    }
}
