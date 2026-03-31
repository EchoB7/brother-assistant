use once_cell::sync::Lazy;
use reqwest::StatusCode;
use std::collections::HashMap;
use std::sync::Mutex;

use crate::config::{now_secs, AppConfig, CopilotAccount};

const COPILOT_TOKEN_URL: &str = "https://api.github.com/copilot_internal/v2/token";
const GITHUB_USER_API_URL: &str = "https://api.github.com/user";
const GITHUB_USER_AGENT: &str = "CopilotDesktop/0.1 (+https://github.com)";

static COPILOT_SESSION_CACHE: Lazy<Mutex<HashMap<String, SessionCacheEntry>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

#[derive(Debug, Clone)]
struct SessionCacheEntry {
    token: String,
    expires_at: u64,
}

pub fn github_user_agent() -> &'static str {
    GITHUB_USER_AGENT
}

pub fn get_active_copilot_account(config: &mut AppConfig) -> Option<(String, CopilotAccount)> {
    if let Some(active) = &config.active_copilot_account {
        if let Some(account) = config.copilot_accounts.get(active) {
            return Some((active.clone(), account.clone()));
        }
    }
    let first = config
        .copilot_accounts
        .iter()
        .next()
        .map(|(name, account)| (name.clone(), account.clone()))?;
    config.active_copilot_account = Some(first.0.clone());
    Some(first)
}

pub fn rotate_copilot_account(config: &mut AppConfig) -> Option<String> {
    let keys: Vec<String> = config.copilot_accounts.keys().cloned().collect();
    if keys.len() <= 1 {
        return None;
    }
    let current = config.active_copilot_account.clone();
    let current_index = current
        .as_ref()
        .and_then(|name| keys.iter().position(|key| key == name))
        .unwrap_or(0);
    let next_name = keys[(current_index + 1) % keys.len()].clone();
    config.active_copilot_account = Some(next_name.clone());
    Some(next_name)
}

pub fn clear_copilot_session_cache(account_name: &str) {
    if let Ok(mut cache) = COPILOT_SESSION_CACHE.lock() {
        cache.remove(account_name);
    }
}

pub async fn github_username_from_token(token: &str) -> Result<String, String> {
    let client = reqwest::Client::new();
    let response = client
        .get(GITHUB_USER_API_URL)
        .header("Authorization", format!("token {}", token))
        .header("Accept", "application/json")
        .header("User-Agent", GITHUB_USER_AGENT)
        .send()
        .await
        .map_err(|e| format!("Falha ao validar conta GitHub: {e}"))?;

    if !response.status().is_success() {
        return Err("Não foi possível obter o usuário GitHub da conta autorizada.".into());
    }

    let payload: serde_json::Value = response
        .json()
        .await
        .map_err(|e| format!("Resposta inválida do GitHub: {e}"))?;

    payload
        .get("login")
        .and_then(|value| value.as_str())
        .map(|value| value.to_string())
        .ok_or_else(|| "GitHub não retornou o login da conta.".into())
}

pub async fn request_copilot_session_token(
    account_name: &str,
    oauth_token: &str,
    force_refresh: bool,
) -> Result<String, String> {
    let now = now_secs();

    if !force_refresh {
        let cache = COPILOT_SESSION_CACHE
            .lock()
            .map_err(|_| "Falha ao acessar cache de sessão")?;
        if let Some(entry) = cache.get(account_name) {
            if entry.expires_at > now + 60 {
                return Ok(entry.token.clone());
            }
        }
    }

    let client = reqwest::Client::new();
    let response = client
        .get(COPILOT_TOKEN_URL)
        .header("Authorization", format!("token {}", oauth_token))
        .header("Accept", "application/json")
        .header("User-Agent", GITHUB_USER_AGENT)
        .header("Editor-Version", "vscode/1.113.0")
        .header("Editor-Plugin-Version", "copilot-chat/0.27.2025032401")
        .send()
        .await
        .map_err(|e| format!("Falha ao obter sessão do Copilot: {e}"))?;

    if response.status() == StatusCode::UNAUTHORIZED {
        return Err("OAuth da conta expirou. Remova e adicione a conta novamente.".into());
    }

    if !response.status().is_success() {
        let body = response.text().await.unwrap_or_default();
        return Err(format!("Falha ao obter sessão do Copilot: {}", body));
    }

    let payload: serde_json::Value = response
        .json()
        .await
        .map_err(|e| format!("Resposta inválida da sessão Copilot: {e}"))?;

    let token = payload
        .get("token")
        .and_then(|value| value.as_str())
        .ok_or_else(|| "Sessão Copilot sem token.".to_string())?
        .to_string();

    let expires_at = payload
        .get("expires_at")
        .and_then(|value| value.as_f64())
        .map(|value| value as u64)
        .unwrap_or(now + 1800);

    let mut cache = COPILOT_SESSION_CACHE
        .lock()
        .map_err(|_| "Falha ao atualizar cache de sessão")?;
    cache.insert(
        account_name.to_string(),
        SessionCacheEntry {
            token: token.clone(),
            expires_at,
        },
    );

    Ok(token)
}

pub fn copilot_model_uses_responses(model: &str) -> bool {
    matches!(
        model,
        "gpt-5.4"
            | "gpt-5.4-mini"
            | "gpt-5.3-codex"
            | "gpt-5.2-codex"
            | "gpt-5.1-codex"
            | "gpt-5.1-codex-max"
            | "goldeneye-free-auto"
    )
}