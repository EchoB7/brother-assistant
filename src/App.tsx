import { useState, useCallback, useEffect, useRef } from "react";
import TopBar from "./components/TopBar";
import QuickActions from "./components/QuickActions";
import ChatPanel from "./components/ChatPanel";
import Composer from "./components/Composer";
import QuickModelPanel from "./components/QuickModelPanel";
import Settings from "./components/Settings";
import ConversationSidebar from "./components/ConversationSidebar";
import { getProviderSpec } from "./modelCatalog";
import { invokeCommand, listenEvent } from "./platform/host";
import type { Message, SettingsState, FileAttachment } from "./types";

function createId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

/* ── Persistência local de conversas ── */
interface StoredConversation {
  id: string;
  title: string;
  messages: Message[];
  updatedAt: string;
}

const CONV_STORAGE_KEY = "brother.conversations.v1";
const ACTIVE_CONV_KEY = "brother.activeConversation.v1";

function loadConversations(): StoredConversation[] {
  try {
    const raw = localStorage.getItem(CONV_STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveConversations(convs: StoredConversation[]) {
  localStorage.setItem(CONV_STORAGE_KEY, JSON.stringify(convs));
}

function loadActiveId(): string | null {
  return localStorage.getItem(ACTIVE_CONV_KEY);
}

function saveActiveId(id: string) {
  localStorage.setItem(ACTIVE_CONV_KEY, id);
}

function titleFromMessages(msgs: Message[]): string {
  const first = msgs.find((m) => m.role === "user");
  if (!first) return "Nova conversa";
  const text = first.content.slice(0, 40);
  return text.length < first.content.length ? text + "…" : text;
}

export default function App() {
  const [conversations, setConversations] = useState<StoredConversation[]>(() => loadConversations());
  const [activeConvId, setActiveConvId] = useState<string>(() => {
    const saved = loadActiveId();
    if (saved && loadConversations().some((c) => c.id === saved)) return saved;
    return "";
  });
  const [isTyping, setIsTyping] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showQuickModelPanel, setShowQuickModelPanel] = useState(false);
  const [showSidebar, setShowSidebar] = useState(false);
  const [isUpdatingRuntimeConfig, setIsUpdatingRuntimeConfig] = useState(false);
  const [settingsState, setSettingsState] = useState<SettingsState | null>(null);
  const [darkMode, setDarkMode] = useState(() => localStorage.getItem("brother.darkMode") === "true");
  const assistantIdRef = useRef<string>("");
  const abortRef = useRef(false);

  // Active conversation messages
  const activeConv = conversations.find((c) => c.id === activeConvId);
  const messages = activeConv?.messages ?? [];

  // Dark mode effect
  useEffect(() => {
    document.documentElement.classList.toggle("dark", darkMode);
    localStorage.setItem("brother.darkMode", String(darkMode));
  }, [darkMode]);

  // Persist conversations on every change
  useEffect(() => {
    saveConversations(conversations);
  }, [conversations]);

  useEffect(() => {
    if (activeConvId) saveActiveId(activeConvId);
  }, [activeConvId]);

  const setMessages = useCallback(
    (updater: (prev: Message[]) => Message[]) => {
      setConversations((prev) =>
        prev.map((c) => {
          if (c.id !== activeConvId) return c;
          const newMsgs = updater(c.messages);
          return {
            ...c,
            messages: newMsgs,
            title: titleFromMessages(newMsgs),
            updatedAt: new Date().toISOString(),
          };
        })
      );
    },
    [activeConvId]
  );

  const persistSettings = useCallback(async (nextState: SettingsState) => {
    setIsUpdatingRuntimeConfig(true);
    try {
      const updated = await invokeCommand<SettingsState>("set_settings_state", {
        update: nextState,
      });
      setSettingsState(updated);
      return updated;
    } finally {
      setIsUpdatingRuntimeConfig(false);
    }
  }, []);

  const refreshSettings = useCallback(async () => {
    try {
      const state = await invokeCommand<SettingsState>("get_settings_state");
      setSettingsState(state);
    } catch (error) {
      console.error(error);
    }
  }, []);

  useEffect(() => {
    refreshSettings();

    const unlisten1 = listenEvent<string>("chat-stream-chunk", (chunk) => {
      if (abortRef.current) return;
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantIdRef.current
            ? { ...m, content: m.content + chunk }
            : m
        )
      );
    });

    const unlisten2 = listenEvent("chat-stream-done", () => {
      setIsTyping(false);
      abortRef.current = false;
    });

    return () => {
      unlisten1.then((fn) => fn());
      unlisten2.then((fn) => fn());
    };
  }, [refreshSettings, setMessages]);

  const handleChangeModel = useCallback(
    async (model: string) => {
      if (!settingsState || settingsState.model === model) return;
      try {
        await persistSettings({ ...settingsState, model });
      } catch (error) {
        console.error(error);
      }
    },
    [persistSettings, settingsState]
  );

  const handleChangeProvider = useCallback(
    async (providerName: string) => {
      if (!settingsState || settingsState.provider === providerName) return;
      const provider = getProviderSpec(providerName);
      const nextModel = provider.models.includes(settingsState.model)
        ? settingsState.model
        : provider.models[0] || settingsState.model;
      try {
        await persistSettings({ ...settingsState, provider: providerName, model: nextModel });
      } catch (error) {
        console.error(error);
      }
    },
    [persistSettings, settingsState]
  );

  const handleToggleAgentMode = useCallback(async () => {
    if (!settingsState) return;
    try {
      await persistSettings({ ...settingsState, agent_mode: !settingsState.agent_mode });
    } catch (error) {
      console.error(error);
    }
  }, [persistSettings, settingsState]);

  const handleCloseSettings = useCallback(async () => {
    await refreshSettings();
    setShowSettings(false);
  }, [refreshSettings]);

  const handleNewConversation = useCallback(() => {
    const newConv: StoredConversation = {
      id: createId(),
      title: "Nova conversa",
      messages: [],
      updatedAt: new Date().toISOString(),
    };
    setConversations((prev) => [newConv, ...prev]);
    setActiveConvId(newConv.id);
    setShowSidebar(false);
  }, []);

  const handleSelectConversation = useCallback((id: string) => {
    setActiveConvId(id);
    setShowSidebar(false);
  }, []);

  const handleDeleteConversation = useCallback(
    (id: string) => {
      setConversations((prev) => {
        const next = prev.filter((c) => c.id !== id);
        if (id === activeConvId) {
          setActiveConvId(next[0]?.id ?? "");
        }
        return next;
      });
    },
    [activeConvId]
  );

  const handleExportConversation = useCallback(
    (id: string) => {
      const conv = conversations.find((c) => c.id === id);
      if (!conv) return;
      const lines = [
        `# ${conv.title}`,
        `Exportado em ${new Date().toLocaleString("pt-BR")}`,
        "",
        ...conv.messages.map((m) => {
          const label = m.role === "user" ? "Você" : "Brother";
          const time = m.timestamp
            ? new Date(m.timestamp).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })
            : "";
          return `## ${label} ${time}\n${m.content}\n`;
        }),
      ];
      const blob = new Blob([lines.join("\n")], { type: "text/markdown;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${conv.title.replace(/[^a-zA-Z0-9\u00C0-\u024F ]/g, "").trim().replace(/\s+/g, "-").slice(0, 50)}.md`;
      a.click();
      URL.revokeObjectURL(url);
    },
    [conversations]
  );

  const handleSend = useCallback(
    async (text: string, attachments?: FileAttachment[]) => {
      abortRef.current = false;
      let convId = activeConvId;

      // Read file contents for attachments
      let fullText = text;
      if (attachments?.length) {
        const parts: string[] = [];
        for (const att of attachments) {
          try {
            if (att.type === "image") {
              const dataUrl = await invokeCommand<string>("read_image", { path: att.path });
              parts.push(`[Imagem anexada: ${att.name}]\n(conteúdo visual em base64 — descreva se possível)`);
            } else {
              const content = await invokeCommand<string>("read_file", { path: att.path });
              parts.push(`--- Conteúdo de ${att.name} ---\n${content}\n--- Fim de ${att.name} ---`);
            }
          } catch (err: any) {
            parts.push(`[Erro ao ler ${att.name}: ${err?.message || err}]`);
          }
        }
        const attachmentContext = parts.join("\n\n");
        fullText = fullText
          ? `${attachmentContext}\n\n${fullText}`
          : `Analise o conteúdo deste(s) arquivo(s):\n\n${attachmentContext}`;
      }

      // Create a new conversation if none active
      if (!convId) {
        const newConv: StoredConversation = {
          id: createId(),
          title: text.slice(0, 40) || (attachments?.[0]?.name ?? "Nova conversa"),
          messages: [],
          updatedAt: new Date().toISOString(),
        };
        setConversations((prev) => [newConv, ...prev]);
        convId = newConv.id;
        setActiveConvId(convId);
      }

      const timestamp = new Date().toISOString();
      const userMsg: Message = { id: createId(), role: "user", content: fullText, timestamp, attachments };
      const assistantMsg: Message = { id: createId(), role: "assistant", content: "", timestamp };
      assistantIdRef.current = assistantMsg.id;

      // Add messages to the conversation
      setConversations((prev) =>
        prev.map((c) => {
          if (c.id !== convId) return c;
          const newMsgs = [...c.messages, userMsg, assistantMsg];
          return { ...c, messages: newMsgs, title: titleFromMessages(newMsgs), updatedAt: timestamp };
        })
      );
      setIsTyping(true);

      const conv = conversations.find((c) => c.id === convId);
      const existingMsgs = conv?.messages ?? [];
      const chatHistory = [...existingMsgs, userMsg].map((m) => ({ role: m.role, content: m.content }));

      try {
        await invokeCommand("chat_stream", { messages: chatHistory });
      } catch (err: any) {
        const errorText = typeof err === "string" ? err : err?.message || "Erro desconhecido";
        setConversations((prev) =>
          prev.map((c) => {
            if (c.id !== convId) return c;
            return {
              ...c,
              messages: c.messages.map((m) =>
                m.id === assistantIdRef.current ? { ...m, content: `⚠️ ${errorText}` } : m
              ),
            };
          })
        );
        setIsTyping(false);
      }
    },
    [activeConvId, conversations]
  );

  const handleStopGeneration = useCallback(() => {
    abortRef.current = true;
    setIsTyping(false);
  }, []);

  const handleRegenerate = useCallback(async () => {
    if (!activeConv || activeConv.messages.length < 2) return;
    // Find last user message
    const lastUserIdx = (() => {
      for (let i = activeConv.messages.length - 1; i >= 0; i--) {
        if (activeConv.messages[i].role === "user") return i;
      }
      return -1;
    })();
    if (lastUserIdx < 0) return;

    const lastUserMsg = activeConv.messages[lastUserIdx];
    // Remove last assistant message
    const trimmedMsgs = activeConv.messages.slice(0, lastUserIdx + 1);
    const assistantMsg: Message = { id: createId(), role: "assistant", content: "", timestamp: new Date().toISOString() };
    assistantIdRef.current = assistantMsg.id;
    abortRef.current = false;

    setConversations((prev) =>
      prev.map((c) => {
        if (c.id !== activeConvId) return c;
        return { ...c, messages: [...trimmedMsgs, assistantMsg], updatedAt: new Date().toISOString() };
      })
    );
    setIsTyping(true);

    const chatHistory = trimmedMsgs.map((m) => ({ role: m.role, content: m.content }));
    try {
      await invokeCommand("chat_stream", { messages: chatHistory });
    } catch (err: any) {
      const errorText = typeof err === "string" ? err : err?.message || "Erro desconhecido";
      setConversations((prev) =>
        prev.map((c) => {
          if (c.id !== activeConvId) return c;
          return {
            ...c,
            messages: c.messages.map((m) =>
              m.id === assistantIdRef.current ? { ...m, content: `⚠️ ${errorText}` } : m
            ),
          };
        })
      );
      setIsTyping(false);
    }
  }, [activeConv, activeConvId]);

  const hasMessages = messages.length > 0;
  const currentProvider = settingsState?.provider ?? "copilot";
  const currentModel = settingsState?.model ?? "gpt-4.1";
  const providerSpec = getProviderSpec(currentProvider);

  return (
    <div className="flex h-screen w-screen overflow-hidden rounded-2xl bg-white dark:bg-gray-900">
      {/* Sidebar de conversas */}
      <ConversationSidebar
        open={showSidebar}
        conversations={conversations}
        activeId={activeConvId}
        darkMode={darkMode}
        onSelect={handleSelectConversation}
        onNew={handleNewConversation}
        onDelete={handleDeleteConversation}
        onExport={handleExportConversation}
        onClose={() => setShowSidebar(false)}
      />

      {/* Área principal */}
      <div className="flex flex-1 flex-col min-w-0">
        <TopBar
          onSettingsClick={() => {
            setShowQuickModelPanel(false);
            setShowSettings(true);
          }}
          onAgentModeToggle={handleToggleAgentMode}
          onQuickConfigClick={() => setShowQuickModelPanel((v) => !v)}
          showQuickConfigButton={!showSettings}
          quickConfigOpen={showQuickModelPanel}
          providerLabel={providerSpec.label}
          currentModel={currentModel}
          agentModeEnabled={settingsState?.agent_mode ?? false}
          onToggleSidebar={() => setShowSidebar((v) => !v)}
          onNewConversation={handleNewConversation}
          darkMode={darkMode}
          onToggleDarkMode={() => setDarkMode((v) => !v)}
        />

        <div className="relative flex flex-col flex-1 min-h-0 overflow-hidden">
          {showSettings ? (
            <Settings onClose={handleCloseSettings} />
          ) : hasMessages ? (
            <ChatPanel messages={messages} isTyping={isTyping} onRegenerate={handleRegenerate} />
          ) : (
            <QuickActions onAction={handleSend} />
          )}

          {!showSettings && settingsState && (
            <QuickModelPanel
              open={showQuickModelPanel}
              disabled={isUpdatingRuntimeConfig || isTyping}
              settingsState={settingsState}
              onClose={() => setShowQuickModelPanel(false)}
              onSelectProvider={handleChangeProvider}
              onSelectModel={handleChangeModel}
            />
          )}
        </div>

        {!showSettings && (
          <Composer onSend={handleSend} onStop={handleStopGeneration} disabled={isTyping} isTyping={isTyping} />
        )}
      </div>
    </div>
  );
}
