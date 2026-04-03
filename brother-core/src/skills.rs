use std::collections::HashSet;
use std::env;
use std::fs;
use std::path::{Path, PathBuf};

use crate::chat::ChatMessage;
use serde::{Deserialize, Serialize};

const MAX_SKILLS_IN_PROMPT: usize = 12;
const MAX_REMOTE_SKILL_RESULTS: usize = 24;
const OPENCLAW_REPO: &str = "openclaw/openclaw";
const OPENCLAW_SKILLS_API: &str = "https://api.github.com/repos/openclaw/openclaw/contents/skills";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SkillSecurity {
    pub version: String,
    pub source: String,
    pub tools: Vec<String>,
    pub permissions: Vec<String>,
    pub install_required: bool,
    pub requires_approval: bool,
    pub auto_activate: bool,
}

impl Default for SkillSecurity {
    fn default() -> Self {
        Self {
            version: "1".to_string(),
            source: "local".to_string(),
            tools: Vec::new(),
            permissions: Vec::new(),
            install_required: false,
            requires_approval: false,
            auto_activate: true,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SkillDefinition {
    pub name: String,
    pub description: String,
    pub instructions: String,
    pub file_path: PathBuf,
    pub keywords: Vec<String>,
    pub security: SkillSecurity,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SkillCatalogEntry {
    pub name: String,
    pub description: String,
    pub version: String,
    pub source: String,
    pub repo: Option<String>,
    pub remote_path: Option<String>,
    pub file_path: Option<String>,
    pub keywords: Vec<String>,
    pub tools: Vec<String>,
    pub permissions: Vec<String>,
    pub install_required: bool,
    pub requires_approval: bool,
    pub auto_activate: bool,
    pub installed: bool,
}

#[derive(Debug, Deserialize)]
struct GithubContentEntry {
    name: String,
    path: String,
    #[serde(rename = "type")]
    kind: String,
    download_url: Option<String>,
}

pub fn user_skills_dir() -> PathBuf {
    dirs::config_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("copilot-assistente")
        .join("skills")
}

fn unique_existing_dirs(paths: Vec<PathBuf>) -> Vec<PathBuf> {
    let mut seen = HashSet::new();
    let mut dirs = Vec::new();

    for path in paths {
        let normalized = path.to_string_lossy().to_string();
        if !seen.insert(normalized) {
            continue;
        }
        if path.is_dir() {
            dirs.push(path);
        }
    }

    dirs
}

fn candidate_skill_dirs() -> Vec<PathBuf> {
    let mut dirs = Vec::new();

    if let Ok(value) = env::var("BROTHER_SKILLS_DIR") {
        let custom = PathBuf::from(value);
        dirs.push(custom.clone());
        dirs.push(custom.join("skills"));
    }

    dirs.push(user_skills_dir());

    if let Ok(current_dir) = env::current_dir() {
        dirs.push(current_dir.join("skills"));
    }

    if let Ok(executable) = env::current_exe() {
        if let Some(parent) = executable.parent() {
            dirs.push(parent.join("skills"));
            if let Some(grandparent) = parent.parent() {
                dirs.push(grandparent.join("skills"));
            }
        }
    }

    unique_existing_dirs(dirs)
}

fn parse_list_field(value: &str) -> Vec<String> {
    value
        .split(',')
        .map(|item| item.trim().trim_matches('"').trim_matches('\''))
        .filter(|item| !item.is_empty())
        .map(|item| item.to_string())
        .collect()
}

fn parse_bool_field(value: &str) -> bool {
    matches!(
        value.trim().trim_matches('"').trim_matches('\'').to_ascii_lowercase().as_str(),
        "true" | "1" | "yes" | "sim" | "on"
    )
}

fn safe_default_source(file_path: &Path) -> String {
    let path = file_path.to_string_lossy();
    if path.contains(".config/copilot-assistente/skills") {
        return "user".to_string();
    }
    if path.contains("/skills/") {
        return "workspace".to_string();
    }
    "local".to_string()
}

fn parse_metadata_field(value: &str, security: &mut SkillSecurity, keywords: &mut Vec<String>) {
    let value = value.trim();
    let Ok(metadata) = serde_json::from_str::<serde_json::Value>(value) else {
        return;
    };

    let brother = metadata.get("brother").unwrap_or(&metadata);

    if let Some(version) = brother.get("version").and_then(|v| v.as_str()) {
        security.version = version.to_string();
    }
    if let Some(source) = brother.get("source").and_then(|v| v.as_str()) {
        security.source = source.to_string();
    }
    if let Some(tools) = brother.get("tools").and_then(|v| v.as_array()) {
        security.tools.extend(
            tools
                .iter()
                .filter_map(|item| item.as_str())
                .map(|item| item.to_string()),
        );
    }
    if let Some(permissions) = brother.get("permissions").and_then(|v| v.as_array()) {
        security.permissions.extend(
            permissions
                .iter()
                .filter_map(|item| item.as_str())
                .map(|item| item.to_string()),
        );
    }
    if let Some(install_required) = brother.get("installRequired").and_then(|v| v.as_bool()) {
        security.install_required = install_required;
    }
    if let Some(requires_approval) = brother.get("requiresApproval").and_then(|v| v.as_bool()) {
        security.requires_approval = requires_approval;
    }
    if let Some(auto_activate) = brother.get("autoActivate").and_then(|v| v.as_bool()) {
        security.auto_activate = auto_activate;
    }
    if let Some(keyword_values) = brother.get("keywords").and_then(|v| v.as_array()) {
        keyword_values
            .iter()
            .filter_map(|item| item.as_str())
            .for_each(|item| {
                keywords.push(item.to_string());
        });
    }
}

fn fallback_skill_name(file_path: &Path) -> Option<String> {
    file_path
        .parent()
        .and_then(|parent| parent.file_name())
        .and_then(|name| name.to_str())
        .map(|name| name.trim().to_string())
        .filter(|name| !name.is_empty())
}

fn fallback_description_and_instructions(body: &str) -> (Option<String>, String) {
    let mut description = None;
    let mut instructions = String::new();

    for line in body.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            if !instructions.is_empty() && !instructions.ends_with("\n\n") {
                instructions.push('\n');
            }
            continue;
        }

        if description.is_none() && !trimmed.starts_with('#') {
            description = Some(trimmed.to_string());
        }

        instructions.push_str(line);
        instructions.push('\n');
    }

    (description, instructions.trim().to_string())
}

fn parse_skill_markdown(content: &str, file_path: &Path) -> Option<SkillDefinition> {
    let trimmed = content.trim();
    let (frontmatter, body) = if let Some(remainder) = trimmed.strip_prefix("---\n") {
        if let Some(frontmatter_end) = remainder.find("\n---\n") {
            (&remainder[..frontmatter_end], remainder[frontmatter_end + 5..].trim())
        } else {
            ("", trimmed)
        }
    } else {
        ("", trimmed)
    };

    if body.is_empty() {
        return None;
    }

    let mut name = None;
    let mut description = None;
    let mut keywords = Vec::new();
    let mut security = SkillSecurity {
        source: safe_default_source(file_path),
        ..SkillSecurity::default()
    };

    for line in frontmatter.lines() {
        let Some((raw_key, raw_value)) = line.split_once(':') else {
            continue;
        };

        let key = raw_key.trim();
        let value = raw_value.trim();
        match key {
            "name" => name = Some(value.trim_matches('"').trim_matches('\'').to_string()),
            "description" => {
                description = Some(value.trim_matches('"').trim_matches('\'').to_string())
            }
            "keywords" | "triggers" => keywords.extend(parse_list_field(value)),
            "tools" => security.tools.extend(parse_list_field(value)),
            "metadata" => parse_metadata_field(value, &mut security, &mut keywords),
            "disable-model-invocation" => {
                if parse_bool_field(value) {
                    security.auto_activate = false;
                    security.requires_approval = true;
                }
            }
            _ => {}
        }
    }

    let (fallback_description, fallback_instructions) = fallback_description_and_instructions(body);
    if name.as_deref().map(|value| value.trim().is_empty()).unwrap_or(true) {
        name = fallback_skill_name(file_path);
    }
    if description.as_deref().map(|value| value.trim().is_empty()).unwrap_or(true) {
        description = fallback_description;
    }

    let name = name?.trim().to_string();
    let description = description?.trim().to_string();
    if name.is_empty() || description.is_empty() {
        return None;
    }

    if security.version.trim().is_empty() {
        security.version = "1".to_string();
    }
    if security.source.trim().is_empty() {
        security.source = safe_default_source(file_path);
    }

    if security.install_required || !security.permissions.is_empty() {
        security.requires_approval = true;
    }

    Some(SkillDefinition {
        name,
        description,
        instructions: if fallback_instructions.is_empty() {
            body.to_string()
        } else {
            fallback_instructions
        },
        file_path: file_path.to_path_buf(),
        keywords,
        security,
    })
}

fn load_skill_from_dir(skill_dir: &Path) -> Option<SkillDefinition> {
    let file_path = skill_dir.join("SKILL.md");
    let content = fs::read_to_string(&file_path).ok()?;
    parse_skill_markdown(&content, &file_path)
}

fn skill_to_catalog_entry(skill: &SkillDefinition, installed: bool) -> SkillCatalogEntry {
    SkillCatalogEntry {
        name: skill.name.clone(),
        description: skill.description.clone(),
        version: skill.security.version.clone(),
        source: skill.security.source.clone(),
        repo: if skill.security.source == "openclaw" {
            Some(OPENCLAW_REPO.to_string())
        } else {
            None
        },
        remote_path: if skill.security.source == "openclaw" {
            Some(format!("skills/{}", skill.name))
        } else {
            None
        },
        file_path: Some(skill.file_path.display().to_string()),
        keywords: skill.keywords.clone(),
        tools: skill.security.tools.clone(),
        permissions: skill.security.permissions.clone(),
        install_required: skill.security.install_required,
        requires_approval: skill.security.requires_approval,
        auto_activate: skill.security.auto_activate,
        installed,
    }
}

pub fn installed_skill_summaries() -> Vec<SkillCatalogEntry> {
    discover_skills()
        .into_iter()
        .map(|skill| skill_to_catalog_entry(&skill, true))
        .collect()
}

pub fn discover_skills() -> Vec<SkillDefinition> {
    let mut skills = Vec::new();
    let mut seen_names = HashSet::new();

    for root in candidate_skill_dirs() {
        let Ok(entries) = fs::read_dir(root) else {
            continue;
        };

        for entry in entries.flatten() {
            let Ok(file_type) = entry.file_type() else {
                continue;
            };
            if !file_type.is_dir() {
                continue;
            }

            if let Some(skill) = load_skill_from_dir(&entry.path()) {
                if seen_names.insert(skill.name.clone()) {
                    skills.push(skill);
                }
            }
        }
    }

    skills.sort_by(|left, right| left.name.cmp(&right.name));
    skills
}

fn sanitize_skill_slug(value: &str) -> Option<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return None;
    }

    if trimmed
        .chars()
        .all(|ch| ch.is_ascii_alphanumeric() || ch == '-' || ch == '_')
    {
        Some(trimmed.to_string())
    } else {
        None
    }
}

fn skill_name_set(skills: &[SkillDefinition]) -> HashSet<String> {
    skills.iter().map(|skill| skill.name.clone()).collect()
}

async fn github_json<T: for<'de> Deserialize<'de>>(
    client: &reqwest::Client,
    url: &str,
) -> Result<T, String> {
    let response = client
        .get(url)
        .send()
        .await
        .map_err(|error| format!("Falha ao consultar o catálogo remoto: {error}"))?;
    let response = response
        .error_for_status()
        .map_err(|error| format!("Catálogo remoto respondeu com erro: {error}"))?;

    response
        .json::<T>()
        .await
        .map_err(|error| format!("Falha ao decodificar resposta remota: {error}"))
}

async fn github_text(client: &reqwest::Client, url: &str) -> Result<String, String> {
    let response = client
        .get(url)
        .send()
        .await
        .map_err(|error| format!("Falha ao baixar skill remota: {error}"))?;
    let response = response
        .error_for_status()
        .map_err(|error| format!("Skill remota não pôde ser lida: {error}"))?;

    response
        .text()
        .await
        .map_err(|error| format!("Falha ao ler skill remota: {error}"))
}

async fn github_bytes(client: &reqwest::Client, url: &str) -> Result<Vec<u8>, String> {
    let response = client
        .get(url)
        .send()
        .await
        .map_err(|error| format!("Falha ao baixar arquivo da skill: {error}"))?;
    let response = response
        .error_for_status()
        .map_err(|error| format!("Arquivo remoto não pôde ser baixado: {error}"))?;

    response
        .bytes()
        .await
        .map(|bytes| bytes.to_vec())
        .map_err(|error| format!("Falha ao ler bytes da skill: {error}"))
}

fn openclaw_skill_markdown_url(skill_name: &str) -> String {
    format!(
        "https://raw.githubusercontent.com/openclaw/openclaw/main/skills/{skill_name}/SKILL.md"
    )
}

fn is_safe_child_name(name: &str) -> bool {
    !name.is_empty()
        && !name.contains('/')
        && !name.contains('\\')
        && name != "."
        && name != ".."
}

async fn fetch_openclaw_skill(
    client: &reqwest::Client,
    skill_name: &str,
) -> Result<SkillDefinition, String> {
    let content = github_text(client, &openclaw_skill_markdown_url(skill_name)).await?;
    let virtual_path = PathBuf::from(format!("openclaw/{skill_name}/SKILL.md"));
    let mut skill = parse_skill_markdown(&content, &virtual_path)
        .ok_or_else(|| format!("Skill remota inválida: {skill_name}"))?;
    skill.file_path = virtual_path;
    skill.security.source = "openclaw".to_string();
    skill.security.install_required = false;
    Ok(skill)
}

fn remote_skill_score(skill: &SkillDefinition, query: &str) -> usize {
    let trimmed = query.trim();
    if trimmed.is_empty() {
        return 1;
    }

    let lowered = trimmed.to_lowercase();
    let metadata_context = format!(
        "{} {} {}",
        skill.name,
        skill.description,
        skill.keywords.join(" ")
    );
    let remote_context = format!(
        "{} {} {} {}",
        skill.name,
        skill.description,
        skill.keywords.join(" "),
        skill.instructions
    );
    let query_tokens = tokenize(trimmed);
    let metadata_tokens = tokenize(&metadata_context);
    let context_tokens = tokenize(&remote_context);
    let mut base_score = query_tokens.intersection(&context_tokens).count() + skill_match_score(skill, trimmed);
    let contains_match = skill.name.to_lowercase().contains(&lowered)
        || skill.description.to_lowercase().contains(&lowered)
        || skill.instructions.to_lowercase().contains(&lowered)
        || skill
            .keywords
            .iter()
            .any(|keyword| keyword.to_lowercase().contains(&lowered));

    let web_intent = query_tokens.contains("web")
        || lowered.contains("browser")
        || lowered.contains("chrome")
        || lowered.contains("chromium")
        || lowered.contains("navegador")
        || lowered.contains("site")
        || lowered.contains("url");

    if web_intent {
        const WEB_HINTS: &[&str] = &["web", "url", "html", "page", "site", "browser", "canvas"];
        let metadata_hint_count = WEB_HINTS
            .iter()
            .filter(|hint| metadata_tokens.contains(**hint))
            .count();
        let instruction_hint_count = WEB_HINTS
            .iter()
            .filter(|hint| context_tokens.contains(**hint))
            .count();

        if metadata_hint_count > 0 {
            base_score += 4 + metadata_hint_count;
        } else if instruction_hint_count > 0 {
            base_score += 1;
        } else {
            return 0;
        }

        if skill.name.contains("url") || skill.name.contains("canvas") {
            base_score += 3;
        }
    }

    if contains_match {
        base_score + 3
    } else {
        base_score
    }
}

pub async fn search_openclaw_skills(query: &str) -> Result<Vec<SkillCatalogEntry>, String> {
    let client = reqwest::Client::builder()
        .user_agent("Brother Assistant")
        .build()
        .map_err(|error| format!("Falha ao iniciar cliente HTTP: {error}"))?;

    let installed_names = skill_name_set(&discover_skills());
    let entries: Vec<GithubContentEntry> = github_json(&client, OPENCLAW_SKILLS_API).await?;
    let mut scored = Vec::new();

    for entry in entries.into_iter().filter(|entry| entry.kind == "dir") {
        let Ok(skill) = fetch_openclaw_skill(&client, &entry.name).await else {
            continue;
        };

        let score = remote_skill_score(&skill, query);
        if query.trim().is_empty() || score > 0 {
            scored.push((score, skill));
        }
    }

    scored.sort_by(|left, right| {
        right
            .0
            .cmp(&left.0)
            .then_with(|| left.1.name.cmp(&right.1.name))
    });

    Ok(scored
        .into_iter()
        .take(MAX_REMOTE_SKILL_RESULTS)
        .map(|(_, skill)| {
            let mut entry = skill_to_catalog_entry(&skill, installed_names.contains(&skill.name));
            entry.repo = Some(OPENCLAW_REPO.to_string());
            entry.remote_path = Some(format!("skills/{}", skill.name));
            entry.file_path = None;
            entry
        })
        .collect())
}

pub async fn install_openclaw_skill(skill_name: &str) -> Result<SkillCatalogEntry, String> {
    let skill_name = sanitize_skill_slug(skill_name)
        .ok_or_else(|| "Nome de skill inválido para instalação.".to_string())?;
    let client = reqwest::Client::builder()
        .user_agent("Brother Assistant")
        .build()
        .map_err(|error| format!("Falha ao iniciar cliente HTTP: {error}"))?;

    let root_dir = user_skills_dir();
    let target_dir = root_dir.join(&skill_name);
    fs::create_dir_all(&target_dir)
        .map_err(|error| format!("Falha ao preparar diretório da skill: {error}"))?;

    let mut pending = vec![(format!("skills/{skill_name}"), target_dir.clone())];
    while let Some((remote_path, local_dir)) = pending.pop() {
        fs::create_dir_all(&local_dir)
            .map_err(|error| format!("Falha ao preparar subdiretório da skill: {error}"))?;

        let url = format!(
            "https://api.github.com/repos/openclaw/openclaw/contents/{remote_path}"
        );
        let entries: Vec<GithubContentEntry> = github_json(&client, &url).await?;

        for entry in entries {
            if !is_safe_child_name(&entry.name) {
                continue;
            }

            let destination = local_dir.join(&entry.name);
            match entry.kind.as_str() {
                "dir" => pending.push((entry.path, destination)),
                "file" => {
                    let download_url = entry
                        .download_url
                        .ok_or_else(|| format!("Arquivo remoto sem URL de download: {}", entry.path))?;
                    let bytes = github_bytes(&client, &download_url).await?;
                    fs::write(&destination, bytes)
                        .map_err(|error| format!("Falha ao gravar arquivo da skill: {error}"))?;
                }
                _ => {}
            }
        }
    }

    let skill = load_skill_from_dir(&target_dir)
        .ok_or_else(|| "A skill instalada não possui um SKILL.md válido.".to_string())?;
    Ok(skill_to_catalog_entry(&skill, true))
}

fn tokenize(text: &str) -> HashSet<String> {
    const STOPWORDS: &[&str] = &[
        "the", "and", "para", "com", "que", "uma", "por", "from", "with", "this",
        "that", "then", "else",
    ];

    fn canonical_token(token: &str) -> String {
        match token {
            "abra" | "abre" | "abrir" | "abrindo" | "abriria" | "open" | "opens" => {
                "abrir".to_string()
            }
            "inicie" | "inicia" | "iniciar" | "iniciando" | "execute" | "executa"
            | "executar" | "launch" | "launche" => "executar".to_string(),
            "browser" | "browse" | "browsing" | "web" | "website" | "webpage" | "site"
            | "sites" | "page" | "pages" | "url" | "urls" | "http" | "https" | "chrome"
            | "chromium" | "navegador" => {
                "web".to_string()
            }
            "search" | "searching" | "find" | "lookup" | "query" => "buscar".to_string(),
            "app" | "apps" | "aplicativo" | "aplicativos" | "programa" | "programas"
            | "software" | "softwares" => "programa".to_string(),
            other if other.ends_with('s') && other.len() > 4 => other[..other.len() - 1].to_string(),
            other => other.to_string(),
        }
    }

    text.to_lowercase()
        .split(|ch: char| !ch.is_alphanumeric())
        .filter(|token| token.len() >= 3)
        .filter(|token| !STOPWORDS.contains(token))
        .map(canonical_token)
        .collect()
}

fn skill_match_score(skill: &SkillDefinition, user_input: &str) -> usize {
    let normalized_input = user_input.to_lowercase();
    let user_tokens = tokenize(user_input);
    let metadata = format!(
        "{} {} {}",
        skill.name,
        skill.description,
        skill.keywords.join(" ")
    );
    let skill_tokens = tokenize(&metadata);

    let mut score = user_tokens.intersection(&skill_tokens).count();
    let exact_name = skill.name.replace('-', " ").to_lowercase();
    if !exact_name.is_empty() && normalized_input.contains(&exact_name) {
        score += 4;
    }

    for keyword in &skill.keywords {
        let keyword = keyword.trim().to_lowercase();
        let keyword_tokens = tokenize(&keyword);
        let keyword_matches = !keyword_tokens.is_empty() && keyword_tokens.is_subset(&user_tokens);
        if (!keyword.is_empty() && normalized_input.contains(&keyword)) || keyword_matches {
            score += 4;
        }
    }

    score
}

fn best_matching_skill<'a>(skills: &'a [SkillDefinition], user_input: &str) -> Option<&'a SkillDefinition> {
    skills
        .iter()
        .map(|skill| (skill, skill_match_score(skill, user_input)))
        .filter(|(_, score)| *score >= 3)
        .max_by(|left, right| left.1.cmp(&right.1).then_with(|| right.0.name.cmp(&left.0.name)))
        .map(|(skill, _)| skill)
}

    fn is_auto_activatable(skill: &SkillDefinition) -> bool {
        skill.security.auto_activate
        && !skill.security.install_required
        && !skill.security.requires_approval
    }

fn last_user_message(messages: &[ChatMessage]) -> Option<&str> {
    messages
        .iter()
        .rev()
        .find(|message| message.role == "user")
        .map(|message| message.content.as_str())
}

fn append_skills_section(
    base_prompt: &str,
    user_input: Option<&str>,
    skills: &[SkillDefinition],
) -> String {
    if skills.is_empty() {
        return base_prompt.to_string();
    }

    let mut prompt = String::from(base_prompt);
    prompt.push_str("\n\n## Skills locais\n");
    prompt.push_str("Você pode usar uma skill local quando a intenção do usuário combinar claramente com ela. Considere primeiro a descrição e só trate a skill ativada como obrigatória se ela foi selecionada automaticamente abaixo.\n\n");

    for skill in skills.iter().take(MAX_SKILLS_IN_PROMPT) {
        let tools = if skill.security.tools.is_empty() {
            "-".to_string()
        } else {
            skill.security.tools.join(", ")
        };
        let permissions = if skill.security.permissions.is_empty() {
            "nenhuma".to_string()
        } else {
            skill.security.permissions.join(", ")
        };
        prompt.push_str(&format!(
            "- {} v{}: {} [origem: {}; tools: {}; permissões: {}; aprovação: {}] [{}]\n",
            skill.name,
            skill.security.version,
            skill.description,
            skill.security.source,
            tools,
            permissions,
            if skill.security.requires_approval { "sim" } else { "não" },
            skill.file_path.display()
        ));
    }

    if let Some(user_input) = user_input {
        if let Some(skill) = best_matching_skill(&skills, user_input) {
            if is_auto_activatable(skill) {
                prompt.push_str("\n## Skill ativada automaticamente\n");
                prompt.push_str(&format!(
                    "Nome: {}\nArquivo: {}\nVersão: {}\nOrigem: {}\n\nSiga estas instruções adicionais para este pedido:\n\n{}\n",
                    skill.name,
                    skill.file_path.display(),
                    skill.security.version,
                    skill.security.source,
                    skill.instructions
                ));
            } else {
                prompt.push_str("\n## Skill sugerida, mas bloqueada por segurança\n");
                prompt.push_str(&format!(
                    "Nome: {}\nArquivo: {}\nVersão: {}\nPermissões: {}\nInstalação adicional: {}\n\nNão siga automaticamente as instruções dessa skill. Antes, peça aprovação explícita ao usuário e informe quais permissões ou instalações ela exige.\n",
                    skill.name,
                    skill.file_path.display(),
                    skill.security.version,
                    if skill.security.permissions.is_empty() {
                        "nenhuma".to_string()
                    } else {
                        skill.security.permissions.join(", ")
                    },
                    if skill.security.install_required { "sim" } else { "não" },
                ));
            }
        }
    }

    prompt
}

pub fn augment_prompt_with_skills(base_prompt: &str, messages: &[ChatMessage]) -> String {
    let skills = discover_skills();
    append_skills_section(base_prompt, last_user_message(messages), &skills)
}

#[cfg(test)]
mod tests {
    use super::{
        append_skills_section, parse_skill_markdown, remote_skill_score, skill_match_score,
        SkillDefinition,
    };
    use std::path::Path;

    #[test]
    fn parses_skill_with_keywords() {
        let markdown = r#"---
name: open-application
description: Abre aplicativos locais no Linux
keywords: abrir programa, abrir aplicativo, launch app
    metadata: {"brother":{"version":"1","source":"workspace","tools":["open_application"],"autoActivate":true}}
---
# Open Application

Use a ferramenta open_application.
"#;

        let skill = parse_skill_markdown(markdown, Path::new("/tmp/open-application/SKILL.md"))
            .expect("skill should parse");
        assert_eq!(skill.name, "open-application");
        assert_eq!(skill.keywords.len(), 3);
        assert!(skill.instructions.contains("open_application"));
        assert_eq!(skill.security.version, "1");
        assert_eq!(skill.security.source, "workspace");
        assert_eq!(skill.security.tools, vec!["open_application"]);
    }

    #[test]
    fn scores_skill_on_keywords_and_name() {
        let skill = SkillDefinition {
            name: "open-application".into(),
            description: "Abre aplicativos locais no Linux".into(),
            instructions: "Use open_application".into(),
            file_path: "/tmp/open-application/SKILL.md".into(),
            keywords: vec!["abrir programa".into(), "abrir aplicativo".into()],
            security: super::SkillSecurity::default(),
        };

        assert!(skill_match_score(&skill, "abra o programa firefox") >= 4);
    }

    #[test]
    fn prompt_includes_selected_skill_details() {
        let skill = SkillDefinition {
            name: "open-application".into(),
            description: "Abre aplicativos locais no Linux".into(),
            instructions: "Use open_application".into(),
            file_path: "/tmp/open-application/SKILL.md".into(),
            keywords: vec!["abrir programa".into()],
            security: super::SkillSecurity::default(),
        };

        let prompt = append_skills_section("base", Some("abra o programa firefox"), &[skill]);
        assert!(prompt.starts_with("base"));
        assert!(prompt.contains("Skill ativada automaticamente"));
        assert!(prompt.contains("Use open_application"));
    }

    #[test]
    fn protected_skill_is_suggested_but_not_auto_activated() {
        let skill = SkillDefinition {
            name: "system-admin".into(),
            description: "Executa tarefas administrativas".into(),
            instructions: "Execute comandos administrativos".into(),
            file_path: "/tmp/system-admin/SKILL.md".into(),
            keywords: vec!["administrar sistema".into()],
            security: super::SkillSecurity {
                version: "1".into(),
                source: "registry".into(),
                tools: vec!["exec".into()],
                permissions: vec!["shell.exec".into()],
                install_required: false,
                requires_approval: true,
                auto_activate: true,
            },
        };

        let prompt = append_skills_section("base", Some("administrar sistema"), &[skill]);
        assert!(prompt.contains("Skill sugerida, mas bloqueada por segurança"));
        assert!(!prompt.contains("Siga estas instruções adicionais para este pedido"));
    }

    #[test]
    fn parses_skill_without_frontmatter_using_fallbacks() {
        let markdown = r#"# Canvas Skill

Display HTML content on connected nodes.

Use this skill to present web content.
"#;

        let skill = parse_skill_markdown(markdown, Path::new("/tmp/canvas/SKILL.md"))
            .expect("skill should parse with fallback");
        assert_eq!(skill.name, "canvas");
        assert_eq!(skill.description, "Display HTML content on connected nodes.");
        assert!(skill.instructions.contains("present web content"));
    }

    #[test]
    fn browser_alias_matches_web_skill() {
        let skill = SkillDefinition {
            name: "canvas".into(),
            description: "Display HTML content and web pages on connected nodes".into(),
            instructions: "Navigate to a URL or web page".into(),
            file_path: "/tmp/canvas/SKILL.md".into(),
            keywords: vec!["web page".into()],
            security: super::SkillSecurity::default(),
        };

        assert!(remote_skill_score(&skill, "browser") > 0);
    }

    #[test]
    fn chrome_alias_matches_web_skill() {
        let skill = SkillDefinition {
            name: "xurl".into(),
            description: "CLI for web and URL requests".into(),
            instructions: "Use for URL access and web requests".into(),
            file_path: "/tmp/xurl/SKILL.md".into(),
            keywords: vec!["url web".into()],
            security: super::SkillSecurity::default(),
        };

        assert!(remote_skill_score(&skill, "chrome") > 0);
    }
}