# Integração BCB na WR Trading Pro — especificação local aditiva

Status: proposta local para implementação supervisionada; não publicada, sem commit/push/deploy.

## Objetivo

Disponibilizar na WR Trading Pro os dados oficiais do BCB/IFData já validados para os 10 bancos B3, preservando a separação entre CVM e BCB, sem alterar o banco Prisma operacional e sem habilitar execução de ordens.

## Fonte e destino

- Fonte canônica local: `/root/.hermes/workspace/cvm_fundamentos/data/cvm_fundamentos.db`.
- Destino da aplicação: `data/cvm/cvm_fundamentos.db` no repositório WR (`C:\WR\wr_trade_pro_`).
- A cópia deve ser precedida por backup datado do destino e validada por SQLite; não copiar arquivos `-wal`/`-shm` como se fossem o banco principal.
- Os dados BCB da fonte são exclusivamente as tabelas `bcb_*` já validadas; não reprocessar a fonte web nesta tarefa.

## Escopo permitido

1. Criar ferramenta/script reprodutível para sincronizar somente o snapshot SQLite BCB/CVM, com backup, cópia atômica e validação de integridade.
2. Criar reader server-only read-only para as tabelas BCB, separado de `cvm-legacy-db.ts` quando isso reduzir acoplamento.
3. Criar tipos/consultas para:
   - vínculo ticker B3 → empresa/CNPJ → instituição/conglomerado BCB;
   - dados prudenciais 1004/1009;
   - dados financeiros 1005;
   - cobertura por banco/data/perímetro;
   - ausência como NULL, nunca zero.
4. Expor somente consultas GET/read-only necessárias para a UI/agentes, com DTO allowlist e paginação/limites server-side.
5. Integrar contexto BCB aos Agent Runs apenas como referência factual, sem permitir que LLM escreva dados, execute ordens ou altere `RiskDecision`/`OrderIntent`.
6. Adicionar testes determinísticos de schema, sincronização, cobertura 10/10, separação 1004/1009 vs 1005, vínculo de identidade, NULL e sanitização.
7. Documentar proveniência, data-base, unidade monetária e limitações.

## Escopo proibido

- Não alterar, remover ou renomear tabelas CVM existentes.
- Não inserir BCB em `CvmFiling`, `CvmFact`, `ShareCapitalFact`, `fundamental_indicators`, `StockMonitoring` ou `Prediction`.
- Não misturar prudencial 1004/1009 com financeiro 1005.
- Não atribuir automaticamente indicador de banco operacional a holding listada.
- Não criar ranking, sinal, recomendação ou estratégia de trading.
- Não tocar `docs/CODEX_HANDOFF.md`, `python/mt5_bridge.py`, execução/trading, credenciais, `.env`, MCP de trade ou rotas de ordens.
- Não fazer commit, push, merge, deploy ou apagar as modificações já existentes no main.
- Não usar credenciais nem registrar segredos.

## Regras de identidade e dados

- Ticker nunca é chave prudencial única.
- O modelo de vínculo deve conservar ticker, `cd_cvm`, CNPJ da companhia, código BCB, CNPJ líder, nome da entidade, tipo de consolidação e proveniência.
- Entidades BCB sem vínculo confiável devem aparecer como pendentes/NULL, não ser adivinhadas.
- Valores monetários devem manter unidade explícita e precisão disponível; percentuais devem ser identificados como percentuais.
- Datas-base devem ser preservadas como datas civis/períodos BCB.

## Critérios de aceitação

- Snapshot WR validado por `PRAGMA integrity_check = 'ok'`.
- As tabelas CVM pré-existentes permanecem presentes e com contagens não reduzidas.
- As 27 tabelas BCB e 245.590 linhas da fonte são reproduzidas no destino, salvo diferença explicitamente documentada.
- Cobertura dos 10 tickers: ABCB4, BBAS3, BBDC4, BEES3, BMGB4, BPAC11, BRSR6, ITUB4, PINE4 e SANB11.
- Teste comprova separação dos perímetros e idempotência da sincronização.
- `npm run test:<item>` novo, `npm run test:cvm-fundamentals`, `npx prisma validate`, `tsc --noEmit` e `npm run build` passam, ou falhas ambientais são separadas e documentadas.
- Diff revisado inclui arquivos rastreados e não rastreados; nenhuma alteração fora do escopo.
- Relatório final declara exatamente arquivos, comandos, exit codes, backup, commit/push/deploy (devem permanecer NÃO realizados) e pendências.
