# Ferramentas de pesquisa do Jesse portadas para a WR

Data: 2026-09-06
Status: aprovado para implementação

## Contexto

O motor determinístico de backtest da WR (`src/domain/v1/models/backtest-run/index.ts`,
279 linhas) é honesto no que faz — entrada no *open* da barra seguinte, stop/take-profit
avaliados intrabarra, custos sempre subtraídos, Sharpe anualizado pelo `periodsPerYear`
real do timeframe, embargo/purge entre treino e teste. Mas produz **um número único, sem
intervalo de confiança**, e nenhuma regra de entrada da plataforma passa por um gate
estatístico antes de virar proposta de trade.

O framework Jesse (`jesse 3.1.1`, MIT, analisado no container Docker local) resolve
exatamente esses dois buracos em `jesse/research/`:

- `rule_significance_testing/` — testa se o retorno da barra seguinte a um sinal poderia
  plausivelmente vir do acaso, via *stationary bootstrap*.
- `monte_carlo/` — embaralha a ordem dos trades e reconstrói a curva de capital N vezes,
  produzindo intervalos de confiança para retorno e drawdown.

E expõe ambos ao agente por um padrão de tool que se repete em todas as operações
pesadas: `create_draft → update_draft → run → get_session`.

Este documento especifica o porte desses três elementos. A licença do Jesse é MIT
(verificada em `jesse-3.1.1.dist-info`), então reimplementar as ideias é livre.

## O que NÃO é portado, e por quê

- **O motor event-driven** (`modes/backtest_mode.py`, 2307 linhas). Modela perpetual
  futures, funding rate, margem cross/isolated e liquidação — nada disso existe na B3.
  O motor de 279 linhas da WR atende o caso; o que falta nele é intervalo de confiança,
  não sofisticação de execução.
- **Os drivers de exchange** (Binance, Bybit, Apex, Lighter). A WR é MT5/B3.
- **A Fase 1 do teste de significância** (backtest só-de-sinal chamando `should_long()`).
  Ver seção seguinte.
- **Monte Carlo por reamostragem de candles** (`candle_pipelines/`: ruído gaussiano,
  resampler, moving-block bootstrap). Superfície maior, valor menor que a variante de
  trades. Fica para uma rodada futura, se houver.
- **Os itens 4 e 5** da análise original (unificar `ml_features()` como fonte única;
  consolidar os guard-rails do `trade.propose` em filtros nomeados). São refatorações de
  código existente, não ferramentas novas.

## Achado que muda o desenho

No Jesse, o teste de significância precisa rodar um backtest só-de-sinal porque lá o
sinal **só existe dentro do ciclo de vida da estratégia** — é o retorno de
`should_long()` numa barra específica.

Na WR, sinais já são dados de primeira classe: a tabela `Signal` (`modelVersionId`,
`instrumentId`, `barTime`, `direction`, `score`, `knowledgeTime`) e o
`BacktestSignalInput[]` que alimenta `runDeterministicBacktest`. **A saída da Fase 1 do
Jesse já existe na WR.** Só a Fase 2 — o bootstrap — é código novo.

Isso é melhor que o original em um ponto concreto: o `knowledgeTime` do `Signal` deixa o
teste herdar a garantia point-in-time que o motor já aplica (R-BT-7), em vez de confiar
que a estratégia não olhou para frente.

## Arquitetura

### 1. Núcleo puro (zero I/O)

Segue o padrão de `cvm-financial-health-rules.ts`: funções puras, testáveis isoladamente,
sem tocar banco nem rede.

#### `src/domain/v1/models/rule-significance/index.ts`

```ts
stationaryBootstrap(
  returns: readonly number[],
  observedMean: number,
  nSimulations: number,
  seed: number,
  meanBlockLength: number,
): Float64Array

ruleSignificanceTest(input: RuleSignificanceInput): RuleSignificanceResult
```

Mecânica portada de `research/rule_significance_testing/bootstrap.py`:

1. Centrar a série de retornos em zero (`centered = returns - observedMean`) — é isso
   que materializa a hipótese nula H0 "o retorno esperado da regra não é positivo".
2. Reamostrar blocos contíguos de comprimento geométrico: a cada posição, probabilidade
   `1 / meanBlockLength` de iniciar um bloco novo em um índice uniformemente sorteado;
   entre reinícios o índice avança normalmente, com *wrap* circular no fim da série.
   Isso preserva a dependência serial local, que um bootstrap i.i.d. destruiria.
3. `pValue` = fração das médias simuladas ≥ a média observada.

Retorno (`RuleSignificanceResult`):

| campo | tipo | nota |
|---|---|---|
| `observedMean` | `number` | média do log-retorno da barra seguinte |
| `annualizedReturn` | `number` | anualizado pelo tempo de calendário decorrido |
| `pValue` | `number \| null` | `null` quando abaixo do piso de observações |
| `nObservations` | `number` | após remoção de NaN |
| `nSimulations` | `number` | simulações efetivamente completadas |
| `meanBlockLength` | `number` | o valor usado, não o default |
| `insufficientData` | `boolean` | `true` quando `nObservations < MIN_OBSERVATIONS` |

Duas divergências **deliberadas** em relação ao Jesse:

- **PRNG determinístico próprio** (xoshiro128\*\* semeado, ~15 linhas). Não há equivalente
  de `np.random.default_rng` em JS, e um teste que dependa de `Math.random` não trava
  regressão nenhuma. Mesma seed → mesmo array de médias simuladas, sempre. Seed default
  42, como no Jesse.
- **Piso de observações explícito.** Abaixo de `MIN_OBSERVATIONS` o retorno é
  `pValue: null` com `insufficientData: true`, nunca um p-valor calculado sobre uma
  dúzia de sinais. É a mesma regra do "pilar sem dado não aprova e não reprova" da Saúde
  Financeira: dado ausente não vira afirmação.

`meanBlockLength` default 10 barras — o valor convencional para retornos financeiros
fracamente dependentes, e o mesmo default do Jesse. Exposto como parâmetro porque o
p-valor não significa nada sem ele; por isso também volta no resultado.

#### `src/domain/v1/models/monte-carlo-trades/index.ts`

```ts
monteCarloTrades(input: MonteCarloInput): MonteCarloResult
```

Embaralha a ordem dos `BacktestTrade[]` que `runDeterministicBacktest` já produz,
reconstrói a curva de capital de cada cenário a partir de `startingBalance`, e agrega.

**Correção sobre o que de fato varia.** O motor da WR é **aditivo**: `netPnl` é valor
absoluto por trade, com `lotSize` fixo, e `computeMetrics` soma. Logo `totalNetPnl`,
`totalNetReturn`, `meanReturn`, `stdDevReturn`, `winRate` e `sharpe` são **invariantes à
ordem** — embaralhar não muda nenhum deles. O que varia é o **caminho**: `maxDrawdown` e,
por consequência, o Calmar.

Isso é menos do que o Monte Carlo do Jesse entrega, e a diferença tem causa: o Jesse
reconstrói a curva de capital com composição (o tamanho da posição sai do saldo corrente),
então lá a ordem muda o retorno também. Replicar isso na WR exigiria mudar o motor para
sizing proporcional ao saldo — fora deste escopo, e uma decisão de modelagem, não um
detalhe.

Então o retorno é honesto sobre isso, em vez de exibir um percentil degenerado:

- `invariants: { totalNetPnl, totalNetReturn, meanReturn, sharpe, winRate }` — valores
  únicos, com o campo `orderInvariant: true` explicando que percentil não se aplica.
- `pathDependent: { maxDrawdown, calmar }` — percentis 5/50/95 e ICs de 90% e 95%, os
  mesmos cortes de `research/monte_carlo/common.py`.
- `original` — o resultado não embaralhado, ao lado, para comparação.

Um percentil 5/50/95 idêntico em três casas para retorno total não seria informação: seria
a plataforma parecendo dizer mais do que sabe.

Reaproveita as funções de métrica que já existem em `backtest-run/index.ts`. Se estiverem
privadas ao módulo, são extraídas para um módulo comum na mesma pasta — mudança
mecânica, sem alteração de comportamento do motor.

O que este teste responde, e é o motivo de existir: **quanto do drawdown observado é sorte
de sequência.** Duas estratégias com o mesmo lucro total e o mesmo Sharpe podem ter
drawdowns máximos muito diferentes dependendo apenas de em que ordem os perdedores
apareceram. Um drawdown observado de 8% cujo percentil 95 entre cenários é 22% descreve
uma conta que sobreviveu por ordem favorável, não por robustez — e é isso que estoura
conta pequena. Hoje a WR reporta o 8% e cala sobre o 22%.

### 2. Persistência

Migration **aditiva**, um modelo novo, nenhum modelo existente alterado:

```prisma
model ResearchSession {
  sessionId    String   @id @default(cuid())
  kind         String   // SIGNIFICANCE | MONTE_CARLO
  status       String   // DRAFT | RUNNING | DONE | FAILED | CANCELLED
  label        String
  notes        String?
  configJson   String
  resultJson   String?
  errorSummary String?  // já sanitizado — nunca stack trace nem path bruto
  createdBy    String
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt

  @@index([kind, status, createdAt])
}
```

Um modelo genérico com `kind`, não uma tabela por tipo: é o que o Jesse faz (backtest,
monte carlo, significância e otimização compartilham a mesma forma de sessão), e evita
que a terceira ferramenta futura peça uma terceira migration.

`errorSummary` sanitizado segue o precedente já documentado do `BackfillRun` no schema —
falha não vaza path, token nem stack trace do upstream.

### 3. Serviço de aplicação

`src/application/research-session/service.ts` — CRUD do rascunho mais:

```ts
run(sessionId): Promise<ResearchSessionReadModel>
cancel(sessionId): Promise<ResearchSessionReadModel>
```

A transição `DRAFT → RUNNING` é feita por **update condicional**
(`updateMany({ where: { sessionId, status: 'DRAFT' }, data: { status: 'RUNNING' } })`),
nunca por read-then-write. Duas chamadas concorrentes de `run()` no mesmo rascunho: uma
vence (contagem afetada = 1), a outra recebe erro `ALREADY_RUNNING`. É a mesma trava CAS
que o `ModelVersion.publishedAt` já usa neste schema.

`configJson` é validado por Zod na entrada conforme o `kind` — um rascunho de
`SIGNIFICANCE` e um de `MONTE_CARLO` não aceitam a mesma configuração.

### 4. Rotas HTTP

```
POST   /api/v1/research-sessions          cria rascunho
GET    /api/v1/research-sessions          lista (filtro por kind/status)
GET    /api/v1/research-sessions/[id]     lê sessão
PATCH  /api/v1/research-sessions/[id]     atualiza rascunho / notas
DELETE /api/v1/research-sessions/[id]     remove
POST   /api/v1/research-sessions/[id]/run
POST   /api/v1/research-sessions/[id]/cancel
```

Next.js 15: `params` é `Promise<{ id: string }>` — usar `await params`.

### 5. Superfície MCP

12 tools novas, `privilege: 'free'` (são leitura e computação; não tocam broker nem
mudam estado de conta), no molde fino de `src/mcp/pilot/tools/trade.ts` — Zod na
fronteira, zero regra de negócio no arquivo da tool:

```
research.significance.create_draft | update_draft | get | list | run | cancel
research.monte_carlo.create_draft  | update_draft | get | list | run | cancel
```

`createdBy` é fixado no servidor como `'mcp:hermes'` e **nunca** vem dos argumentos —
mesmo raciocínio do docblock de `trade.ts` sobre `requestedBy`: se viesse do argumento,
um agente poderia variar o valor para reabrir cotas ou forjar autoria.

O ganho do padrão draft→run→session, e o motivo de não ser uma tool única de 20
parâmetros: o agente monta a configuração incrementalmente, o `run` é um passo separado
e cancelável, e o rascunho **sobrevive ao reinício do MCP Pilot** — que é processo filho
do Electron e reinicia com frequência.

## Fluxo de dados

```
Signal[] / BacktestSignalInput[]  ─┐
MarketBar[]                        ├─→ ruleSignificanceTest()  ─→ resultJson
config (nSims, seed, blockLength) ─┘

runDeterministicBacktest() → BacktestTrade[] ─┐
startingBalance                               ├─→ monteCarloTrades() ─→ resultJson
config (nScenarios, seed)                     ┘
```

Ambos os núcleos recebem dados já materializados e devolvem estruturas puras. Quem lê do
banco é o serviço de aplicação; quem valida é a fronteira Zod; quem calcula não conhece
nenhum dos dois.

## Tratamento de erro

- **Dado insuficiente** não é erro: é `insufficientData: true` com `pValue: null`. A
  sessão termina `DONE`, e o resultado diz por que não há p-valor.
- **Configuração inválida** é rejeitada na fronteira Zod, antes de qualquer escrita — a
  sessão nunca chega a `RUNNING` com config que não roda.
- **Falha durante o cálculo** transiciona para `FAILED` com `errorSummary` sanitizado.
- **`run()` sobre sessão não-`DRAFT`** devolve `ALREADY_RUNNING` (ou o status atual), sem
  recomputar.
- **`cancel()` sobre sessão `DONE`** é no-op idempotente, não erro.

## Testes

TDD. Runner em `scripts/research-session/run-research-session-tests.cjs`, exposto como
`npm run test:research-session`, no padrão dos 20+ runners que já existem no
`package.json`.

Casos que travam as propriedades que importam:

1. **Bootstrap determinístico** — mesma seed produz array idêntico; seeds diferentes
   produzem arrays diferentes. Sem isso nenhum outro teste estatístico é reprodutível.
2. **Série de puro ruído** (sem deriva) → p-valor não significativo.
3. **Série com deriva positiva forte** → p-valor baixo.
4. **Observações abaixo do piso** → `pValue: null` e `insufficientData: true`, nunca um
   número.
5. **Preservação de dependência serial** — o bootstrap estacionário aplicado a uma série
   autocorrelacionada produz variância das médias simuladas maior que um bootstrap
   i.i.d. sobre a mesma série. É o que justifica a escolha do método.
6. **Monte Carlo com 1 trade** → todos os cenários idênticos (não há ordem a embaralhar).
7. **Percentis ordenados** — p5 ≤ p50 ≤ p95 para as métricas dependentes de caminho.
8. **Invariantes são de fato invariantes** — sobre um conjunto de trades com resultados
   distintos, `totalNetPnl` e `sharpe` são idênticos em todos os cenários. Se variarem, a
   reconstrução da curva está errada.
9. **Dependentes de caminho de fato variam** — sobre o mesmo conjunto, `maxDrawdown`
   assume mais de um valor entre os cenários. Sem esse teste, uma implementação que
   ignorasse o embaralhamento passaria no teste 8.
10. **CAS** — dois `run()` concorrentes sobre o mesmo rascunho: exatamente um transiciona.
11. **Config inválida por `kind`** — config de Monte Carlo num rascunho de significância
    é rejeitada na fronteira.
12. **Registro das 12 tools** — todas registram, e entrada inválida devolve erro de tool
    em vez de lançar.

## Fora de escopo (explícito)

- Nenhuma UI nova — nem aba, nem painel dentro de aba existente. A validação estatística
  nasce como capacidade do agente, que é quem propõe trades. As 10 abas existentes
  continuam sendo o critério de "terminar".
- Nenhum Monte Carlo por reamostragem de candles.
- Nenhuma mudança de comportamento em `runDeterministicBacktest` — no máximo extração
  mecânica de funções de métrica para reuso.
- Nenhuma tool `gated`: nada aqui envia ordem.
