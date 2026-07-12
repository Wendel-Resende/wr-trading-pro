# Fase 1 — Item 1: contratos e portas de domínio

## Objetivo

Este incremento introduz a versão conceitual `v1` do vocabulário canônico em `src/domain`, sem migrar consumidores existentes. O módulo contém somente tipos, modelos e portas; não conhece framework, persistência, terminal de negociação nem processo desktop.

## Escopo entregue

- modelos de instrumento, quote/tick, barra/timeframe, conta/posição/portfólio;
- requests mínimos somente para consultas de leitura;
- portas `InstrumentCatalog`, `MarketDataProvider`, `HistoricalBarsProvider`, `PortfolioProvider` e `ExecutionBroker`;
- barrels em `models`, `ports`, `v1` e `domain`;
- constante `DOMAIN_CONTRACT_VERSION = 1` como marcador explícito da versão conceitual.

`ExecutionBroker` é deliberadamente um marcador sem método acionável. O contrato
de execução será aberto somente no Item 3, quando `OrderIntent` puder exigir
decisão de risco, aprovação humana e idempotência explícitas. Assim, nenhum
adaptador consegue satisfazer a porta atual e encaminhar uma ordem direta.

## Estratégia anti-big-bang

1. Manter toda a UI, APIs e integrações atuais sem alterações.
2. Criar adaptadores futuros nas bordas, um caso de uso por vez, sem fazer os modelos de domínio dependerem dos formatos legados.
3. Migrar primeiro caminhos somente de leitura (catálogo, cotações, histórico e portfólio).
4. Tratar execução em incremento separado, com controles de risco e habilitação explícita antes de conectar qualquer adaptador.
5. Consumidores que exigem estabilidade importam `src/domain/v1`; o barrel raiz
   é apenas o alias deliberado da versão corrente. Uma mudança incompatível cria
   nova versão conceitual em vez de alterar silenciosamente `v1`.

## Critérios de aceitação

- os cinco contratos existem e fixtures TypeScript implementam todos;
- nenhum arquivo sob `src/domain` importa bibliotecas de UI, aplicação, persistência, fornecedor ou desktop;
- nomes das portas são neutros em relação à tecnologia;
- não há schemas de validação nem tipos do pipeline de proposta/risco neste incremento;
- a porta `ExecutionBroker` não expõe `submit`, `send`, `place`, `execute` ou
  `cancel`, nem exporta payload executável antes do Item 3;
- `npm run smoke:domain-contracts`, `npx tsc --noEmit` e `npm run electron:compile` terminam com sucesso.

## Verificação

```bash
npm run smoke:domain-contracts
npx tsc --noEmit
npm run electron:compile
```

O smoke compila isoladamente o domínio e as fixtures, verifica as cinco interfaces, o marcador de versão, a neutralidade tecnológica e invariantes estruturais determinísticos.
