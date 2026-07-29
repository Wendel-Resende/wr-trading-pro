# Design — Integração do Kronos como segundo motor de previsão

- **Data:** 2026-07-28
- **Autor:** Claude Code (Opus 5)
- **Status:** aprovado (brainstorming) → aguardando plano
- **Origem:** pedido do usuário para integrar o Kronos (`/root/Kronos`, WSL
  Ubuntu) à plataforma, reaproveitando os padrões das Fases 3–5.

## Problema

A plataforma tem hoje **um único motor de previsão**: o escore composto de
fator fundamentalista (Item D, `2f72b7a..3d33e3a`), que ordena empresas
dentro de cada trimestre pela média dos percentis de features com sinal
comprovado, sobre um horizonte de 60 pregões, sob 5 gates de aceitação.

O **Kronos** é um foundation model decoder-only para candles (K-lines),
pré-treinado em 45 bolsas, publicado em AAAI 2026. Ele resolve um problema
diferente: dado o histórico OHLCV de UM ativo, gera caminhos futuros
amostrados. É informação que a plataforma não tem — preço, e não fundamento.

A pergunta que motiva a integração não é "o Kronos funciona?", e sim **"o
Kronos bate o escore de fator, medido pela mesma régua?"**. Um motor novo
com métricas próprias não responde isso.

## Decisões tomadas no brainstorming

| Decisão | Escolha | Alternativas descartadas |
|---|---|---|
| Papel | Motor de previsão **paralelo**, com trilha própria | Camada de contexto sem sinal; feature do motor atual; substituir o Item D |
| Instrumento | **Ações B3 em D1** | Futuros intradiários (WIN/WDO); piloto de ativo único |
| Execução | **Serviço Python no repo**, modelo vendorizado | Serviço no WSL via HTTP; job sem serviço |
| Gate | **Converter em escore transversal e reusar os 5 gates existentes** | Gate temporal próprio; híbrido com 6º check de calibração |
| Fine-tune | **Fora de escopo — zero-shot, pesos congelados** | Fine-tune em D1 da B3; zero-shot com fase 2 prometida |

## Ideia central

```
512 barras D1 ≤ knowledgeTime  →  KronosPredictor.predict(pred_len=60, sample_count=20)
   →  20 caminhos de close  →  retorno mediano previsto em 60 pregões
   →  escore transversal do trimestre  →  evaluateDirectionalGate()  →  quintis  →  sinal
```

O horizonte de previsão (`pred_len = 60`) é escolhido para **coincidir com o
horizonte do motor atual** (`HORIZON_TRADING_DAYS = 60` em
`python/ml/directional_classifier.py`). O recorte trimestral, o embargo do
alvo e o universo validado também são os mesmos.

**Definição exata do escore.** Dentro de cada trimestre, o retorno mediano
previsto de cada empresa é convertido no seu **percentil transversal** entre
as empresas do universo validado naquele trimestre; o escore é esse percentil
centrado em 0 (positivo = acima da mediana das pares). Daí saem os quintis
(1 = pior, 5 = melhor) e o sinal, exatamente como no motor atual. Nenhuma
probabilidade é estimada — a ordenação é o instrumento.

Consequência deliberada: a saída do Kronos passa pelo **mesmo**
`src/application/ml-directional/gate.ts` — IC ≥ 0,02, t-stat ≥ 2,0, excesso
do quintil superior ≥ 0,5% ao trimestre líquido de custos, spread topo−fundo
positivo, ≥ 60% dos anos com spread positivo. Os dois motores ficam
comparáveis número a número.

**Custo aceito da decisão:** a banda de dispersão que o Kronos produz de
graça (as 20 amostras dão um intervalo de previsão) é descartada na conversão
para escore. Ela é persistida junto da previsão para inspeção, mas **não
participa do gate nem do sinal** nesta entrega.

## Arquitetura

Aditiva e espelhando `ml-directional` camada a camada. Nenhum modelo, rota ou
componente existente é alterado, exceto a coluna `engine` em `MlTrainingRun`
(com default no valor atual).

### Python (`python/`)

| Módulo | Papel |
|---|---|
| `kronos_model/` | Modelo **vendorizado** de `/root/Kronos/model`: `kronos.py`, `module.py`, `__init__.py`. Só o modelo — nada de `examples/`, `finetune/`, CSVs ou figuras. |
| `ml/kronos_adapter.py` | Carrega tokenizer + modelo dos pesos locais, fixa device e seed, expõe `forecast_batch(contexts, pred_len)` sobre `KronosPredictor.predict_batch`. |
| `ml/kronos_scorer.py` | Walk-forward: para cada (trimestre, ticker) monta o contexto a partir do snapshot, gera, agrega em escore, aplica o embargo de 60 pregões. |
| `ml/kronos_worker.py` | Job assíncrono espelhando `directional_worker.py`: fases, progresso, cancelamento real. |

Pesos: baixados uma vez do HuggingFace (`NeoQuasar/Kronos-Tokenizer-base` +
`NeoQuasar/Kronos-small`) para `data/models/kronos/`, ignorado pelo Git, com
sha256 registrado na versão do modelo. Regra arquitetural do repo respeitada:
dados e código dentro de `wr_trade_pro_`, nunca em `AppData`.

O contexto de 512 barras é o `max_context` do Kronos-small. Em D1 são ~2 anos
de histórico por previsão — coberto pelo histórico estendido via Yahoo
Finance (`410098a`).

### TypeScript

```
src/domain/v1/models/ml-kronos.ts          tipos + códigos de erro
src/domain/v1/ports/ml-kronos-repository.ts
src/application/ml-kronos/{dto,port,service}.ts
    └── IMPORTA ml-directional/{gate,costs}.ts — não duplica
src/adapters/prisma/ml-kronos/{repository,mapping,schemas,errors}.ts
src/app/api/v1/ml/kronos/models/route.ts
src/app/api/v1/ml/kronos/models/[modelVersion]/route.ts
src/app/api/v1/ml/kronos/predictions/route.ts
src/components/ml/KronosSignalsView.tsx
src/mcp/pilot/tools/ml-kronos.ts
```

O gate é **importado**, não copiado. Se um limiar mudar, muda para os dois
motores ao mesmo tempo — que é exatamente o comportamento desejado quando a
premissa é comparabilidade.

### Prisma

`KronosModelVersion` e `KronosPrediction`, espelhando os `Directional*`
(mesmos estados `DRAFT`/`ACTIVE`/`FAILED`/`SUPERSEDED`, mesmo claim CAS
atômico contra o `MlTrainingRun`). Tabelas novas em vez de discriminador nas
existentes: aditivo, sem migração de dados, e segue o precedente do Item D.

`KronosPrediction` acrescenta, além dos campos do `DirectionalPrediction`:

- `predictedReturn: Float` — retorno mediano previsto em 60 pregões
- `predictionBandJson: String` — percentis P10/P50/P90 das 20 amostras
- `contextBars: Int` — quantas barras entraram no contexto (< 512 é possível)

`MlTrainingRun` ganha `engine String @default("DIRECTIONAL")`. O job manager,
a máquina de estados (`state-machine.ts`), o polling e o cancelamento são
reaproveitados inteiros.

### MCP

Tools `kronos.*` espelhando `ml-directional.ts`, falando com a **camada de
aplicação direto**, com `requestedBy` fixo em `mcp:hermes`. Nunca via
`/api/v1/*`: `resolveRequestedBy` deriva o principal do cookie de sessão e o
piloto autentica por Bearer — armadilha já registrada no `CODEX_HANDOFF.md`.
Como no motor atual, a **evidência viaja junto do ranking**: sem essa
amarração, o agente repassa a lista como verdade e consulta as ressalvas só
se lembrar.

## Determinismo point-in-time

O Kronos **amostra** — duas execuções idênticas divergem por padrão. Isso é
incompatível com a garantia de reprodutibilidade da plataforma. Cinco travas:

1. **Barras do snapshot imutável** (`bars_snapshot.py`), truncadas em
   `knowledgeTime`. Nenhuma barra posterior entra no contexto.
2. **Seed derivada deterministicamente** de `(modelVersion, ticker, período)`
   via `torch.manual_seed`. `sample_count`, `T` e `top_p` congelados na
   versão do modelo.
3. **Embargo do alvo** idêntico ao atual: linha cuja janela de 60 pregões
   invade o período de calibração é descartada.
4. **Digest da versão** cobre sha256 dos pesos + parâmetros de amostragem +
   universo + digest do dataset rotulado.
5. **Previsões persistidas.** O passado nunca é recalculado.

O universo é o **universo validado** do modelo, com o mesmo tratamento da
correção `e604724`: empresa sem série de preços que permita medir o resultado
fica FORA do ranking e vai para o relatório de exclusões, nunca ranqueada
junto com peso igual ao das validadas.

## Risco principal: custo computacional

É o risco que pode inviabilizar a entrega, e está declarado antes do resto do
plano.

Ordem de grandeza: ~140 tickers × ~40 trimestres × `sample_count` gerações
autorregressivas de 60 passos cada. Numa RTX 4060 (8 GB) isso é hora(s), não
minuto(s). O treino do motor atual já levou ~17 min num caso conhecido.

Mitigações no desenho: `predict_batch` (não `predict` em laço), `sample_count`
modesto (20), Kronos-small (24,7 M parâmetros) antes de considerar o base.

**Portão de continuidade:** o primeiro marco do plano é um piloto que roda
**um único ano** de walk-forward e mede o tempo real, antes de escrever o gate,
as rotas e a UI. Se o piloto mostrar que o walk-forward completo é
impraticável, o corte de escopo é decidido com número na mão.

## Fora de escopo

- Fine-tuning dos pesos (decidido no brainstorming).
- Futuros intradiários WIN/WDO — exigem pipeline de barras intraday e
  governança que não existem.
- Uso da banda de previsão como sinal ou como gate de calibração.
- Qualquer emissão de `OrderIntent`. O motor produz sinal; a trilha de ordem
  continua sendo a existente, com aprovação humana.
- Substituir ou alterar o motor direcional.

## Critérios de aceitação

1. O piloto de um ano roda ponta a ponta e reporta tempo medido por trimestre.
2. Duas execuções do mesmo `(modelVersion, período)` produzem escores
   idênticos bit a bit.
3. Nenhuma barra com `openedAt > knowledgeTime` entra em qualquer contexto —
   verificado por teste, não por inspeção.
4. Um modelo reprovado em qualquer gate fica `FAILED`, persistido para
   auditoria e **invisível** no seletor da UI e nas tools MCP.
5. `KronosSignalsView` não exibe sinal nenhum sem modelo aprovado — exibe
   quais gates reprovaram e com que números, como o `DirectionalSignalsView`.
6. As tools MCP nunca devolvem lista vazia muda sem modelo ativo: devolvem
   aviso explícito.
7. Nenhum DTO público expõe `artifactPath`, `pythonJobId` ou hiperparâmetro
   bruto.
8. O `evaluateDirectionalGate` continua com um único ponto de definição —
   nenhum limiar duplicado na trilha Kronos.
