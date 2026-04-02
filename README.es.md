# Brother Assistant

> **🌐 Idioma / Language:** [English](README.md) · [Português](README.pt-br.md) · [Español](#)

Asistente de IA nativo para Linux con ventana propia, bandeja del sistema y atajo global. Sin dependencia de terminal.

<p align="center">
  <img src="screenshots/preview.png" alt="Brother Assistant" width="400">
</p>

## Características

- **Chat con streaming** — Respuestas en tiempo real con Markdown, resaltado de sintaxis y bloques de código copiables
- **Multi-proveedor** — GitHub Copilot, OpenAI, Venice, Groq, OpenRouter, Gemini, xAI, Custom (Ollama/LM Studio)
- **Modo Agente** — Ejecuta acciones en tu PC: crear/editar/eliminar archivos, abrir apps, buscar en la web, organizar carpetas
- **Arrastrar archivos** — Drag & drop de PDF, DOCX, TXT e imágenes directo al chat
- **Historial de conversaciones** — Persistido localmente con exportación a Markdown
- **Modo oscuro** — Tema claro/oscuro con toggle
- **Bandeja del sistema** — Se minimiza a la bandeja con menú contextual
- **Atajo global** — `Super+Shift+B` para mostrar/ocultar la ventana desde cualquier lugar
- **Inicio automático** — Opción de iniciar con el sistema (XDG autostart)
- **Búsqueda web** — Busca en DuckDuckGo y trae resultados dentro del chat
- **Multi-idioma** — 11 idiomas: English, Português, Español, Русский, 日本語, 中文, العربية, Deutsch, Français, Italiano, हिन्दी
- **Rotación de cuentas** — Múltiples API keys con rotación automática en caso de rate limit

## Stack Técnico

| Capa | Tecnología |
|------|-----------|
| **Ventana** | [tao](https://github.com/nickel-org/tao) + [wry](https://github.com/nickel-org/wry) (WebKitGTK) |
| **Bandeja** | [tray-icon](https://github.com/nickel-org/tray-icon) |
| **Atajo global** | [global-hotkey](https://github.com/nickel-org/global-hotkey) |
| **Core** | Rust (lógica de negocio, proveedores, agente, streaming) |
| **Frontend** | React 18 + TypeScript + Vite + Tailwind CSS v4 |
| **IPC** | JSON postMessage via protocolo custom `brother://app/` |

## Requisitos

- Linux (Ubuntu 22.04+ recomendado)
- Node.js 18+
- Rust 1.75+
- Dependencias del sistema:
  ```bash
  sudo apt install libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev
  ```

## Primeros Pasos

```bash
# Instalar dependencias del frontend
npm install

# Build del frontend
npm run build

# Ejecutar en modo dev
cargo run -p brother-shell
```

## Build Release

```bash
# Build optimizada + paquete .deb
./scripts/build-release.sh

# O manualmente:
npm run build
cargo build --release -p brother-shell
```

## Estructura del Proyecto

```
brother-core/    # Lógica de negocio (proveedores, agente, config, streaming)
brother-shell/   # Shell nativa Linux (tao + wry + tray + hotkey)
linux-cli/       # CLI alternativa (terminal)
src/             # Frontend React (componentes, estilos, tipos)
scripts/         # Scripts de build
```

## Privacidad

- **Cero telemetría** — Ningún dato se envía a servidores del proyecto
- **Configuración local** — Las API keys y el historial se guardan en `~/.config/copilot-assistente/`
- **Única comunicación externa** — La API del proveedor de IA que elegiste
- **Opción 100% offline** — Usa Custom provider apuntando a Ollama local

## Licencia

LGPL
