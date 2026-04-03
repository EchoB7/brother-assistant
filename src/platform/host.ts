import type { DeviceFlowStart, SettingsState, SkillCatalogEntry } from "../types";

type EventHandler<T> = (payload: T) => void;
type Unlisten = () => void;
export type WindowAction = "minimize" | "toggleMaximize" | "close" | "startDrag";

export interface HostBridge {
  invoke?<T>(command: string, args?: Record<string, unknown>): Promise<T>;
  listen?<T>(event: string, handler: EventHandler<T>): Promise<Unlisten> | Unlisten;
  windowControl?(action: WindowAction): Promise<void> | void;
}

declare global {
  interface Window {
    __BROTHER_HOST__?: HostBridge;
    __TAURI_INTERNALS__?: unknown;
  }
}

const SETTINGS_STORAGE_KEY = "brother.settings.v1";
const localListeners = new Map<string, Set<EventHandler<unknown>>>();
const OPENCLAW_SKILLS_API = "https://api.github.com/repos/openclaw/openclaw/contents/skills";
const MAX_PREVIEW_SKILL_RESULTS = 24;
const PREVIEW_LOCAL_SKILL_FILES = (
  import.meta as ImportMeta & {
    glob: (pattern: string, options: Record<string, unknown>) => Record<string, string>;
  }
).glob("../../skills/*/SKILL.md", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

const SKILL_ALIASES: Record<string, string> = {
  browser: "web",
  browse: "web",
  browsing: "web",
  web: "web",
  website: "web",
  webpage: "web",
  site: "web",
  sites: "web",
  page: "web",
  pages: "web",
  url: "web",
  urls: "web",
  http: "web",
  https: "web",
  chrome: "web",
  chromium: "web",
  navegador: "web",
  search: "buscar",
  searching: "buscar",
  find: "buscar",
  lookup: "buscar",
  query: "buscar",
};

const SKILL_STOPWORDS = new Set([
  "the", "and", "para", "com", "que", "uma", "por", "from", "with", "this", "that", "then", "else",
]);

const WEB_HINTS = ["web", "url", "html", "page", "site", "browser", "canvas"];

interface GithubSkillDirEntry {
  name: string;
  type: string;
}

function tokenizeSkillText(text: string) {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9]+/i)
      .filter((token) => token.length >= 3 && !SKILL_STOPWORDS.has(token))
      .map((token) => SKILL_ALIASES[token] ?? (token.endsWith("s") && token.length > 4 ? token.slice(0, -1) : token))
  );
}

function parsePreviewSkillMarkdown(
  markdown: string,
  fallbackName: string,
  options?: {
    source?: string;
    repo?: string | null;
    remotePath?: string | null;
    filePath?: string | null;
    installed?: boolean;
  }
): SkillCatalogEntry | null {
  const trimmed = markdown.trim();
  let frontmatter = "";
  let body = trimmed;

  if (trimmed.startsWith("---\n")) {
    const remainder = trimmed.slice(4);
    const frontmatterEnd = remainder.indexOf("\n---\n");
    if (frontmatterEnd >= 0) {
      frontmatter = remainder.slice(0, frontmatterEnd);
      body = remainder.slice(frontmatterEnd + 5).trim();
    }
  }

  let name = fallbackName;
  let description = "";
  const keywords: string[] = [];

  for (const line of frontmatter.split("\n")) {
    const separator = line.indexOf(":");
    if (separator < 0) continue;
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim().replace(/^['"]|['"]$/g, "");
    if (key === "name" && value) {
      name = value;
    } else if (key === "description" && value) {
      description = value;
    } else if ((key === "keywords" || key === "triggers") && value) {
      keywords.push(...value.split(",").map((item) => item.trim()).filter(Boolean));
    }
  }

  if (!description) {
    for (const line of body.split("\n")) {
      const candidate = line.trim();
      if (candidate && !candidate.startsWith("#")) {
        description = candidate;
        break;
      }
    }
  }

  if (!name || !description) {
    return null;
  }

  return {
    name,
    description,
    version: "1",
    source: options?.source ?? "openclaw",
    repo: options?.repo ?? "openclaw/openclaw",
    remote_path: options?.remotePath ?? `skills/${fallbackName}`,
    file_path: options?.filePath ?? null,
    keywords,
    tools: [],
    permissions: [],
    install_required: false,
    requires_approval: false,
    auto_activate: true,
    installed: options?.installed ?? false,
  };
}

function listPreviewInstalledSkills() {
  return Object.entries(PREVIEW_LOCAL_SKILL_FILES)
    .map(([filePath, markdown]) => {
      const match = filePath.match(/skills\/([^/]+)\/SKILL\.md$/);
      const fallbackName = match?.[1] ?? "skill-local";
      return parsePreviewSkillMarkdown(markdown, fallbackName, {
        source: "workspace",
        repo: null,
        remotePath: null,
        filePath,
        installed: true,
      });
    })
    .filter((skill): skill is SkillCatalogEntry => Boolean(skill))
    .sort((left, right) => left.name.localeCompare(right.name));
}

function scorePreviewSkill(skill: SkillCatalogEntry, markdown: string, query: string) {
  const trimmed = query.trim();
  if (!trimmed) return 1;

  const lowered = trimmed.toLowerCase();
  const metadataContext = `${skill.name} ${skill.description} ${skill.keywords.join(" ")}`;
  const remoteContext = `${metadataContext} ${markdown}`;
  const queryTokens = tokenizeSkillText(trimmed);
  const metadataTokens = tokenizeSkillText(metadataContext);
  const remoteTokens = tokenizeSkillText(remoteContext);

  let score = 0;
  for (const token of queryTokens) {
    if (remoteTokens.has(token)) score += 1;
    if (metadataTokens.has(token)) score += 1;
  }

  const containsMatch =
    skill.name.toLowerCase().includes(lowered) ||
    skill.description.toLowerCase().includes(lowered) ||
    markdown.toLowerCase().includes(lowered) ||
    skill.keywords.some((keyword) => keyword.toLowerCase().includes(lowered));

  const webIntent =
    queryTokens.has("web") ||
    lowered.includes("browser") ||
    lowered.includes("chrome") ||
    lowered.includes("chromium") ||
    lowered.includes("navegador") ||
    lowered.includes("site") ||
    lowered.includes("url");

  if (webIntent) {
    let metadataHintCount = 0;
    let remoteHintCount = 0;
    for (const hint of WEB_HINTS) {
      if (metadataTokens.has(hint)) metadataHintCount += 1;
      if (remoteTokens.has(hint)) remoteHintCount += 1;
    }

    if (metadataHintCount > 0) {
      score += 4 + metadataHintCount;
    } else if (remoteHintCount > 0) {
      score += 1;
    } else {
      return 0;
    }

    if (skill.name.includes("url") || skill.name.includes("canvas")) {
      score += 3;
    }
  }

  if (containsMatch) {
    score += 3;
  }

  return score;
}

async function searchPreviewOpenClawSkills(query: string) {
  const response = await fetch(OPENCLAW_SKILLS_API);
  if (!response.ok) {
    throw new Error("Nao foi possivel consultar o catalogo do OpenClaw no preview web.");
  }

  const entries = (await response.json()) as GithubSkillDirEntry[];
  const skills: Array<{ score: number; skill: SkillCatalogEntry }> = [];

  for (const entry of entries) {
    if (entry.type !== "dir") continue;

    try {
      const markdownResponse = await fetch(
        `https://raw.githubusercontent.com/openclaw/openclaw/main/skills/${entry.name}/SKILL.md`
      );
      if (!markdownResponse.ok) continue;
      const markdown = await markdownResponse.text();
      const skill = parsePreviewSkillMarkdown(markdown, entry.name);
      if (!skill) continue;
      const score = scorePreviewSkill(skill, markdown, query);
      if (query.trim() === "" || score > 0) {
        skills.push({ score, skill });
      }
    } catch {
      continue;
    }
  }

  skills.sort((left, right) => right.score - left.score || left.skill.name.localeCompare(right.skill.name));
  return skills.slice(0, MAX_PREVIEW_SKILL_RESULTS).map((item) => item.skill);
}

function defaultSettingsState(): SettingsState {
  return {
    agent_mode: false,
    provider: "copilot",
    model: "gpt-5.4",
    github_token: "",
    openai_key: "",
    openrouter_key: "",
    groq_key: "",
    venice_key: "",
    google_key: "",
    xai_key: "",
    custom_api_url: "",
    custom_api_key: "",
    active_copilot_account: null,
    copilot_accounts: [],
    provider_accounts: {},
  };
}

function hasWindow() {
  return typeof window !== "undefined";
}

function detectCustomHost() {
  return hasWindow() ? window.__BROTHER_HOST__ : undefined;
}

export function getInstalledHostBridge() {
  return detectCustomHost();
}

export function installHostBridge(hostBridge: HostBridge | undefined) {
  if (!hasWindow()) {
    return;
  }

  window.__BROTHER_HOST__ = hostBridge;
}

function isTauriRuntime() {
  return hasWindow() && Boolean(window.__TAURI_INTERNALS__);
}

export function getHostRuntime() {
  if (detectCustomHost()) {
    return "custom" as const;
  }

  if (isTauriRuntime()) {
    return "tauri" as const;
  }

  return "local-preview" as const;
}

function mergeSettings(candidate: Partial<SettingsState> | null | undefined): SettingsState {
  const base = defaultSettingsState();
  if (!candidate) {
    return base;
  }

  return {
    ...base,
    ...candidate,
    copilot_accounts: Array.isArray(candidate.copilot_accounts)
      ? candidate.copilot_accounts
      : base.copilot_accounts,
    provider_accounts: candidate.provider_accounts ?? base.provider_accounts,
  };
}

function readLocalSettings() {
  if (!hasWindow()) {
    return defaultSettingsState();
  }

  const raw = window.localStorage.getItem(SETTINGS_STORAGE_KEY);
  if (!raw) {
    return defaultSettingsState();
  }

  try {
    return mergeSettings(JSON.parse(raw) as Partial<SettingsState>);
  } catch {
    return defaultSettingsState();
  }
}

function writeLocalSettings(settings: SettingsState) {
  if (!hasWindow()) {
    return settings;
  }

  window.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  return settings;
}

function emitLocalEvent<T>(event: string, payload: T) {
  const handlers = localListeners.get(event);
  if (!handlers) {
    return;
  }

  handlers.forEach((handler) => handler(payload));
}

function registerLocalEvent<T>(event: string, handler: EventHandler<T>): Unlisten {
  const handlers = localListeners.get(event) ?? new Set<EventHandler<unknown>>();
  handlers.add(handler as EventHandler<unknown>);
  localListeners.set(event, handlers);

  return () => {
    const currentHandlers = localListeners.get(event);
    if (!currentHandlers) {
      return;
    }
    currentHandlers.delete(handler as EventHandler<unknown>);
    if (currentHandlers.size === 0) {
      localListeners.delete(event);
    }
  };
}

function previewResponse(text: string) {
  return `Preview local da UI Brother: esta resposta foi gerada sem Tauri. Sua shell Linux futura deve implementar __BROTHER_HOST__ e encaminhar o pedido ao brother-core. Pergunta recebida: ${text}`;
}

function fakeDeviceFlow(): DeviceFlowStart {
  return {
    device_code: `preview-${Date.now()}`,
    user_code: "BROT-HER1",
    verification_uri: "https://github.com/login/device",
    interval: 5,
    expires_in: 900,
  };
}

function addOrUpdateProviderAccount(
  settings: SettingsState,
  provider: string,
  accountName: string,
  apiKey: string,
  baseUrl?: string | null,
) {
  const providerAccounts = [...(settings.provider_accounts[provider] ?? [])];
  const nextAccount = {
    name: accountName,
    api_key: apiKey,
    base_url: baseUrl ?? "",
    added_at: Math.floor(Date.now() / 1000),
    requests: 0,
    total_tokens: 0,
    active: providerAccounts.length === 0,
  };
  const existingIndex = providerAccounts.findIndex((account) => account.name === accountName);

  if (existingIndex >= 0) {
    const wasActive = providerAccounts[existingIndex].active;
    providerAccounts[existingIndex] = { ...nextAccount, active: wasActive };
  } else {
    providerAccounts.push(nextAccount);
  }

  if (!providerAccounts.some((account) => account.active) && providerAccounts.length > 0) {
    providerAccounts[0] = { ...providerAccounts[0], active: true };
  }

  return {
    ...settings,
    provider_accounts: {
      ...settings.provider_accounts,
      [provider]: providerAccounts,
    },
  };
}

async function invokeLocal<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const settings = readLocalSettings();

  switch (command) {
    case "get_settings_state":
      return settings as T;
    case "set_settings_state": {
      const nextSettings = mergeSettings(args?.update as SettingsState);
      return writeLocalSettings(nextSettings) as T;
    }
    case "start_copilot_device_flow":
      return fakeDeviceFlow() as T;
    case "complete_copilot_device_flow": {
      const username = `preview-${settings.copilot_accounts.length + 1}`;
      const updated = {
        ...settings,
        active_copilot_account: username,
        copilot_accounts: [
          ...settings.copilot_accounts.map((account) => ({ ...account, active: false })),
          {
            username,
            added_at: Math.floor(Date.now() / 1000),
            requests: 0,
            total_tokens: 0,
            active: true,
          },
        ],
      };
      return writeLocalSettings(updated) as T;
    }
    case "set_active_copilot_account": {
      const username = String(args?.username ?? "");
      const updated = {
        ...settings,
        active_copilot_account: username,
        copilot_accounts: settings.copilot_accounts.map((account) => ({
          ...account,
          active: account.username === username,
        })),
      };
      return writeLocalSettings(updated) as T;
    }
    case "remove_copilot_account": {
      const username = String(args?.username ?? "");
      const remaining = settings.copilot_accounts.filter((account) => account.username !== username);
      const activeUsername = remaining.find((account) => account.active)?.username ?? remaining[0]?.username ?? null;
      const updated = {
        ...settings,
        active_copilot_account: activeUsername,
        copilot_accounts: remaining.map((account, index) => ({
          ...account,
          active: activeUsername ? account.username === activeUsername : index === 0,
        })),
      };
      return writeLocalSettings(updated) as T;
    }
    case "import_legacy_copilot_agent_config":
      return settings as T;
    case "add_provider_account": {
      const provider = String(args?.provider ?? settings.provider);
      const accountName = String(args?.account_name ?? "principal");
      const apiKey = String(args?.api_key ?? "");
      const updated = addOrUpdateProviderAccount(
        settings,
        provider,
        accountName,
        apiKey,
        args?.base_url as string | null | undefined,
      );
      return writeLocalSettings(updated) as T;
    }
    case "set_active_provider_account": {
      const provider = String(args?.provider ?? settings.provider);
      const accountName = String(args?.account_name ?? "");
      const updated = {
        ...settings,
        provider_accounts: {
          ...settings.provider_accounts,
          [provider]: (settings.provider_accounts[provider] ?? []).map((account) => ({
            ...account,
            active: account.name === accountName,
          })),
        },
      };
      return writeLocalSettings(updated) as T;
    }
    case "remove_provider_account": {
      const provider = String(args?.provider ?? settings.provider);
      const accountName = String(args?.account_name ?? "");
      const remaining = (settings.provider_accounts[provider] ?? []).filter((account) => account.name !== accountName);
      const normalized = remaining.map((account, index) => ({
        ...account,
        active: account.active || (!remaining.some((item) => item.active) && index === 0),
      }));
      const updated = {
        ...settings,
        provider_accounts: {
          ...settings.provider_accounts,
          [provider]: normalized,
        },
      };
      return writeLocalSettings(updated) as T;
    }
    case "chat_stream": {
      const messages = Array.isArray(args?.messages) ? (args?.messages as Array<{ role: string; content: string }>) : [];
      const userMessages = messages.filter((message) => message.role === "user");
      const lastUserMessage = userMessages.length > 0 ? userMessages[userMessages.length - 1].content : "";
      const content = previewResponse(lastUserMessage);
      const chunks = content.match(/.{1,18}/g) ?? [content];

      chunks.forEach((chunk, index) => {
        window.setTimeout(() => emitLocalEvent("chat-stream-chunk", chunk), 80 * (index + 1));
      });
      window.setTimeout(() => emitLocalEvent("chat-stream-done", null), 80 * (chunks.length + 1));
      return undefined as T;
    }
    case "list_installed_skills":
      return listPreviewInstalledSkills() as T;
    case "search_openclaw_skills":
      return (await searchPreviewOpenClawSkills(String(args?.query ?? ""))) as T;
    case "install_openclaw_skill":
      throw new Error("Instalação de skills só está disponível no host nativo.");
    default:
      throw new Error(`Comando nao suportado fora do host nativo: ${command}`);
  }
}

let tauriCorePromise: Promise<typeof import("@tauri-apps/api/core")> | null = null;
let tauriEventPromise: Promise<typeof import("@tauri-apps/api/event")> | null = null;
let tauriWindowPromise: Promise<typeof import("@tauri-apps/api/window")> | null = null;

function getTauriCore() {
  tauriCorePromise ??= import("@tauri-apps/api/core");
  return tauriCorePromise;
}

function getTauriEvent() {
  tauriEventPromise ??= import("@tauri-apps/api/event");
  return tauriEventPromise;
}

function getTauriWindow() {
  tauriWindowPromise ??= import("@tauri-apps/api/window");
  return tauriWindowPromise;
}

function shouldFallbackToLocal(command: string, error: unknown) {
  if (!["list_installed_skills", "search_openclaw_skills"].includes(command)) {
    return false;
  }

  if (!(error instanceof Error)) {
    return false;
  }

  const message = error.message.toLowerCase();
  return message.includes("comando não suportado") || message.includes("comando nao suportado");
}

export async function invokeCommand<T>(command: string, args?: Record<string, unknown>) {
  const customHost = detectCustomHost();
  if (customHost?.invoke) {
    try {
      return await customHost.invoke<T>(command, args);
    } catch (error) {
      if (shouldFallbackToLocal(command, error)) {
        return invokeLocal<T>(command, args);
      }
      throw error;
    }
  }

  if (isTauriRuntime()) {
    const { invoke } = await getTauriCore();
    return invoke<T>(command, args);
  }

  return invokeLocal<T>(command, args);
}

export async function listenEvent<T>(event: string, handler: EventHandler<T>) {
  const customHost = detectCustomHost();
  if (customHost?.listen) {
    return customHost.listen<T>(event, handler);
  }

  if (isTauriRuntime()) {
    const { listen } = await getTauriEvent();
    return listen<T>(event, (tauriEvent) => handler(tauriEvent.payload));
  }

  return registerLocalEvent(event, handler);
}

export async function controlWindow(action: WindowAction) {
  const customHost = detectCustomHost();
  if (customHost?.windowControl) {
    await customHost.windowControl(action);
    return;
  }

  if (isTauriRuntime()) {
    const { getCurrentWindow } = await getTauriWindow();
    const currentWindow = getCurrentWindow();

    if (action === "minimize") {
      await currentWindow.minimize();
      return;
    }

    if (action === "toggleMaximize") {
      await currentWindow.toggleMaximize();
      return;
    }

    await currentWindow.hide();
  }
}
