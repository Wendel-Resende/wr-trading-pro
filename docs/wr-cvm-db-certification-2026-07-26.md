# Certificação do banco CVM da WR Trading Pro — 138 empresas

Data: 2026-07-26

## Objetivo

Certificar que o banco local da WR Trading Pro está apontando cada ticker para o emissor correto da CVM, evitando repetir erro de identidade como Localiza Rent a Car versus Localiza Fleet.

Banco verificado:

```text
data/cvm/cvm_fundamentos.db
```

Fonte de certificação usada como referência:

```text
/root/.hermes/workspace/cvm_fundamentos/data/exports/b3_cvm_identity_audit_all_20260726_v6/local_review/final_certification/final_cvm_identity_certification_138.csv
```

## Gate executado

Script versionado:

```text
scripts/verify_wr_cvm_db_certification.py
```

Comando:

```bash
python3 scripts/verify_wr_cvm_db_certification.py
```

## Resultado

Veredito: PASS

Resumo validado:

- Empresas no banco WR: 138
- Linhas na certificação Guardião: 138
- Tickers duplicados em `empresas`: 0
- `cd_cvm` duplicado em `empresas`: 0
- Divergências entre `empresas.cd_cvm` e certificação: 0
- Divergências de CNPJ preenchido no banco contra cadastro CVM/certificação: 0
- Empresas com `blocking_issues` na certificação: 0
- Linhas órfãs fora de `empresas`: 0 nas tabelas auditadas

Cobertura por tabela principal:

| Tabela | CD_CVM distintos |
| --- | ---: |
| `dre_trimestral` | 138 |
| `bpa_trimestral` | 138 |
| `bpp_trimestral` | 138 |
| `dfc_trimestral` | 138 |
| `dva_trimestral` | 138 |
| `dra_trimestral` | 138 |
| `capital_social` | 138 |
| `dividendos_jcp_dmpl` | 133 |

Observação: `dividendos_jcp_dmpl` é uma tabela opcional de proventos; 133 emissores com linhas não bloqueiam a certificação de identidade CVM das 138 empresas.

## Guardrail Localiza

- `RENT3` no banco WR: `019739` / `LOCALIZA RENT A CAR SA` / `16.670.085/0001-55`
- `024813` — Localiza Fleet — aparece 0 vezes em:
  - `empresas`
  - `dre_trimestral`
  - `bpa_trimestral`
  - `bpp_trimestral`
  - `dfc_trimestral`
  - `dva_trimestral`
  - `dra_trimestral`

## Interpretação

O banco CVM da WR Trading Pro está certificado quanto ao risco principal de identidade:

- ticker → `CD_CVM` correto;
- `CD_CVM` presente na certificação Guardião;
- CNPJ preenchido compatível com a CVM;
- tabelas principais cobrem todos os 138 emissores;
- sem resíduos do `CD_CVM` errado da Localiza Fleet.

As 58 empresas marcadas anteriormente como `CERTIFICADO_CVM_MAPPING_RI_INCONCLUSIVO` continuam apenas com ressalva de RI/PDF/release textual. Essa ressalva não indica empresa errada na extração CVM.
