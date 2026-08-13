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
