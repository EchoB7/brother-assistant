import { useEffect, useRef, useState, useCallback } from "react";
import { Check, Copy, RefreshCw, ThumbsDown, ThumbsUp, User, Volume2, VolumeX } from "lucide-react";
import MarkdownRenderer from "./MarkdownRenderer";
import { useI18n } from "../i18n";
import type { Message } from "../types";

interface ChatPanelProps {
  messages: Message[];
  isTyping?: boolean;
  onRegenerate?: () => void;
}

function AssistantAvatar() {
  return (
    <div className="relative">
      <div className="absolute inset-0 bg-gradient-to-br from-blue-500 via-purple-500 to-pink-500 rounded-xl animate-pulse opacity-20 blur-md" />
      <div className="relative w-9 h-9 rounded-xl flex items-center justify-center shrink-0 bg-gradient-to-br from-blue-500 via-purple-500 to-pink-500 shadow-lg">
        <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
        </svg>
      </div>
    </div>
  );
}

function CopyMessageButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const { t } = useI18n();
  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [text]);

  return (
    <button
      onClick={handleCopy}
      className="flex items-center gap-1 rounded-md p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 dark:text-gray-500 dark:hover:bg-gray-700 dark:hover:text-gray-300"
      title={t("copyMessage")}
    >
      {copied ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
    </button>
  );
}

function FeedbackButtons() {
  const [feedback, setFeedback] = useState<"up" | "down" | null>(null);
  const { t } = useI18n();
  return (
    <>
      <button
        onClick={() => setFeedback(feedback === "up" ? null : "up")}
        className={`rounded-md p-1 transition-colors ${feedback === "up" ? "text-green-500" : "text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:text-gray-500 dark:hover:bg-gray-700 dark:hover:text-gray-300"}`}
        title={t("goodResponse")}
      >
        <ThumbsUp className="h-3.5 w-3.5" />
      </button>
      <button
        onClick={() => setFeedback(feedback === "down" ? null : "down")}
        className={`rounded-md p-1 transition-colors ${feedback === "down" ? "text-red-500" : "text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:text-gray-500 dark:hover:bg-gray-700 dark:hover:text-gray-300"}`}
        title={t("badResponse")}
      >
        <ThumbsDown className="h-3.5 w-3.5" />
      </button>
    </>
  );
}

function SpeakButton({ text }: { text: string }) {
  const [isSpeaking, setIsSpeaking] = useState(false);
  const { t, locale } = useI18n();

  const handleSpeak = useCallback(async () => {
    const { invokeCommand } = await import("../platform/host");
    if (isSpeaking) {
      try { await invokeCommand("stop_speaking"); } catch {}
      setIsSpeaking(false);
      return;
    }
    try {
      await invokeCommand("speak_text", { text, locale });
      setIsSpeaking(true);
      // Poll to detect when speech ends (espeak-ng process finishes)
      const poll = setInterval(async () => {
        // Simple timeout — espeak typically speaks ~150 words/min
        // We just auto-reset after a generous estimate
      }, 1000);
      const wordCount = text.split(/\s+/).length;
      const estimatedMs = Math.max(3000, (wordCount / 2.5) * 1000);
      setTimeout(() => {
        clearInterval(poll);
        setIsSpeaking(false);
      }, estimatedMs);
    } catch {
      // Fallback: try Web Speech API
      if (window.speechSynthesis) {
        const plain = text.replace(/```[\s\S]*?```/g, "").replace(/[#*_`~>\[\]()!|]/g, "").replace(/\n+/g, ". ").trim();
        const utterance = new SpeechSynthesisUtterance(plain);
        const langMap: Record<string, string> = {
          "en": "en-US", "pt-br": "pt-BR", "es": "es-ES", "ru": "ru-RU", "ja": "ja-JP",
          "zh": "zh-CN", "ar": "ar-SA", "de": "de-DE", "fr": "fr-FR", "it": "it-IT", "hi": "hi-IN",
        };
        utterance.lang = langMap[locale] || "pt-BR";
        utterance.onend = () => setIsSpeaking(false);
        utterance.onerror = () => setIsSpeaking(false);
        window.speechSynthesis.speak(utterance);
        setIsSpeaking(true);
      }
    }
  }, [text, isSpeaking, locale]);

  return (
    <button
      onClick={handleSpeak}
      className={`rounded-md p-1 transition-colors ${
        isSpeaking
          ? "text-blue-500 animate-pulse"
          : "text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:text-gray-500 dark:hover:bg-gray-700 dark:hover:text-gray-300"
      }`}
      title={isSpeaking ? t("stopSpeaking") : t("speakMessage")}
    >
      {isSpeaking ? <VolumeX className="h-3.5 w-3.5" /> : <Volume2 className="h-3.5 w-3.5" />}
    </button>
  );
}

export default function ChatPanel({ messages, isTyping, onRegenerate }: ChatPanelProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const shouldAutoScrollRef = useRef(true);
  const { t, locale } = useI18n();

  useEffect(() => {
    if (!shouldAutoScrollRef.current) return;
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, isTyping]);

  function handleScroll() {
    const el = containerRef.current;
    if (!el) return;
    shouldAutoScrollRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 96;
  }

  const lastAssistantIndex = (() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === "assistant") return i;
    }
    return -1;
  })();

  return (
    <div
      ref={containerRef}
      onScroll={handleScroll}
      className="flex-1 min-h-0 overflow-y-auto overscroll-contain scrollbar-thin"
    >
      {messages.map((msg, idx) => {
        const isAssistant = msg.role === "assistant";
        const timestamp = msg.timestamp
          ? new Date(msg.timestamp).toLocaleTimeString(locale === "en" ? "en-US" : locale === "es" ? "es" : "pt-BR", { hour: "2-digit", minute: "2-digit" })
          : null;
        const isLastAssistant = idx === lastAssistantIndex;
        const showActions = isAssistant && msg.content.length > 0 && !isTyping;

        return (
          <div
            key={msg.id}
            className={`group flex gap-3 p-5 transition-all duration-300 animate-msg-in ${
              isAssistant ? "bg-gradient-to-r from-blue-50/30 to-purple-50/30 hover:bg-slate-50/50 dark:from-blue-950/20 dark:to-purple-950/20 dark:hover:bg-gray-800/50" : ""
            }`}
          >
            {isAssistant ? (
              <AssistantAvatar />
            ) : (
              <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 bg-gradient-to-br from-slate-600 to-slate-700 shadow-lg">
                <User className="w-4 h-4 text-white" strokeWidth={2.5} />
              </div>
            )}
            <div className="flex-1 min-w-0">
              <div className="mb-2 flex items-center gap-2">
                <span className="font-bold text-sm text-slate-900 dark:text-gray-100">{isAssistant ? "Brother" : t("you")}</span>
                {timestamp && <span className="text-xs font-medium text-slate-400 dark:text-gray-500">{timestamp}</span>}
              </div>

              {isAssistant ? (
                <MarkdownRenderer content={msg.content} />
              ) : (
                <p className="text-sm leading-relaxed whitespace-pre-wrap text-slate-700 dark:text-gray-300">{msg.content}</p>
              )}

              {showActions && (
                <div className="mt-2 flex items-center gap-1 opacity-0 transition-opacity duration-200 group-hover:opacity-100">
                  <CopyMessageButton text={msg.content} />
                  <SpeakButton text={msg.content} />
                  <FeedbackButtons />
                  {isLastAssistant && onRegenerate && (
                    <button
                      onClick={onRegenerate}
                      className="flex items-center gap-1 rounded-md p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 dark:text-gray-500 dark:hover:bg-gray-700 dark:hover:text-gray-300"
                    >
                      <RefreshCw className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        );
      })}

      {isTyping && (
        <div className="flex gap-3 p-5 bg-gradient-to-r from-blue-50/30 to-purple-50/30 dark:from-blue-950/20 dark:to-purple-950/20">
          <AssistantAvatar />
          <div className="flex items-center pt-2">
            <div className="flex gap-1.5">
              <div className="w-2 h-2 bg-gradient-to-r from-blue-500 to-purple-500 rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
              <div className="w-2 h-2 bg-gradient-to-r from-purple-500 to-pink-500 rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
              <div className="w-2 h-2 bg-gradient-to-r from-pink-500 to-blue-500 rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
            </div>
          </div>
        </div>
      )}
      <div ref={endRef} className="h-4" />
    </div>
  );
}
