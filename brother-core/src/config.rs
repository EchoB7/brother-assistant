use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::fs;
use std::path::PathBuf;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

const GITHUB_MODELS_URL: &str = "https://models.inference.ai.azure.com/chat/completions";
const OPENAI_URL: &str = "https://api.openai.com/v1/chat/completions";
const OPENROUTER_URL: &str = "https://openrouter.ai/api/v1/chat/completions";
const GROQ_URL: &str = "https://api.groq.com/openai/v1/chat/completions";
const VENICE_URL: &str = "https://api.venice.ai/api/v1/chat/completions";
const XAI_URL: &str = "https://api.x.ai/v1/chat/completions";

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct UsageStats {
    #[serde(default)]
    pub prompt_tokens: u64,
    #[serde(default)]
    pub completion_tokens: u64,
    #[serde(default)]
    pub input_tokens: u64,
    #[serde(default)]
    pub output_tokens: u64,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct CopilotAccount {
    pub oauth_token: String,
    pub added_at: u64,
    pub requests: u64,
    pub total_tokens: u64,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct ProviderAccount {
    pub api_key: String,
    #[serde(default)]
    pub base_url: String,
    pub added_at: u64,
    pub requests: u64,
    pub total_tokens: u64,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct ProviderAccountGroup {
    pub active: Option<String>,
    #[serde(default)]
    pub accounts: BTreeMap<String, ProviderAccount>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AppConfig {
    #[serde(default)]
    pub agent_mode: bool,
    pub provider: String,
    pub model: String,
    pub github_token: String,
    pub openai_key: String,
    pub openrouter_key: String,
    pub groq_key: String,
    pub venice_key: String,
    pub google_key: String,
    pub xai_key: String,
    pub custom_api_url: String,
    pub custom_api_key: String,
    pub active_copilot_account: Option<String>,
    pub copilot_accounts: BTreeMap<String, CopilotAccount>,
    #[serde(default)]
    pub provider_accounts: BTreeMap<String, ProviderAccountGroup>,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            agent_mode: false,
            provider: "copilot".into(),
            model: "gpt-4.1".into(),
            github_token: String::new(),
            openai_key: String::new(),
            openrouter_key: String::new(),
            groq_key: String::new(),
            venice_key: String::new(),
            google_key: String::new(),
            xai_key: String::new(),
            custom_api_url: String::new(),
            custom_api_key: String::new(),
            active_copilot_account: None,
            copilot_accounts: BTreeMap::new(),
            provider_accounts: BTreeMap::new(),
        }
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SettingsState {
    pub agent_mode: bool,
    pub provider: String,
    pub model: String,
    pub github_token: String,
    pub openai_key: String,
    pub openrouter_key: String,
    pub groq_key: String,
    pub venice_key: String,
    pub google_key: String,
    pub xai_key: String,
    pub custom_api_url: String,
    pub custom_api_key: String,
    pub active_copilot_account: Option<String>,
    pub copilot_accounts: Vec<CopilotAccountSummary>,
    pub provider_accounts: BTreeMap<String, Vec<ProviderAccountSummary>>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SettingsUpdate {
    pub agent_mode: bool,
    pub provider: String,
    pub model: String,
    pub github_token: String,
    pub openai_key: String,
    pub openrouter_key: String,
    pub groq_key: String,
    pub venice_key: String,
    pub google_key: String,
    pub xai_key: String,
    pub custom_api_url: String,
    pub custom_api_key: String,
    pub active_copilot_account: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CopilotAccountSummary {
    pub username: String,
    pub added_at: u64,
    pub requests: u64,
    pub total_tokens: u64,
    pub active: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ProviderAccountSummary {
    pub name: String,
    pub api_key: String,
    pub base_url: String,
    pub added_at: u64,
    pub requests: u64,
    pub total_tokens: u64,
    pub active: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DeviceFlowStart {
    pub device_code: String,
    pub user_code: String,
    pub verification_uri: String,
    pub interval: u64,
    pub expires_in: u64,
}

pub fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_else(|_| Duration::from_secs(0))
        .as_secs()
}

pub fn config_path() -> PathBuf {
    let dir = dirs::config_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("copilot-assistente");
    let _ = fs::create_dir_all(&dir);
    dir.join("settings.json")
}

pub fn load_config() -> AppConfig {
    let path = config_path();
    let mut config = match fs::read_to_string(&path) {
        Ok(data) => serde_json::from_str(&data).unwrap_or_default(),
        Err(_) => AppConfig::default(),
    };
    normalize_config(&mut config);
    config
}

pub fn save_config(config: &AppConfig) -> Result<(), String> {
    let path = config_path();
    let data = serde_json::to_string_pretty(config).map_err(|e| e.to_string())?;
    fs::write(&path, data).map_err(|e| e.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(&path, fs::Permissions::from_mode(0o600));
    }
    Ok(())
}

pub fn provider_supports_accounts(provider: &str) -> bool {
    matches!(
        provider,
        "github" | "openai" | "openrouter" | "groq" | "venice" | "google" | "xai"
    )
}

pub fn supported_account_providers() -> [&'static str; 7] {
    ["github", "openai", "openrouter", "groq", "venice", "google", "xai"]
}

pub fn read_direct_provider_key(config: &AppConfig, provider: &str) -> String {
    match provider {
        "github" => config.github_token.clone(),
        "openai" => config.openai_key.clone(),
        "openrouter" => config.openrouter_key.clone(),
        "groq" => config.groq_key.clone(),
        "venice" => config.venice_key.clone(),
        "google" => config.google_key.clone(),
        "xai" => config.xai_key.clone(),
        _ => String::new(),
    }
}

pub fn write_direct_provider_key(config: &mut AppConfig, provider: &str, value: String) {
    match provider {
        "github" => config.github_token = value,
        "openai" => config.openai_key = value,
        "openrouter" => config.openrouter_key = value,
        "groq" => config.groq_key = value,
        "venice" => config.venice_key = value,
        "google" => config.google_key = value,
        "xai" => config.xai_key = value,
        _ => {}
    }
}

pub fn default_account_name(config: &AppConfig, provider: &str) -> String {
    let store = config.provider_accounts.get(provider);
    if store
        .map(|group| !group.accounts.contains_key("principal"))
        .unwrap_or(true)
    {
        return "principal".to_string();
    }

    let mut index = store.map(|group| group.accounts.len()).unwrap_or(0) + 1;
    loop {
        let candidate = format!("{}{}", provider, index);
        let exists = store
            .map(|group| group.accounts.contains_key(&candidate))
            .unwrap_or(false);
        if !exists {
            return candidate;
        }
        index += 1;
    }
}

pub fn normalize_provider_account_group(config: &mut AppConfig, provider: &str) {
    if !provider_supports_accounts(provider) {
        return;
    }

    let direct_key = read_direct_provider_key(config, provider).trim().to_string();
    let store = config.provider_accounts.entry(provider.to_string()).or_default();

    if store.accounts.is_empty() && !direct_key.is_empty() {
        store.accounts.insert(
            "principal".to_string(),
            ProviderAccount {
                api_key: direct_key.clone(),
                base_url: String::new(),
                added_at: now_secs(),
                requests: 0,
                total_tokens: 0,
            },
        );
        store.active = Some("principal".to_string());
    }

    if store
        .active
        .as_ref()
        .map(|name| !store.accounts.contains_key(name))
        .unwrap_or(true)
    {
        store.active = store.accounts.keys().next().cloned();
    }

    let active_key = store
        .active
        .as_ref()
        .and_then(|name| store.accounts.get(name))
        .map(|account| account.api_key.clone())
        .unwrap_or(direct_key);
    write_direct_provider_key(config, provider, active_key);
}

pub fn normalize_config(config: &mut AppConfig) {
    for provider in supported_account_providers() {
        normalize_provider_account_group(config, provider);
    }
}

pub fn provider_default_url(provider: &str) -> Result<String, String> {
    match provider {
        "github" => Ok(GITHUB_MODELS_URL.to_string()),
        "openai" => Ok(OPENAI_URL.to_string()),
        "openrouter" => Ok(OPENROUTER_URL.to_string()),
        "groq" => Ok(GROQ_URL.to_string()),
        "venice" => Ok(VENICE_URL.to_string()),
        "xai" => Ok(XAI_URL.to_string()),
        "custom" => Err("Provider custom depende de URL configurada.".into()),
        _ => Err("Provider sem endpoint configurado.".into()),
    }
}

pub fn get_active_provider_account(
    config: &mut AppConfig,
    provider: &str,
) -> Option<(String, ProviderAccount)> {
    let store = config.provider_accounts.get_mut(provider)?;
    if let Some(active) = &store.active {
        if let Some(account) = store.accounts.get(active) {
            return Some((active.clone(), account.clone()));
        }
    }
    let first = store
        .accounts
        .iter()
        .next()
        .map(|(name, account)| (name.clone(), account.clone()))?;
    store.active = Some(first.0.clone());
    Some(first)
}

pub fn rotate_provider_account(config: &mut AppConfig, provider: &str) -> Option<String> {
    let store = config.provider_accounts.get_mut(provider)?;
    let keys: Vec<String> = store.accounts.keys().cloned().collect();
    if keys.len() <= 1 {
        return None;
    }
    let current = store.active.clone();
    let current_index = current
        .as_ref()
        .and_then(|name| keys.iter().position(|key| key == name))
        .unwrap_or(0);
    let next_name = keys[(current_index + 1) % keys.len()].clone();
    store.active = Some(next_name.clone());
    Some(next_name)
}

pub fn update_provider_usage(config: &mut AppConfig, provider: &str, account_name: &str, usage: &UsageStats) {
    if let Some(store) = config.provider_accounts.get_mut(provider) {
        if let Some(account) = store.accounts.get_mut(account_name) {
            account.requests += 1;
            account.total_tokens += usage.prompt_tokens
                + usage.completion_tokens
                + usage.input_tokens
                + usage.output_tokens;
        }
    }
}

pub fn provider_token_for(config: &AppConfig, provider: &str) -> Result<String, String> {
    let direct = read_direct_provider_key(config, provider);
    let active_account_key = config
        .provider_accounts
        .get(provider)
        .and_then(|store| {
            store
                .active
                .as_ref()
                .and_then(|name| store.accounts.get(name))
                .or_else(|| store.accounts.values().next())
        })
        .map(|account| account.api_key.clone())
        .unwrap_or(direct);

    let message = match provider {
        "github" => "Configure o token do GitHub Models.",
        "openai" => "Configure a API key da OpenAI.",
        "openrouter" => "Configure uma API key do OpenRouter.",
        "groq" => "Configure uma API key da Groq.",
        "venice" => "Configure uma API key da Venice.",
        "google" => "Configure uma API key do Gemini.",
        "xai" => "Configure uma API key da xAI.",
        "custom" => "Configure a API key do provedor custom.",
        _ => "Provider sem token direto configurado.",
    };

    ensure_non_empty(&active_account_key, message)
}

pub fn settings_state_from_config(config: &AppConfig) -> SettingsState {
    let accounts = config
        .copilot_accounts
        .iter()
        .map(|(username, account)| CopilotAccountSummary {
            username: username.clone(),
            added_at: account.added_at,
            requests: account.requests,
            total_tokens: account.total_tokens,
            active: config.active_copilot_account.as_deref() == Some(username.as_str()),
        })
        .collect();

    let mut provider_accounts = BTreeMap::new();
    for provider in supported_account_providers() {
        let summaries = config
            .provider_accounts
            .get(provider)
            .map(|group| {
                group
                    .accounts
                    .iter()
                    .map(|(name, account)| ProviderAccountSummary {
                        name: name.clone(),
                        api_key: account.api_key.clone(),
                        base_url: account.base_url.clone(),
                        added_at: account.added_at,
                        requests: account.requests,
                        total_tokens: account.total_tokens,
                        active: group.active.as_deref() == Some(name.as_str()),
                    })
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();
        provider_accounts.insert(provider.to_string(), summaries);
    }

    SettingsState {
        agent_mode: config.agent_mode,
        provider: config.provider.clone(),
        model: config.model.clone(),
        github_token: config.github_token.clone(),
        openai_key: config.openai_key.clone(),
        openrouter_key: config.openrouter_key.clone(),
        groq_key: config.groq_key.clone(),
        venice_key: config.venice_key.clone(),
        google_key: config.google_key.clone(),
        xai_key: config.xai_key.clone(),
        custom_api_url: config.custom_api_url.clone(),
        custom_api_key: config.custom_api_key.clone(),
        active_copilot_account: config.active_copilot_account.clone(),
        copilot_accounts: accounts,
        provider_accounts,
    }
}

pub fn apply_settings_update(config: &mut AppConfig, update: SettingsUpdate) {
    config.agent_mode = update.agent_mode;
    config.provider = update.provider;
    config.model = update.model;
    config.github_token = update.github_token;
    config.openai_key = update.openai_key;
    config.openrouter_key = update.openrouter_key;
    config.groq_key = update.groq_key;
    config.venice_key = update.venice_key;
    config.google_key = update.google_key;
    config.xai_key = update.xai_key;
    config.custom_api_url = update.custom_api_url;
    config.custom_api_key = update.custom_api_key;
    if let Some(active) = update.active_copilot_account {
        config.active_copilot_account = Some(active);
    }
    normalize_config(config);
}

pub fn ensure_non_empty(value: &str, message: &str) -> Result<String, String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        Err(message.into())
    } else {
        Ok(trimmed.to_string())
    }
}