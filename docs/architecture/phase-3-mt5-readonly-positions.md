# Fase 3 — MT5 nativo: posições read-only

Status: proposta local, não publicada e não commitada.

## Objetivo
Migrar somente `MT5Service.getPositions()` do bridge WebSocket legado para a rota server-side/MCP nativo, sem criar caminho de execução ou mutação de ordens.

## Escopo permitido
- Adicionar capability/tool read-only `positions` no cliente server-side já existente.
- Adicionar rota autenticada e sanitizada para consulta de posições, se necessária pelo contrato atual.
- Adaptar `MT5Service.getPositions()` e o cache/evento de posições para consumir a rota HTTP server-side.
- Preservar o contrato de UI existente quando possível.
- Adicionar harness mock para resposta array e resposta envelopada, falha de sessão, ferramenta ausente, terminal desconectado e sanitização.
- Atualizar somente consumidores que dependem diretamente de `getPositions()` para leitura.

## Escopo proibido
- `sendOrder`, `modifyOrder`, `cancelOrder`, `enableTrading`, `OrderIntent` ou qualquer mutação.
- Migração de `getOrders`, `getHistory`, ticks, símbolos, candles/chart ou book.
- Remoção do bridge legado para métodos ainda não migrados.
- Credenciais no renderer, localStorage, URL, logs ou payloads.
- Commit, push, deploy, reinício do MT5 ou conexão operacional real.
- Alterar `eligibleForExecution`, que deve permanecer `false`.

## Regras de segurança
- Token e endpoint MCP permanecem server-side.
- Respostas públicas usam allowlist/normalização e `redactSensitiveFields`.
- Falhas não expõem stack trace, token, headers ou detalhes de rede.
- Sem dados reais obrigatórios no harness; usar mock local.

## Aceitação
- `npm run test:mt5-mcp` verde com cobertura da capability positions.
- `npx tsc --noEmit` verde.
- `npm run build` verde.
- Teste prova ausência de caminho de ordem e de credenciais no cliente.
- Diff limitado aos arquivos da capability/rota/serviço/testes.
- Nenhuma alteração em `main`, commit ou push.
