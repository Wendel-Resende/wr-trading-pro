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
