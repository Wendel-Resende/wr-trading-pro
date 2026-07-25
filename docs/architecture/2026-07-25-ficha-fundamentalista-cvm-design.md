# Ficha Fundamentalista por Empresa — spec aditiva (v1)

- **Data:** 2026-07-25
- **Autor:** Claude Code (Opus 4.8), a partir de brainstorming com o usuário
- **Status:** rascunho — **aguardando revisão do Guardião** antes de qualquer código
- **Origem:** análise de gap (diagramas archify Vibe-Trading/Fincept do Guardião) →
  decisão de focar nos dados B3/CVM já existentes. Primeira fatia do "Painel de
  Análise Fundamentalista" (parte dos "insights profissionais pretendidos" do
  dossiê de upgrade, [[wr-trading-pro-professional-upgrade]]).

## 1. Problema

A plataforma já tem, no snapshot `data/cvm/cvm_fundamentos.db`, um acervo rico de
dados fundamentalistas de 138 empresas B3 (2011–2026): demonstrações completas
(`dre_trimestral`, `bpa_trimestral`, `bpp_trimestral`, `dfc_trimestral`,
`dra_trimestral`, `dva_trimestral`), formulário de referência (`fre_*`),
`dividendos_jcp_dmpl`, e **duas tabelas de indicadores já calculados pelo pipeline
do Guardião**: `indicadores` e a mais rica `fundamental_indicators`.

Mas a UI só expõe **`/api/cvm/companies`** (lista/detalhe) e **`/api/cvm/dividends`**.
Toda a camada de análise fundamentalista está ausente — os indicadores computados
não são superficiados, e não há uma "ficha" por empresa que mostre a evolução dos
fundamentos ao longo do tempo. Esta spec entrega a **primeira fatia**: uma ficha
read-only por empresa.

## 2. Decisões de arquitetura

### D1 — Fonte: tabelas de indicadores do pipeline, read-only, sem recálculo

Os números vêm das tabelas **já computadas** pelo pipeline do Guardião
(`fonte='CALCULADO'`), nunca recalculados no WR (o Guardião é dono desse cálculo;
recalcular duplicaria e arriscaria divergência). Decisão do usuário no brainstorming.

- **Primária:** `fundamental_indicators` (tem `data_ref` por período e é a mais
  completa: `roic`, `giro_ativos`, `divida_liquida_ebitda`, `divida_bruta_pl`,
  `pl_ativos`, `icj`, `payout_ratio`, `p_ebitda`, `ev_ebitda`, `ev_ebit`,
  `crescimento_receita_yoy`, `crescimento_lucro_yoy`, `cagr5y_*`, `preco_ref`,
  `roe`, `roa`, margens).
- **Complemento:** `indicadores` (margens, `roe`, `roa`, `endividamento`,
  `liquidez_corrente`, `divida_pl`) para campos ausentes em
  `fundamental_indicators` (ex.: `endividamento`, `liquidez_corrente`).
- Leitura via adapter read-only sobre `cvm_fundamentos.db`, no mesmo padrão dos
  `/api/cvm/*` existentes. Nenhuma escrita nesse banco.

### D2 — Indicadores exibidos (v1)

Agrupados por dimensão, série trimestral:

- **Margens:** `margem_bruta`, `margem_ebit`, `margem_ebitda`, `margem_liquida`.
- **Retornos:** `roe`, `roa`, `roic`.
- **Alavancagem:** `endividamento`, `divida_pl`/`divida_bruta_pl`,
  `divida_liquida_ebitda`.
- **Liquidez:** `liquidez_corrente`.
- **Proventos:** `payout_ratio`.

Unidades declaradas por campo (percentuais vs múltiplos vs razões) — nunca um
número sem unidade.

### D3 — Métrica derivada no WR: conversão de caixa

O único cálculo novo, porque não existe nas tabelas de indicadores:

```
conversaoCaixa[ano,tri] = fco[ano,tri] / lucro_liquido[ano,tri]
```

`fco` de `dfc_trimestral`, `lucro_liquido` de `dre_trimestral`, casados por
`(cd_cvm, ano, trimestre)`. Regras determinísticas (testadas):

- `lucro_liquido <= 0` → não divide; retorna `null` + flag `motivo: 'LUCRO_NAO_POSITIVO'`
  (razão sem sentido econômico com lucro negativo — nunca fabrica um número).
- `fco` ausente ou `lucro_liquido` ausente (ex.: buraco de DRE) →
  `null` + flag `motivo: 'DADO_AUSENTE'`.
- Rotulada na proveniência como **`derivado no WR`** com a fórmula, distinta dos
  indicadores `CALCULADO` do pipeline.

### D4 — Carimbo de conhecimento derivado do prazo legal (não há data de publicação)

As tabelas têm `data_ref` (fim do período) e `criado_em` (do pipeline), **mas
nenhuma data de publicação/recebimento CVM**. Portanto o "carimbo de conhecimento"
é **derivado do prazo legal**, espelhando a defasagem que o ML Híbrido já aplica:

```
knowledgeDate = data_ref + (trimestre == 4 ? 90 dias : 45 dias)
              // ITR (T1/T2/T3): +45d ; DFP (T4/anual): +90d
estimadoPorPrazoLegal = true   // sempre, nesta v1 (sem data real de publicação)
```

Se `data_ref` estiver ausente numa tabela (ex.: `indicadores` só tem `ano/trimestre`),
derivar o fim do período civil de `(ano, trimestre)` e aplicar a mesma regra.
Este carimbo afirma apenas "no mais tardar nesta data, o fato já era público" —
consistente com o princípio point-in-time do projeto, sem inventar uma hora de
publicação que a fonte não tem. Alinhar a constante de prazo com a lógica
`asof_fundamentals` do `python/ml` (mesma regra, para não divergir).

### D5 — Série reportada, sem reconstrução "as of" (decisão do usuário)

A ficha mostra a **série reportada completa**, cada período com seu carimbo de
conhecimento. **Não** reconstrói "o que era conhecido até a data X" nem trata
retificações por data — isso é follow-up explícito (seção 6). Retificações
existentes no snapshot aparecem como o pipeline as deixou; a ficha não as
reprocessa.

### D6 — Dados faltantes são explícitos, nunca fabricados

Buracos conhecidos (ex.: `dre_trimestral` sem ITUB4 2012T2/T3 e ABEV3 2013T1,
registrados no handoff) e qualquer período ausente aparecem como **"sem dado"**
na série/tabela, com o período preservado. Nenhum valor interpolado, estimado ou
zero-como-dado. A conversão de caixa herda isso via D3.

### D7 — Envelope de proveniência por métrica

Cada ponto de dado carrega:

```ts
interface FundamentalPointV1 {
  readonly period: { readonly ano: number; readonly trimestre: 1 | 2 | 3 | 4 };
  readonly value: number | null;         // null = sem dado (D6)
  readonly unit: 'percent' | 'ratio' | 'multiple';
  readonly source: 'pipeline-cvm' | 'derivado-wr';
  readonly dataRef: string | null;       // ISO date do fim do período, se houver
  readonly knowledgeDate: string;        // ISO, D4
  readonly estimadoPorPrazoLegal: boolean;
  readonly note?: string;                // ex.: 'LUCRO_NAO_POSITIVO', 'DADO_AUSENTE'
}
```

### D8 — Contrato de API: novo endpoint read-only

`GET /api/cvm/companies/[cdCvm]/fundamentals`

- `cdCvm` validado (dígitos; empresa existente → 404 se não).
- Query opcional: `fromYear`, `toYear`, `limitQuarters` (default: últimos 20 tri).
- Resposta: `{ company: {cdCvm, ticker, nome, setor}, series: { <indicador>: FundamentalPointV1[] }, provenance: { db: 'cvm_fundamentos.db', tables: [...], generatedAt } }`.
- **Read-only garantido**: adapter só faz `SELECT`; nenhuma rota de escrita.
- Zod na fronteira (query + shape de saída), no padrão `/api/v1` do projeto.
- Segue o estilo dos `/api/cvm/*` já existentes (auth de sessão como o resto do app).

### D9 — UI: seção na aba Fundamentos CVM (detalhe da empresa)

Nova seção **"Ficha Fundamentalista"** no detalhe de empresa da aba Fundamentos CVM.
Small-multiples com **Recharts** (já no stack): sparklines por dimensão (margens,
retornos, alavancagem, liquidez) + série de conversão de caixa, e uma tabela
trimestral com os carimbos de conhecimento e flags de proveniência. Estados
honestos: "sem dado" visível, fonte (`pipeline` vs `derivado WR`) rotulada,
carimbo "estimado (prazo legal)" explícito. Nenhum `alert()` — toast global.

## 3. Contratos afetados (todos aditivos)

- **Novo** `GET /api/cvm/companies/[cdCvm]/fundamentals` (`route.ts`).
- **Novo** adapter/serviço read-only lendo `cvm_fundamentos.db`
  (`fundamental_indicators` + `indicadores` + `dre_trimestral` + `dfc_trimestral`
  + `empresas`), no padrão dos leitores `/api/cvm/*` existentes.
- **Novo** cálculo determinístico `conversaoCaixa` (D3) + derivação de
  `knowledgeDate` (D4), com testes próprios.
- DTO `FundamentalPointV1` + envelope de resposta (D7).
- **UI** nova seção no componente de detalhe da empresa (aba Fundamentos CVM) +
  chamada à nova rota.
- Nenhuma mudança em schema Prisma, no banco CVM, em contratos existentes, ou nos
  fluxos de ML/backtest/execução.

## 4. Testes obrigatórios

- **D3 (conversão de caixa):** normal (fco/lucro>0); `lucro<=0` →
  `null`+`LUCRO_NAO_POSITIVO`; `fco` ausente → `null`+`DADO_AUSENTE`; `lucro`
  ausente → idem; contra fixtures reais de 1–2 tickers.
- **D4 (carimbo):** T1/T2/T3 → `data_ref`+45d; T4 → `data_ref`+90d;
  `data_ref` ausente → derivado do fim do período civil de `(ano,tri)`;
  `estimadoPorPrazoLegal` sempre `true` nesta v1.
- **D6 (faltantes):** um ticker/período com buraco conhecido (ITUB4/ABEV3)
  retorna `value: null` com período preservado, nunca fabricado.
- **D8 (contrato):** `cdCvm` inexistente → 404; read-only (nenhuma escrita
  possível pela rota); proveniência presente em toda métrica; paginação/janela
  respeitada; Zod rejeita query malformada.
- Regressão: `/api/cvm/companies` e `/api/cvm/dividends` inalterados;
  `tsc --noEmit`, `npm run build`.

## 5. Fora de escopo (v1 → próximas fatias do painel)

- Seletor "as of" com reconstrução point-in-time e tratamento de retificação (D5).
- Múltiplos vs preço de mercado / motor de valuation (precisa de preço MT5).
- Comparação setorial point-in-time (cross-empresa).
- Decomposição DuPont/ROIC detalhada (embora `fundamental_indicators.roic`/
  `giro_ativos` já existam — surfaçá-los aqui é ok; a *decomposição* explicativa é
  próxima fatia).
- Recálculo de indicadores a partir de demonstrações cruas (D1 decidiu confiar no
  pipeline; reconciliação híbrida é outra fatia se surgir desconfiança).

## 6. Desvios conscientes / limitações declaradas

1. **Sem data de publicação real** — o carimbo é derivado do prazo legal (D4),
   mais conservador do que a data real de recebimento CVM. Popular datas reais de
   publicação é trabalho futuro.
2. **Confia no pipeline do Guardião** (D1) — a WR não valida a corretude dos
   indicadores `CALCULADO`; se o pipeline tem imprecisão (o vault registra
   ressalvas na `dividendos_jcp_dmpl`/`financial_health`), a ficha a reflete. A
   proveniência deixa claro que a fonte é o pipeline, não um cálculo do WR.
3. **Série reportada, não as-of** (D5).

## 7. Critério de aceitação

Para qualquer empresa das 138, a ficha mostra a evolução trimestral dos
indicadores fundamentalistas que o pipeline já computou (margens, retornos incl.
ROIC, alavancagem, liquidez, payout) mais a conversão de caixa derivada no WR,
cada ponto com unidade, fonte (`pipeline` vs `derivado WR`), período e carimbo de
conhecimento derivado do prazo legal (flag "estimado"). Períodos ausentes aparecem
como "sem dado", nunca fabricados. A rota é read-only e não toca nenhum fluxo de
ML/backtest/execução. Nunca um número sem unidade/fonte, nunca um dado ausente
apresentado como zero, nunca uma data de publicação inventada.

---

**Próximo passo:** revisão do Guardião (via canal de coordenação) sobre esta spec
— em especial D1 (confiar no pipeline vs reconciliar), D4 (regra do carimbo de
conhecimento, alinhamento com `asof_fundamentals` do `python/ml`) e a escolha
`fundamental_indicators` como fonte primária. Nenhum código será escrito antes da
aprovação; implementação depois em worktree, sem push até revisão do diff.
