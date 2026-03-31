import { useEffect, useMemo, useState, type ComponentProps, type ElementType } from "react";
import {
  ArrowLeft,
  ArrowRightLeft,
  Bot,
  Brain,
  Check,
  Cloud,
  Globe,
  KeyRound,
  Languages,
  Link as LinkIcon,
  Plus,
  RefreshCw,
  Shield,
  Trash2,
  Zap,
} from "lucide-react";
import { PROVIDER_SPECS, getProviderModels, getProviderSpec } from "../modelCatalog";
import { useI18n, LOCALE_LABELS, type Locale } from "../i18n";
import { invokeCommand } from "../platform/host";
import type { DeviceFlowStart, ProviderAccountSummary, SettingsState } from "../types";

interface SettingsProps {
  onClose: () => void;
}

const PROVIDER_ICONS: Record<string, ElementType<ComponentProps<typeof Zap>>> = {
  copilot: Shield,
  github: Shield,
  openrouter: Globe,
  groq: Zap,
  venice: Shield,
  google: SparklesFallback,
  openai: Brain,
  xai: Zap,
  custom: Cloud,
};

function SparklesFallback(props: ComponentProps<typeof Zap>) {
  return <Zap {...props} />;
}

function formatDate(value: number, locale: string) {
  if (!value) return "-";
  const localeMap: Record<string, string> = {
    "en": "en-US", "pt-br": "pt-BR", "es": "es-ES", "ru": "ru-RU",
    "ja": "ja-JP", "zh": "zh-CN", "ar": "ar-SA", "de": "de-DE",
    "fr": "fr-FR", "it": "it-IT", "hi": "hi-IN",
  };
  return new Date(value * 1000).toLocaleDateString(localeMap[locale] || "en-US");
}

function tokenLabel(providerName: string) {
  switch (providerName) {
    case "github":
      return "Token GitHub";
    case "openrouter":
      return "API key OpenRouter";
    case "groq":
      return "API key Groq";
    case "venice":
      return "API key Venice";
    case "google":
      return "API key Gemini";
    case "openai":
      return "API key OpenAI";
    case "xai":
      return "API key xAI";
    case "custom":
      return "API key Custom";
    default:
      return "Token";
  }
}

function providerSupportsAccounts(providerName: string) {
  return ["github", "openai", "openrouter", "groq", "venice", "google", "xai"].includes(providerName);
}

function maskSecret(value: string) {
  if (!value) return "—";
  if (value.length <= 12) return `${value.slice(0, 4)}...${value.slice(-2)}`;
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

function defaultAccountName(providerName: string, accounts: ProviderAccountSummary[]) {
  if (!accounts.some((account) => account.name === "principal")) {
    return "principal";
  }
  return `${providerName}${accounts.length + 1}`;
}

export default function Settings({ onClose }: SettingsProps) {
  const { t, locale, setLocale } = useI18n();
  const [config, setConfig] = useState<SettingsState | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");
  const [deviceFlow, setDeviceFlow] = useState<DeviceFlowStart | null>(null);
  const [addingAccount, setAddingAccount] = useState(false);
  const [newAccountName, setNewAccountName] = useState("");
  const [newAccountKey, setNewAccountKey] = useState("");
  const [providerActionBusy, setProviderActionBusy] = useState(false);
  const [modelQuery, setModelQuery] = useState("");
  const [autostart, setAutostart] = useState(false);

  useEffect(() => {
    invokeCommand<SettingsState>("get_settings_state")
      .then(setConfig)
      .catch(console.error);
    invokeCommand<boolean>("get_autostart")
      .then(setAutostart)
      .catch(() => {});
  }, []);

  const selectedProvider = useMemo(() => {
    if (!config) return PROVIDER_SPECS[0];
    return getProviderSpec(config.provider);
  }, [config]);

  const providerAccounts = useMemo(() => {
    if (!config) return [];
    return config.provider_accounts?.[config.provider] ?? [];
  }, [config]);

  const supportsAccounts = providerSupportsAccounts(config?.provider ?? "");
  const providerModels = useMemo(() => {
    if (!config) return [];
    return getProviderModels(config.provider);
  }, [config]);
  const filteredProviderModels = useMemo(() => {
    const query = modelQuery.trim().toLowerCase();
    if (!query) {
      return providerModels;
    }

    return providerModels.filter(
      (model) =>
        model.id.toLowerCase().includes(query) ||
        model.family.toLowerCase().includes(query) ||
        model.tags.some((tag) => tag.includes(query))
    );
  }, [modelQuery, providerModels]);

  useEffect(() => {
    if (!config || !supportsAccounts) {
      setNewAccountName("");
      setNewAccountKey("");
      return;
    }

    setNewAccountName((value) => value || defaultAccountName(config.provider, providerAccounts));
  }, [config, providerAccounts, supportsAccounts]);

  useEffect(() => {
    setModelQuery("");
  }, [config?.provider]);

  function renderTag(tag: string) {
    const tone =
      tag === "code"
        ? "border-sky-200 bg-sky-50 text-sky-700"
        : tag === "reasoning"
          ? "border-amber-200 bg-amber-50 text-amber-700"
          : "border-violet-200 bg-violet-50 text-violet-700";

    return (
      <span
        key={tag}
        className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] ${tone}`}
      >
        {tag}
      </span>
    );
  }

  function handleProviderChange(name: string) {
    const provider = getProviderSpec(name);
    setConfig((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        provider: name,
        model: provider.models[0] || prev.model,
      };
    });
    setSaved(false);
    setStatusMessage("");
  }

  async function handleSave() {
    if (!config) return;
    setSaving(true);
    try {
      const updated = await invokeCommand<SettingsState>("set_settings_state", { update: config });
      setConfig(updated);
      setSaved(true);
      setStatusMessage(t("configSaved"));
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      console.error(err);
      setStatusMessage(t("configSaveFailed"));
    }
    setSaving(false);
  }

  async function handleStartAccountFlow() {
    setAddingAccount(true);
    try {
      const flow = await invokeCommand<DeviceFlowStart>("start_copilot_device_flow");
      setDeviceFlow(flow);
      setStatusMessage(t("authorizeGitHub"));
    } catch (error) {
      console.error(error);
      setStatusMessage(t("authFailed"));
    }
    setAddingAccount(false);
  }

  async function handleCompleteAccountFlow() {
    if (!deviceFlow) return;
    setAddingAccount(true);
    try {
      const updated = await invokeCommand<SettingsState>("complete_copilot_device_flow", {
        device_code: deviceFlow.device_code,
        interval: deviceFlow.interval,
        expires_in: deviceFlow.expires_in,
      });
      setConfig(updated);
      setDeviceFlow(null);
      setStatusMessage(t("copilotAdded"));
    } catch (error) {
      console.error(error);
      setStatusMessage(String(error));
    }
    setAddingAccount(false);
  }

  async function handleActivateAccount(username: string) {
    try {
      const updated = await invokeCommand<SettingsState>("set_active_copilot_account", { username });
      setConfig(updated);
      setStatusMessage(`${t("accountActive")} ${username}`);
    } catch (error) {
      console.error(error);
      setStatusMessage(t("copilotSwitchFailed"));
    }
  }

  async function handleRemoveAccount(username: string) {
    try {
      const updated = await invokeCommand<SettingsState>("remove_copilot_account", { username });
      setConfig(updated);
      setStatusMessage(`${t("accountRemoved")} ${username}`);
    } catch (error) {
      console.error(error);
      setStatusMessage(t("copilotRemoveFailed"));
    }
  }

  async function handleImportLegacyConfig() {
    setSaving(true);
    try {
      const updated = await invokeCommand<SettingsState>("import_legacy_copilot_agent_config");
      setConfig(updated);
      setStatusMessage(t("importSuccess"));
    } catch (error) {
      console.error(error);
      setStatusMessage(t("importFailed"));
    }
    setSaving(false);
  }

  async function handleAddProviderAccount() {
    if (!config) return;
    setProviderActionBusy(true);
    try {
      const updated = await invokeCommand<SettingsState>("add_provider_account", {
        provider: config.provider,
        account_name: newAccountName,
        api_key: newAccountKey,
        base_url: null,
      });
      setConfig(updated);
      setNewAccountName(defaultAccountName(config.provider, updated.provider_accounts?.[config.provider] ?? []));
      setNewAccountKey("");
      setStatusMessage(`${t("accountAddedIn")} ${selectedProvider.label}.`);
    } catch (error) {
      console.error(error);
      setStatusMessage(t("providerAddFailed"));
    }
    setProviderActionBusy(false);
  }

  async function handleActivateProviderAccount(accountName: string) {
    if (!config) return;
    setProviderActionBusy(true);
    try {
      const updated = await invokeCommand<SettingsState>("set_active_provider_account", {
        provider: config.provider,
        account_name: accountName,
      });
      setConfig(updated);
      setStatusMessage(`${t("accountActive")} ${accountName}`);
    } catch (error) {
      console.error(error);
      setStatusMessage(t("providerActivateFailed"));
    }
    setProviderActionBusy(false);
  }

  async function handleRemoveProviderAccount(accountName: string) {
    if (!config) return;
    setProviderActionBusy(true);
    try {
      const updated = await invokeCommand<SettingsState>("remove_provider_account", {
        provider: config.provider,
        account_name: accountName,
      });
      setConfig(updated);
      setStatusMessage(`${t("accountRemoved")} ${accountName}`);
    } catch (error) {
      console.error(error);
      setStatusMessage(t("providerRemoveFailed"));
    }
    setProviderActionBusy(false);
  }

  if (!config) {
    return (
      <div className="flex h-full items-center justify-center bg-gradient-to-b from-white/70 to-slate-50/90 dark:from-gray-900/70 dark:to-gray-800/90 px-6 text-sm text-slate-500 dark:text-gray-400">
        {t("loadingSettings")}
      </div>
    );
  }

  const tokenField = selectedProvider.tokenField as keyof SettingsState | null;
  const tokenValue = tokenField ? String(config[tokenField] ?? "") : "";

  return (
    <div className="flex-1 overflow-y-auto bg-gradient-to-b from-white/80 via-slate-50/70 to-white/90 dark:from-gray-900/80 dark:via-gray-800/70 dark:to-gray-900/90 scrollbar-thin">
      <div className="p-5">
        <div className="mb-5 rounded-[26px] border border-white/70 dark:border-gray-700 bg-white/80 dark:bg-gray-800/80 p-5 shadow-[0_20px_60px_rgba(15,23,42,0.08)] backdrop-blur-xl">
          <div className="mb-4 flex items-center justify-between gap-3">
            <button
              onClick={onClose}
              className="inline-flex items-center gap-2 rounded-xl bg-slate-100/80 dark:bg-gray-700/80 px-3 py-2 text-sm text-slate-500 dark:text-gray-400 transition-colors hover:bg-slate-200/80 dark:hover:bg-gray-600/80 hover:text-slate-800 dark:hover:text-white"
            >
              <ArrowLeft className="w-4 h-4" />
              {t("backToChat")}
            </button>
            <div className="rounded-full border border-slate-200 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400 dark:text-gray-400">
              {t("brotherControl")}
            </div>
          </div>

          <h2 className="text-lg font-bold text-slate-900 dark:text-white mb-1">{t("settings")}</h2>
          <p className="text-sm text-slate-500 dark:text-gray-400 mb-0">{t("settingsDescription")}</p>
        </div>

        <div className="mb-5 rounded-[24px] border border-white/70 dark:border-gray-700 bg-white/85 dark:bg-gray-800/85 p-4 shadow-[0_16px_40px_rgba(15,23,42,0.08)] backdrop-blur-xl">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-800 dark:text-gray-200">
                <Bot className="w-4 h-4 text-slate-500 dark:text-gray-400" />
                {t("agentMode")}
              </div>
              <p className="mt-1 text-xs text-slate-500 dark:text-gray-400">
                {t("agentModeDesc")}
              </p>
              <p className="mt-2 text-[11px] text-slate-400 dark:text-gray-500">
                {t("agentModeActions")}
              </p>
            </div>

            <button
              onClick={() => {
                setConfig((prev) => prev ? { ...prev, agent_mode: !prev.agent_mode } : prev);
                setSaved(false);
              }}
              className={`relative inline-flex h-8 w-14 shrink-0 rounded-full transition-colors ${config.agent_mode ? "bg-emerald-500" : "bg-slate-300 dark:bg-gray-600"}`}
            >
              <span
                className={`absolute top-1 h-6 w-6 rounded-full bg-white shadow transition-transform ${config.agent_mode ? "translate-x-7" : "translate-x-1"}`}
              />
            </button>
          </div>
        </div>

        <div className="mb-5 rounded-[24px] border border-white/70 dark:border-gray-700 bg-white/85 dark:bg-gray-800/85 p-4 shadow-[0_16px_40px_rgba(15,23,42,0.08)] backdrop-blur-xl">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-800 dark:text-gray-200">
                <Zap className="w-4 h-4 text-slate-500 dark:text-gray-400" />
                {t("startWithSystem")}
              </div>
              <p className="mt-1 text-xs text-slate-500 dark:text-gray-400">
                {t("startWithSystemDesc")}
              </p>
            </div>

            <button
              onClick={async () => {
                const next = !autostart;
                try {
                  const result = await invokeCommand<boolean>("set_autostart", { enabled: next });
                  setAutostart(result);
                } catch (e) {
                  console.error(e);
                }
              }}
              className={`relative inline-flex h-8 w-14 shrink-0 rounded-full transition-colors ${autostart ? "bg-emerald-500" : "bg-slate-300 dark:bg-gray-600"}`}
            >
              <span
                className={`absolute top-1 h-6 w-6 rounded-full bg-white shadow transition-transform ${autostart ? "translate-x-7" : "translate-x-1"}`}
              />
            </button>
          </div>
        </div>

        <div className="mb-5 rounded-[24px] border border-white/70 dark:border-gray-700 bg-white/85 dark:bg-gray-800/85 p-4 shadow-[0_16px_40px_rgba(15,23,42,0.08)] backdrop-blur-xl">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-800 dark:text-gray-200">
                <Languages className="w-4 h-4 text-slate-500 dark:text-gray-400" />
                {t("language")}
              </div>
            </div>
            <select
              value={locale}
              onChange={(e) => setLocale(e.target.value as Locale)}
              className="rounded-xl border border-slate-200 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-1.5 text-sm text-slate-700 dark:text-gray-300 outline-none"
            >
              {(Object.keys(LOCALE_LABELS) as Locale[]).map((loc) => (
                <option key={loc} value={loc}>{LOCALE_LABELS[loc]}</option>
              ))}
            </select>
          </div>
        </div>

        <button
          onClick={handleImportLegacyConfig}
          disabled={saving}
          className="mb-5 inline-flex w-full items-center justify-center gap-2 rounded-[22px] border border-white/70 dark:border-gray-700 bg-white/85 dark:bg-gray-800/85 px-3 py-3 text-sm font-semibold text-slate-700 dark:text-gray-300 shadow-[0_12px_30px_rgba(15,23,42,0.06)] transition-colors hover:bg-slate-50 dark:hover:bg-gray-700 disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${saving ? "animate-spin" : ""}`} />
          {t("importLegacy")}
        </button>

        <label className="text-sm font-semibold text-slate-700 dark:text-gray-300 mb-2 block">{t("provider")}</label>
        <div className="grid gap-2 mb-5 max-h-72 overflow-y-auto pr-1 scrollbar-thin">
          {PROVIDER_SPECS.map((p) => {
            const Icon = PROVIDER_ICONS[p.name] ?? Shield;
            const isActive = config.provider === p.name;
            const accountCount = config.provider_accounts?.[p.name]?.length ?? 0;
            return (
              <button
                key={p.name}
                onClick={() => handleProviderChange(p.name)}
                className={`flex items-center gap-3 rounded-[22px] border p-3 text-left shadow-[0_10px_24px_rgba(15,23,42,0.05)] transition-all ${
                  isActive
                    ? "border-blue-400 bg-[linear-gradient(135deg,rgba(239,246,255,0.95),rgba(245,243,255,0.95))] dark:bg-[linear-gradient(135deg,rgba(30,58,138,0.3),rgba(76,29,149,0.3))]"
                    : "border-white/70 dark:border-gray-700 bg-white/85 dark:bg-gray-800/85 hover:border-slate-300 dark:hover:border-gray-600"
                }`}
              >
                <Icon className={`w-5 h-5 ${isActive ? "text-blue-600 dark:text-blue-400" : "text-slate-500 dark:text-gray-400"}`} />
                <div>
                  <div className={`text-sm font-medium ${isActive ? "text-blue-700 dark:text-blue-400" : "text-slate-700 dark:text-gray-300"}`}>{p.label}</div>
                  <div className="text-[11px] text-slate-500 dark:text-gray-400">{t(p.summary)}</div>
                  <div className="text-[10px] text-slate-400 dark:text-gray-500">{p.endpoint}</div>
                </div>
                {providerSupportsAccounts(p.name) && accountCount > 0 && (
                  <span className={`ml-auto rounded-full px-2 py-1 text-[10px] font-semibold ${isActive ? "bg-blue-100 text-blue-700" : "bg-slate-100 text-slate-500"}`}>
                    {accountCount} {t("accounts")}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        <div className="mb-5 rounded-[22px] border border-white/70 dark:border-gray-700 bg-white/85 dark:bg-gray-800/85 p-3 shadow-[0_10px_24px_rgba(15,23,42,0.05)]">
          <div className="flex items-center gap-2 text-xs font-semibold text-slate-600 dark:text-gray-400 mb-1">
            <LinkIcon className="w-3.5 h-3.5" /> {t("endpoint")}
          </div>
          <div className="text-xs text-slate-500 dark:text-gray-400 break-all">
            {config.provider === "custom" ? config.custom_api_url || t("defineCustomUrl") : selectedProvider.endpoint}
          </div>
        </div>

        {config.provider === "copilot" ? (
          <div className="mb-6 rounded-[24px] border border-white/70 dark:border-gray-700 bg-white/85 dark:bg-gray-800/85 p-4 shadow-[0_14px_34px_rgba(15,23,42,0.06)] backdrop-blur-xl">
            <div className="flex items-center justify-between gap-3 mb-3">
              <div>
                <h3 className="text-sm font-semibold text-slate-800 dark:text-gray-200">{t("copilotAccounts")}</h3>
                <p className="text-xs text-slate-500 dark:text-gray-400">{t("copilotAccountsDescription")}</p>
              </div>
              <button
                onClick={handleStartAccountFlow}
                disabled={addingAccount}
                className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-blue-500 to-purple-600 px-3 py-2 text-xs font-semibold text-white transition-all hover:from-blue-600 hover:to-purple-700 disabled:opacity-50"
              >
                {addingAccount ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                {t("addAccount")}
              </button>
            </div>

            {deviceFlow && (
              <div className="mb-4 rounded-[22px] border border-blue-200 bg-[linear-gradient(135deg,rgba(239,246,255,0.96),rgba(245,243,255,0.96))] p-3">
                <div className="text-xs font-semibold text-blue-700 mb-1">{t("deviceFlowGitHub")}</div>
                <div className="text-xs text-slate-700 mb-2">{t("deviceFlowInstructions")}</div>
                <a href={deviceFlow.verification_uri} target="_blank" rel="noreferrer" className="text-xs text-blue-700 underline break-all block mb-2">
                  {deviceFlow.verification_uri}
                </a>
                <div className="font-mono text-lg tracking-[0.25em] bg-white border border-blue-200 rounded-xl px-3 py-2 inline-block text-slate-900 mb-3">
                  {deviceFlow.user_code}
                </div>
                <div>
                  <button
                    onClick={handleCompleteAccountFlow}
                    disabled={addingAccount}
                    className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
                  >
                    {addingAccount ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                    {t("completeLogin")}
                  </button>
                </div>
              </div>
            )}

            <div className="space-y-2">
              {config.copilot_accounts.length === 0 ? (
                <div className="text-xs text-slate-500">{t("noAccountConnected")}</div>
              ) : (
                config.copilot_accounts.map((account) => (
                  <div key={account.username} className="rounded-[22px] border border-slate-200/80 dark:border-gray-600 bg-slate-50/80 dark:bg-gray-700/80 p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-sm font-semibold text-slate-800 dark:text-gray-200 flex items-center gap-2">
                          {account.username}
                          {account.active && <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-400">{t("active")}</span>}
                        </div>
                        <div className="text-[11px] text-slate-500 dark:text-gray-400 mt-1">
                          {t("addedOn")} {formatDate(account.added_at, locale)} | {t("requests")} {account.requests} | {t("tokens")} {account.total_tokens.toLocaleString()}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {!account.active && (
                          <button onClick={() => handleActivateAccount(account.username)} className="rounded-lg bg-slate-900 px-2.5 py-1.5 text-[11px] text-white hover:bg-slate-800">
                            {t("activate")}
                          </button>
                        )}
                        <button onClick={() => handleRemoveAccount(account.username)} className="p-2 rounded-lg text-red-500 hover:bg-red-50">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        ) : supportsAccounts ? (
          <div className="mb-6 space-y-4 rounded-[24px] border border-white/70 dark:border-gray-700 bg-white/85 dark:bg-gray-800/85 p-4 shadow-[0_14px_34px_rgba(15,23,42,0.06)] backdrop-blur-xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-slate-800 dark:text-gray-200">{t("providerTokens")}</h3>
                <p className="text-xs text-slate-500 dark:text-gray-400 mt-1">{t("copilotAccountsDescription")}</p>
              </div>
              <div className="rounded-2xl bg-slate-100 dark:bg-gray-700 px-3 py-2 text-right">
                <div className="text-[10px] uppercase tracking-[0.14em] text-slate-400 dark:text-gray-500 font-semibold">{t("activeLabel")}</div>
                <div className="text-xs font-semibold text-slate-700 dark:text-gray-300">
                  {providerAccounts.find((account) => account.active)?.name ?? t("noneLabel")}
                </div>
              </div>
            </div>

            <div className="rounded-[22px] border border-slate-200 dark:border-gray-600 bg-slate-50/80 dark:bg-gray-700/80 p-3">
              <div className="grid gap-2">
                <input
                  type="text"
                  value={newAccountName}
                  onChange={(event) => setNewAccountName(event.target.value)}
                  placeholder={defaultAccountName(config.provider, providerAccounts)}
                  className="w-full rounded-xl border border-slate-200 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-3 text-sm text-slate-800 dark:text-gray-200 outline-none transition-colors focus:border-blue-500"
                />
                <div className="relative">
                  <KeyRound className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-gray-500" />
                  <input
                    type="password"
                    value={newAccountKey}
                    onChange={(event) => setNewAccountKey(event.target.value)}
                    placeholder={config.provider === "github" ? "ghp_..." : "sk-..."}
                    className="w-full rounded-xl border border-slate-200 dark:border-gray-600 bg-white dark:bg-gray-800 pl-10 pr-3 py-3 text-sm font-mono text-slate-800 dark:text-gray-200 outline-none transition-colors focus:border-blue-500"
                  />
                </div>
                <button
                  onClick={handleAddProviderAccount}
                  disabled={providerActionBusy || !newAccountKey.trim()}
                  className="inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-slate-900 to-slate-700 px-3 py-3 text-sm font-semibold text-white transition-colors hover:from-slate-800 hover:to-slate-700 disabled:opacity-50"
                >
                  {providerActionBusy ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                  {t("addToken")}
                </button>
              </div>
            </div>

            <div className="max-h-80 overflow-y-auto rounded-[22px] border border-slate-200 dark:border-gray-600 bg-white/95 dark:bg-gray-800/95">
              {providerAccounts.length === 0 ? (
                <div className="px-4 py-5 text-xs text-slate-500 dark:text-gray-400">{t("noTokenConfigured")}</div>
              ) : (
                <div className="divide-y divide-slate-100 dark:divide-gray-700">
                  {providerAccounts.map((account) => (
                    <div key={account.name} className="flex items-start justify-between gap-3 px-4 py-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-semibold text-slate-800 dark:text-gray-200">{account.name}</span>
                          {account.active && <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-400">{t("active")}</span>}
                        </div>
                        <div className="mt-1 text-[11px] text-slate-500 dark:text-gray-400 font-mono">{maskSecret(account.api_key)}</div>
                        <div className="mt-1 text-[11px] text-slate-400 dark:text-gray-500">
                          {t("requests")} {account.requests} | {t("tokens")} {account.total_tokens.toLocaleString()}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {!account.active && (
                          <button
                            onClick={() => handleActivateProviderAccount(account.name)}
                            disabled={providerActionBusy}
                            className="inline-flex items-center gap-1 rounded-lg bg-slate-900 px-2.5 py-1.5 text-[11px] text-white hover:bg-slate-800 disabled:opacity-50"
                          >
                            <ArrowRightLeft className="w-3.5 h-3.5" />
                            {t("activate")}
                          </button>
                        )}
                        <button
                          onClick={() => handleRemoveProviderAccount(account.name)}
                          disabled={providerActionBusy}
                          className="p-2 rounded-lg text-red-500 hover:bg-red-50 disabled:opacity-50"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <p className="text-xs text-slate-400 dark:text-gray-500">{t(selectedProvider.helpText)}</p>
          </div>
        ) : (
          <>
            <label className="text-sm font-semibold text-slate-700 dark:text-gray-300 mb-2 block">{tokenLabel(config.provider)}</label>
            <div className="relative mb-1">
              <KeyRound className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-gray-500" />
              <input
                type="password"
                value={tokenValue}
                onChange={(event) => {
                  if (!tokenField) return;
                  setConfig((prev) => prev ? { ...prev, [tokenField]: event.target.value } : prev);
                  setSaved(false);
                }}
                placeholder={config.provider === "github" ? "ghp_..." : "sk-..."}
                className="w-full rounded-[22px] border-2 border-slate-200 dark:border-gray-600 bg-white/95 dark:bg-gray-800 py-3 pl-10 pr-3 text-sm font-mono dark:text-gray-200 outline-none transition-colors focus:border-blue-500"
              />
            </div>
            <p className="text-xs text-slate-400 dark:text-gray-500 mb-5">{t(selectedProvider.helpText)}</p>
          </>
        )}

        <label className="text-sm font-semibold text-slate-700 dark:text-gray-300 mb-2 block">{t("model")}</label>
        {selectedProvider.models.length > 0 ? (
          <div className="mb-5 space-y-2">
            <input
              type="text"
              value={modelQuery}
              onChange={(event) => setModelQuery(event.target.value)}
              placeholder={t("searchModelPlaceholder")}
              className="w-full rounded-[22px] border-2 border-slate-200 dark:border-gray-600 bg-white/95 dark:bg-gray-800 px-3 py-3 text-sm dark:text-gray-200 outline-none transition-colors focus:border-blue-500"
            />
            <div className="max-h-80 overflow-y-auto rounded-[22px] border border-slate-200 dark:border-gray-600 bg-white/95 dark:bg-gray-800/95 p-2 scrollbar-thin shadow-[0_10px_24px_rgba(15,23,42,0.05)]">
              {filteredProviderModels.length === 0 ? (
                <div className="px-3 py-3 text-xs text-slate-500 dark:text-gray-400">{t("noModelFound")}</div>
              ) : (
                <div className="space-y-1">
                  {filteredProviderModels.map((model) => {
                    const active = model.id === config.model;
                    return (
                      <button
                        key={model.id}
                        type="button"
                        onClick={() => {
                          setConfig((p) => (p ? { ...p, model: model.id } : p));
                          setSaved(false);
                        }}
                        className={`w-full rounded-xl border px-3 py-2.5 text-left transition-colors ${
                          active
                            ? "border-blue-500 bg-blue-50 dark:bg-blue-950/40"
                            : "border-transparent hover:border-slate-200 dark:hover:border-gray-600 hover:bg-slate-50 dark:hover:bg-gray-700"
                        }`}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <div className={`truncate text-sm font-medium ${active ? "text-blue-700 dark:text-blue-400" : "text-slate-800 dark:text-gray-300"}`}>
                              {model.id}
                            </div>
                            <div className="text-[11px] text-slate-400 dark:text-gray-500">{model.family}</div>
                          </div>
                          {model.tags.length > 0 && (
                            <div className="flex shrink-0 flex-wrap items-center justify-end gap-1">
                              {model.tags.map(renderTag)}
                            </div>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        ) : (
          <input
            type="text"
            value={config.model}
            onChange={(e) => { setConfig((p) => p ? ({ ...p, model: e.target.value }) : p); setSaved(false); }}
            placeholder="model-name"
            className="mb-5 w-full rounded-[22px] border-2 border-slate-200 dark:border-gray-600 bg-white/95 dark:bg-gray-800 p-3 text-sm dark:text-gray-200 outline-none transition-colors focus:border-blue-500"
          />
        )}

        {config.provider === "custom" && (
          <>
            <label className="text-sm font-semibold text-slate-700 dark:text-gray-300 mb-2 block">{t("apiUrl")}</label>
            <input
              type="text"
              value={config.custom_api_url}
              onChange={(e) => { setConfig((p) => p ? ({ ...p, custom_api_url: e.target.value }) : p); setSaved(false); }}
              placeholder="http://localhost:11434/v1/chat/completions"
              className="mb-5 w-full rounded-[22px] border-2 border-slate-200 dark:border-gray-600 bg-white/95 dark:bg-gray-800 p-3 text-sm font-mono dark:text-gray-200 outline-none transition-colors focus:border-blue-500"
            />
          </>
        )}

        {!!statusMessage && (
          <div className="mb-4 rounded-[22px] border border-slate-200 dark:border-gray-700 bg-white/90 dark:bg-gray-700/90 px-3 py-2 text-xs text-slate-600 dark:text-gray-300 shadow-[0_10px_24px_rgba(15,23,42,0.05)]">
            {statusMessage}
          </div>
        )}

        <button
          onClick={handleSave}
          disabled={saving}
          className={`flex w-full items-center justify-center gap-2 rounded-[22px] p-3 text-sm font-semibold transition-all duration-300 ${
            saved
              ? "bg-green-500 text-white"
              : "bg-gradient-to-r from-blue-500 to-purple-600 text-white hover:from-blue-600 hover:to-purple-700"
          } disabled:cursor-not-allowed disabled:opacity-50`}
        >
          {saved ? (
            <>
              <Check className="w-4 h-4" /> {t("savedLabel")}
            </>
          ) : (
            t("saveSettings")
          )}
        </button>
      </div>
    </div>
  );
}
