use reqwest::StatusCode;
use serde::{Deserialize, Serialize};
use serde_json::json;

use crate::config::{
    ensure_non_empty, provider_default_url, provider_token_for, rotate_provider_account,
    save_config, AppConfig, UsageStats,
};
use crate::copilot::{
    copilot_model_uses_responses, get_active_copilot_account, github_user_agent,
    request_copilot_session_token, rotate_copilot_account,
};

const COPILOT_API_URL: &str = "https://api.githubcopilot.com/chat/completions";
const COPILOT_RESPONSES_URL: &str = "https://api.githubcopilot.com/responses";

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
}

#[derive(Debug, Serialize, Deserialize, Default)]
pub struct StreamDelta {
    #[serde(default)]
    pub content: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Default)]
pub struct StreamMessage {
    #[serde(default)]
    pub content: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Default)]
pub struct StreamChoice {
    #[serde(default)]
    pub delta: StreamDelta,
    #[serde(default)]
    pub message: StreamMessage,
}

#[derive(Debug, Serialize, Deserialize, Default)]
pub struct StreamChunk {
    #[serde(default)]
    pub choices: Vec<StreamChoice>,
    #[serde(default)]
    pub usage: Option<UsageStats>,
}

pub fn provider_token(config: &AppConfig) -> Result<String, String> {
    match config.provider.as_str() {
        "github" | "openai" | "openrouter" | "groq" | "venice" | "google" | "xai" => {
            provider_token_for(config, config.provider.as_str())
        }
        "custom" => ensure_non_empty(&config.custom_api_key, "Configure a API key do provedor custom."),
        _ => Err("Provider sem token direto configurado.".into()),
    }
}

pub fn provider_url(config: &AppConfig) -> Result<String, String> {
    match config.provider.as_str() {
        "github" | "openai" | "openrouter" | "groq" | "venice" | "xai" => {
            if let Some(account) = config
                .provider_accounts
                .get(config.provider.as_str())
                .and_then(|group| {
                    group
                        .active
                        .as_ref()
                        .and_then(|name| group.accounts.get(name))
                        .or_else(|| group.accounts.values().next())
                })
            {
                if !account.base_url.trim().is_empty() {
                    return Ok(account.base_url.trim().to_string());
                }
            }
            provider_default_url(config.provider.as_str())
        }
        "custom" => ensure_non_empty(&config.custom_api_url, "Configure a URL do provedor custom."),
        _ => Err("Provider sem endpoint configurado.".into()),
    }
}

pub fn build_chat_messages(messages: &[ChatMessage], system_prompt: &str) -> Vec<serde_json::Value> {
    let mut result = vec![json!({
        "role": "system",
        "content": system_prompt,
    })];

    for message in messages {
        result.push(json!({
            "role": message.role,
            "content": message.content,
        }));
    }

    result
}

pub fn build_messages_with_system(system_prompt: &str, messages: &[ChatMessage]) -> Vec<serde_json::Value> {
    build_chat_messages(messages, system_prompt)
}

pub fn extract_text_from_openai_payload(payload: &serde_json::Value) -> String {
    if let Some(content) = payload
        .get("choices")
        .and_then(|value| value.get(0))
        .and_then(|value| value.get("message"))
        .and_then(|value| value.get("content"))
    {
        if let Some(text) = content.as_str() {
            return text.to_string();
        }

        if let Some(parts) = content.as_array() {
            let mut text = String::new();
            for part in parts {
                if let Some(value) = part.get("text").and_then(|value| value.as_str()) {
                    text.push_str(value);
                }
            }
            return text;
        }
    }

    String::new()
}

pub async fn complete_openai_like_once(
    client: &reqwest::Client,
    url: &str,
    token: &str,
    body: serde_json::Value,
    extra_headers: &[(&str, &str)],
) -> Result<String, String> {
    let mut request = client
        .post(url)
        .header("Authorization", format!("Bearer {}", token))
        .header("Content-Type", "application/json");

    for (name, value) in extra_headers {
        request = request.header(*name, *value);
    }

    let response = request
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Erro de conexão: {e}"))?;

    let status = response.status();
    if !status.is_success() {
        let body_text = response.text().await.unwrap_or_default();
        return Err(format!("Erro da API ({status}): {body_text}"));
    }

    let payload: serde_json::Value = response
        .json()
        .await
        .map_err(|e| format!("Resposta inválida da API: {e}"))?;

    Ok(extract_text_from_openai_payload(&payload))
}

pub fn gemini_contents(messages: &[ChatMessage]) -> Vec<serde_json::Value> {
    messages
        .iter()
        .map(|message| {
            let role = if message.role == "assistant" { "model" } else { "user" };
            json!({
                "role": role,
                "parts": [{ "text": message.content }],
            })
        })
        .collect()
}

pub async fn complete_gemini_once(
    client: &reqwest::Client,
    config: &mut AppConfig,
    messages: &[ChatMessage],
    system_prompt: &str,
) -> Result<String, String> {
    let attempts = config
        .provider_accounts
        .get("google")
        .map(|group| group.accounts.len().max(1))
        .unwrap_or(1);

    for _ in 0..attempts {
        let key = provider_token_for(config, "google")?;
        let url = format!(
            "https://generativelanguage.googleapis.com/v1beta/models/{}:generateContent?key={}",
            config.model, key
        );
        let body = json!({
            "system_instruction": {
                "parts": [{ "text": system_prompt }],
            },
            "contents": gemini_contents(messages),
        });

        let response = client
            .post(url)
            .header("Content-Type", "application/json")
            .json(&body)
            .send()
            .await
            .map_err(|e| format!("Erro de conexão: {e}"))?;

        if response.status() == StatusCode::TOO_MANY_REQUESTS {
            if rotate_provider_account(config, "google").is_some() {
                save_config(config)?;
                continue;
            }
        }

        let status = response.status();
        if !status.is_success() {
            let body_text = response.text().await.unwrap_or_default();
            return Err(format!("Erro Gemini ({status}): {body_text}"));
        }

        let payload: serde_json::Value = response
            .json()
            .await
            .map_err(|e| format!("Resposta inválida do Gemini: {e}"))?;

        let mut text = String::new();
        if let Some(parts) = payload
            .get("candidates")
            .and_then(|value| value.get(0))
            .and_then(|value| value.get("content"))
            .and_then(|value| value.get("parts"))
            .and_then(|value| value.as_array())
        {
            for part in parts {
                if let Some(fragment) = part.get("text").and_then(|value| value.as_str()) {
                    text.push_str(fragment);
                }
            }
        }

        return Ok(text);
    }

    Err("Falha ao concluir planejamento com Gemini.".into())
}

pub async fn complete_copilot_once(
    client: &reqwest::Client,
    config: &mut AppConfig,
    messages: &[ChatMessage],
    system_prompt: &str,
) -> Result<String, String> {
    let accounts_len = config.copilot_accounts.len();
    if accounts_len == 0 {
        return Err("Nenhuma conta Copilot conectada.".into());
    }

    for _ in 0..accounts_len {
        let (account_name, account) = get_active_copilot_account(config)
            .ok_or_else(|| "Nenhuma conta Copilot ativa.".to_string())?;
        let session_token = request_copilot_session_token(&account_name, &account.oauth_token, false).await?;

        if copilot_model_uses_responses(&config.model) {
            let input_text = messages
                .iter()
                .map(|message| format!("{}: {}", message.role, message.content))
                .collect::<Vec<_>>()
                .join("\n");

            let response = client
                .post(COPILOT_RESPONSES_URL)
                .header("Authorization", format!("Bearer {}", session_token))
                .header("Content-Type", "application/json")
                .header("User-Agent", github_user_agent())
                .header("Copilot-Integration-Id", "vscode-chat")
                .header("Editor-Version", "vscode/1.113.0")
                .json(&json!({
                    "model": config.model,
                    "input": format!("{}\n\n{}", system_prompt, input_text),
                    "max_output_tokens": 4000,
                }))
                .send()
                .await
                .map_err(|e| format!("Erro de conexão: {e}"))?;

            if response.status() == StatusCode::TOO_MANY_REQUESTS {
                if rotate_copilot_account(config).is_some() {
                    save_config(config)?;
                    continue;
                }
            }

            if response.status() == StatusCode::UNAUTHORIZED {
                let _ = request_copilot_session_token(&account_name, &account.oauth_token, true).await?;
                continue;
            }

            let status = response.status();
            if !status.is_success() {
                let body_text = response.text().await.unwrap_or_default();
                return Err(format!("Erro Copilot ({status}): {body_text}"));
            }

            let payload: serde_json::Value = response
                .json()
                .await
                .map_err(|e| format!("Resposta inválida do Copilot: {e}"))?;

            let mut text = String::new();
            if let Some(items) = payload.get("output").and_then(|value| value.as_array()) {
                for item in items {
                    if item.get("type").and_then(|value| value.as_str()) == Some("message") {
                        if let Some(content_parts) = item.get("content").and_then(|value| value.as_array()) {
                            for part in content_parts {
                                if part.get("type").and_then(|value| value.as_str()) == Some("output_text") {
                                    if let Some(fragment) = part.get("text").and_then(|value| value.as_str()) {
                                        text.push_str(fragment);
                                    }
                                }
                            }
                        }
                    }
                }
            }

            return Ok(text);
        }

        let response = client
            .post(COPILOT_API_URL)
            .header("Authorization", format!("Bearer {}", session_token))
            .header("Content-Type", "application/json")
            .header("User-Agent", github_user_agent())
            .header("Copilot-Integration-Id", "vscode-chat")
            .header("Editor-Version", "vscode/1.113.0")
            .json(&json!({
                "model": config.model,
                "messages": build_messages_with_system(system_prompt, messages),
                "stream": false,
                "temperature": 0.1,
            }))
            .send()
            .await
            .map_err(|e| format!("Erro de conexão: {e}"))?;

        if response.status() == StatusCode::TOO_MANY_REQUESTS {
            if rotate_copilot_account(config).is_some() {
                save_config(config)?;
                continue;
            }
        }

        if response.status() == StatusCode::UNAUTHORIZED {
            let _ = request_copilot_session_token(&account_name, &account.oauth_token, true).await?;
            continue;
        }

        let status = response.status();
        if !status.is_success() {
            let body_text = response.text().await.unwrap_or_default();
            return Err(format!("Erro Copilot ({status}): {body_text}"));
        }

        let payload: serde_json::Value = response
            .json()
            .await
            .map_err(|e| format!("Resposta inválida do Copilot: {e}"))?;
        return Ok(extract_text_from_openai_payload(&payload));
    }

    Err("Falha ao concluir planejamento com Copilot.".into())
}