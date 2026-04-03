---
name: open-application
description: Entende pedidos para abrir, iniciar ou executar programas locais no Linux e direciona para a ferramenta open_application.
metadata: {"brother":{"version":"1","source":"workspace","tools":["open_application"],"permissions":[],"installRequired":false,"requiresApproval":false,"autoActivate":true,"keywords":["abrir programa","abrir aplicativo","iniciar software","executar app","launch app","open app"]}}
---

# Open Application

Use esta skill quando o pedido principal do usuario for abrir um programa local.

## Regras

- Use a ferramenta open_application.
- Extraia somente o nome mais provavel do aplicativo.
- Remova verbos, artigos e contexto desnecessario antes de chamar a ferramenta.
- Se o pedido citar varios aplicativos, peca para o usuario escolher um.
- Se o nome estiver ambiguo, peca esclarecimento em vez de inventar.
- Nao use web_search quando a intencao principal for abrir um programa local.

## Exemplos

- "abra o programa firefox" -> open_application {"name":"firefox"}
- "inicie o vscode" -> open_application {"name":"vscode"}
- "executa o telegram" -> open_application {"name":"telegram"}