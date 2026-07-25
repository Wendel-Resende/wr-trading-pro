# Item D — Classificador Direcional com Ensemble Governado

**Status:** SPEC PARA IMPLEMENTAÇÃO  
**Modelo alvo:** Claude Code ( Opus 5), Windows  
**Data:** 2026-07-25  
**Substituição limpa (remove legado):** ✅  
**`docs/CODEX_HANDOFF.md` não tocado:** ✅  

---

## 1. Problema

A feature Previsões ML atual (Item B — Híbrido governado D1 10 pregões: TimesFM + LightGBM + CVM) não produz sinais utilizáveis para montagem de portfólio. O usuário precisa de **previsão direcional com alta confiança** (≥90%), não de previsão de preço pontual. O horizonte de 10 pregões é muito curto para que fundamentos CVM (trimestrais) tenham impacto no preço.

## 2. Objetivo

Substituir o motor de previsão atual por um **classificador direcional binário (UP/DOWN)** com ensemble de 3 modelos e gate de confiança, mantendo a infraestrutura existente (ml_api.py, walk-forward, CVM point-in-time, BacktestCostProfile, ResearchRuns/BacktestRuns).

## 3. Princípios fixos

1. **Sem lookahead:** `knowledgeTime <= decisionTime` em todas as features e targets.
2. **Substituição limpa:** remover código legado (TimesFM, MA Crossover, Regressão Linear, adaptadores e modelos associados). O classificador direcional é o único motor de previsão da plataforma. Rotas e UI legadas são removidas.
3. **Sem float canônico em verdades:** preços e targets são entradas validadas, não verdades absolutas.
4. **LLM não executa:** o ensemble é determinístico; LLM não participa da previsão.
5. **Sem banco real/MT5/rede/trading:** read-only sobre dados locais.
6. **Gate de confiança obrigatório:** só emitir sinal quando p > 0.90 (COMPRA) ou p < 0.10 (VENDA); caso contrário, NEUTRO.
7. **Horizonte 60 pregões (1 trimestre):** alinhado com a periodicidade dos fundamentos CVM.
8. **Identidade canônica no servidor:** hashes, versões e digests são computados e persistidos no backend, nunca confiados do cliente.

## 4. Arquitetura

### 4.1 Novo motor Python: `python/ml/directional_classifier.py`

```
Features (trimestre T, ~50 features):
  - Rentabilidade: ROE, ROA, margem_bruta, margem_ebit, margem_liquida
  - Saúde financeira: divida_pl, liquidez_corrente, endividamento
  - Geração de caixa: fcf_ativo, fco_ativo
  - Momentum fundamental: delta_roe, delta_margem_bruta (T vs T-1)
  - Qualidade: fcf_positivo (flag), dividendos_positivo (flag)
  - Setor relativo: roe_vs_mediana_setor, margem_vs_mediana_setor

Target:
  - direcao_60d: 1 se retorno_total_60_pregões > 0, else 0
  - Calculado a partir do snapshot de barras D1 existente (bars_snapshot.py)

Ensemble:
  - LightGBMClassifier (peso 0.40)
  - XGBoostClassifier (peso 0.40)
  - LogisticRegression com Ridge (peso 0.20)
  - Votação: média ponderada das probabilidades

Gate de confiança:
  - prob > 0.90 → sinal = COMPRA, confiança = prob
  - prob < 0.10 → sinal = VENDA, confiança = 1 - prob
  - 0.10 ≤ prob ≤ 0.90 → sinal = NEUTRO, confiança = prob
```

### 4.2 Treino: walk-forward trimestral

```
Janela de treino: 2011-T1 até T-1 (expanding window)
Janela de teste: trimestre T
Features: conhecidas em T (knowledgeTime <= decisionTime = último dia de T-1)
Target: direção do retorno de T+1 (60 pregões à frente)

Walk-forward:
  Treino: 2011-2017 → Teste: 2018
  Treino: 2011-2018 → Teste: 2019
  ...
  Treino: 2011-2025 → Teste: 2026

Métricas por janela:
  - Acurácia direcional em sinais de alta confiança
  - Brier score (calibração)
  - Cobertura: quantas empresas tiveram sinal de alta confiança
  - Comparação com baseline "comprar tudo" (buy-and-hold direcional)
```

### 4.3 Integração com `ml_api.py` (porta 5560)

Novos endpoints (substituem os legados de ML):

```
POST /ml/directional/train
  Body: { costProfileId, forceRetrain?: boolean }
  Response: { researchRunId, modelVersion, metrics: { accuracy, brier, coverage, baselineDelta } }

POST /ml/directional/predict
  Body: { modelVersion }
  Response: {
    predictions: [{ ticker, cdCvm, signal: "COMPRA"|"VENDA"|"NEUTRO", confidence, topFeatures }]
    modelVersion, universeDigest, generatedAt
  }
```

### 4.4 Persistência

Novos modelos Prisma (aditivos, migration nova):

```prisma
model DirectionalModelVersion {
  id            String   @id @default(cuid())
  modelVersion  String   @unique   // hash dos hiperparâmetros + features + universo
  createdAt     DateTime @default(now())
  researchRunId String
  metrics       String   // JSON: { accuracy, brier, coverage, baselineDelta, confusionMatrix }
  artifactPath  String             // caminho do .pkl ou .json do modelo treinado
  status        String   @default("ACTIVE")  // ACTIVE | SUPERSEDED | FAILED
  researchRun   ResearchRun @relation(fields: [researchRunId], references: [id])
}

model DirectionalPrediction {
  id               String   @id @default(cuid())
  modelVersion     String
  cdCvm            String
  ticker           String
  signal           String   // COMPRA | VENDA | NEUTRO
  confidence       Float
  topFeatures      String   // JSON: [{feature, importance}]
  universeDigest   String
  generatedAt      DateTime @default(now())

  @@unique([modelVersion, cdCvm, generatedAt])
}
```

### 4.5 Rotas Next.js (aditivas)

```
GET  /api/v1/ml/directional/models          — lista ModelVersions ativas
GET  /api/v1/ml/directional/models/[id]     — detalhes + métricas
POST /api/v1/ml/directional/predictions     — dispara predição (internamente chama ml_api.py)
GET  /api/v1/ml/directional/predictions?modelVersion=X — últimas predições
```

Todas usam `admin.ts` (allowlist) para criação; leitura é autenticada (mesmo padrão das rotas existentes).

### 4.6 UI — Aba Previsões ML

Substituir o conteúdo atual da aba Previsões ML por:

1. **Seletor de versão do modelo** (dropdown com ModelVersions ativas, métricas resumidas)
2. **Tabela de sinais** (ticker, sinal, confiança, top 3 features)
   - Linha verde = COMPRA, vermelha = VENDA, cinza = NEUTRO
   - Tooltip com breakdown das features
3. **Resumo de cobertura**: X sinais de alta confiança em Y empresas
4. **Botão "Treinar novo modelo"** com seleção de BacktestCostProfile
5. **Histórico de ResearchRuns** (reaproveitar componente existente)
6. **Gráfico de calibração** (reliability diagram: confiança vs acurácia observada)

### 4.7 Métricas e gate de aceitação

O modelo só pode ser ativado (status=ACTIVE) se:

```
Gate 1: Acurácia direcional (sinais alta confiança) ≥ 85%
Gate 2: Brier score < 0.15
Gate 3: Cobertura ≥ 30 empresas com sinal de alta confiança no último trimestre
Gate 4: Supera baseline "comprar tudo" por ≥ 15pp de acurácia
```

Se qualquer gate falhar, status = FAILED e o modelo não aparece na UI.

## 5. Escopo permitido

- Criar `python/ml/directional_classifier.py` + testes
- Adicionar endpoints em `python/ml/ml_api.py`
- **Remover** código legado de ML:
  - `python/ml/timesfm_adapter.py` e referências
  - `python/ml/ma_crossover.py` e referências
  - `python/ml/linear_regression.py` e referências
  - Modelos Prisma legados: `MlModelVersion`, `MlPrediction` (se existirem como tabelas separadas do híbrido)
  - Rotas Next.js legadas: `/api/v1/ml/hybrid/*`, `/api/v1/ml/legacy/*`
  - Componentes UI legados: `MLModelsTab`, `MLPredictionsTab` (conteúdo antigo), heurísticas visíveis
  - Ferramentas MCP legadas: `ml_run_prediction`, `ml_run_backtest`
- Criar migration Prisma aditiva (DirectionalModelVersion, DirectionalPrediction)
- Criar rotas Next.js em `src/app/api/v1/ml/directional/`
- Reescrever componentes UI na aba Previsões ML (dropdown versão, tabela sinais, gate visual)
- Adicionar testes: `test:directional-classifier`, `test:directional-api`
- Atualizar `npm run test:ml-hybrid` para cobrir apenas o novo motor (remover testes de legado)

## 6. Escopo proibido

- ❌ Alterar `docs/CODEX_HANDOFF.md`
- ❌ Alterar `OrderIntent`, execução, broker, bridge de ordens
- ❌ Alterar `tradingAgentsService`, `src/app/api/agents/**`
- ❌ Alterar `WR_TRADING_ENABLED`, kill switch, DEMO-only
- ❌ Usar `Float`/`Decimal` em identidade canônica (usar string/hash)
- ❌ Acessar MT5, rede externa, ou banco real

## 7. Testes obrigatórios

### Python

```
python/ml/tests/test_directional_classifier.py:
  - test_ensemble_voting: 3 modelos, votação ponderada
  - test_confidence_gate: prob 0.92 → COMPRA, prob 0.05 → VENDA, prob 0.50 → NEUTRO
  - test_walk_forward_no_lookahead: knowledgeTime <= decisionTime
  - test_directional_target: direcao correta a partir de retorno 60d
  - test_coverage_metric: conta sinais de alta confiança
  - test_brier_score: calibração dentro do esperado
  - test_baseline_comparison: supera buy-and-hold
  - test_serialization: salva e carrega modelo treinado
```

### TypeScript

```
scripts/test:directional-classifier:
  - test_model_version_lifecycle: criar, ativar, supersede
  - test_prediction_persistence: DirectionalPrediction CRUD
  - test_api_train: POST /ml/directional/train → 202 + researchRunId
  - test_api_predict: POST /ml/directional/predict → sinais com gate
  - test_api_list_models: GET paginado, filtrado por status
  - test_api_get_predictions: GET com modelVersion query param
  - test_confidence_gate_contract: COMPRA/VENDA/NEUTRO conforme regra
  - test_cost_profile_required: rejeita treino sem costProfileId
```

### Regressões (não podem quebrar)

```
test:backtest-run
test:b3-session
test:cvm-facts
test:reconciliation
test:research-run
test:model-version
smoke:auth
```

Nota: `test:ml-hybrid` é substituído por `test:directional-classifier`. O legado (TimesFM, MA Crossover) não precisa de regressão pois está sendo removido.

## 8. Decisões de arquitetura

1. **Por que 3 modelos em vez de 1?** Erros de LightGBM, XGBoost e RegLogística são descorrelacionados. Quando 3 modelos independentes concordam, a confiança sobe naturalmente. O gate de 90% é alcançável porque o ensemble filtra os casos ambíguos.

2. **Por que horizonte 60 e não 10?** Fundamentos CVM são trimestrais — não variam em 10 pregões. Com 60 pregões, o modelo captura o impacto real dos fundamentos no preço. Não é "prever o futuro distante" — é alinhar o horizonte da previsão com a frequência do sinal.

3. **Por que probabilidade calibrada (Brier) e não só acurácia?** Um modelo que diz "90% de confiança" mas acerta 70% é pior que um que diz "75%" e acerta 75%. O Brier score força calibração honesta.

4. **Por que remover TimesFM?** Foundation model com 138 séries B3 é overkill — o sinal é fraco, o custo de treino é alto, e o ensemble LightGBM+XGBoost+Logística entrega melhor resultado com muito menos complexidade. Remover o legado simplifica a base de código, reduz superfície de bugs e elimina a confusão de múltiplos motores de previsão concorrentes.

## 9. Migração Prisma

```sql
-- Aditiva: não altera tabelas existentes
CREATE TABLE "DirectionalModelVersion" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "modelVersion" TEXT NOT NULL UNIQUE,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "researchRunId" TEXT NOT NULL,
  "metrics" TEXT NOT NULL,
  "artifactPath" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  CONSTRAINT "DirectionalModelVersion_researchRunId_fkey"
    FOREIGN KEY ("researchRunId") REFERENCES "ResearchRun"("id")
);

CREATE TABLE "DirectionalPrediction" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "modelVersion" TEXT NOT NULL,
  "cdCvm" TEXT NOT NULL,
  "ticker" TEXT NOT NULL,
  "signal" TEXT NOT NULL,
  "confidence" REAL NOT NULL,
  "topFeatures" TEXT NOT NULL,
  "universeDigest" TEXT NOT NULL,
  "generatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX "DirectionalPrediction_modelVersion_cdCvm_generatedAt_key"
  ON "DirectionalPrediction"("modelVersion", "cdCvm", "generatedAt");
```

## 10. Critério de aceitação

- [ ] `tsc --noEmit` limpo
- [ ] `prisma validate` passa
- [ ] `npm run build` sucesso
- [ ] Todos os testes obrigatórios (seção 7) verdes
- [ ] Regressões intactas (test:backtest-run, test:b3-session, test:cvm-facts, smoke:auth)
- [ ] Código legado removido: TimesFM, MA Crossover, Regressão Linear, adaptadores, rotas e UI associadas
- [ ] UI funcional: dropdown de versão, tabela de sinais, gate visual (cores), métricas visíveis
- [ ] Treino via UI → ResearchRun criado → ModelVersion persiste com métricas → Predições disponíveis
- [ ] Gate de confiança: sinais com p < 0.10 ou > 0.90 aparecem; 0.10-0.90 não
- [ ] Modelo sem gate reprovado não aparece no dropdown da UI
- [ ] Ferramentas MCP `ml_run_prediction` e `ml_run_backtest` removidas do Pilot
