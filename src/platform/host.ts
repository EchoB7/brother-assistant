import type { DeviceFlowStart, SettingsState } from "../types";

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

export async function invokeCommand<T>(command: string, args?: Record<string, unknown>) {
  const customHost = detectCustomHost();
  if (customHost?.invoke) {
    return customHost.invoke<T>(command, args);
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
