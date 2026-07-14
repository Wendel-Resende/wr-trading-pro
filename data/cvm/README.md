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

**Gerações (recopiados em 2026-07-14 ~20:15, após regeneração com 1T2026):**

- `portfolio_12_dividendos_jcp.csv` e `dividend_quality_score.csv` —
  **2026-07-14 20:11, com 1T2026**. Carteira vigente: VIVA3, CXSE3, BBSE3,
  ENGI11, LAVV3, TRIS3, LEVE3, GRND3, ALUP11, SHUL4, VIVT3, INTB3
  (entraram CXSE3/LEVE3/GRND3/SHUL4/INTB3; saíram ITUB4/ITSA4/WEGE3/ABEV3/
  KEPL3 — ver inventário no vault).
- `financial_health_scores.csv` — regenerado 2026-07-14 20:10, mas o painel
  vai até **2025T4** (confirmar com o Guardião se é regra de janela).
- `dividendos_jcp_*.csv` (série/resumo/cobertura) — geração **2026-05-26**,
  até 2025T4.
- `portfolio_ranking.csv` (2026-05-30) e `monte_carlo_sustainability.csv`
  (2026-05-25) — não regenerados; o gate MC exibido pode defasar da
  carteira nova.
