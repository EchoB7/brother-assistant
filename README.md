# Brother Assistant

> **🌐 Language / Idioma:** [English](#) · [Português](README.pt-br.md) · [Español](README.es.md)

Native AI assistant for Linux with its own window, system tray and global hotkey. No terminal dependency.

<p align="center">
  <img src="screenshots/preview.png" alt="Brother Assistant" width="400">
</p>

## Features

- **Streaming chat** — Real-time responses with Markdown rendering, syntax highlighting and copy-to-clipboard code blocks
- **Multi-provider** — GitHub Copilot, OpenAI, Venice, Groq, OpenRouter, Gemini, xAI, Custom (Ollama/LM Studio)
- **Agent mode** — Execute actions on your PC: create/edit/delete files, open apps, web search, organize folders
- **Drag & drop files** — Drop PDF, DOCX, TXT, images directly into the chat
- **Conversation history** — Persisted locally with export to Markdown
- **Dark mode** — Light/dark theme toggle
- **System tray** — Minimizes to the tray with context menu
- **Global hotkey** — `Super+Shift+B` to show/hide the window from anywhere
- **Autostart** — Option to launch on system startup (XDG autostart)
- **Web search** — Searches DuckDuckGo and brings results inside the chat
- **Multi-language** — 11 languages: English, Português, Español, Русский, 日本語, 中文, العربية, Deutsch, Français, Italiano, हिन्दी
- **Account rotation** — Multiple API keys with automatic rotation on rate limit

## Tech Stack

| Layer | Technology |
|-------|-----------|
| **Window** | [tao](https://github.com/nickel-org/tao) + [wry](https://github.com/nickel-org/wry) (WebKitGTK) |
| **System tray** | [tray-icon](https://github.com/nickel-org/tray-icon) |
| **Global hotkey** | [global-hotkey](https://github.com/nickel-org/global-hotkey) |
| **Core** | Rust (business logic, providers, agent, streaming) |
| **Frontend** | React 18 + TypeScript + Vite + Tailwind CSS v4 |
| **IPC** | JSON postMessage via custom `brother://app/` protocol |

## Requirements

- Linux (Ubuntu 22.04+ recommended)
- Node.js 18+
- Rust 1.75+
- System dependencies:
  ```bash
  sudo apt install libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev
  ```

## Getting Started

```bash
# Install frontend dependencies
npm install

# Build the frontend
npm run build

# Run in dev mode
cargo run -p brother-shell
```

## Release Build

```bash
# Optimized build + .deb package
./scripts/build-release.sh

# Or manually:
npm run build
cargo build --release -p brother-shell
```

## Project Structure

```
brother-core/    # Business logic (providers, agent, config, streaming)
brother-shell/   # Native Linux shell (tao + wry + tray + hotkey)
linux-cli/       # Alternative CLI (terminal)
src/             # React frontend (components, styles, types)
scripts/         # Build scripts
```

## Privacy

- **Zero telemetry** — No data is sent to project servers
- **Local config** — API keys and history stay in `~/.config/copilot-assistente/`
- **Only external communication** — The AI provider API you chose
- **100% offline option** — Use Custom provider pointing to a local Ollama instance


## License

LGPL
