# data/cvm — banco de fundamentos CVM (derivado)

`cvm_fundamentos.db` é um **snapshot do banco derivado** mantido pelo
Guardião_Hermes no WSL (`/root/.hermes/workspace/cvm_fundamentos/data/`).

- Snapshot copiado em: **2026-07-14 (2ª cópia, ~19:40 — inclui 1T2026)**
- Conteúdo: 138 empresas B3, séries trimestrais 2011–2026T1 (DRE, BPA, BPP,
  DFC, DVA, DRA, indicadores calculados, capital social); 134 empresas já
  com o 1T2026 na DRE
- Proveniência: valores derivados/normalizados a partir de arquivos públicos
  da CVM pelo pipeline do lab; **não** é o dado bruto point-in-time
  (sem protocolo de documento, sem data de publicação, sem versionamento
  de retificação)

## Papel

Fonte **read-only** da API `/api/cvm/*` e da tab Fundamentos CVM da UI.
Não confundir com o modelo canônico point-in-time (`CvmFiling`/`CvmFact`),
que permanece vazio até a ingestão real dos dados brutos do portal da CVM
(etapa futura). A UI exibe a proveniência derivada explicitamente.

Para atualizar o snapshot: copiar novamente do WSL e atualizar a data acima.

## exports/ — análises derivadas (snapshot 2026-07-14)

CSVs copiados de `/root/.hermes/workspace/cvm_fundamentos/data/exports/`
(inventário completo no vault: `cvm-fundamentos-inventory-2026-07-14`):

- `dividend_quality_score.csv` — score 0–100 + classe, 7 sub-componentes (138)
- `portfolio_12_dividendos_jcp.csv` — carteira 12 com gates Monte Carlo
- `portfolio_ranking.csv` — ranking geral com score final (138)
- `dividendos_jcp_por_trimestre.csv` / `_resumo_por_empresa.csv` / `_cobertura.csv`
- `financial_health_scores.csv` — painel trimestral + score de saúde (11 MB)
- `monte_carlo_sustainability.csv` — sustentabilidade por empresa da carteira

Consumidos read-only por `/api/cvm/dividends` e pelo detalhe de empresa
(`src/lib/server/cvm-exports.ts`). Mesma proveniência derivada do banco.

**Gerações (recopiados em 2026-07-14 ~22:20 — conjunto completo com 1T2026):**

- Carteira vigente (`portfolio_12_dividendos_jcp.csv`, 20:11): VIVA3, CXSE3,
  BBSE3, ENGI11, LAVV3, TRIS3, LEVE3, GRND3, ALUP11, SHUL4, VIVT3, INTB3
  (entraram CXSE3/LEVE3/GRND3/SHUL4/INTB3; saíram ITUB4/ITSA4/WEGE3/ABEV3/
  KEPL3 — ver inventário no vault).
- `dividendos_jcp_*.csv` (22:14) — série por trimestre com **134 linhas de
  2026T1** (7.064 registros).
- `financial_health_scores.csv` (22:xx) — painel até **2026T1** (7.062
  registros).
- `monte_carlo_sustainability.csv` (22:xx) — **138 tickers** (cobertura
  completa; antes só a carteira antiga de 12).
- `dividend_quality_score.csv` (20:11) e `portfolio_ranking.csv` (21:49).

**Nota operacional:** a cópia WSL → `C:\WR` feita pelo Guardião falhou
silenciosamente duas vezes (os arquivos nunca chegaram); quem copia da
fonte (`/root/.hermes/workspace/cvm_fundamentos/data/exports/`) para cá é
o Claude Code, validando contagens/2026T1 após cada cópia.

## Tabelas `bcb_*` — dados BCB/IFData (integração 2026-08-13)

O mesmo arquivo `cvm_fundamentos.db` também carrega as tabelas `bcb_prudencial_*`
(14) e `bcb_financeiro_*` (13) — **27 no total**, publicadas pelo Banco Central
(IFData) para os 10 bancos B3 cobertos: ABCB4, BBAS3, BBDC4, BEES3, BMGB4,
BPAC11, BRSR6, ITUB4, PINE4, SANB11. Cobertura confirmada 10/10 em ambos os
perímetros (prudencial e financeiro).

- **Proveniência:** BCB/IFData, `fonte='BCB_IFDATA'` em cada linha. Ver
  `docs/architecture/phase-bcb-wr-integration.md` (spec) e
  `src/lib/server/bcb-legacy-db.ts` (reader, regras de identidade/dados
  documentadas no topo do arquivo).
- **Sincronização:** `node scripts/bcb-sync/sync-bcb-snapshot.cjs` — copia
  SOMENTE as 27 tabelas `bcb_*` da fonte canônica (WSL,
  `/root/.hermes/workspace/cvm_fundamentos/data/cvm_fundamentos.db`) para
  este destino, com backup datado em `backups/`, validação
  `PRAGMA integrity_check` e checagem de que nenhuma tabela CVM
  pré-existente regride em contagem. Não sobrescreve o arquivo inteiro
  (o destino às vezes tem tabelas CVM mais atualizadas que o snapshot BCB
  da fonte — sobrescrever tudo regrediria essas tabelas).
- **Dois perímetros, nunca misturados:** `tipo_instituicao` 1004 (até
  202306) / 1009 (202309+) = **prudencial**; 1009 → 1005 = **financeiro**.
  Os códigos de conglomerado (`cod_inst`) de cada perímetro são
  DIFERENTES entre si — nunca somados/combinados num mesmo agregado.
- **Unidade monetária:** BRL nas colunas `*_brl`; campo `unidade` (`brl` |
  `usd` | `ratio` | `contagem` | `booleano`) identifica percentuais/frações
  explicitamente nas tabelas EAV (`*_resumo` etc.). Datas-base no formato
  `AAAAMM` (fim de trimestre BCB), preservadas como publicadas — nunca
  recalculadas.
- **Limitações conhecidas (não inventadas, documentadas):**
  - Não existe CNPJ do líder do conglomerado nem nome de entidade BCB como
    colunas confiáveis na fonte atual — `cod_lider_bcb` (só em
    `bcb_prudencial_capital`) é explicitamente "código interno do BCB, NÃO
    é CNPJ" no schema-fonte, e não é reaproveitado como tal. Esses dois
    campos do vínculo de identidade ficam `null`/pendentes.
  - `tipo_consolidacao` só existe no lado financeiro (1005) na fonte atual;
    fica `null` no lado prudencial.
  - Ausência de métrica é sempre `null`, nunca `0`.
- **Escopo deliberadamente fora desta integração:** ranking, sinal ou
  recomendação de trading com dados BCB; qualquer escrita de dado BCB em
  `CvmFiling`/`CvmFact`/`ShareCapitalFact`/`fundamental_indicators`/
  `StockMonitoring`/`Prediction` (Prisma); atribuição automática de saúde de
  banco operacional a holding listada.

## BUG CORRIGIDO (2026-08-15) — ficha fundamentalista 500 em toda empresa

**Sintoma:** aba Fundamentos CVM mostra "Não foi possível carregar a ficha
fundamentalista." para QUALQUER empresa consultada;
`GET /api/cvm/companies/{cdCvm}/fundamentals` devolve **500**.

**Causa raiz:** o `cvm_fundamentos.db` atualmente ativo **não tem a tabela
`fundamental_indicators`** — só tem a tabela mais antiga `indicadores`.
`src/lib/server/cvm-fundamentals-sheet.ts:164` (`getFundamentalIndicators`)
consulta `SELECT ... FROM fundamental_indicators WHERE cd_cvm = ?`, que
falha com `no such table: fundamental_indicators` antes de qualquer lógica
específica da empresa — por isso o erro é uniforme, não pontual.

O banco vivo está numa linhagem anterior (2026-07-14/17) à que ganhou essa
tabela (merge de 2026-07-18). A tabela existe, íntegra, em
`cvm_fundamentos.db.backup-20260718-con-merge` (6.924 linhas, colunas
`roic/margem_ebit/giro_ativos/divida_liquida_ebitda/divida_bruta_pl/
pl_ativos/icj/payout_ratio/p_ebitda/ev_ebitda/ev_ebit/crescimento_receita_yoy/
crescimento_lucro_yoy/cagr5y_receita/cagr5y_lucro/preco_ref/roe/roa/
margem_bruta/margem_liquida/margem_ebitda`). A sincronização BCB de
2026-08-13 (`scripts/bcb-sync/sync-bcb-snapshot.cjs`) **não causou isso** —
por design ela só copia as 27 tabelas `bcb_*`; o banco já estava sem
`fundamental_indicators` antes dela rodar. Em algum momento o arquivo
`cvm_fundamentos.db` foi substituído por uma cópia que regrediu essa tabela,
sem que nenhuma validação pegasse (o script de sync só checa regressão de
contagem nas tabelas CVM que ele mesmo toca, não em `fundamental_indicators`).

**Consultado em:** `src/lib/server/cvm-fundamentals-sheet.ts` (linha 164,
também linhas 457/492), `src/lib/server/cvm-sector-ranking.ts` (linhas
95/116/146) e `src/lib/server/cvm-financial-health.ts` (linha 94) — todos
dependem de `fundamental_indicators` e devem falhar do mesmo jeito.

**Correção aplicada (2026-08-15, via Guardião_Hermes/Claude Code no WSL):**
a tabela `fundamental_indicators` foi restaurada no `cvm_fundamentos.db`
ativo — confirmado 6.924 linhas, incluindo registros para o cd_cvm 020958
(caso que disparou o 500 original). `GET /api/cvm/companies/{cdCvm}/fundamentals`
volta a funcionar.

## REGRESSÃO DO MESMO BUG (2026-08-28) — Saúde Financeira, Ranking Setorial e Ficha caem em 500

**Sintoma:** aba **Saúde Financeira** não carrega o ranking da indústria.
`GET /api/cvm/financial-health` devolve **500** para qualquer requisição:

```
Error: no such table: fundamental_indicators   (SQL logic error)
  em src/lib/server/cvm-financial-health.ts:94
```

**Causa raiz:** o `cvm_fundamentos.db` ativo perdeu de novo a tabela
`fundamental_indicators` — exatamente a regressão corrigida em 2026-08-15,
descrita na seção acima. O banco vivo tem 38 tabelas (27 `bcb_*` + 10 CVM);
sobrou só a `indicadores`, que não tem `divida_bruta_pl` nem `icj`, dois dos
cinco pilares.

**Quando quebrou:** entre 15/08 e 21/08. O backup pré-sync
`backups/cvm_fundamentos_pre_2t26_sync_20260821_063604.db` **ainda tem** a
tabela (6.924 linhas); o arquivo vivo, gravado por aquele sync do 2T26, saiu
sem ela. Ou seja, o pipeline que atualiza o banco (do Guardião_Hermes, fora
deste repo — nada aqui gera essa tabela) substitui o arquivo por uma linhagem
que não a inclui, e nenhuma validação pega: o sync só confere regressão de
contagem nas tabelas que ele mesmo escreve.

**Escopo — não é só a Saúde Financeira.** Quebram do mesmo jeito:
`cvm-fundamentals-sheet.ts:164/457/492` (Ficha Fundamentalista),
`cvm-sector-ranking.ts:95/146` (Ranking Setorial) e
`python/ml/directional_features.py:83` (features direcionais do ML).

**O bloco de bancos (BCB) está intacto** — `npm run test:bcb-financial-health`
passa inteiro (10 bancos, 45 trimestres cada), porque lê só tabelas `bcb_*`.
Na tela, o painel de bancos funciona e o ranking da indústria é que morre.

**Correção verificada, NÃO aplicada:** transplantando `fundamental_indicators`
do backup de 21/08 para uma cópia do banco vivo, a query da saúde financeira
volta a rodar (6.895 linhas, 137 tickers). Esse backup vai até **1T26**,
enquanto `dre_trimestral`/`indicadores` do banco vivo já têm **2T26** — o
transplante destravaria as abas com os indicadores um trimestre atrasados.
Por isso a decisão do usuário (2026-08-28) foi **acionar o Guardião_Hermes
para regerar a tabela já com o 2T26**, em vez de transplantar o backup.

**Prevenção sugerida (não implementada):** o pipeline que publica
`cvm_fundamentos.db` deve checar presença e contagem de `fundamental_indicators`
antes de substituir o arquivo vivo — o bug já reincidiu duas vezes exatamente
por falta dessa checagem.

### Causa raiz real e gate de publicação (2026-08-28, cont.)

A seção acima supunha "substituído por uma cópia que regrediu". O publicador
foi localizado e a causa é mais específica:
`/root/.hermes/workspace/cvm_fundamentos/scripts/merge_2t26_preserve_history.py`
(WSL, linha 10) faz `shutil.copy2(backup, target)` — **substitui o banco
canônico inteiro por um backup** e depois reinsere só as linhas do trimestre
novo das tabelas que têm `(cd_cvm, ano, trimestre)`. Toda tabela fora desse
formato herda o estado do backup escolhido: `fundamental_indicators` é
justamente uma delas, e o backup usado (15/08 10:56) era anterior à restauração
da tabela (15/08 15:49). `sync-bcb-snapshot.cjs` está inocente — ele é
tabela-a-tabela e só toca `bcb_*`.

A regeneração é etapa separada (`build_fundamental_indicators.py`, com `--db`),
e não roda sozinha depois do merge. Foi ela que restaurou a tabela em 28/08:
7.085 linhas, 138 empresas, cobertura até **2026T2** (135 linhas).

**Gate adicionado neste repo** — `scripts/cvm-sync/publish-cvm-snapshot.cjs`,
com os gates puros em `cvm-publish-gates.cjs`. Roda os seis gates no candidato
ANTES de qualquer escrita e publica por `fs.renameSync` (troca atômica, mesmo
volume), com backup datado:

| Gate | Reprova quando |
|---|---|
| `INTEGRIDADE` | `integrity_check` ≠ ok ou `foreign_key_check` não vazio |
| `FUNDAMENTAL_INDICATORS` | tabela ausente, vazia ou sem as 28 colunas |
| `COBERTURA_TRIMESTRE` | o trimestre mais recente da `dre` não está nos indicadores (≥90% das empresas) |
| `SEM_DUPLICIDADES` | `(cd_cvm, ano, trimestre)` repetida ou ticker duplicado |
| `SETORES_VALIDOS` | qualquer empresa com ticker e `setor_cvm` vazio |
| `SEM_REGRESSAO` | qualquer tabela CVM/BCB encolhe ou desaparece vs destino |

Testes: `npm run test:cvm-publish-gates` (cada defeito injetado reprova o gate
específico + prova de fumaça no banco vivo). `npm run test:financial-health`
ganhou trava cruzando com `bcb_prudencial_capital`: nenhum banco do bloco BCB
pode aparecer no ranking da indústria — a asserção antiga ("nenhum bucket
financeiro") não pegava `setor_cvm` NULL, que foi exatamente o furo de 28/08.
