# Contexto Ativo de Instrumento — Plano de Implementação

**Objetivo:** estabelecer um único instrumento ativo para a área de trabalho da WR Trading Pro, com favoritos persistentes e navegação contextual entre Dashboard e Fundamentos CVM.

**Referência de produto:** a avaliação do FinceptTerminal foi usada somente como benchmark de capacidade de terminal modular. Esta implementação é original, B3-first e não reutiliza código, interfaces, assets ou fluxos derivados de software AGPL.

**Escopo desta entrega:** leitura e navegação contextual. Não cria ordens, não altera a política de risco, não adiciona provedores externos e não muda MCP/MT5/Python.

## Mapa técnico validado

- Shell: `src/app/page.tsx` mantém as abas carregadas e hoje não possui um contrato de ticker global.
- Dashboard: `src/components/tabs/DashboardTab.tsx` tinha estado local de `selectedSymbol`, usado por gráfico, chat e book.
- Fundamentos CVM: `src/components/tabs/CvmFundamentalsTab.tsx` já carrega uma lista com `ticker` e `cdCvm`, mas seleciona empresa por estado próprio.
- Mercado: `src/services/mt5Service.ts` continua sendo a única integração de leitura de ticks/gráfico.

## Critérios de aceite

- [ ] Símbolo é normalizado para maiúsculas e validado no formato B3 (`AAAA3`, `AAAA11`, etc.).
- [ ] Símbolo ativo e favoritos persistem em `localStorage` de forma defensiva; storage indisponível ou corrompido volta ao estado seguro.
- [ ] A barra do workspace permite selecionar favorito, fixar/remover favoritos e abrir Dashboard ou Fundamentos.
- [ ] Dashboard usa o símbolo ativo para gráfico, chat e book; trocar o ativo remove a assinatura de ticks anterior.
- [ ] Fundamentos CVM abre automaticamente a empresa correspondente quando houver cobertura; ausência de cobertura é explícita e não inventa dados.
- [ ] Não há efeito de trade automático ou mudança em risk policy.
- [ ] Regras puras passam por testes, TypeScript não apresenta erros e build de produção conclui.

## Arquivos

- Criar `src/lib/workspace/instrument-state.ts`: regras puras e serialização defensiva.
- Criar `src/contexts/InstrumentContext.tsx`: provider React e persistência local.
- Criar `src/components/workspace/InstrumentContextBar.tsx`: barra original de contexto ativo.
- Criar `scripts/workspace/instrument-state-test.ts` e runner correspondente.
- Modificar `package.json`, `src/app/page.tsx`, `DashboardTab.tsx` e `CvmFundamentalsTab.tsx`.

## Validação

1. `npm run test:workspace-instrument`
2. `npx tsc --noEmit -p tsconfig.json`
3. `npm run build`
4. atualização do grafo: `graphify update .`
5. revisão de `git diff`, commit separado para correção de monitoramento e feature de workspace, e push somente após readback do remoto.
