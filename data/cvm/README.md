# data/cvm — banco de fundamentos CVM (derivado)

`cvm_fundamentos.db` é um **snapshot do banco derivado** mantido pelo
Guardião_Hermes no WSL (`/root/.hermes/workspace/cvm_fundamentos/data/`).

- Snapshot copiado em: **2026-07-14**
- Conteúdo: 138 empresas B3, séries trimestrais 2011–2025 (DRE, BPA, BPP,
  DFC, DVA, DRA, indicadores calculados, capital social)
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

**Nota (2026-07-14):** a carteira 12 nos CSVs atuais difere da tabela
registrada no inventário do vault (ex.: VIVA3 81,7 lidera; VULC3/INTB3
presentes; ITUB4 ausente) — os exports parecem mais recentes que a página.
Divergência anotada no log do vault para o Guardião esclarecer a versão.
