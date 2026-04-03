# Brother Assistant

> **🌐 Language / Idioma:** [English](#) · [Português](README.pt-br.md) · [Español](README.es.md)

Native AI assistant for Linux with its own window, system tray and global hotkey. No terminal dependency.

<p align="center">
  <img src="screenshots/preview.png" alt="Brother Assistant" width="400">
</p>

## Features

- **Streaming chat** — Real-time responses with Markdown rendering, syntax highlighting and copy-to-clipboard code blocks
- **Multi-provider** — GitHub Copilot, OpenAI, Venice, Groq, OpenRouter, Gemini, xAI, Custom (Ollama/LM Studio)
- **OpenClaw skills catalog** — Search and import compatible community skills directly from Settings
- **Agent mode** — Execute actions on your PC: create/edit/delete files, open apps, web search, organize folders and generate images
- **Voice input and TTS** — Dictate prompts by microphone and read assistant responses aloud
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
- Optional TTS engines for read-aloud:
  ```bash
  sudo apt install espeak-ng speech-dispatcher
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
skills/          # Local skills loaded in development and portable installs
src/             # React frontend (components, styles, types)
scripts/         # Build scripts
```

## Skills

- Brother now has a local skills base for prompt augmentation and task specialization.
- Brother can also search and import compatible community skills from OpenClaw, making external skill catalogs available inside Settings.
- Skills are loaded from `skills/` in the current project, from a sibling `skills/` directory near the executable, or from `~/.config/copilot-assistente/skills/`.
- Each skill lives in its own folder and must provide a `SKILL.md` with `name`, `description` and Markdown instructions.
- Supported manifest fields now include `metadata` with a Brother JSON object containing `version`, `source`, `tools`, `permissions`, `installRequired`, `requiresApproval` and `autoActivate`.
- Skills that require permissions or installation are cataloged but not auto-activated; the runtime flags them as approval-only.
- Settings now include a skills browser with local installed skills, OpenClaw catalog search, and one-click install for compatible OpenClaw skills when supported by the native host.
- In browser preview, the UI falls back to a built-in catalog reader so skills search still works even before restarting the native shell.
- Agent responses now include the executed action label, such as `open_application`, `open_browser_search`, or `web_search`, to make behavior easier to inspect.

## Privacy

- **Zero telemetry** — No data is sent to project servers
- **Local config** — API keys and history stay in `~/.config/copilot-assistente/`
- **Only external communication** — The AI provider API you chose
- **100% offline option** — Use Custom provider pointing to a local Ollama instance


## License

LGPL
