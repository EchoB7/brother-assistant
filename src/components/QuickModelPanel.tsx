import { useEffect, useMemo, useState } from "react";
import { AlertCircle, CheckCircle2, Layers3, Sparkles, X } from "lucide-react";
import { PROVIDER_SPECS, getProviderModels, getProviderSpec, groupModelsByFamily } from "../modelCatalog";
import { useI18n } from "../i18n";
import type { SettingsState } from "../types";

interface QuickModelPanelProps {
  open: boolean;
  disabled?: boolean;
  settingsState: SettingsState;
  onClose: () => void;
  onSelectProvider: (provider: string) => void;
  onSelectModel: (model: string) => void;
}

function hasProviderCredential(settingsState: SettingsState) {
  if (settingsState.provider === "copilot") {
    return settingsState.copilot_accounts.length > 0;
  }

  const providerAccounts = settingsState.provider_accounts?.[settingsState.provider] ?? [];
  if (providerAccounts.length > 0) {
    return providerAccounts.some((account) => Boolean(account.api_key));
  }

  const provider = getProviderSpec(settingsState.provider);
  const tokenField = provider.tokenField as keyof SettingsState | null;
  if (!tokenField) {
    return true;
  }

  return Boolean(settingsState[tokenField]);
}

export default function QuickModelPanel({
  open,
  disabled,
  settingsState,
  onClose,
  onSelectProvider,
  onSelectModel,
}: QuickModelPanelProps) {
  const { t } = useI18n();
  const selectedProvider = useMemo(
    () => getProviderSpec(settingsState.provider),
    [settingsState.provider]
  );
  const [customModel, setCustomModel] = useState(settingsState.model);
  const [modelQuery, setModelQuery] = useState("");

  useEffect(() => {
    setCustomModel(settingsState.model);
    setModelQuery("");
  }, [settingsState.model, settingsState.provider]);

  const providerReady = hasProviderCredential(settingsState);
  const filteredModels = useMemo(() => {
    const providerModels = getProviderModels(settingsState.provider);
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
  }, [modelQuery, settingsState.provider]);
  const groupedModels = useMemo(() => groupModelsByFamily(filteredModels), [filteredModels]);

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

  return (
    <>
      <div
        aria-hidden={!open}
        onClick={onClose}
        className={`absolute inset-0 z-20 bg-slate-950/12 dark:bg-black/40 backdrop-blur-[2px] transition-opacity duration-300 ${
          open ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
      />

      <aside
        className={`absolute inset-y-0 right-0 z-30 flex w-[min(22rem,calc(100%-1rem))] flex-col border-l border-white/70 dark:border-gray-700 bg-[linear-gradient(180deg,rgba(255,255,255,0.96),rgba(248,250,252,0.92))] dark:bg-[linear-gradient(180deg,rgba(17,24,39,0.98),rgba(31,41,55,0.95))] shadow-2xl backdrop-blur-2xl transition-transform duration-300 ${
          open ? "translate-x-0" : "pointer-events-none translate-x-full"
        }`}
      >
        <div className="flex items-start justify-between gap-3 border-b border-slate-200/80 dark:border-gray-700 px-5 py-4">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400 dark:text-gray-500">
              {t("session")}
            </div>
            <h3 className="mt-1 text-base font-bold text-slate-900 dark:text-gray-100">{t("providerAndModel")}</h3>
            <p className="mt-1 text-xs text-slate-500 dark:text-gray-400">
              {t("quickModelDescription")}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-9 w-9 items-center justify-center rounded-xl text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800 dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-white"
            aria-label={t("closeQuickPanel")}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          <div className="rounded-[24px] border border-white/70 dark:border-gray-700 bg-[linear-gradient(135deg,rgba(248,250,252,0.98),rgba(255,255,255,0.95))] dark:bg-[linear-gradient(135deg,rgba(31,41,55,0.98),rgba(17,24,39,0.95))] p-4 shadow-[0_14px_32px_rgba(15,23,42,0.06)]">
            <div className="flex items-start gap-3">
              <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-blue-50 text-blue-600">
                <Sparkles className="h-5 w-5" />
              </span>
              <div className="min-w-0">
                <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400 dark:text-gray-500">
                  {t("current")}
                </div>
                <div className="mt-1 truncate text-sm font-semibold text-slate-900 dark:text-gray-100">
                  {selectedProvider.label}
                </div>
                <div className="truncate text-xs text-slate-500 dark:text-gray-400">{settingsState.model}</div>
              </div>
            </div>

            <div
              className={`mt-4 flex items-center gap-2 rounded-xl border px-3 py-2 text-xs ${
                providerReady
                  ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                  : "border-amber-200 bg-amber-50 text-amber-700"
              }`}
            >
              {providerReady ? (
                <CheckCircle2 className="h-4 w-4 shrink-0" />
              ) : (
                <AlertCircle className="h-4 w-4 shrink-0" />
              )}
              <span>
                {providerReady
                  ? t("credentialReady")
                  : selectedProvider.name === "copilot"
                    ? t("addCopilotAccount")
                    : t("noTokenForProvider")}
              </span>
            </div>
          </div>

          <section className="mt-5">
            <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-700 dark:text-gray-300">
              <Layers3 className="h-4 w-4 text-slate-400" />
              {t("provider")}
            </div>
            <div className="grid max-h-64 gap-2 overflow-y-auto pr-1 scrollbar-thin">
              {PROVIDER_SPECS.map((provider) => {
                const active = provider.name === settingsState.provider;
                return (
                  <button
                    key={provider.name}
                    type="button"
                    disabled={disabled}
                    onClick={() => onSelectProvider(provider.name)}
                    className={`rounded-[22px] border px-3 py-3 text-left shadow-[0_10px_24px_rgba(15,23,42,0.04)] transition-all ${
                      active
                        ? "border-blue-500 bg-blue-50 text-blue-700 shadow-sm"
                        : "border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300 dark:hover:border-gray-500 dark:hover:bg-gray-700"
                    } disabled:cursor-not-allowed disabled:opacity-60`}
                  >
                    <div className="text-sm font-semibold">{provider.label}</div>
                    <div className="mt-1 text-[11px] text-slate-500 dark:text-gray-400">{t(provider.summary)}</div>
                    <div className="mt-1 text-[10px] text-slate-400 dark:text-gray-500">{provider.endpoint}</div>
                  </button>
                );
              })}
            </div>
          </section>

          <section className="mt-5">
            <div className="mb-2 text-sm font-semibold text-slate-700 dark:text-gray-300">{t("model")}</div>
            {selectedProvider.models.length > 0 ? (
              <div className="space-y-2">
                <input
                  type="text"
                  value={modelQuery}
                  disabled={disabled}
                  onChange={(event) => setModelQuery(event.target.value)}
                  placeholder={t("searchModel")}
                  className="w-full rounded-2xl border border-slate-200 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-3 text-sm text-slate-800 dark:text-gray-200 outline-none transition-colors focus:border-blue-500 disabled:cursor-not-allowed disabled:opacity-60"
                />
                <div className="max-h-56 overflow-y-auto rounded-[22px] border border-slate-200 dark:border-gray-600 bg-white/95 dark:bg-gray-800/95 p-2 scrollbar-thin shadow-[0_10px_24px_rgba(15,23,42,0.04)]">
                  {filteredModels.length === 0 ? (
                    <div className="px-3 py-2 text-xs text-slate-500 dark:text-gray-400">{t("noModelFound")}</div>
                  ) : (
                    Object.entries(groupedModels).map(([family, models]) => (
                      <div key={family} className="mb-3 last:mb-0">
                        <div className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400 dark:text-gray-500">
                          {family}
                        </div>
                        <div className="space-y-1">
                          {models.map((model) => {
                            const active = model.id === settingsState.model;
                            return (
                              <button
                                key={model.id}
                                type="button"
                                disabled={disabled}
                                onClick={() => onSelectModel(model.id)}
                                className={`w-full rounded-xl px-3 py-2.5 text-left text-sm transition-colors ${
                                  active
                                    ? "bg-blue-50 text-blue-700 font-semibold dark:bg-blue-950/40 dark:text-blue-400"
                                    : "text-slate-700 hover:bg-slate-50 dark:text-gray-300 dark:hover:bg-gray-700"
                                } disabled:cursor-not-allowed disabled:opacity-60`}
                              >
                                <div className="flex items-center justify-between gap-3">
                                  <span className="min-w-0 truncate">{model.id}</span>
                                  {model.tags.length > 0 && (
                                    <span className="flex shrink-0 flex-wrap items-center justify-end gap-1">
                                      {model.tags.map(renderTag)}
                                    </span>
                                  )}
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                <input
                  type="text"
                  value={customModel}
                  disabled={disabled}
                  onChange={(event) => setCustomModel(event.target.value)}
                  placeholder="nome-do-modelo"
                  className="w-full rounded-2xl border border-slate-200 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-3 text-sm text-slate-800 dark:text-gray-200 outline-none transition-colors focus:border-blue-500 disabled:cursor-not-allowed disabled:opacity-60"
                />
                <button
                  type="button"
                  disabled={disabled || !customModel.trim() || customModel.trim() === settingsState.model}
                  onClick={() => onSelectModel(customModel.trim())}
                  className="w-full rounded-2xl bg-slate-900 dark:bg-gray-700 px-3 py-3 text-sm font-semibold text-white transition-colors hover:bg-slate-800 dark:hover:bg-gray-600 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Aplicar modelo custom
                </button>
              </div>
            )}
            <p className="mt-2 text-xs text-slate-400 dark:text-gray-500">{t(selectedProvider.helpText)}</p>
          </section>
        </div>
      </aside>
    </>
  );
}