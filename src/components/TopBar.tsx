import { Bot, Menu, MessageSquarePlus, Minus, Moon, Settings, SlidersHorizontal, Square, Sun, X } from "lucide-react";
import { controlWindow } from "../platform/host";
import { useCallback } from "react";
import { useI18n } from "../i18n";

interface TopBarProps {
  onSettingsClick?: () => void;
  onQuickConfigClick?: () => void;
  onAgentModeToggle?: () => void;
  showQuickConfigButton?: boolean;
  quickConfigOpen?: boolean;
  providerLabel?: string;
  currentModel?: string;
  agentModeEnabled?: boolean;
  onToggleSidebar?: () => void;
  onNewConversation?: () => void;
  darkMode?: boolean;
  onToggleDarkMode?: () => void;
}

export default function TopBar({
  onSettingsClick,
  onQuickConfigClick,
  onAgentModeToggle,
  showQuickConfigButton,
  quickConfigOpen,
  providerLabel,
  currentModel,
  agentModeEnabled,
  onToggleSidebar,
  onNewConversation,
  darkMode,
  onToggleDarkMode,
}: TopBarProps) {
  const { t } = useI18n();
  const handleDragStart = useCallback((e: React.MouseEvent) => {
    // Only drag when clicking directly on the bar, not on buttons
    if ((e.target as HTMLElement).closest('button')) return;
    controlWindow('startDrag');
  }, []);

  return (
    <div
      data-tauri-drag-region
      onMouseDown={handleDragStart}
      className={`shrink-0 cursor-grab active:cursor-grabbing ${darkMode ? "bg-gradient-to-r from-gray-900 to-gray-800" : "bg-gradient-to-r from-white to-slate-50"}`}
    >
      {/* Linha 1: título + controles da janela */}
      <div className="flex items-center justify-between px-4 pt-3 pb-1">
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={onToggleSidebar}
            className={`flex h-7 w-7 items-center justify-center rounded-md transition-colors ${darkMode ? "hover:bg-gray-700" : "hover:bg-slate-200/60"}`}
            title={t("conversations")}
          >
            <Menu className={`w-3.5 h-3.5 ${darkMode ? "text-gray-400" : "text-slate-500"}`} />
          </button>
          <button
            type="button"
            onClick={onNewConversation}
            className={`flex h-7 w-7 items-center justify-center rounded-md transition-colors ${darkMode ? "hover:bg-gray-700" : "hover:bg-slate-200/60"}`}
            title={t("newConversation")}
          >
            <MessageSquarePlus className={`w-3.5 h-3.5 ${darkMode ? "text-gray-400" : "text-slate-500"}`} />
          </button>
          <div className="relative flex h-6 w-6 items-center justify-center rounded-lg bg-gradient-to-br from-blue-500 via-purple-500 to-pink-500 shadow">
            <svg className="w-3.5 h-3.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
          </div>
          <h2 className={`text-sm font-bold tracking-tight ${darkMode ? "text-white" : "text-slate-900"}`}>Brother</h2>
        </div>
        <div className="flex items-center gap-0.5">
          <button type="button" onClick={onToggleDarkMode} className={`flex h-7 w-7 items-center justify-center rounded-md transition-colors ${darkMode ? "hover:bg-gray-700" : "hover:bg-slate-200/60"}`} title={darkMode ? t("lightMode") : t("darkMode")}>
            {darkMode ? <Sun className="w-3.5 h-3.5 text-yellow-400" /> : <Moon className="w-3.5 h-3.5 text-slate-500" />}
          </button>
          <button type="button" onClick={onSettingsClick} className={`flex h-7 w-7 items-center justify-center rounded-md transition-colors ${darkMode ? "hover:bg-gray-700" : "hover:bg-slate-200/60"}`}>
            <Settings className={`w-3.5 h-3.5 ${darkMode ? "text-gray-400" : "text-slate-500"}`} />
          </button>
          <button type="button" onClick={() => void controlWindow("minimize")} className={`flex h-7 w-7 items-center justify-center rounded-md transition-colors ${darkMode ? "hover:bg-gray-700" : "hover:bg-slate-200/60"}`}>
            <Minus className={`w-3.5 h-3.5 ${darkMode ? "text-gray-400" : "text-slate-500"}`} />
          </button>
          <button type="button" onClick={() => void controlWindow("toggleMaximize")} className={`flex h-7 w-7 items-center justify-center rounded-md transition-colors ${darkMode ? "hover:bg-gray-700" : "hover:bg-slate-200/60"}`}>
            <Square className={`w-3 h-3 ${darkMode ? "text-gray-400" : "text-slate-500"}`} />
          </button>
          <button type="button" onClick={() => void controlWindow("close")} className={`flex h-7 w-7 items-center justify-center rounded-md transition-colors ${darkMode ? "text-gray-400 hover:bg-red-500 hover:text-white" : "text-slate-500 hover:bg-red-500 hover:text-white"}`}>
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Linha 2: modo + sessão */}
      <div className="flex items-center gap-2 px-4 pb-3">
        <button
          type="button"
          onClick={onAgentModeToggle}
          className={`flex h-8 items-center gap-1.5 rounded-lg border px-2.5 transition-all duration-200 ${
            agentModeEnabled
              ? "border-emerald-200 bg-emerald-50 text-emerald-700"
              : darkMode
                ? "border-gray-600 bg-gray-700/80 text-gray-300 hover:bg-gray-700"
                : "border-slate-200 bg-white/80 text-slate-600 hover:bg-slate-100"
          }`}
        >
          <Bot className="h-3.5 w-3.5 shrink-0" />
          <span className="text-xs font-semibold">{agentModeEnabled ? t("agent") : t("chat")}</span>
        </button>
        {showQuickConfigButton && (
          <button
            type="button"
            onClick={onQuickConfigClick}
            className={`flex h-8 min-w-0 flex-1 items-center gap-1.5 rounded-lg border px-2.5 transition-all duration-200 ${
              quickConfigOpen
                ? "border-blue-200 bg-blue-50 text-blue-700"
                : darkMode
                  ? "border-gray-600 bg-gray-700/80 text-gray-300 hover:bg-gray-700"
                  : "border-slate-200 bg-white/80 text-slate-600 hover:bg-slate-100"
            }`}
          >
            <SlidersHorizontal className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate text-xs font-semibold">
              {providerLabel || "Provedor"} · {currentModel || "Modelo"}
            </span>
          </button>
        )}
      </div>
    </div>
  );
}
