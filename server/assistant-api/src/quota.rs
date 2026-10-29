//! The daily limit: one Postgres function, called with the service role key.
//!
//! `consume_assistant_quota(p_user_id, p_limit)` adds one to the account's
//! counter for the current UTC day and answers whether the request fits. It
//! does both in one statement, so two tabs asking at once cannot both take the
//! last request. Only the service role may run it (see the migration), and the
//! table behind it is closed to every client.
//!
//! A failure to reach it refuses the request. Every answer is paid for, and a
//! limit that opens when Supabase is down is not a limit.

use std::future::Future;
use std::time::Duration;

use serde_json::json;

// ============================================================================
// Types
// ============================================================================

pub trait Quota: Send + Sync + 'static {
    /// Takes one request from the account's allowance for today. `Ok(false)`
    /// when the allowance is spent.
    fn consume(
        &self,
        user_id: &str,
        limit: u32,
    ) -> impl Future<Output = Result<bool, String>> + Send;
}

pub struct SupabaseQuota {
    rpc_url: String,
    service_role_key: String,
    client: reqwest::Client,
}

// ============================================================================
// Implementation
// ============================================================================

impl SupabaseQuota {
    pub fn new(supabase_url: &str, service_role_key: &str, client: reqwest::Client) -> Self {
        Self {
            rpc_url: format!("{supabase_url}/rest/v1/rpc/consume_assistant_quota"),
            service_role_key: service_role_key.to_owned(),
            client,
        }
    }
}

impl Quota for SupabaseQuota {
    async fn consume(&self, user_id: &str, limit: u32) -> Result<bool, String> {
        let response = self
            .client
            .post(&self.rpc_url)
            .header("apikey", &self.service_role_key)
            .bearer_auth(&self.service_role_key)
            .json(&json!({ "p_user_id": user_id, "p_limit": limit }))
            .timeout(Duration::from_secs(10))
            .send()
            .await
            .map_err(|error| format!("quota request failed: {error}"))?;

        let status = response.status();
        if !status.is_success() {
            return Err(format!("quota function answered {status}"));
        }
        response
            .json::<bool>()
            .await
            .map_err(|error| format!("quota answer unreadable: {error}"))
    }
}
