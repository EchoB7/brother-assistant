use std::borrow::Cow;
use std::fs;
use std::path::{Component, Path, PathBuf};
use std::time::Duration;

use base64::Engine;
use brother_core::chat::ChatMessage;
use brother_core::config::{
	apply_settings_update, default_account_name, load_config, normalize_provider_account_group,
	now_secs, provider_supports_accounts, save_config, settings_state_from_config, AppConfig,
	CopilotAccount, DeviceFlowStart, ProviderAccount, ProviderAccountGroup, SettingsState,
	SettingsUpdate,
};
use brother_core::copilot::{
	clear_copilot_session_cache, github_user_agent, github_username_from_token,
};
use brother_core::runtime::{
	run_chat_request, ChatRuntimeEvent, DEFAULT_AGENT_PLANNER_PROMPT, DEFAULT_SYSTEM_PROMPT,
};
use global_hotkey::{GlobalHotKeyEvent, GlobalHotKeyManager, hotkey::{Code, HotKey, Modifiers}};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tao::dpi::{LogicalSize, LogicalPosition};
use tao::event::{Event, WindowEvent};
use tao::event_loop::{ControlFlow, EventLoopBuilder, EventLoopProxy};
#[cfg(target_os = "linux")]
use tao::platform::unix::WindowExtUnix;
use tao::window::{Icon, Window, WindowBuilder};
use tray_icon::{TrayIconBuilder, menu::{Menu, MenuItem, MenuEvent}};
use wry::http::header::CONTENT_TYPE;
use wry::http::{Request, Response, StatusCode};
#[cfg(target_os = "linux")]
use wry::WebViewBuilderExtUnix;
use wry::{WebView, WebViewBuilder};

const GITHUB_DEVICE_CODE_URL: &str = "https://github.com/login/device/code";
const GITHUB_OAUTH_TOKEN_URL: &str = "https://github.com/login/oauth/access_token";
const VSCODE_CLIENT_ID: &str = "01ab8ac9400c4e429b23";
const SHELL_URL: &str = "brother://app/";
const INIT_SCRIPT: &str = r#"
(() => {
  const listeners = new Map();
  const pending = new Map();
  const nextId = () => {
	if (window.crypto?.randomUUID) {
	  return window.crypto.randomUUID();
	}
	return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  };
  const post = (message) => window.ipc.postMessage(JSON.stringify(message));

  window.__BROTHER_HOST_INTERNAL__ = {
	resolve(id, payload) {
	  const entry = pending.get(id);
	  if (!entry) return;
	  pending.delete(id);
	  entry.resolve(payload);
	},
	reject(id, error) {
	  const entry = pending.get(id);
	  if (!entry) return;
	  pending.delete(id);
	  entry.reject(typeof error === 'string' ? new Error(error) : error);
	},
	emit(event, payload) {
	  const handlers = listeners.get(event);
	  if (!handlers) return;
	  handlers.forEach((handler) => {
		try {
		  handler(payload);
		} catch (error) {
		  console.error(error);
		}
	  });
	},
  };

  window.__BROTHER_HOST__ = {
	invoke(command, args) {
	  return new Promise((resolve, reject) => {
		const id = nextId();
		pending.set(id, { resolve, reject });
		post({ kind: 'invoke', id, command, args: args ?? null });
	  });
	},
	listen(event, handler) {
	  let handlers = listeners.get(event);
	  if (!handlers) {
		handlers = new Set();
		listeners.set(event, handlers);
	  }
	  handlers.add(handler);

	  return () => {
		const current = listeners.get(event);
		if (!current) return;
		current.delete(handler);
		if (current.size === 0) {
		  listeners.delete(event);
		}
	  };
	},
	windowControl(action) {
	  post({ kind: 'windowControl', action });
	},
  };
})();
"#;

#[derive(Debug, Clone)]
enum UserEvent {
	Ipc(String),
	Eval(String),
}

#[derive(Debug, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
enum IpcMessage {
	Invoke {
		id: String,
		command: String,
		args: Option<Value>,
	},
	WindowControl {
		action: WindowAction,
	},
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
enum WindowAction {
	Minimize,
	ToggleMaximize,
	Close,
	StartDrag,
}

fn read_json_file(path: &PathBuf) -> Option<Value> {
	let raw = fs::read_to_string(path).ok()?;
	serde_json::from_str(&raw).ok()
}

fn extract_string(value: Option<&Value>) -> Option<String> {
	value.and_then(|item| item.as_str()).map(|item| item.to_string())
}

fn import_provider_key(
	config: &mut AppConfig,
	provider_name: &str,
	config_root: &Value,
	provider_accounts_root: Option<&Value>,
) {
	let provider_cfg = config_root
		.get("providers")
		.and_then(|value| value.get(provider_name));

	let direct_key = extract_string(provider_cfg.and_then(|value| value.get("api_key")));
	let provider_base_url =
		extract_string(provider_cfg.and_then(|value| value.get("base_url"))).unwrap_or_default();

	let provider_accounts = provider_accounts_root
		.and_then(|root| root.get("providers"))
		.and_then(|providers| providers.get(provider_name));

	let mut imported_store = ProviderAccountGroup::default();

	if let Some(active_name) = provider_accounts
		.and_then(|value| value.get("active"))
		.and_then(|value| value.as_str())
	{
		imported_store.active = Some(active_name.to_string());
	}

	if let Some(accounts_map) = provider_accounts
		.and_then(|value| value.get("accounts"))
		.and_then(|value| value.as_object())
	{
		for (account_name, account_value) in accounts_map {
			let api_key = extract_string(account_value.get("api_key"));
			if let Some(api_key) = api_key {
				imported_store.accounts.insert(
					account_name.clone(),
					ProviderAccount {
						api_key,
						base_url: extract_string(account_value.get("base_url")).unwrap_or_default(),
						added_at: account_value
							.get("added_at")
							.and_then(|value| value.as_u64())
							.unwrap_or_else(now_secs),
						requests: account_value
							.get("requests")
							.and_then(|value| value.as_u64())
							.unwrap_or(0),
						total_tokens: account_value
							.get("total_tokens")
							.and_then(|value| value.as_u64())
							.unwrap_or(0),
					},
				);
			}
		}
	}

	if imported_store.accounts.is_empty() {
		if let Some(value) = direct_key {
			imported_store.accounts.insert(
				"principal".to_string(),
				ProviderAccount {
					api_key: value,
					base_url: provider_base_url,
					added_at: now_secs(),
					requests: 0,
					total_tokens: 0,
				},
			);
			imported_store.active = Some("principal".to_string());
		}
	}

	if !imported_store.accounts.is_empty() {
		if imported_store
			.active
			.as_ref()
			.map(|name| !imported_store.accounts.contains_key(name))
			.unwrap_or(true)
		{
			imported_store.active = imported_store.accounts.keys().next().cloned();
		}
		config
			.provider_accounts
			.insert(provider_name.to_string(), imported_store);
	}

	normalize_provider_account_group(config, provider_name);
}

fn import_copilot_accounts(config: &mut AppConfig, base_dir: &PathBuf) {
	let accounts_path = base_dir.join("accounts.json");
	if let Some(accounts_json) = read_json_file(&accounts_path) {
		let active = extract_string(accounts_json.get("active"));
		if let Some(accounts_map) = accounts_json.get("accounts").and_then(|value| value.as_object()) {
			for (username, account_value) in accounts_map {
				let oauth_token = extract_string(account_value.get("oauth_token"));
				if let Some(oauth_token) = oauth_token {
					config.copilot_accounts.insert(
						username.clone(),
						CopilotAccount {
							oauth_token,
							added_at: account_value
								.get("added_at")
								.and_then(|value| value.as_u64())
								.unwrap_or_else(now_secs),
							requests: account_value
								.get("requests")
								.and_then(|value| value.as_u64())
								.unwrap_or(0),
							total_tokens: account_value
								.get("total_tokens")
								.and_then(|value| value.as_u64())
								.unwrap_or(0),
						},
					);
				}
			}
		}
		if active.is_some() {
			config.active_copilot_account = active;
		}
	}

	if config.copilot_accounts.is_empty() {
		let oauth_path = base_dir.join("oauth_token.json");
		if let Some(oauth_json) = read_json_file(&oauth_path) {
			if let Some(access_token) = extract_string(oauth_json.get("access_token")) {
				config.copilot_accounts.insert(
					"legacy-oauth".to_string(),
					CopilotAccount {
						oauth_token: access_token,
						added_at: now_secs(),
						requests: 0,
						total_tokens: 0,
					},
				);
				config.active_copilot_account = Some("legacy-oauth".to_string());
			}
		}
	}
}

fn import_legacy_copilot_agent_config_inner() -> Result<AppConfig, String> {
	let base_dir = dirs::home_dir()
		.unwrap_or_else(|| PathBuf::from("."))
		.join(".config")
		.join("copilot-agent");

	let config_json = read_json_file(&base_dir.join("config.json"))
		.ok_or_else(|| "Não encontrei ~/.config/copilot-agent/config.json".to_string())?;
	let provider_accounts_json = read_json_file(&base_dir.join("provider_accounts.json"));

	let mut config = load_config();

	if let Some(active_platform) = extract_string(config_json.get("active_platform")) {
		config.provider = match active_platform.as_str() {
			"copilot" | "github" | "openai" | "openrouter" | "groq" | "venice" | "google"
			| "xai" | "custom" => active_platform,
			_ => config.provider.clone(),
		};
	}

	if let Some(model) = extract_string(config_json.get("model")) {
		config.model = model;
	}

	import_provider_key(&mut config, "github", &config_json, provider_accounts_json.as_ref());
	import_provider_key(&mut config, "openai", &config_json, provider_accounts_json.as_ref());
	import_provider_key(&mut config, "openrouter", &config_json, provider_accounts_json.as_ref());
	import_provider_key(&mut config, "groq", &config_json, provider_accounts_json.as_ref());
	import_provider_key(&mut config, "venice", &config_json, provider_accounts_json.as_ref());
	import_provider_key(&mut config, "google", &config_json, provider_accounts_json.as_ref());
	import_provider_key(&mut config, "xai", &config_json, provider_accounts_json.as_ref());
	import_copilot_accounts(&mut config, &base_dir);

	save_config(&config)?;
	Ok(config)
}

async fn start_copilot_device_flow_impl() -> Result<DeviceFlowStart, String> {
	let client = reqwest::Client::new();
	let response = client
		.post(GITHUB_DEVICE_CODE_URL)
		.header("Accept", "application/json")
		.header("User-Agent", github_user_agent())
		.form(&[("client_id", VSCODE_CLIENT_ID), ("scope", "read:user")])
		.send()
		.await
		.map_err(|e| format!("Falha ao iniciar Device Flow: {e}"))?;

	if !response.status().is_success() {
		let body = response.text().await.unwrap_or_default();
		return Err(format!("Falha ao iniciar Device Flow: {}", body));
	}

	let payload: Value = response
		.json()
		.await
		.map_err(|e| format!("Resposta inválida do Device Flow: {e}"))?;

	Ok(DeviceFlowStart {
		device_code: payload
			.get("device_code")
			.and_then(|value| value.as_str())
			.unwrap_or_default()
			.to_string(),
		user_code: payload
			.get("user_code")
			.and_then(|value| value.as_str())
			.unwrap_or_default()
			.to_string(),
		verification_uri: payload
			.get("verification_uri")
			.and_then(|value| value.as_str())
			.unwrap_or("https://github.com/login/device")
			.to_string(),
		interval: payload
			.get("interval")
			.and_then(|value| value.as_u64())
			.unwrap_or(5),
		expires_in: payload
			.get("expires_in")
			.and_then(|value| value.as_u64())
			.unwrap_or(600),
	})
}

async fn complete_copilot_device_flow_impl(
	device_code: String,
	interval: u64,
	expires_in: u64,
) -> Result<SettingsState, String> {
	let client = reqwest::Client::new();
	let attempts = ((expires_in / interval.max(1)).max(1)).min(120);

	for _ in 0..attempts {
		tokio::time::sleep(Duration::from_secs(interval.max(1))).await;
		let response = client
			.post(GITHUB_OAUTH_TOKEN_URL)
			.header("Accept", "application/json")
			.header("User-Agent", github_user_agent())
			.form(&[
				("client_id", VSCODE_CLIENT_ID),
				("device_code", device_code.as_str()),
				("grant_type", "urn:ietf:params:oauth:grant-type:device_code"),
			])
			.send()
			.await
			.map_err(|e| format!("Falha ao concluir Device Flow: {e}"))?;

		let payload: Value = response
			.json()
			.await
			.map_err(|e| format!("Resposta inválida do Device Flow: {e}"))?;

		match payload.get("error").and_then(|value| value.as_str()) {
			Some("authorization_pending") => continue,
			Some("slow_down") => {
				tokio::time::sleep(Duration::from_secs(5)).await;
				continue;
			}
			Some(error) => return Err(format!("Falha na autenticação GitHub: {}", error)),
			None => {}
		}

		let oauth_token = payload
			.get("access_token")
			.and_then(|value| value.as_str())
			.ok_or_else(|| "GitHub não retornou access_token.".to_string())?;

		let username = github_username_from_token(oauth_token).await?;
		let mut config = load_config();
		config.copilot_accounts.insert(
			username.clone(),
			CopilotAccount {
				oauth_token: oauth_token.to_string(),
				added_at: now_secs(),
				requests: config
					.copilot_accounts
					.get(&username)
					.map(|account| account.requests)
					.unwrap_or(0),
				total_tokens: config
					.copilot_accounts
					.get(&username)
					.map(|account| account.total_tokens)
					.unwrap_or(0),
			},
		);
		if config.active_copilot_account.is_none() {
			config.active_copilot_account = Some(username);
		}
		save_config(&config)?;
		return Ok(settings_state_from_config(&config));
	}

	Err("Tempo esgotado aguardando a autorização da conta GitHub.".into())
}

fn sanitize_path(path: &str) -> PathBuf {
	let mut sanitized = PathBuf::new();
	for component in Path::new(path).components() {
		if let Component::Normal(value) = component {
			sanitized.push(value);
		}
	}
	sanitized
}

fn content_type_for(path: &Path) -> &'static str {
	match path.extension().and_then(|value| value.to_str()).unwrap_or_default() {
		"html" => "text/html; charset=utf-8",
		"js" => "text/javascript; charset=utf-8",
		"css" => "text/css; charset=utf-8",
		"json" => "application/json; charset=utf-8",
		"svg" => "image/svg+xml",
		"png" => "image/png",
		"jpg" | "jpeg" => "image/jpeg",
		"webp" => "image/webp",
		"ico" => "image/x-icon",
		_ => "application/octet-stream",
	}
}

fn build_response(
	status: StatusCode,
	content_type: &str,
	body: Vec<u8>,
) -> Response<Cow<'static, [u8]>> {
	Response::builder()
		.status(status)
		.header(CONTENT_TYPE, content_type)
		.body(Cow::Owned(body))
		.expect("falha ao montar resposta do protocolo")
}

fn asset_response(dist_dir: &Path, request: &Request<Vec<u8>>) -> Response<Cow<'static, [u8]>> {
	let raw_path = request.uri().path();
	let sanitized = sanitize_path(raw_path);
	let candidate = if sanitized.as_os_str().is_empty() {
		dist_dir.join("index.html")
	} else {
		dist_dir.join(&sanitized)
	};

	let final_path = if candidate.is_file() {
		candidate
	} else if sanitized.extension().is_none() {
		dist_dir.join("index.html")
	} else {
		candidate
	};

	match fs::read(&final_path) {
		Ok(bytes) => build_response(StatusCode::OK, content_type_for(&final_path), bytes),
		Err(_) => build_response(
			StatusCode::NOT_FOUND,
			"text/plain; charset=utf-8",
			b"asset not found".to_vec(),
		),
	}
}

fn to_js<T: Serialize>(value: &T) -> String {
	serde_json::to_string(value).unwrap_or_else(|_| "null".to_string())
}

fn resolve_script<T: Serialize>(id: &str, payload: &T) -> String {
	format!(
		"window.__BROTHER_HOST_INTERNAL__?.resolve({}, {});",
		to_js(&id),
		to_js(payload)
	)
}

fn reject_script(id: &str, error: &str) -> String {
	format!(
		"window.__BROTHER_HOST_INTERNAL__?.reject({}, {});",
		to_js(&id),
		to_js(&error)
	)
}

fn emit_script<T: Serialize>(event: &str, payload: &T) -> String {
	format!(
		"window.__BROTHER_HOST_INTERNAL__?.emit({}, {});",
		to_js(&event),
		to_js(payload)
	)
}

fn send_eval(proxy: &EventLoopProxy<UserEvent>, script: String) {
	let _ = proxy.send_event(UserEvent::Eval(script));
}

fn send_result<T: Serialize>(proxy: &EventLoopProxy<UserEvent>, id: String, result: Result<T, String>) {
	match result {
		Ok(value) => send_eval(proxy, resolve_script(&id, &value)),
		Err(error) => send_eval(proxy, reject_script(&id, &error)),
	}
}

fn parse_arg<T: serde::de::DeserializeOwned>(args: &Option<Value>, key: &str) -> Result<T, String> {
	let value = args
		.as_ref()
		.and_then(|payload| payload.get(key))
		.cloned()
		.ok_or_else(|| format!("Parâmetro ausente: {}", key))?;
	serde_json::from_value(value).map_err(|error| format!("Parâmetro inválido {}: {}", key, error))
}

fn handle_window_action(window: &Window, action: WindowAction) -> bool {
	match action {
		WindowAction::Minimize => {
			window.set_minimized(true);
			false
		}
		WindowAction::ToggleMaximize => {
			window.set_maximized(!window.is_maximized());
			false
		}
		WindowAction::Close => true,
		WindowAction::StartDrag => {
			let _ = window.drag_window();
			false
		}
	}
}

fn autostart_desktop_path() -> Option<PathBuf> {
	dirs::config_dir().map(|d| d.join("autostart").join("brother-assistant.desktop"))
}

fn get_autostart_enabled() -> bool {
	autostart_desktop_path()
		.map(|p| p.is_file())
		.unwrap_or(false)
}

fn set_autostart_enabled(enabled: bool) -> Result<bool, String> {
	let path = autostart_desktop_path()
		.ok_or_else(|| "Pasta de configuração não encontrada".to_string())?;

	if enabled {
		let exe = std::env::current_exe()
			.map_err(|e| format!("Não foi possível detectar o executável: {}", e))?;

		if let Some(parent) = path.parent() {
			fs::create_dir_all(parent)
				.map_err(|e| format!("Erro ao criar pasta autostart: {}", e))?;
		}

		let icon_path = dirs::data_dir()
			.unwrap_or_else(|| PathBuf::from("~/.local/share"))
			.join("icons")
			.join("brother-assistant.png");

		let content = format!(
			"[Desktop Entry]\nType=Application\nName=Brother Assistant\nExec={}\nIcon={}\nComment=Assistente IA Desktop\nX-GNOME-Autostart-enabled=true\nStartupNotify=false\n",
			exe.display(),
			icon_path.display()
		);

		fs::write(&path, content)
			.map_err(|e| format!("Erro ao criar autostart: {}", e))?;
	} else if path.is_file() {
		fs::remove_file(&path)
			.map_err(|e| format!("Erro ao remover autostart: {}", e))?;
	}

	Ok(enabled)
}

/// Read text content from a file (TXT, PDF, source code, etc.)
fn read_file_content(path: &str) -> Result<String, String> {
	let file_path = Path::new(path);
	if !file_path.is_file() {
		return Err(format!("Arquivo não encontrado: {}", path));
	}

	let ext = file_path.extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase();

	match ext.as_str() {
		"pdf" => read_pdf_text(file_path),
		"docx" => read_docx_text(file_path),
		_ => {
			// Try reading as UTF-8 text
			fs::read_to_string(file_path)
				.map_err(|e| format!("Erro ao ler arquivo: {}", e))
		}
	}
}

fn read_pdf_text(path: &Path) -> Result<String, String> {
	let doc = lopdf::Document::load(path)
		.map_err(|e| format!("Erro ao abrir PDF: {}", e))?;

	let mut text = String::new();
	let pages = doc.get_pages();
	for &page_id in pages.values() {
		if let Ok(content) = doc.extract_text(&[page_id.0]) {
			text.push_str(&content);
			text.push('\n');
		}
	}

	if text.trim().is_empty() {
		return Err("PDF não contém texto extraível (pode ser escaneado/imagem).".into());
	}

	Ok(text)
}

fn read_docx_text(path: &Path) -> Result<String, String> {
	// Simple DOCX reader: extract document.xml from the ZIP archive
	let file = fs::File::open(path).map_err(|e| format!("Erro ao abrir DOCX: {}", e))?;
	let mut archive = zip::ZipArchive::new(file)
		.map_err(|e| format!("Erro ao ler DOCX como ZIP: {}", e))?;

	let mut doc_xml = archive.by_name("word/document.xml")
		.map_err(|_| "Não encontrei word/document.xml no DOCX".to_string())?;

	let mut xml_content = String::new();
	std::io::Read::read_to_string(&mut doc_xml, &mut xml_content)
		.map_err(|e| format!("Erro ao ler XML do DOCX: {}", e))?;

	// Strip XML tags to get plain text
	let mut text = String::new();
	let mut in_tag = false;
	for ch in xml_content.chars() {
		if ch == '<' { in_tag = true; continue; }
		if ch == '>' { in_tag = false; continue; }
		if !in_tag { text.push(ch); }
	}

	Ok(text)
}

/// Search for files matching a pattern in common directories
fn search_files(query: &str, search_path: Option<&str>) -> Result<Vec<String>, String> {
	let base = search_path
		.map(PathBuf::from)
		.unwrap_or_else(|| dirs::home_dir().unwrap_or_else(|| PathBuf::from("/")));

	if !base.is_dir() {
		return Err(format!("Diretório não encontrado: {}", base.display()));
	}

	let pattern = format!("{}/**/*{}*", base.display(), query);
	let mut results: Vec<String> = Vec::new();

	for entry in glob::glob(&pattern).map_err(|e| format!("Padrão inválido: {}", e))? {
		if let Ok(path) = entry {
			results.push(path.display().to_string());
			if results.len() >= 50 { break; }
		}
	}

	Ok(results)
}

/// Read an image file and return base64 data URL
fn read_image_base64(path: &str) -> Result<String, String> {
	let file_path = Path::new(path);
	if !file_path.is_file() {
		return Err(format!("Imagem não encontrada: {}", path));
	}

	let ext = file_path.extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase();
	let mime = match ext.as_str() {
		"png" => "image/png",
		"jpg" | "jpeg" => "image/jpeg",
		"gif" => "image/gif",
		"webp" => "image/webp",
		"svg" => "image/svg+xml",
		"bmp" => "image/bmp",
		_ => return Err(format!("Formato de imagem não suportado: .{}", ext)),
	};

	let bytes = fs::read(file_path).map_err(|e| format!("Erro ao ler imagem: {}", e))?;
	let b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);
	Ok(format!("data:{};base64,{}", mime, b64))
}

fn handle_invoke(
	id: String,
	command: String,
	args: Option<Value>,
	proxy: EventLoopProxy<UserEvent>,
	runtime: &tokio::runtime::Runtime,
) {
	match command.as_str() {
		"get_settings_state" => {
			send_result(&proxy, id, Ok(settings_state_from_config(&load_config())));
		}
		"set_settings_state" => {
			let result = (|| {
				let update: SettingsUpdate = parse_arg(&args, "update")?;
				let mut config = load_config();
				apply_settings_update(&mut config, update);
				save_config(&config)?;
				Ok(settings_state_from_config(&config))
			})();
			send_result(&proxy, id, result);
		}
		"import_legacy_copilot_agent_config" => {
			let result = import_legacy_copilot_agent_config_inner().map(|config| settings_state_from_config(&config));
			send_result(&proxy, id, result);
		}
		"get_autostart" => {
			send_result(&proxy, id, Ok(get_autostart_enabled()));
		}
		"set_autostart" => {
			let enabled: bool = match parse_arg(&args, "enabled") {
				Ok(v) => v,
				Err(e) => { send_result::<bool>(&proxy, id, Err(e)); return; }
			};
			send_result(&proxy, id, set_autostart_enabled(enabled));
		}
		"read_file" => {
			let path: String = match parse_arg(&args, "path") {
				Ok(v) => v,
				Err(e) => { send_result::<String>(&proxy, id, Err(e)); return; }
			};
			send_result(&proxy, id, read_file_content(&path));
		}
		"search_files" => {
			let query: String = match parse_arg(&args, "query") {
				Ok(v) => v,
				Err(e) => { send_result::<Vec<String>>(&proxy, id, Err(e)); return; }
			};
			let search_path: Option<String> = args.as_ref()
				.and_then(|a| a.get("path"))
				.and_then(|v| v.as_str())
				.map(|s| s.to_string());
			send_result(&proxy, id, search_files(&query, search_path.as_deref()));
		}
		"read_image" => {
			let path: String = match parse_arg(&args, "path") {
				Ok(v) => v,
				Err(e) => { send_result::<String>(&proxy, id, Err(e)); return; }
			};
			send_result(&proxy, id, read_image_base64(&path));
		}
		"start_copilot_device_flow" => {
			let proxy_clone = proxy.clone();
			runtime.spawn(async move {
				let result = start_copilot_device_flow_impl().await;
				send_result(&proxy_clone, id, result);
			});
		}
		"complete_copilot_device_flow" => {
			let proxy_clone = proxy.clone();
			let device_code = match parse_arg::<String>(&args, "device_code") {
				Ok(value) => value,
				Err(error) => {
					send_result::<Value>(&proxy, id, Err(error));
					return;
				}
			};
			let interval = match parse_arg::<u64>(&args, "interval") {
				Ok(value) => value,
				Err(error) => {
					send_result::<Value>(&proxy, id, Err(error));
					return;
				}
			};
			let expires_in = match parse_arg::<u64>(&args, "expires_in") {
				Ok(value) => value,
				Err(error) => {
					send_result::<Value>(&proxy, id, Err(error));
					return;
				}
			};

			runtime.spawn(async move {
				let result = complete_copilot_device_flow_impl(device_code, interval, expires_in).await;
				send_result(&proxy_clone, id, result);
			});
		}
		"set_active_copilot_account" => {
			let result = (|| {
				let username: String = parse_arg(&args, "username")?;
				let mut config = load_config();
				if !config.copilot_accounts.contains_key(&username) {
					return Err("Conta Copilot não encontrada.".into());
				}
				config.active_copilot_account = Some(username);
				save_config(&config)?;
				Ok(settings_state_from_config(&config))
			})();
			send_result(&proxy, id, result);
		}
		"remove_copilot_account" => {
			let result = (|| {
				let username: String = parse_arg(&args, "username")?;
				let mut config = load_config();
				if config.copilot_accounts.remove(&username).is_none() {
					return Err("Conta Copilot não encontrada.".into());
				}
				if config.active_copilot_account.as_deref() == Some(username.as_str()) {
					config.active_copilot_account = config.copilot_accounts.keys().next().cloned();
				}
				clear_copilot_session_cache(&username);
				save_config(&config)?;
				Ok(settings_state_from_config(&config))
			})();
			send_result(&proxy, id, result);
		}
		"add_provider_account" => {
			let result = (|| {
				let provider: String = parse_arg(&args, "provider")?;
				let account_name: String = parse_arg(&args, "account_name")?;
				let api_key: String = parse_arg(&args, "api_key")?;
				let base_url: Option<String> = args
					.as_ref()
					.and_then(|payload| payload.get("base_url"))
					.cloned()
					.map(serde_json::from_value)
					.transpose()
					.map_err(|error| format!("Parâmetro inválido base_url: {}", error))?
					.flatten();

				if !provider_supports_accounts(&provider) {
					return Err("Esse provedor não suporta múltiplos tokens nesta tela.".into());
				}
				if api_key.trim().is_empty() {
					return Err("Informe a API key da conta.".into());
				}

				let mut config = load_config();
				let final_name = if account_name.trim().is_empty() {
					default_account_name(&config, &provider)
				} else {
					account_name.trim().to_string()
				};

				let store = config.provider_accounts.entry(provider.clone()).or_default();
				store.accounts.insert(
					final_name.clone(),
					ProviderAccount {
						api_key: api_key.trim().to_string(),
						base_url: base_url.unwrap_or_default().trim().to_string(),
						added_at: now_secs(),
						requests: store
							.accounts
							.get(&final_name)
							.map(|account| account.requests)
							.unwrap_or(0),
						total_tokens: store
							.accounts
							.get(&final_name)
							.map(|account| account.total_tokens)
							.unwrap_or(0),
					},
				);

				if store.active.is_none() {
					store.active = Some(final_name);
				}

				normalize_provider_account_group(&mut config, &provider);
				save_config(&config)?;
				Ok(settings_state_from_config(&config))
			})();
			send_result(&proxy, id, result);
		}
		"set_active_provider_account" => {
			let result = (|| {
				let provider: String = parse_arg(&args, "provider")?;
				let account_name: String = parse_arg(&args, "account_name")?;
				if !provider_supports_accounts(&provider) {
					return Err("Esse provedor não suporta múltiplos tokens nesta tela.".into());
				}

				let mut config = load_config();
				let store = config
					.provider_accounts
					.get_mut(&provider)
					.ok_or_else(|| "Provedor sem contas configuradas.".to_string())?;

				if !store.accounts.contains_key(&account_name) {
					return Err("Conta do provedor não encontrada.".into());
				}

				store.active = Some(account_name);
				normalize_provider_account_group(&mut config, &provider);
				save_config(&config)?;
				Ok(settings_state_from_config(&config))
			})();
			send_result(&proxy, id, result);
		}
		"remove_provider_account" => {
			let result = (|| {
				let provider: String = parse_arg(&args, "provider")?;
				let account_name: String = parse_arg(&args, "account_name")?;
				if !provider_supports_accounts(&provider) {
					return Err("Esse provedor não suporta múltiplos tokens nesta tela.".into());
				}

				let mut config = load_config();
				let store = config
					.provider_accounts
					.get_mut(&provider)
					.ok_or_else(|| "Provedor sem contas configuradas.".to_string())?;

				if store.accounts.remove(&account_name).is_none() {
					return Err("Conta do provedor não encontrada.".into());
				}

				if store.active.as_deref() == Some(account_name.as_str()) {
					store.active = store.accounts.keys().next().cloned();
				}

				normalize_provider_account_group(&mut config, &provider);
				save_config(&config)?;
				Ok(settings_state_from_config(&config))
			})();
			send_result(&proxy, id, result);
		}
		"chat_stream" => {
			let messages: Vec<ChatMessage> = match parse_arg(&args, "messages") {
				Ok(value) => value,
				Err(error) => {
					send_result::<Value>(&proxy, id, Err(error));
					return;
				}
			};

			let proxy_clone = proxy.clone();
			runtime.spawn(async move {
				let client = reqwest::Client::new();
				let mut config = load_config();
				let result = run_chat_request(
					&client,
					&mut config,
					&messages,
					DEFAULT_SYSTEM_PROMPT,
					DEFAULT_AGENT_PLANNER_PROMPT,
					|event| match event {
						ChatRuntimeEvent::Chunk(content) => {
							send_eval(&proxy_clone, emit_script("chat-stream-chunk", &content));
						}
						ChatRuntimeEvent::Done => {
							send_eval(&proxy_clone, emit_script("chat-stream-done", &Value::Null));
						}
					},
				)
				.await;

				match result {
					Ok(()) => send_eval(&proxy_clone, resolve_script(&id, &Value::Null)),
					Err(error) => send_eval(&proxy_clone, reject_script(&id, &error)),
				}
			});
		}
		_ => {
			send_result::<Value>(
				&proxy,
				id,
				Err(format!("Comando não suportado na shell Linux: {}", command)),
			);
		}
	}
}

fn create_webview(window: &Window, proxy: EventLoopProxy<UserEvent>) -> Result<WebView, String> {
	let dist_dir = Path::new(env!("CARGO_MANIFEST_DIR"))
		.parent()
		.unwrap_or_else(|| Path::new(env!("CARGO_MANIFEST_DIR")))
		.join("dist");

	if !dist_dir.join("index.html").is_file() {
		return Err(format!(
			"Build do frontend não encontrada em {}. Rode npm run build antes de abrir a shell Linux.",
			dist_dir.display()
		));
	}

	let asset_root = dist_dir.clone();
	let builder = WebViewBuilder::new()
		.with_custom_protocol("brother".into(), move |_webview_id, request| {
			asset_response(&asset_root, &request)
		})
		.with_devtools(cfg!(debug_assertions))
		.with_transparent(true)
		.with_initialization_script(INIT_SCRIPT)
		.with_ipc_handler(move |payload| {
			let _ = proxy.send_event(UserEvent::Ipc(payload.body().to_string()));
		})
		.with_url(SHELL_URL);

	#[cfg(target_os = "linux")]
	{
		let vbox = window
			.default_vbox()
			.ok_or_else(|| "A janela GTK da shell Linux não está disponível.".to_string())?;

		builder
			.build_gtk(vbox)
			.map_err(|error| error.to_string())
	}

	#[cfg(not(target_os = "linux"))]
	{
		builder.build(window).map_err(|error| error.to_string())
	}
}

fn main() {
	let runtime = tokio::runtime::Runtime::new().expect("falha ao iniciar runtime tokio da shell Linux");
	let event_loop = EventLoopBuilder::<UserEvent>::with_user_event().build();
	let proxy = event_loop.create_proxy();

	// Carregar ícone da janela
	let icon_bytes = include_bytes!("../icon.png");
	let icon_img = image::load_from_memory(icon_bytes).expect("falha ao decodificar ícone").into_rgba8();
	let (iw, ih) = icon_img.dimensions();
	let icon_rgba = icon_img.into_raw();
	let window_icon = Icon::from_rgba(icon_rgba.clone(), iw, ih).expect("falha ao criar ícone");

	let window = WindowBuilder::new()
		.with_title("Brother")
		.with_decorations(false)
		.with_inner_size(LogicalSize::new(400.0, 600.0))
		.with_min_inner_size(LogicalSize::new(340.0, 440.0))
		.with_window_icon(Some(window_icon))
		.build(&event_loop)
		.expect("falha ao criar janela Linux nativa");

	// Posicionar no canto inferior direito da tela
	let monitor = window
		.primary_monitor()
		.or_else(|| window.current_monitor())
		.or_else(|| window.available_monitors().next());
	if let Some(monitor) = monitor {
		let pos = monitor.position(); // posição do monitor em pixels físicos
		let screen = monitor.size();
		let scale = monitor.scale_factor();
		let sw = screen.width as f64 / scale;
		let sh = screen.height as f64 / scale;
		let mx = pos.x as f64 / scale;
		let my = pos.y as f64 / scale;
		let margin = 12.0;
		let taskbar_height = 48.0;
		window.set_outer_position(LogicalPosition::new(
			mx + sw - 400.0 - margin,
			my + sh - 600.0 - margin - taskbar_height,
		));
	}

	let webview = match create_webview(&window, proxy.clone()) {
		Ok(webview) => webview,
		Err(error) => panic!("{}", error),
	};

	// System tray
	let tray_menu = Menu::new();
	let show_item = MenuItem::new("Abrir Brother", true, None);
	let quit_item = MenuItem::new("Sair", true, None);
	let show_item_id = show_item.id().clone();
	let quit_item_id = quit_item.id().clone();
	let _ = tray_menu.append(&show_item);
	let _ = tray_menu.append(&quit_item);

	let tray_icon_data = tray_icon::Icon::from_rgba(icon_rgba, iw, ih).expect("falha ao criar ícone da tray");
	let tray = TrayIconBuilder::new()
		.with_icon(tray_icon_data)
		.with_menu(Box::new(tray_menu))
		.with_tooltip("Brother Assistant")
		.build()
		.expect("falha ao criar system tray");
	let tray = std::cell::RefCell::new(Some(tray));

	// Atalho global: Super + Shift + B
	let hotkey_manager = GlobalHotKeyManager::new().ok();
	let hotkey = HotKey::new(Some(Modifiers::SUPER | Modifiers::SHIFT), Code::KeyB);
	if let Some(ref manager) = hotkey_manager {
		let _ = manager.register(hotkey);
	}

	event_loop.run(move |event, _, control_flow| {
		*control_flow = ControlFlow::Wait;

		// Tray menu events
		if let Ok(event) = MenuEvent::receiver().try_recv() {
			if event.id() == &show_item_id {
				window.set_visible(true);
				window.set_focus();
			} else if event.id() == &quit_item_id {
				// Destruir tray antes de sair para remover o ícone da bandeja
				tray.borrow_mut().take();
				*control_flow = ControlFlow::Exit;
			}
		}

		// Global hotkey events (Super+Shift+B)
		if let Ok(_event) = GlobalHotKeyEvent::receiver().try_recv() {
			if window.is_visible() {
				window.set_visible(false);
			} else {
				window.set_visible(true);
				window.set_focus();
			}
		}

		match event {
			Event::UserEvent(UserEvent::Ipc(payload)) => {
				match serde_json::from_str::<IpcMessage>(&payload) {
					Ok(IpcMessage::Invoke { id, command, args }) => {
						handle_invoke(id, command, args, proxy.clone(), &runtime);
					}
					Ok(IpcMessage::WindowControl { action }) => {
						if handle_window_action(&window, action) {
							tray.borrow_mut().take();
							*control_flow = ControlFlow::Exit;
						}
					}
					Err(error) => {
						send_eval(
							&proxy,
							format!("console.error('IPC inválido:', {});", to_js(&error.to_string())),
						);
					}
				}
			},
			Event::UserEvent(UserEvent::Eval(script)) => {
				let _ = webview.evaluate_script(&script);
			}
			Event::WindowEvent {
				event: WindowEvent::CloseRequested,
				..
			} => {
				// Destruir tray antes de sair para remover o ícone da bandeja
				tray.borrow_mut().take();
				*control_flow = ControlFlow::Exit;
			}
			_ => {}
		}
	});
}
