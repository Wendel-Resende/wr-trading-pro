# UI Operacional — Sprint 1 Corrigido

> **Para Hermes:** executar por fatias TDD, preservando a separação entre UI, dados e execução.

**Objetivo:** remover fricções visuais confirmadas da WR sem alterar dados, MT5/MCP, execução, política de risco ou regras de negócio.

**Base de decisão:** auditoria externa por screenshots em `C:/Users/rwres/Downloads/WR Trading Pro — Engenharia de Software e Produto.pdf`, confrontada com o código local em 2026-09-27.

## Itens aceitos agora

1. Remover título duplicado `Resumo do Dia` no Spread.
2. Tornar a proveniência CVM recolhível, fechada por padrão, preservando literalmente o aviso técnico.
3. Criar ordenação visual estável para Monitoramento, Ranking Fundamentalista e Saúde Financeira:
   - ciclo `original → ascendente → descendente → original`;
   - `null`/ausente sempre ao fim;
   - não mutar as coleções recebidas nem recalcular escores/ranks.
4. Substituir a exibição crua de erro do Book por estado seguro `Dados indisponíveis`; em Spread, manter o bloqueio fail-closed e explicar `Execução indisponível nesta versão` no próprio botão.

## Itens deliberadamente excluídos

- 2FA e fluxo de credenciais: projeto de segurança posterior, após estabilidade operacional e de dados.
- Tooltip de gráficos fundamentais: já implementado em `CvmFundamentalsTab.tsx`; não duplicar.
- Rótulos como `Mercado fechado`: não implementar enquanto a origem de dados não produzir essa causa de modo determinístico.
- Spread em tempo real, fullscreen, autocomplete e heatmap: backlog posterior.

## Testes

- Criar regras puras de ordenação em `src/lib/table-sort.ts` e teste em `scripts/table-sort/`.
- Cobrir: ciclo de direção, estabilidade, valores ausentes por último e não mutação.
- Rodar o teste novo, typecheck e build de produção.
