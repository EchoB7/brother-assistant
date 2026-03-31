use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::process::Command;

use crate::chat::{
    build_messages_with_system, complete_copilot_once, complete_gemini_once,
    complete_openai_like_once, provider_token, provider_url, ChatMessage,
};
use crate::config::AppConfig;

#[derive(Debug, Clone)]
pub enum AgentAction {
    GetSystemInfo,
    CreateSimpleHtmlAndOpen,
    OpenUrl { url: String },
    OpenPath { path: PathBuf },
    SetWallpaper { path: PathBuf },
    // File operations
    CreateFile { path: PathBuf, content: String },
    EditFile { path: PathBuf, content: String },
    DeleteFile { path: PathBuf },
    // Directory operations
    CreateDir { path: PathBuf },
    MoveFile { from: PathBuf, to: PathBuf },
    RenameFile { from: PathBuf, to: PathBuf },
    ListDir { path: PathBuf },
    // App & search
    OpenApplication { name: String },
    WebSearch { query: String },
    OpenBrowserSearch { query: String },
}

#[derive(Debug, Serialize, Deserialize, Default)]
struct AgentPlan {
    mode: String,
    tool: Option<String>,
    #[serde(default)]
    arguments: serde_json::Value,
}

fn extract_json_object(text: &str) -> Option<String> {
    let trimmed = text.trim();
    if trimmed.starts_with('{') && trimmed.ends_with('}') {
        return Some(trimmed.to_string());
    }

    let without_fences = trimmed
        .trim_start_matches("```json")
        .trim_start_matches("```")
        .trim_end_matches("```")
        .trim();

    if without_fences.starts_with('{') && without_fences.ends_with('}') {
        return Some(without_fences.to_string());
    }

    let start = without_fences.find('{')?;
    let end = without_fences.rfind('}')?;
    Some(without_fences[start..=end].to_string())
}

fn parse_agent_plan(text: &str) -> Option<AgentPlan> {
    let json_text = extract_json_object(text)?;
    serde_json::from_str::<AgentPlan>(&json_text).ok()
}

fn agent_action_from_plan(plan: AgentPlan, original_input: &str) -> Option<AgentAction> {
    if plan.mode != "tool" {
        return None;
    }

    match plan.tool.as_deref()? {
        "get_system_info" => Some(AgentAction::GetSystemInfo),
        "create_simple_html_and_open" => Some(AgentAction::CreateSimpleHtmlAndOpen),
        "open_url" => plan
            .arguments
            .get("url")
            .and_then(|value| value.as_str())
            .map(|url| AgentAction::OpenUrl { url: url.to_string() })
            .or_else(|| detect_url(original_input).map(|url| AgentAction::OpenUrl { url })),
        "open_path" => plan
            .arguments
            .get("path")
            .and_then(|value| value.as_str())
            .map(PathBuf::from)
            .map(|path| AgentAction::OpenPath { path })
            .or_else(|| detect_absolute_file_path(original_input, &[".html", ".htm"]).map(|path| AgentAction::OpenPath { path })),
        "set_wallpaper" => plan
            .arguments
            .get("path")
            .and_then(|value| value.as_str())
            .map(PathBuf::from)
            .map(|path| AgentAction::SetWallpaper { path })
            .or_else(|| detect_absolute_file_path(original_input, &[".png", ".jpg", ".jpeg", ".webp"]).map(|path| AgentAction::SetWallpaper { path })),
        "create_file" => {
            let path = plan.arguments.get("path").and_then(|v| v.as_str()).map(PathBuf::from)?;
            let content = plan.arguments.get("content").and_then(|v| v.as_str()).unwrap_or("").to_string();
            Some(AgentAction::CreateFile { path, content })
        }
        "edit_file" => {
            let path = plan.arguments.get("path").and_then(|v| v.as_str()).map(PathBuf::from)?;
            let content = plan.arguments.get("content").and_then(|v| v.as_str()).unwrap_or("").to_string();
            Some(AgentAction::EditFile { path, content })
        }
        "delete_file" => {
            let path = plan.arguments.get("path").and_then(|v| v.as_str()).map(PathBuf::from)?;
            Some(AgentAction::DeleteFile { path })
        }
        "create_dir" => {
            let path = plan.arguments.get("path").and_then(|v| v.as_str()).map(PathBuf::from)?;
            Some(AgentAction::CreateDir { path })
        }
        "move_file" => {
            let from = plan.arguments.get("from").and_then(|v| v.as_str()).map(PathBuf::from)?;
            let to = plan.arguments.get("to").and_then(|v| v.as_str()).map(PathBuf::from)?;
            Some(AgentAction::MoveFile { from, to })
        }
        "rename_file" => {
            let from = plan.arguments.get("from").and_then(|v| v.as_str()).map(PathBuf::from)?;
            let to = plan.arguments.get("to").and_then(|v| v.as_str()).map(PathBuf::from)?;
            Some(AgentAction::RenameFile { from, to })
        }
        "list_dir" => {
            let path = plan.arguments.get("path").and_then(|v| v.as_str()).map(PathBuf::from)
                .unwrap_or_else(|| PathBuf::from(dirs::home_dir().unwrap_or_else(|| PathBuf::from("/"))));
            Some(AgentAction::ListDir { path })
        }
        "open_application" => {
            let name = plan.arguments.get("name").and_then(|v| v.as_str())?.to_string();
            Some(AgentAction::OpenApplication { name })
        }
        "web_search" => {
            let query = plan.arguments.get("query").and_then(|v| v.as_str())?.to_string();
            Some(AgentAction::WebSearch { query })
        }
        "open_browser_search" => {
            let query = plan.arguments.get("query").and_then(|v| v.as_str())?.to_string();
            Some(AgentAction::OpenBrowserSearch { query })
        }
        _ => None,
    }
}

fn run_command_capture(command: &str, args: &[&str]) -> Option<String> {
    let output = Command::new(command).args(args).output().ok()?;
    if !output.status.success() {
        return None;
    }
    let text = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if text.is_empty() {
        None
    } else {
        Some(text)
    }
}

fn read_proc_value(path: &str, field_names: &[&str]) -> Option<String> {
    let content = fs::read_to_string(path).ok()?;
    for line in content.lines() {
        for field in field_names {
            if let Some(value) = line.strip_prefix(field) {
                return Some(value.trim().trim_start_matches(':').trim().to_string());
            }
        }
    }
    None
}

fn read_meminfo_kib(field_name: &str) -> Option<u64> {
    let content = fs::read_to_string("/proc/meminfo").ok()?;
    for line in content.lines() {
        if let Some(value) = line.strip_prefix(field_name) {
            let numeric = value
                .trim()
                .trim_start_matches(':')
                .trim()
                .strip_suffix(" kB")
                .unwrap_or(value.trim())
                .trim();
            return numeric.parse::<u64>().ok();
        }
    }
    None
}

fn format_kib(kib: u64) -> String {
    const GIB: f64 = 1024.0 * 1024.0;
    const MIB: f64 = 1024.0;

    let kib_f64 = kib as f64;
    if kib_f64 >= GIB {
        format!("{:.1} GiB", kib_f64 / GIB)
    } else {
        format!("{:.0} MiB", kib_f64 / MIB)
    }
}

fn linux_cpu_info() -> String {
    read_proc_value("/proc/cpuinfo", &["model name", "Hardware", "Processor"])
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "CPU não identificada".to_string())
}

fn linux_memory_info() -> String {
    let Some(total_kib) = read_meminfo_kib("MemTotal") else {
        return "Memória não identificada".to_string();
    };

    let available_kib = read_meminfo_kib("MemAvailable").unwrap_or(0);
    let used_kib = total_kib.saturating_sub(available_kib);

    format!(
        "{} total / {} usada / {} disponível",
        format_kib(total_kib),
        format_kib(used_kib),
        format_kib(available_kib)
    )
}

pub fn collect_system_info() -> String {
    #[cfg(target_os = "linux")]
    {
        let os_info = run_command_capture("uname", &["-srmo"]).unwrap_or_else(|| "Linux".to_string());
        let cpu_info = linux_cpu_info();
        let cores = std::thread::available_parallelism()
            .map(|value| value.get().to_string())
            .unwrap_or_else(|_| "?".to_string());
        let memory = linux_memory_info();
        let disk = run_command_capture("sh", &["-c", "df -h / | awk 'NR==2 {print $2 \" total / \" $3 \" usado / \" $4 \" livre\"}'"])
            .unwrap_or_else(|| "Armazenamento não identificado".to_string());

        return format!(
            "## Dados do PC\n\n- Sistema: {}\n- CPU: {}\n- Núcleos lógicos: {}\n- Memória RAM: {}\n- Armazenamento (/): {}",
            os_info, cpu_info, cores, memory, disk
        );
    }

    #[cfg(not(target_os = "linux"))]
    {
        format!(
            "## Dados do PC\n\n- Sistema: {}\n- Arquitetura: {}",
            std::env::consts::OS,
            std::env::consts::ARCH
        )
    }
}

pub async fn plan_agent_action_with_model(
    client: &reqwest::Client,
    config: &mut AppConfig,
    messages: &[ChatMessage],
    planner_prompt: &str,
) -> Result<Option<AgentAction>, String> {
    let response_text = match config.provider.as_str() {
        "copilot" => complete_copilot_once(client, config, messages, planner_prompt).await?,
        "google" => complete_gemini_once(client, config, messages, planner_prompt).await?,
        _ => {
            let url = provider_url(config)?;
            let token = provider_token(config)?;
            let body = serde_json::json!({
                "model": config.model,
                "messages": build_messages_with_system(planner_prompt, messages),
                "stream": false,
                "temperature": 0,
            });
            let extra_headers = if config.provider == "openrouter" {
                vec![("HTTP-Referer", "https://localhost"), ("X-Title", "Brother Desktop")]
            } else {
                vec![]
            };
            complete_openai_like_once(client, &url, &token, body, &extra_headers).await?
        }
    };

    let Some(plan) = parse_agent_plan(&response_text) else {
        return Ok(None);
    };

    let original_input = messages
        .iter()
        .rev()
        .find(|message| message.role == "user")
        .map(|message| message.content.as_str())
        .unwrap_or_default();

    Ok(agent_action_from_plan(plan, original_input))
}

fn agent_output_dir() -> PathBuf {
    let dir = dirs::config_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("copilot-assistente")
        .join("agent-output");
    let _ = fs::create_dir_all(&dir);
    dir
}

pub fn detect_url(input: &str) -> Option<String> {
    input
        .split_whitespace()
        .find(|part| part.starts_with("http://") || part.starts_with("https://"))
        .map(|part| part.trim_matches(|c| c == '"' || c == '\'' || c == ',' || c == '.').to_string())
}

pub fn detect_absolute_file_path(input: &str, extensions: &[&str]) -> Option<PathBuf> {
    input.split_whitespace().find_map(|part| {
        let candidate = part.trim_matches(|c| c == '"' || c == '\'' || c == ',' || c == '.');
        if !candidate.starts_with('/') {
            return None;
        }
        let lower = candidate.to_lowercase();
        if !extensions.is_empty() && !extensions.iter().any(|ext| lower.ends_with(ext)) {
            return None;
        }
        Some(PathBuf::from(candidate))
    })
}

pub fn detect_agent_action(input: &str) -> Option<AgentAction> {
    let normalized = input.to_lowercase();
    let wants_browser = normalized.contains("navegador") || normalized.contains("browser");
    let wants_create = normalized.contains("crie") || normalized.contains("criar") || normalized.contains("gera") || normalized.contains("gerar");

    if wants_create && normalized.contains("html") && wants_browser {
        return Some(AgentAction::CreateSimpleHtmlAndOpen);
    }

    if wants_browser {
        // "abra o navegador e pesquise X"
        if normalized.contains("pesquis") || normalized.contains("busca") || normalized.contains("search") {
            let query = input.to_string();
            return Some(AgentAction::OpenBrowserSearch { query });
        }
        if let Some(url) = detect_url(input) {
            return Some(AgentAction::OpenUrl { url });
        }
        if let Some(path) = detect_absolute_file_path(input, &[".html", ".htm"]) {
            return Some(AgentAction::OpenPath { path });
        }
    }

    if normalized.contains("wallpaper") || normalized.contains("papel de parede") {
        if let Some(path) = detect_absolute_file_path(input, &[".png", ".jpg", ".jpeg", ".webp"]) {
            return Some(AgentAction::SetWallpaper { path });
        }
    }

    // Detect web search intent
    if normalized.contains("pesquis") || normalized.contains("busca") || normalized.contains("search")
       || normalized.contains("procur") {
        // If it contains a path, it might be file search - skip
        if !normalized.contains("/") {
            let query = input.to_string();
            return Some(AgentAction::WebSearch { query });
        }
    }

    // Detect open application intent
    if (normalized.contains("abr") || normalized.contains("inici") || normalized.contains("execut"))
       && (normalized.contains("aplicativ") || normalized.contains("programa") || normalized.contains("software")
           || normalized.contains("app ") || normalized.ends_with("app")) {
        let name = input.to_string();
        return Some(AgentAction::OpenApplication { name });
    }

    None
}

fn open_target(target: &str) -> Result<(), String> {
    #[cfg(target_os = "linux")]
    {
        Command::new("xdg-open")
            .arg(target)
            .spawn()
            .map_err(|e| format!("Falha ao abrir no navegador: {e}"))?;
        return Ok(());
    }

    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg(target)
            .spawn()
            .map_err(|e| format!("Falha ao abrir no navegador: {e}"))?;
        return Ok(());
    }

    #[cfg(target_os = "windows")]
    {
        Command::new("cmd")
            .args(["/C", "start", "", target])
            .spawn()
            .map_err(|e| format!("Falha ao abrir no navegador: {e}"))?;
        return Ok(());
    }

    #[allow(unreachable_code)]
    Err("Sistema operacional não suportado para abrir destino.".into())
}

fn create_simple_html_file() -> Result<PathBuf, String> {
    let output_dir = agent_output_dir();
    let path = output_dir.join("pagina-simples.html");
    let html = r#"<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Página Simples</title>
  <style>
    body {
      margin: 0;
      min-height: 100vh;
      display: grid;
      place-items: center;
      font-family: "Segoe UI", sans-serif;
      background: linear-gradient(135deg, #eff6ff, #f8fafc 55%, #e0e7ff);
      color: #0f172a;
    }
    main {
      width: min(92vw, 42rem);
      padding: 2.5rem;
      border-radius: 1.5rem;
      background: rgba(255, 255, 255, 0.82);
      box-shadow: 0 24px 60px rgba(15, 23, 42, 0.12);
      border: 1px solid rgba(148, 163, 184, 0.18);
      backdrop-filter: blur(18px);
    }
    h1 {
      margin: 0 0 0.75rem;
      font-size: clamp(2rem, 4vw, 3rem);
    }
    p {
      margin: 0;
      line-height: 1.7;
      color: #334155;
    }
  </style>
</head>
<body>
  <main>
    <h1>Bem-vindo!</h1>
    <p>Esta é uma página HTML simples criada automaticamente pelo modo agente do Brother Desktop.</p>
  </main>
</body>
</html>
"#;
    fs::write(&path, html).map_err(|e| format!("Falha ao criar HTML: {e}"))?;
    Ok(path)
}

fn set_wallpaper(path: &PathBuf) -> Result<(), String> {
    #[cfg(target_os = "linux")]
    {
        if !path.exists() {
            return Err("A imagem informada para wallpaper não existe.".into());
        }

        let uri = format!("file://{}", path.display());
        let status = Command::new("gsettings")
            .args(["set", "org.gnome.desktop.background", "picture-uri", &uri])
            .status()
            .map_err(|e| format!("Falha ao alterar wallpaper: {e}"))?;

        if !status.success() {
            return Err("Não foi possível alterar o wallpaper com gsettings.".into());
        }

        let _ = Command::new("gsettings")
            .args(["set", "org.gnome.desktop.background", "picture-uri-dark", &uri])
            .status();
        return Ok(());
    }

    #[allow(unreachable_code)]
    Err("Troca de wallpaper está implementada apenas para GNOME no Linux nesta versão.".into())
}

fn validate_path_safety(path: &PathBuf) -> Result<(), String> {
    let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("/home"));
    let canonical = if path.exists() {
        path.canonicalize().unwrap_or_else(|_| path.clone())
    } else {
        path.clone()
    };

    // Block operations on system dirs
    let blocked = ["/bin", "/sbin", "/usr", "/etc", "/boot", "/dev", "/proc", "/sys", "/var", "/lib", "/lib64"];
    let path_str = canonical.to_string_lossy();
    for b in &blocked {
        if path_str.starts_with(b) {
            return Err(format!("Operação bloqueada: caminho do sistema ({}).", b));
        }
    }

    // Must be inside /home or /tmp
    if !path_str.starts_with(home.to_string_lossy().as_ref()) && !path_str.starts_with("/tmp") {
        return Err("Operação bloqueada: só é permitido operar em caminhos dentro de /home ou /tmp.".into());
    }

    Ok(())
}

fn open_application_by_name(name: &str) -> Result<(), String> {
    #[cfg(target_os = "linux")]
    {
        let lower = name.to_lowercase();

        // Try direct command first (common names)
        let direct_names = [
            "firefox", "chromium", "google-chrome", "code", "nautilus", "gedit",
            "gnome-terminal", "vlc", "gimp", "libreoffice", "thunderbird",
            "spotify", "discord", "telegram-desktop", "steam",
        ];
        for cmd in &direct_names {
            if lower.contains(cmd) || cmd.contains(&lower) {
                Command::new(cmd)
                    .spawn()
                    .map_err(|e| format!("Falha ao abrir {}: {e}", cmd))?;
                return Ok(());
            }
        }

        // Search .desktop files for a match
        let dirs_to_search = [
            PathBuf::from("/usr/share/applications"),
            PathBuf::from("/usr/local/share/applications"),
            dirs::home_dir()
                .unwrap_or_else(|| PathBuf::from("/home"))
                .join(".local/share/applications"),
        ];

        for app_dir in &dirs_to_search {
            if let Ok(entries) = fs::read_dir(app_dir) {
                for entry in entries.flatten() {
                    let path = entry.path();
                    if path.extension().and_then(|e| e.to_str()) != Some("desktop") {
                        continue;
                    }
                    if let Ok(content) = fs::read_to_string(&path) {
                        let desktop_name = content.lines()
                            .find(|l| l.starts_with("Name="))
                            .map(|l| l.trim_start_matches("Name=").to_lowercase())
                            .unwrap_or_default();

                        if desktop_name.contains(&lower) || lower.contains(&desktop_name) {
                            // Found a match - launch via gtk-launch or xdg-open
                            let desktop_file = path.file_stem()
                                .and_then(|s| s.to_str())
                                .unwrap_or_default();
                            let status = Command::new("gtk-launch")
                                .arg(desktop_file)
                                .spawn();
                            if status.is_ok() {
                                return Ok(());
                            }
                        }
                    }
                }
            }
        }

        return Err(format!("Não encontrei o aplicativo '{}'. Tente o nome exato do comando.", name));
    }

    #[allow(unreachable_code)]
    Err("Abrir aplicativos está implementado apenas para Linux nesta versão.".into())
}

async fn fetch_web_search_results(query: &str) -> Result<String, String> {
    let encoded = urlencoding::encode(query);
    let url = format!("https://html.duckduckgo.com/html/?q={}", encoded);
    let client = reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| format!("Falha ao criar HTTP client: {e}"))?;
    let resp = client.get(&url)
        .send()
        .await
        .map_err(|e| format!("Falha na pesquisa web: {e}"))?;
    let html = resp.text().await.map_err(|e| format!("Falha ao ler resposta: {e}"))?;

    // Parse results from DuckDuckGo HTML
    let mut results = Vec::new();
    for chunk in html.split("class=\"result__a\"") {
        if results.len() >= 8 { break; }
        if results.is_empty() && !html.contains("result__a") { break; }
        // Extract href
        let _href = chunk.split("href=\"").nth(0)
            .and_then(|_| chunk.split("href=\"").nth(0))
            .unwrap_or_default();
        // Better: find the link text
        if let Some(after_tag) = chunk.split('>').nth(0) {
            let _ = after_tag; // skip first part
        }
        // Extract text between > and </a>
        let title = chunk.split('>').nth(1)
            .and_then(|s| s.split('<').next())
            .unwrap_or_default()
            .trim();
        // Extract snippet from result__snippet
        let snippet = chunk.split("result__snippet").nth(1)
            .and_then(|s| s.split('>').nth(1))
            .and_then(|s| s.split('<').next())
            .unwrap_or_default()
            .trim();
        if !title.is_empty() {
            results.push(format!("**{}**\n{}", title, snippet));
        }
    }

    // Fallback: extract any <a class="result__a"> text more simply
    if results.is_empty() {
        // Try simpler extraction
        for part in html.split("result__body") {
            if results.len() >= 8 { break; }
            let text: String = part.split('<').next().unwrap_or_default()
                .chars().filter(|c| !c.is_control()).collect();
            let clean = text.trim();
            if clean.len() > 20 {
                results.push(clean.to_string());
            }
        }
    }

    if results.is_empty() {
        Ok(format!("Não encontrei resultados para '{}'.", query))
    } else {
        Ok(format!("Resultados da pesquisa para '{}':\n\n{}", query, results.join("\n\n")))
    }
}

pub async fn execute_agent_action(action: &AgentAction) -> Result<String, String> {
    match action {
        AgentAction::GetSystemInfo => Ok(collect_system_info()),
        AgentAction::CreateSimpleHtmlAndOpen => {
            let file_path = create_simple_html_file()?;
            open_target(file_path.to_string_lossy().as_ref())?;
            Ok(format!(
                "Modo agente: criei uma página HTML simples em {} e abri no navegador.",
                file_path.display()
            ))
        }
        AgentAction::OpenUrl { url } => {
            open_target(url)?;
            Ok(format!("Modo agente: abri {} no navegador.", url))
        }
        AgentAction::OpenPath { path } => {
            if !path.exists() {
                return Err("O arquivo solicitado para abrir no navegador não existe.".into());
            }
            open_target(path.to_string_lossy().as_ref())?;
            Ok(format!("Modo agente: abri {} no navegador.", path.display()))
        }
        AgentAction::SetWallpaper { path } => {
            set_wallpaper(path)?;
            Ok(format!("Modo agente: alterei o wallpaper usando a imagem {}.", path.display()))
        }
        AgentAction::CreateFile { path, content } => {
            // Security: block paths outside home
            validate_path_safety(path)?;
            if let Some(parent) = path.parent() {
                let _ = fs::create_dir_all(parent);
            }
            fs::write(path, content).map_err(|e| format!("Falha ao criar arquivo: {e}"))?;
            Ok(format!("Modo agente: criei o arquivo {}.", path.display()))
        }
        AgentAction::EditFile { path, content } => {
            validate_path_safety(path)?;
            if !path.exists() {
                return Err(format!("O arquivo {} não existe.", path.display()));
            }
            fs::write(path, content).map_err(|e| format!("Falha ao editar arquivo: {e}"))?;
            Ok(format!("Modo agente: editei o arquivo {}.", path.display()))
        }
        AgentAction::DeleteFile { path } => {
            validate_path_safety(path)?;
            if !path.exists() {
                return Err(format!("O arquivo/diretório {} não existe.", path.display()));
            }
            if path.is_dir() {
                fs::remove_dir_all(path).map_err(|e| format!("Falha ao remover diretório: {e}"))?;
            } else {
                fs::remove_file(path).map_err(|e| format!("Falha ao remover arquivo: {e}"))?;
            }
            Ok(format!("Modo agente: removi {}.", path.display()))
        }
        AgentAction::CreateDir { path } => {
            validate_path_safety(path)?;
            fs::create_dir_all(path).map_err(|e| format!("Falha ao criar diretório: {e}"))?;
            Ok(format!("Modo agente: criei o diretório {}.", path.display()))
        }
        AgentAction::MoveFile { from, to } => {
            validate_path_safety(from)?;
            validate_path_safety(to)?;
            if !from.exists() {
                return Err(format!("O caminho {} não existe.", from.display()));
            }
            if let Some(parent) = to.parent() {
                let _ = fs::create_dir_all(parent);
            }
            fs::rename(from, to).map_err(|e| format!("Falha ao mover: {e}"))?;
            Ok(format!("Modo agente: movi {} para {}.", from.display(), to.display()))
        }
        AgentAction::RenameFile { from, to } => {
            validate_path_safety(from)?;
            validate_path_safety(to)?;
            if !from.exists() {
                return Err(format!("O caminho {} não existe.", from.display()));
            }
            fs::rename(from, to).map_err(|e| format!("Falha ao renomear: {e}"))?;
            Ok(format!("Modo agente: renomeei {} para {}.", from.display(), to.display()))
        }
        AgentAction::ListDir { path } => {
            if !path.exists() || !path.is_dir() {
                return Err(format!("O diretório {} não existe.", path.display()));
            }
            let mut entries: Vec<String> = Vec::new();
            let read = fs::read_dir(path).map_err(|e| format!("Falha ao listar diretório: {e}"))?;
            for entry in read.flatten() {
                let name = entry.file_name().to_string_lossy().to_string();
                let file_type = entry.file_type().ok();
                let suffix = if file_type.map(|t| t.is_dir()).unwrap_or(false) { "/" } else { "" };
                entries.push(format!("{}{}", name, suffix));
            }
            entries.sort();
            let listing = if entries.is_empty() {
                "(diretório vazio)".to_string()
            } else {
                entries.join("\n")
            };
            Ok(format!("Modo agente: conteúdo de {}:\n\n```\n{}\n```", path.display(), listing))
        }
        AgentAction::OpenApplication { name } => {
            open_application_by_name(name)?;
            Ok(format!("Modo agente: abri o aplicativo '{}'.", name))
        }
        AgentAction::WebSearch { query } => {
            let search_results = fetch_web_search_results(query).await?;
            Ok(search_results)
        }
        AgentAction::OpenBrowserSearch { query } => {
            let encoded = urlencoding::encode(query);
            let url = format!("https://www.google.com/search?q={}", encoded);
            open_target(&url)?;
            Ok(format!("Modo agente: abri o navegador com a pesquisa '{}'.", query))
        }
    }
}