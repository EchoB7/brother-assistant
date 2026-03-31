import { useState, useRef, type FormEvent, type KeyboardEvent, type DragEvent } from "react";
import { Send, StopCircle, Paperclip, X, FileText, ImageIcon } from "lucide-react";
import { useI18n } from "../i18n";
import type { FileAttachment } from "../types";

interface ComposerProps {
  onSend: (text: string, attachments?: FileAttachment[]) => void;
  onStop?: () => void;
  disabled?: boolean;
  isTyping?: boolean;
}

export default function Composer({ onSend, onStop, disabled, isTyping }: ComposerProps) {
  const [text, setText] = useState("");
  const [isFocused, setIsFocused] = useState(false);
  const [attachments, setAttachments] = useState<FileAttachment[]>([]);
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { t } = useI18n();

  const IMAGE_EXTS = ["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg"];

  function fileType(name: string): "file" | "image" {
    const ext = name.split(".").pop()?.toLowerCase() ?? "";
    return IMAGE_EXTS.includes(ext) ? "image" : "file";
  }

  function addFiles(paths: string[]) {
    const newAttachments = paths
      .filter((p) => !attachments.some((a) => a.path === p))
      .map((p) => ({
        name: p.split("/").pop() ?? p,
        path: p,
        type: fileType(p),
      }));
    if (newAttachments.length) setAttachments((prev) => [...prev, ...newAttachments]);
  }

  function removeAttachment(path: string) {
    setAttachments((prev) => prev.filter((a) => a.path !== path));
  }

  function handleDrop(e: DragEvent) {
    e.preventDefault();
    setIsDragOver(false);
    const uris: string[] = [];
    if (e.dataTransfer.types.includes("text/uri-list")) {
      const text = e.dataTransfer.getData("text/uri-list");
      text.split("\n").forEach((line) => {
        const trimmed = line.trim();
        if (trimmed.startsWith("file://")) {
          uris.push(decodeURIComponent(trimmed.replace("file://", "")));
        }
      });
    }
    // Fallback: check files from dataTransfer
    if (!uris.length && e.dataTransfer.files.length) {
      Array.from(e.dataTransfer.files).forEach((f) => {
        if ((f as any).path) uris.push((f as any).path);
      });
    }
    if (uris.length) addFiles(uris);
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = text.trim();
    if ((!trimmed && !attachments.length) || disabled) return;
    onSend(trimmed, attachments.length ? attachments : undefined);
    setText("");
    setAttachments([]);
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  }

  return (
    <div
      className="shrink-0 bg-gradient-to-t from-white to-slate-50 p-5 dark:from-gray-900 dark:to-gray-800"
      onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
      onDragLeave={() => setIsDragOver(false)}
      onDrop={handleDrop}
    >
      {/* Drag overlay */}
      {isDragOver && (
        <div className="mb-3 flex items-center justify-center rounded-xl border-2 border-dashed border-blue-400 bg-blue-50 p-4 dark:bg-blue-900/30">
          <p className="text-sm font-medium text-blue-600 dark:text-blue-300">{t("dropFileHere")}</p>
        </div>
      )}

      {/* Attached files */}
      {attachments.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-2">
          {attachments.map((a) => (
            <div key={a.path} className="flex items-center gap-1.5 rounded-lg bg-slate-100 px-2.5 py-1.5 text-xs font-medium text-slate-700 dark:bg-gray-700 dark:text-slate-200">
              {a.type === "image" ? <ImageIcon className="h-3.5 w-3.5 text-purple-500" /> : <FileText className="h-3.5 w-3.5 text-blue-500" />}
              <span className="max-w-[120px] truncate">{a.name}</span>
              <button type="button" onClick={() => removeAttachment(a.path)} className="ml-0.5 rounded p-0.5 hover:bg-slate-200 dark:hover:bg-gray-600">
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      <form onSubmit={handleSubmit}>
        <div
          className={`flex items-end gap-2 rounded-2xl border-2 bg-white p-3 shadow-lg transition-all duration-300 dark:bg-gray-800 ${
            isFocused
              ? "border-blue-500 shadow-blue-500/20 shadow-xl"
              : "border-slate-200 hover:border-slate-300 dark:border-gray-600 dark:hover:border-gray-500"
          }`}
        >
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="rounded-lg p-2 text-slate-400 transition-all duration-200 hover:bg-blue-50 hover:text-blue-600 dark:hover:bg-gray-700"
            title={t("attachFile")}
          >
            <Paperclip className="h-4 w-4" />
          </button>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => {
              const files = e.target.files;
              if (!files) return;
              // For WebKitGTK, files may not have .path. Use name as fallback hint.
              const paths = Array.from(files).map((f) => (f as any).webkitRelativePath || (f as any).path || f.name);
              addFiles(paths);
              e.target.value = "";
            }}
          />
          <div className="flex flex-1 items-center">
            <input
              type="text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              onFocus={() => setIsFocused(true)}
              onBlur={() => setIsFocused(false)}
              onKeyDown={handleKeyDown}
              placeholder={attachments.length ? t("describeFile") : t("askAnything")}
              disabled={disabled}
              className="flex-1 bg-transparent px-2 text-sm font-medium text-slate-800 outline-none placeholder:text-slate-400 dark:text-slate-100"
            />
          </div>
          {isTyping ? (
            <button
              type="button"
              onClick={onStop}
              className="group relative overflow-hidden rounded-xl bg-gradient-to-br from-red-500 to-orange-500 p-2.5 text-white shadow-lg transition-all duration-300 hover:scale-105 hover:shadow-xl"
              title={t("stopGeneration")}
            >
              <StopCircle className="relative h-4 w-4" />
            </button>
          ) : (
            <button
              type="submit"
              disabled={(!text.trim() && !attachments.length) || disabled}
              className="group relative overflow-hidden rounded-xl bg-gradient-to-br from-blue-500 to-purple-600 p-2.5 text-white shadow-lg transition-all duration-300 hover:scale-105 hover:from-blue-600 hover:to-purple-700 hover:shadow-xl disabled:cursor-not-allowed disabled:opacity-40"
              title={t("sendMessage")}
            >
              <div className="absolute inset-0 bg-gradient-to-br from-white/20 to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
              <Send className="relative h-4 w-4" />
            </button>
          )}
        </div>
      </form>
      <p className="mt-3 text-center text-[10px] font-medium text-slate-400">
                {t("aiDisclaimerShort")}
      </p>
    </div>
  );
}
