# AGENTS.md — WR Trading Pro

## Antes de qualquer tarefa

Leia estes arquivos nesta ordem:

1. `CLAUDE.md` — arquitetura, stack, convenções e bugs corrigidos.
2. `BUILD_STATUS.md` — estado real do build atual.
3. `docs/CODEX_HANDOFF.md` — contexto recente, pendências e onde paramos.

Se houver conflito entre documentação antiga e arquivos atuais, confie primeiro no código atual e no `BUILD_STATUS.md`.

## Regras de trabalho

- Não apague arquivos ou diretórios sem confirmação explícita.
- Não faça commits sem o usuário pedir.
- Antes de mudanças grandes, rode `git status --short` e explique o escopo.
- Ao modificar TypeScript/Next/Electron, rode no mínimo:
  - `npm run build`
  - `npm run electron:compile` quando tocar em `electron/`.
- Preserve API routes do Next.js: o projeto NÃO usa `output: 'export'`.
- Preserve o padrão Next.js servidor + Electron; não converter para static export.
- Python deve usar o ambiente Conda `IA_Day_Trading` no Windows.
- ProfitDLL ainda é integração parcial/stub até ativação/chave Nelogica.
- Trate ruído CRLF/LF entre Windows e WSL com cuidado; não confunda line ending com mudança funcional.

## Ao finalizar uma tarefa

Atualize `docs/CODEX_HANDOFF.md` com:

- O que foi feito.
- Arquivos alterados.
- Comandos de verificação executados e resultado.
- Próximos passos recomendados.
- Estado do `git status` relevante.

Isso evita que a próxima sessão Codex comece sem contexto.
