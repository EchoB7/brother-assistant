# Brother Assistant

Assistente de IA nativo para Linux com janela própria, system tray e atalho global. Sem dependência de terminal.

## Features

- **Chat com streaming** — Respostas em tempo real com markdown, syntax highlight e blocos de código copiáveis
- **Multi-provedor** — GitHub Copilot, OpenAI, Venice, Groq, OpenRouter, Gemini, xAI, Custom (Ollama/LM Studio)
- **Modo Agente** — Executa ações no PC: criar/editar/excluir arquivos, abrir apps, pesquisar na web, organizar pastas
- **Arrastar arquivos** — Drag & drop de PDF, DOCX, TXT, imagens direto no chat
- **Histórico de conversas** — Persistido localmente, com busca e exportação
- **Dark mode** — Tema claro/escuro com toggle
- **System tray** — Minimiza para a bandeja com menu de contexto
- **Atalho global** — `Super+Shift+B` para abrir/esconder a janela
- **Autostart** — Opção de iniciar com o sistema (XDG autostart)
- **Pesquisa web** — Busca no DuckDuckGo e traz resultados dentro do chat
- **Rotação de contas** — Múltiplas API keys com rotação automática em caso de rate limit

## Stack

- **Shell**: tao (janela) + wry (WebView/WebKitGTK) + tray-icon + global-hotkey
- **Core**: Rust (lógica de negócio, providers, agente, streaming)
- **Frontend**: React 18 + TypeScript + Vite + Tailwind CSS v4
- **IPC**: JSON postMessage via protocolo custom `brother://app/`

## Requisitos

- Linux (Ubuntu 22.04+ recomendado)
- Node.js 18+
- Rust 1.75+
- Dependências do sistema:
  ```bash
  sudo apt install libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev
  ```

## Desenvolvimento

```bash
# Instalar dependências do frontend
npm install

# Build do frontend
npm run build

# Rodar em modo dev
cargo run -p brother-shell
```

## Build Release

```bash
# Build otimizada + pacote .deb
./scripts/build-release.sh

# Ou manualmente:
npm run build
cargo build --release -p brother-shell
cargo deb -p brother-shell --no-build
```

## Estrutura

```
brother-core/    # Lógica de negócio (providers, agente, config, streaming)
brother-shell/   # Shell nativa Linux (tao + wry + tray + hotkey)
linux-cli/       # CLI alternativa (terminal)
src/             # Frontend React (componentes, estilos, tipos)
scripts/         # Scripts de build
```

## Privacidade

- **Zero telemetria** — Nenhum dado é enviado para servidores do projeto
- **Configurações locais** — API keys e histórico ficam em `~/.config/copilot-assistente/`
- **Única comunicação externa** — A API do provedor de IA que você escolheu
- **Opção 100% offline** — Use Custom provider apontando para Ollama local

## Licença

MIT

## O que ja existe

- Janela desktop base
- Layout visual de assistente
- Sidebar de conversas
- Area principal de chat
- Composer pronto para integrar backend
- Base Rust do Tauri com comando de healthcheck

## Como rodar

```bash
npm install
npm run tauri dev
```

Se quiser rodar apenas o frontend no navegador:

```bash
npm install
npm run dev
```

Nesse modo, a UI usa um fallback local em memória para preview. Chat, configurações e eventos passam por um bridge de frontend em vez de depender diretamente do Tauri.

## Bridge da UI

A UI React agora fala apenas com [src/platform/host.ts](src/platform/host.ts).

Esse arquivo resolve 3 cenários:

- Tauri atual: usa dinamicamente @tauri-apps/api.
- Preview no navegador: usa fallback local para renderizar a interface sem backend nativo.
- Shell Linux futura: pode injetar um host próprio via window.__BROTHER_HOST__ e reaproveitar a mesma UI.

Contrato esperado da shell:

```ts
window.__BROTHER_HOST__ = {
	invoke(command, args) {
		// encaminha comandos ao brother-core
	},
	listen(event, handler) {
		// conecta eventos de stream do backend
		return () => {};
	},
	windowControl(action) {
		// minimize | toggleMaximize | hide
	},
};
```

Com isso, a remoção do Tauri deixa de exigir reescrita da interface: a mesma UI pode rodar sobre outra shell que exponha esse contrato.

## Linux nativo inicial

O primeiro passo da migração para Linux sem Tauri está em linux-cli.

O core agora vive em brother-core, como crate Rust independente. O Tauri virou apenas uma casca de UI/eventos em cima desse core, e o CLI Linux usa exatamente a mesma lógica compartilhada.

Para uso desktop sem Tauri, a nova shell Linux está em brother-shell.

```bash
cargo run -p brother-shell
```

Ela conversa direto com brother-core, usa janela Linux nativa via eframe/egui e cobre o fluxo principal de chat sem depender do Tauri.

O próximo passo da migração é fazer a shell Linux hospedar esta mesma UI React por meio do bridge acima, em vez de manter uma recriação separada da interface.

```bash
cargo run --manifest-path linux-cli/Cargo.toml -- status
cargo run --manifest-path linux-cli/Cargo.toml -- system-info
cargo run --manifest-path linux-cli/Cargo.toml -- ask Explique o projeto
cargo run --manifest-path linux-cli/Cargo.toml -- agent dados do meu pc
cargo run --manifest-path linux-cli/Cargo.toml -- status --json
```

Ele usa a mesma configuração já salva em ~/.config/copilot-assistente/settings.json.

Para automação e GitHub Actions, o CLI também aceita --json e devolve {"ok": true|false, ...}.

Também foi adicionado um workflow em .github/workflows/linux-cli.yml para compilar esse binário no GitHub Actions sem depender do shell Tauri.

## Panorama da remoção do Tauri

Hoje o backend principal já não precisa mais morar dentro do Tauri. A lógica de configuração, provedores, agent mode, auth Copilot e runtime de conversa foi movida para brother-core.

Isso significa que a dependência restante do Tauri ficou concentrada na casca desktop atual: janela, tray, single-instance e bridge de eventos com a UI.

Para remover o Tauri por completo, falta substituir essa casca por uma interface Linux nativa. O backend já está preparado para isso.

Essa substituição começou em brother-shell. A partir daqui, o Tauri pode ser tratado como legado e removido em etapas, sem impacto no backend.

## Proximos passos sugeridos

- Integrar backend local de modelos
- Adicionar historico persistente
- Adicionar execucao controlada de comandos do sistema
- Criar tela de configuracao de provedores
- Adicionar memoria local com SQLite
