import { useState, useCallback, useEffect, useId, type ComponentPropsWithoutRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { Check, Copy, Download } from "lucide-react";

function LocalImage({ src, alt, ...rest }: ComponentPropsWithoutRef<"img">) {
  const [dataUri, setDataUri] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const isLocal = typeof src === "string" && src.startsWith("/");

  useEffect(() => {
    if (!isLocal || !src) return;
    let cancelled = false;
    (async () => {
      try {
        const { invokeCommand } = await import("../platform/host");
        const uri = await invokeCommand<string>("read_image", { path: src });
        if (!cancelled) setDataUri(uri);
      } catch {
        if (!cancelled) setError(true);
      }
    })();
    return () => { cancelled = true; };
  }, [src, isLocal]);

  if (!isLocal) {
    return <img src={src} alt={alt} className="my-3 max-w-full rounded-xl shadow-md" {...rest} />;
  }
  if (error) {
    return <p className="text-xs text-red-500 italic">Não foi possível carregar a imagem: {src}</p>;
  }
  if (!dataUri) {
    return (
      <div className="my-3 flex h-48 w-full items-center justify-center rounded-xl border border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="group relative my-3 inline-block">
      <img src={dataUri} alt={alt || ""} className="max-w-full rounded-xl shadow-md" {...rest} />
      <a
        href={dataUri}
        download={src.split("/").pop() || "image.png"}
        className="absolute top-2 right-2 rounded-lg bg-black/50 p-1.5 text-white opacity-0 transition-opacity group-hover:opacity-100 hover:bg-black/70"
        title="Salvar imagem"
      >
        <Download className="h-4 w-4" />
      </a>
    </div>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [text]);

  return (
    <button
      onClick={handleCopy}
      className="flex items-center gap-1 rounded px-2 py-1 text-xs text-slate-300 transition-colors hover:bg-white/10 hover:text-white"
    >
      {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
      {copied ? "Copiado" : "Copiar"}
    </button>
  );
}

function CodeBlock(props: ComponentPropsWithoutRef<"code">) {
  const { children, className, ...rest } = props;
  const isInline = !className;
  const text = String(children).replace(/\n$/, "");

  if (isInline) {
    return (
      <code
        className="rounded bg-slate-100 px-1.5 py-0.5 text-[13px] font-mono text-pink-600 dark:bg-slate-800 dark:text-pink-400"
        {...rest}
      >
        {children}
      </code>
    );
  }

  const lang = className?.replace("language-", "") ?? "";

  if (lang === "mermaid") {
    return <MermaidBlock chart={text} />;
  }

  return (
    <div className="group relative my-3 rounded-lg border border-slate-200 bg-slate-900 dark:border-slate-700">
      <div className="flex items-center justify-between rounded-t-lg bg-slate-800 px-3 py-1.5">
        <span className="text-[11px] font-medium uppercase tracking-wider text-slate-400">
          {lang || "code"}
        </span>
        <CopyButton text={text} />
      </div>
      <pre className="overflow-x-auto p-3 text-[13px] leading-relaxed">
        <code className={className} {...rest}>
          {children}
        </code>
      </pre>
    </div>
  );
}

function MermaidBlock({ chart }: { chart: string }) {
  const elementId = useId().replace(/[:]/g, "-");
  const [svg, setSvg] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [themeVersion, setThemeVersion] = useState(0);

  useEffect(() => {
    if (typeof document === "undefined") return;

    const observer = new MutationObserver(() => {
      setThemeVersion((current) => current + 1);
    });

    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });

    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function renderChart() {
      try {
        const mermaid = (await import("mermaid")).default;
        const isDark = document.documentElement.classList.contains("dark");

        mermaid.initialize({
          startOnLoad: false,
          securityLevel: "loose",
          theme: isDark ? "dark" : "default",
        });

        const result = await mermaid.render(`brother-mermaid-${elementId}-${themeVersion}`, chart);
        if (!cancelled) {
          setSvg(result.svg);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setSvg("");
          setError(err instanceof Error ? err.message : "Falha ao renderizar diagrama.");
        }
      }
    }

    renderChart();

    return () => {
      cancelled = true;
    };
  }, [chart, elementId, themeVersion]);

  return (
    <div className="my-4 overflow-hidden rounded-xl border border-slate-200 bg-white p-3 shadow-sm dark:border-slate-700 dark:bg-slate-900">
      <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400 dark:text-slate-500">
        Mermaid
      </div>
      {svg ? (
        <div
          className="mermaid-render [&_svg]:h-auto [&_svg]:max-w-full"
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      ) : (
        <pre className="overflow-x-auto rounded-lg bg-slate-50 p-3 text-[13px] text-slate-700 dark:bg-slate-950 dark:text-slate-200">
          <code>{chart}</code>
        </pre>
      )}
      {error && (
        <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">
          {error}
        </p>
      )}
    </div>
  );
}

interface MarkdownRendererProps {
  content: string;
}

export default function MarkdownRenderer({ content }: MarkdownRendererProps) {
  return (
    <div className="prose prose-sm prose-slate max-w-none dark:prose-invert [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        components={{
          code: CodeBlock,
          img: LocalImage,
          a: ({ children, href, ...rest }) => (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-600 underline hover:text-blue-800 dark:text-blue-400"
              {...rest}
            >
              {children}
            </a>
          ),
          table: ({ children, ...rest }) => (
            <div className="my-3 overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700">
              <table className="min-w-full text-sm" {...rest}>
                {children}
              </table>
            </div>
          ),
          th: ({ children, ...rest }) => (
            <th className="bg-slate-50 px-3 py-2 text-left font-semibold dark:bg-slate-800" {...rest}>
              {children}
            </th>
          ),
          td: ({ children, ...rest }) => (
            <td className="border-t border-slate-200 px-3 py-2 dark:border-slate-700" {...rest}>
              {children}
            </td>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
