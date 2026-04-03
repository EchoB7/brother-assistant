use futures_util::StreamExt;
use reqwest::StatusCode;
use serde_json::json;

use crate::agent::{detect_agent_action, execute_agent_action, plan_agent_action_with_model};
use crate::chat::{
    build_chat_messages, gemini_contents, provider_token, provider_url, ChatMessage, StreamChunk,
};
use crate::config::{
    get_active_provider_account, provider_token_for, rotate_provider_account, save_config,
    update_provider_usage, AppConfig, UsageStats,
};
use crate::copilot::{
    copilot_model_uses_responses, get_active_copilot_account, github_user_agent,
    request_copilot_session_token, rotate_copilot_account,
};
use crate::skills::augment_prompt_with_skills;

const COPILOT_API_URL: &str = "https://api.githubcopilot.com/chat/completions";
const COPILOT_RESPONSES_URL: &str = "https://api.githubcopilot.com/responses";

pub const DEFAULT_SYSTEM_PROMPT: &str = "Você é o Brother, um assistente de IA inteligente e prestativo. Responda em português do Brasil de forma clara e concisa. Use markdown quando apropriado. Quando ajudar a explicar fluxos, comparações, cronogramas ou estruturas, você pode usar blocos ```mermaid``` para diagramas e gráficos simples.";
pub const DEFAULT_AGENT_PLANNER_PROMPT: &str = "Você é o planejador do modo agente. Analise a ultima mensagem do usuario e decida se deve usar uma ferramenta local. Responda SOMENTE com JSON valido, sem markdown, no formato {\"mode\":\"tool\"|\"chat\",\"tool\":string|null,\"arguments\":object}. Use mode=tool quando a ferramenta resolver o pedido diretamente. Ferramentas: get_system_info {} -> coleta CPU, memoria, armazenamento e sistema; create_simple_html_and_open {} -> cria uma pagina HTML simples e abre no navegador; open_url {\"url\":string} -> abre URL; open_path {\"path\":string} -> abre arquivo local; set_wallpaper {\"path\":string} -> troca wallpaper com imagem local; download_image_and_set_wallpaper {\"query\":string} -> pesquisa uma imagem na web, baixa para a pasta Imagens e aplica como wallpaper; create_file {\"path\":string,\"content\":string} -> cria arquivo com conteudo; edit_file {\"path\":string,\"content\":string} -> sobrescreve conteudo de arquivo existente; delete_file {\"path\":string} -> remove arquivo ou diretorio; create_dir {\"path\":string} -> cria diretorio (com subdiretorios); move_file {\"from\":string,\"to\":string} -> move arquivo ou pasta; rename_file {\"from\":string,\"to\":string} -> renomeia arquivo ou pasta; list_dir {\"path\":string} -> lista conteudo de um diretorio; open_application {\"name\":string} -> abre um aplicativo instalado pelo nome; web_search {\"query\":string} -> pesquisa na web e retorna os resultados dentro do chat; open_browser_search {\"query\":string} -> abre o navegador com uma pesquisa no Google (use quando o usuario pedir para abrir o navegador e pesquisar algo); generate_image {\"prompt\":string} -> gera uma imagem usando IA a partir de uma descricao textual e salva na pasta Imagens (use quando o usuario pedir para criar, gerar, desenhar ou fazer uma imagem). Caminhos devem ser absolutos (ex: /home/usuario/...). Se o pedido nao exigir ferramenta local, responda {\"mode\":\"chat\",\"tool\":null,\"arguments\":{}}.";

pub enum ChatRuntimeEvent {
    Chunk(String),
    Done,
}

fn emit_done<F>(emit: &mut F)
where
    F: FnMut(ChatRuntimeEvent),
{
    emit(ChatRuntimeEvent::Done);
}

fn emit_chunk<F>(emit: &mut F, content: String)
where
    F: FnMut(ChatRuntimeEvent),
{
    emit(ChatRuntimeEvent::Chunk(content));
}

fn emit_single_response_chunk<F>(emit: &mut F, content: String)
where
    F: FnMut(ChatRuntimeEvent),
{
    emit_chunk(emit, content);
    emit_done(emit);
}

fn update_copilot_account_usage(config: &mut AppConfig, account_name: &str, usage: &UsageStats) {
    if let Some(account) = config.copilot_accounts.get_mut(account_name) {
        account.requests += 1;
        account.total_tokens += usage.prompt_tokens
            + usage.completion_tokens
            + usage.input_tokens
            + usage.output_tokens;
    }
}

async fn maybe_run_agent_action<F>(
    client: &reqwest::Client,
    config: &mut AppConfig,
    messages: &[ChatMessage],
    planner_prompt: &str,
    emit: &mut F,
) -> Result<bool, String>
where
    F: FnMut(ChatRuntimeEvent),
{
    if !config.agent_mode {
        return Ok(false);
    }

    let Some(last_user_message) = messages.iter().rev().find(|message| message.role == "user") else {
        return Ok(false);
    };

    let detected_action = detect_agent_action(&last_user_message.content);
    let planned_action = plan_agent_action_with_model(client, config, messages, planner_prompt).await?;

    let action = match detected_action {
        Some(crate::agent::AgentAction::OpenBrowserSearch { .. })
        | Some(crate::agent::AgentAction::OpenApplication { .. })
        | Some(crate::agent::AgentAction::OpenUrl { .. })
        | Some(crate::agent::AgentAction::OpenPath { .. }) => detected_action,
        other => planned_action.or(other),
    };

    let Some(action) = action else {
        return Ok(false);
    };

    let output = execute_agent_action(&action).await?;
    emit_single_response_chunk(emit, output);
    Ok(true)
}

async fn stream_openai_like<F>(
    client: &reqwest::Client,
    url: &str,
    token: &str,
    body: serde_json::Value,
    extra_headers: &[(&str, &str)],
    emit: &mut F,
) -> Result<(StatusCode, UsageStats), String>
where
    F: FnMut(ChatRuntimeEvent),
{
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

    let mut stream = response.bytes_stream();
    let mut buffer = String::new();
    let mut usage = UsageStats::default();

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("Erro no stream: {e}"))?;
        buffer.push_str(&String::from_utf8_lossy(&chunk));

        while let Some(line_end) = buffer.find('\n') {
            let line = buffer[..line_end].trim().to_string();
            buffer = buffer[line_end + 1..].to_string();

            if line.is_empty() || !line.starts_with("data: ") {
                continue;
            }

            let data = &line[6..];
            if data == "[DONE]" {
                emit_done(emit);
                return Ok((status, usage));
            }

            if let Ok(parsed) = serde_json::from_str::<StreamChunk>(data) {
                if let Some(parsed_usage) = parsed.usage {
                    usage = parsed_usage;
                }
                if let Some(choice) = parsed.choices.first() {
                    if let Some(content) = choice
                        .delta
                        .content
                        .clone()
                        .or_else(|| choice.message.content.clone())
                    {
                        emit_chunk(emit, content);
                    }
                }
            }
        }
    }

    emit_done(emit);
    Ok((status, usage))
}

async fn stream_gemini<F>(
    client: &reqwest::Client,
    config: &mut AppConfig,
    messages: &[ChatMessage],
    system_prompt: &str,
    emit: &mut F,
) -> Result<(), String>
where
    F: FnMut(ChatRuntimeEvent),
{
    let attempts = config
        .provider_accounts
        .get("google")
        .map(|group| group.accounts.len().max(1))
        .unwrap_or(1);
    let mut first_rotation = true;

    for _ in 0..attempts {
        let active_account_name = get_active_provider_account(config, "google").map(|(name, _)| name);
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

        let status = response.status();
        if status == StatusCode::TOO_MANY_REQUESTS {
            let rotated = rotate_provider_account(config, "google");
            save_config(config)?;
            if let Some(next_name) = rotated {
                if first_rotation {
                    emit_chunk(
                        emit,
                        format!("[Rotação automática para a conta {}]\n\n", next_name),
                    );
                    first_rotation = false;
                }
                continue;
            }
        }

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

        if text.is_empty() {
            return Err("Gemini não retornou conteúdo.".into());
        }

        let usage = UsageStats {
            input_tokens: payload
                .get("usageMetadata")
                .and_then(|value| value.get("promptTokenCount"))
                .and_then(|value| value.as_u64())
                .unwrap_or(0),
            output_tokens: payload
                .get("usageMetadata")
                .and_then(|value| value.get("candidatesTokenCount"))
                .and_then(|value| value.as_u64())
                .unwrap_or(0),
            ..UsageStats::default()
        };

        if let Some(account_name) = active_account_name {
            update_provider_usage(config, "google", &account_name, &usage);
            save_config(config)?;
        }

        emit_single_response_chunk(emit, text);
        return Ok(());
    }

    Err("Limite atingido em todas as contas Gemini configuradas.".into())
}

async fn stream_copilot<F>(
    client: &reqwest::Client,
    config: &mut AppConfig,
    messages: &[ChatMessage],
    system_prompt: &str,
    emit: &mut F,
) -> Result<(), String>
where
    F: FnMut(ChatRuntimeEvent),
{
    let accounts_len = config.copilot_accounts.len();
    if accounts_len == 0 {
        return Err("Nenhuma conta Copilot conectada. Use Configurações > Copilot > Adicionar conta.".into());
    }

    let mut first_rotation = true;
    for _ in 0..accounts_len {
        let (account_name, account) = get_active_copilot_account(config)
            .ok_or_else(|| "Nenhuma conta Copilot ativa.".to_string())?;

        let session_token = request_copilot_session_token(&account_name, &account.oauth_token, false).await?;
        let use_responses = copilot_model_uses_responses(&config.model);

        if use_responses {
            let user_input = messages
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
                    "input": format!("{}\n\n{}", system_prompt, user_input),
                    "max_output_tokens": 16000,
                }))
                .send()
                .await
                .map_err(|e| format!("Erro de conexão: {e}"))?;

            if response.status() == StatusCode::TOO_MANY_REQUESTS {
                let rotated = rotate_copilot_account(config);
                save_config(config)?;
                if let Some(next_name) = rotated {
                    if first_rotation {
                        emit_chunk(
                            emit,
                            format!("[Rotação automática para a conta {}]\n\n", next_name),
                        );
                        first_rotation = false;
                    }
                    continue;
                }
                return Err("Limite atingido. Adicione mais contas Copilot ou aguarde.".into());
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

            let usage = UsageStats {
                input_tokens: payload
                    .get("usage")
                    .and_then(|value| value.get("input_tokens"))
                    .and_then(|value| value.as_u64())
                    .unwrap_or(0),
                output_tokens: payload
                    .get("usage")
                    .and_then(|value| value.get("output_tokens"))
                    .and_then(|value| value.as_u64())
                    .unwrap_or(0),
                ..UsageStats::default()
            };

            update_copilot_account_usage(config, &account_name, &usage);
            save_config(config)?;
            emit_single_response_chunk(emit, text);
            return Ok(());
        }

        let body = json!({
            "model": config.model,
            "messages": build_chat_messages(messages, system_prompt),
            "stream": true,
            "temperature": 0.3,
            "max_tokens": 4000,
        });

        match stream_openai_like(
            client,
            COPILOT_API_URL,
            &session_token,
            body,
            &[
                ("Copilot-Integration-Id", "vscode-chat"),
                ("Editor-Version", "vscode/1.113.0"),
            ],
            emit,
        )
        .await
        {
            Ok((_, usage)) => {
                update_copilot_account_usage(config, &account_name, &usage);
                save_config(config)?;
                return Ok(());
            }
            Err(error) if error.starts_with("Erro da API (429") => {
                let rotated = rotate_copilot_account(config);
                save_config(config)?;
                if let Some(next_name) = rotated {
                    if first_rotation {
                        emit_chunk(
                            emit,
                            format!("[Rotação automática para a conta {}]\n\n", next_name),
                        );
                        first_rotation = false;
                    }
                    continue;
                }
                return Err("Limite atingido. Adicione mais contas Copilot ou aguarde.".into());
            }
            Err(error) if error.starts_with("Erro da API (401") => {
                let _ = request_copilot_session_token(&account_name, &account.oauth_token, true).await?;
                continue;
            }
            Err(error) => return Err(error),
        }
    }

    Err("Limite atingido em todas as contas Copilot.".into())
}

pub async fn run_chat_request<F>(
    client: &reqwest::Client,
    config: &mut AppConfig,
    messages: &[ChatMessage],
    system_prompt: &str,
    planner_prompt: &str,
    mut emit: F,
) -> Result<(), String>
where
    F: FnMut(ChatRuntimeEvent),
{
    let system_prompt = augment_prompt_with_skills(system_prompt, messages);
    let planner_prompt = augment_prompt_with_skills(planner_prompt, messages);

    if maybe_run_agent_action(client, config, messages, &planner_prompt, &mut emit).await? {
        return Ok(());
    }

    match config.provider.as_str() {
        "copilot" => stream_copilot(client, config, messages, &system_prompt, &mut emit).await,
        "google" => stream_gemini(client, config, messages, &system_prompt, &mut emit).await,
        _ => {
            let provider_name = config.provider.clone();
            let attempts = config
                .provider_accounts
                .get(provider_name.as_str())
                .map(|group| group.accounts.len().max(1))
                .unwrap_or(1);
            let mut first_rotation = true;

            for _ in 0..attempts {
                let active_account_name = get_active_provider_account(config, provider_name.as_str())
                    .map(|(name, _)| name);
                let url = provider_url(config)?;
                let token = provider_token(config)?;
                let body = json!({
                    "model": config.model,
                    "messages": build_chat_messages(messages, &system_prompt),
                    "stream": true,
                    "temperature": 0.3,
                });
                let extra_headers = if config.provider == "openrouter" {
                    vec![("HTTP-Referer", "https://localhost"), ("X-Title", "Brother Desktop")]
                } else {
                    vec![]
                };

                match stream_openai_like(client, &url, &token, body, &extra_headers, &mut emit).await {
                    Ok((_, usage)) => {
                        if let Some(account_name) = active_account_name {
                            update_provider_usage(config, provider_name.as_str(), &account_name, &usage);
                            save_config(config)?;
                        }
                        return Ok(());
                    }
                    Err(error) if error.starts_with("Erro da API (429") => {
                        let rotated = rotate_provider_account(config, provider_name.as_str());
                        save_config(config)?;
                        if let Some(next_name) = rotated {
                            if first_rotation {
                                emit_chunk(
                                    &mut emit,
                                    format!("[Rotação automática para a conta {}]\n\n", next_name),
                                );
                                first_rotation = false;
                            }
                            continue;
                        }
                        return Err(format!("Limite atingido em todas as contas de {}.", provider_name));
                    }
                    Err(error) => return Err(error),
                }
            }

            Err(format!("Não foi possível obter resposta de {}.", provider_name))
        }
    }
}

pub async fn collect_chat_response(
    client: &reqwest::Client,
    config: &mut AppConfig,
    messages: &[ChatMessage],
    system_prompt: &str,
    planner_prompt: &str,
) -> Result<String, String> {
    let mut output = String::new();

    run_chat_request(
        client,
        config,
        messages,
        system_prompt,
        planner_prompt,
        |event| {
            if let ChatRuntimeEvent::Chunk(content) = event {
                output.push_str(&content);
            }
        },
    )
    .await?;

    Ok(output)
}