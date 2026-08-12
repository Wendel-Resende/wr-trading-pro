# Reposicionamento: Previsões ML → Ranking Fundamentalista

Data: 2026-08-11
Status: aprovado pelo usuário (decisões registradas abaixo)
Autor: Claude Code (Opus 5), a pedido do usuário

## Motivação

A aba "Previsões ML" prometia prever o mercado e nunca entregou isso — por
desenho, não por execução ruim. O único motor que passou no gate da própria
plataforma é o **escore composto de fator** (IC +0,096, t +4,32, spread
topo-fundo +2,58 p.p., quintis monotônicos Q1 +0,13% → Q5 +2,71%). O que ele
responde é: *"entre estas empresas, quais tendem a render acima das outras no
próximo trimestre"* — ordenação transversal com horizonte de 60 pregões.

Isso é um resultado quantitativo legítimo, mas não é previsão de mercado.
Três motores foram reprovados pelo gate (híbrido, ensemble direcional, Kronos)
e as três variáveis de desenho foram percorridas (horizonte/alvo, instrumento,
volume de dados). O caminho está esgotado.

Manter o rótulo "Previsões" viola o princípio nº 1 do projeto: nada pode ser
apresentado como o que não é. Plataformas profissionais de referência (Profit
Pro) não têm aba de previsão — dão ferramenta, quem decide é o operador.

**Decisão do usuário:** reposicionar, não remover. Preserva o único resultado
aprovado no gate e elimina a promessa falsa.

## Decisões (respondidas pelo usuário em 2026-08-11)

| # | Questão | Decisão |
|---|---|---|
| 1 | Localização | Aba própria, renomeada para **Ranking Fundamentalista** |
| 2 | Profundidade da renomeação | **UI + respostas de API**. Banco, migrations e modelos Prisma intactos |
| 3 | Rótulos COMPRA/VENDA/NEUTRO | Substituídos por **quintil + escore** |
| 4 | Previsões persistidas desatualizadas | **Regerar** com o código já corrigido |
| 5 | Tools MCP do Hermes | **Descrições e retornos** mudam; **nomes das tools ficam** |
| 6 | Forma da cirurgia | Renomear **e separar** o componente de 803 linhas |

## Problema de dado que motivou a decisão 4

Auditoria em 2026-08-11 (servidor real sobre cópia do `dev.db`) constatou que o
modelo ACTIVE `ab236072…` serve **138 previsões**, quando a correção de universo
de 2026-07-26 resultou em 129 ranqueadas + 9 excluídas.

As previsões persistidas foram geradas em `2026-07-26T03:07:14`, antes de a
correção surtir efeito, e nunca foram regeradas. Evidências:

- distribuição por quintil `28/27/28/27/28` — idêntica à registrada no handoff
  como a rodada com bug;
- GUAR3, NEOE3, STBP3 em **quintil 5**; SRNA3 em **quintil 1** — exatamente as
  quatro empresas que o handoff nomeia como indevidamente nos extremos, por não
  terem série de preços;
- `meta` sem `excludedFromUniverse`.

O código Python está correto. O dado exibido não. Regeneração resolve.

## Arquitetura

### Componentes

```
src/components/tabs/RankingFundamentalistaTab.tsx   (era MLPredictionsTab)
  └── src/components/ranking/
       ├── RankingFundamentalistaView.tsx   orquestra; ÚNICO que faz fetch
       ├── RankingTable.tsx                 ticker, empresa, quintil, escore, barra
       ├── EvidenciaModelo.tsx              IC, t-stat, spread, 5 gates, excesso/quintil
       └── TreinoControls.tsx               disparar / acompanhar / cancelar treino
```

`src/components/ml/DirectionalSignalsView.tsx` (803 linhas) é aposentado; a
pasta `src/components/ml/` deixa de existir.

**Fronteiras:** só a View conhece rede. Os três filhos recebem dados por props,
são testáveis isoladamente e confinam a troca de vocabulário. A separação não é
enfeite — é o que torna a renomeação verificável num arquivo que hoje mistura
ranking, evidência, treino e estados de erro.

### Fluxo de dados

`RankingFundamentalistaView` busca no mount:

1. `GET /api/v1/ml/directional/models?status=ACTIVE&limit=20` — modelo vigente
2. `GET /api/v1/ml/directional/predictions?modelVersion=<mv>` — ranking
3. `GET /api/v1/ml/training-runs?limit=1` — treino mais recente
4. `GET /api/cvm/companies` — total do universo CVM, para a contagem de excluídas

Distribui por props. Sem estado global novo.

## Mapa de vocabulário

### Tela

| Antes | Depois |
|---|---|
| Previsões ML | Ranking Fundamentalista |
| Classificador direcional (60 pregões) | Ranking por fator fundamentalista — ordenação transversal, 60 pregões |
| Sinais / Previsões | Ranking / Posição |
| COMPRA · VENDA · NEUTRO | Q5 · Q4 · Q3 · Q2 · Q1 |
| confiança | *(removido)* |

Legenda fixa e obrigatória na tela:

> **Q5 = topo do ranking no trimestre. Não é recomendação de compra.**

### DTO de `/api/v1/ml/directional/predictions`

| Campo | Antes | Depois |
|---|---|---|
| `signal` | `"COMPRA"` | **removido** |
| `confidence` | `1` | **removido** — constante, não informa nada |
| `prob` | percentil transversal | **`percentil`** |
| `score`, `quantile` | — | mantidos |
| `meta.highConfidence` | contagem de não-NEUTRO | **removido** (derivava de `signal`) |

O `prob` é correção de uma imprecisão já documentada: o schema Prisma registra
que a coluna *"NÃO é probabilidade — guarda o PERCENTIL transversal"*.

**Verificado em 2026-08-11:** o comentário do schema afirma que *"o domínio
expõe o campo como `percentile`"*, mas isso **não é verdade** — o domínio
(`src/domain/v1/models/ml-directional.ts`) usa `prob`, `signal` e `confidence`
como o banco. A renomeação acontece **exclusivamente na fronteira do DTO**
(`toDirectionalPredictionPublicDTO` mapeia `p.prob → percentil`), preservando
domínio, repositório, adapters e coluna. É o que a decisão 2 aprovou; mexer no
domínio faria a mudança escorrer para adapters Prisma sem benefício para quem
lê a tela. O comentário enganoso do schema deve ser corrigido de passagem.

### Tools MCP

Nomes preservados (não quebra a conexão do Hermes, nem a invariante testada do
catálogo de 39 tools). Mudam descrições e campos de retorno, pelo mesmo mapa do
DTO — para o agente parar de receber linguagem de recomendação num canal que
alimenta `trade.propose`.

## Contagem do universo sem alterar o schema

`excludedFromUniverse` é devolvido pelo **POST** (geração) mas não pelo **GET**,
e `DirectionalModelVersion` não guarda o universo (ele vive no artefato
`model.json`). Criar coluna está fora do escopo aprovado (decisão 2).

Solução: a View **deriva** a informação do que já tem — total de empresas CVM
(`/api/cvm/companies`) menos as ranqueadas:

> **129 empresas ranqueadas** — 9 do universo CVM ficaram de fora por não terem
> série de preços para validar o modelo.

Se a diferença for zero, a nota não aparece. Nada é fabricado.

## Regeneração das previsões — TESTADA E REPROVADA

> **Correção de 2026-08-11, após execução real.** A decisão 4 partia da premissa
> de que regerar as previsões corrigiria o ranking. **Isso está errado, e foi
> comprovado rodando.**

Execução real (ML Engine ligado, usuário admin, servidor sobre cópia do
`dev.db`): `POST /api/v1/ml/directional/predictions` respondeu **HTTP 201** em
0,35 s e devolveu **exatamente o mesmo resultado**:

```
ranqueadas: 138          (esperado: 129)
excludedFromUniverse: [] (esperado: 9 tickers)
GUAR3 Q5 · NEOE3 Q5 · STBP3 Q5 · SRNA3 Q1   (ainda nos extremos)
quintis: 28/27/28/27/28  (idênticos ao original)
```

### Causa raiz

O filtro de universo é condicional no motor
(`python/ml/directional_classifier.py:876`):

```python
if model.universe:
    validas = set(model.universe)
```

O artefato do modelo ACTIVE não tem esse campo. Verificado diretamente em
`data/ml/directional_models/ab236072…/model.json`:

```
chaves: selected, featureIc, minTStat, candidates
universe: AUSENTE
```

O arquivo é de **2026-07-26 00:04** — anterior à correção, que passou a gravar
`self.universe` no `fit`. Sem universo no artefato, `predict_latest` não tem
contra o que filtrar e, por compatibilidade deliberada (há teste cobrindo isso:
*"artefato SEM universo gravado não filtra e não quebra"*), devolve todas as 138.

### Consequência

**Regerar não resolve. Só RETREINAR resolve** — o treino novo grava o universo
no artefato. Isso é decisão do usuário, com dois custos reais:

1. tempo de treino (walk-forward completo);
2. risco de o modelo novo **não passar no gate** — e aí a plataforma fica sem
   modelo ACTIVE, o que é honesto mas deixa a aba sem ranking.

### Efeito colateral na contagem derivada

Com 138 ranqueadas e 138 no universo CVM, a nota de exclusão calcula zero e
**não aparece** — a aba mostraria 138 empresas sem nenhum aviso, incluindo as 9
sem série de preços. A derivação está correta; o dado é que mente.

Enquanto o modelo não for retreinado, a aba precisa de um aviso que não dependa
dessa subtração. **Pendência aberta, não implementada** — depende da decisão do
usuário entre retreinar ou avisar.

## Estados honestos (preservados)

| Situação | Comportamento |
|---|---|
| Sem modelo ACTIVE | Aviso explícito. Nunca lista vazia muda |
| Gate reprovado | Mostra qual critério falhou, com valor medido |
| Treino em curso | Progresso por fase + botão cancelar |
| ML Engine desligado | `UPSTREAM_ERROR` com mensagem acionável |
| Ranking vazio | Estado honesto, nunca zeros fabricados |

Esse tratamento custou caro (três defeitos reais detectados: rótulos
fabricados, superconfiança de 95%, métrica errada) e é transportado, não
reescrito.

## Fora de escopo

- Motor Python, gates, walk-forward, perfis de custo — **intactos**
- Tabelas, colunas, migrations — **intactas**
- Nomes das tools MCP — **intactos**
- Confronto Kronos × fator — não faz parte desta mudança
- Refatoração não relacionada

## Testes

- `npm run test:directional-classifier` — deve continuar verde (motor intocado)
- Novas asserções de DTO: `signal` e `confidence` ausentes; `percentil` presente
- `npx tsc --noEmit` e `npm run build` limpos
- **Correção de passagem:** `npm run test:read-models-v1` hoje **não compila**
  (`TS2307` por `@/lib/b3-ticker` em `src/app/api/v1/ml/training-runs/route.ts`).
  Está no caminho desta mudança e será corrigido para import relativo, como os
  outros 5 consumidores do módulo.

## Verificação runtime

Receita de `.claude/skills/verify/SKILL.md`, com a adaptação usada na auditoria
de 2026-08-11: servidor sobre **cópia** do `dev.db` (nunca o original),
`.env.local` temporário, porta 3210, removidos ao final.

Conferir na resposta: ausência de `signal`/`confidence`, presença de
`percentil`, e — após regeneração — 129 ranqueadas sem GUAR3/NEOE3/STBP3/SRNA3
nos extremos.
