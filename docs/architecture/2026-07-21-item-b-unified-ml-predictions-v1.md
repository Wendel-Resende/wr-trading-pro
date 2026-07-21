# Item B — Previsões ML unificadas v1 (horizonte de 10 pregões)

**Status:** proposta aditiva aprovada para implementação após publicação desta spec.
**Data:** 2026-07-21
**Precedentes:** `docs/ML_HYBRID.md`, `docs/architecture/2026-07-20-item-a-backtest-real-ml-hibrido-design.md` (Item A, commit `9c04dea`).

## 1. Problema

A navegação principal apresenta simultaneamente **Previsões ML** e **Modelos ML**, mas elas misturam finalidades incompatíveis:

- `MLPredictionsTab` combina o Híbrido governado com heurísticas legadas;
- `MLModelsTab` executa MA Crossover e Regressão Linear sobre candles ao vivo, sem treino supervisionado, versionamento ou evidência point-in-time;
- o treino híbrido agora exige `costProfileId`, porém a UI atual envia `{}` para `POST /api/v1/ml/train`;
- a UI não explica claramente cobertura de dados, horizonte, versão aprovada, modelo rejeitado ou o BacktestRun econômico real.

Isso impede que o usuário veja a finalidade real do produto: usar preços históricos e fatos fundamentalistas CVM disponíveis na data da decisão para estimar o comportamento futuro de ativos B3.

## 2. Objetivo

Consolidar a navegação em uma única aba **Previsões ML**, cujo único fluxo público de previsão será o modelo híbrido governado D1 para **10 pregões B3**.

A previsão não deve prometer acurácia fixa, preço exato ou execução. Ela deve expor direção, score/probabilidade do modelo, retorno previsto quando disponível, incerteza, fatores relevantes, versão, dados de corte e evidência estatística.

## 3. Princípios fixos

1. **Point-in-time:** toda feature CVM deve satisfazer `knowledgeTime <= decisionTime`; manter ITR `data_ref + 45 dias` e DFP `data_ref + 90 dias`.
2. **D1 somente neste item:** fundamentos trimestrais não justificam previsão H1/M5; não oferecer timeframe intraday no fluxo híbrido.
3. **Horizonte fixo:** o alvo continua retorno/direção em 10 pregões. Cinco e 21 pregões exigem versões, labels, testes e gates próprios em itens futuros.
4. **Modelo atual:** preço + features técnicas + fundamentos CVM point-in-time + TimesFM como feature auxiliar → LightGBM. Não substituir por modelo opaco sem experimento comparável.
5. **Promoção honesta:** somente `ModelVersion` aprovada pelo gate walk-forward pode gerar previsão. Reprovação é resultado válido e deve aparecer no histórico sem sinal acionável.
6. **Backtest canônico:** resultados econômicos vêm exclusivamente do `BacktestRun` do Item A, com snapshot imutável, entrada `open[t+1]`, perfil explícito de custos e sem lookahead.
7. **Sem trading:** não criar/modificar `OrderIntent`, execução, broker, MT5 order bridge, kill switch ou regra DEMO-only.
8. **Sem custo implícito:** treino exige perfil de custos selecionado explicitamente; nunca criar default automático.
9. **Legado não é ML:** MA Crossover e Regressão Linear deixam a navegação pública. Não apagar arquivos/rotas legadas neste item; não alterar contratos MCP que ainda os exponham.
10. **Não tocar:** `docs/CODEX_HANDOFF.md`.

## 4. Experiência da única aba Previsões ML

### 4.1 Cabeçalho e estado

Substituir o título genérico por **Previsões ML — Híbrido governado (D1 · 10 pregões)**. Mostrar exatamente um estado:

- `SEM_MODELO_APROVADO` — previsão bloqueada; mostrar motivo, última pesquisa e ações disponíveis;
- `MODELO_ATIVO` — versão, data de corte, cobertura, horizonte e status do gate;
- `DADOS_INSUFICIENTES` ou `SERVIÇO_INDISPONÍVEL` — erro sanitizado e ação de recuperação.

Não renderizar heurísticas legadas na aba.

### 4.2 Dados e cobertura

Exibir dados recuperados das fontes existentes, sem inventar dados:

- número de símbolos elegíveis, atualizados e com falha no último backfill;
- intervalo D1 e identificador do snapshot/dataset quando houver uma versão;
- disponibilidade dos fundamentos CVM e data de corte do modelo;
- falhas por ticker de forma resumida e paginada.

`Backfill D1` permanece ação explícita. O resultado deve informar sucessos e falhas, como a rota já faz.

### 4.3 Treino e custos

Antes de `Treinar e validar`:

- carregar perfis de custo ativos por uma rota de leitura autenticada;
- exigir seleção de `costProfileId`;
- permitir criação de perfil apenas a administrador, reutilizando o serviço e o schema existentes;
- se não houver perfil disponível, bloquear o treino com instrução clara — nunca usar custo zero/default.

O treino chama a rota governada com `symbols` opcional e `costProfileId` explícito. Durante execução, mostrar estado em progresso; ao final, informar aprovação/reprovação e atualizar a visão.

### 4.4 Evidência da versão e histórico de pesquisa

Para versão ativa, mostrar:

- `modelVersion`, janela temporal, dataset/artifact hash e versão TimesFM;
- número de amostras;
- acurácia direcional e métricas existentes;
- comparação do gate contra `alwaysUp`, `timesfmOnly`, `fundamentalOnly` e `priceOnlyLgbm`;
- resumo do BacktestRun real: perfil de custos, retorno, drawdown, Sharpe, número de operações e cobertura;
- histórico limitado de ResearchRuns recentes aprovados/reprovados, marcado explicitamente como candidato ou aprovado.

Criar apenas as rotas read-only necessárias para a UI consultar perfis de custo, pesquisas e BacktestRuns associados a uma versão. Todas devem ter Zod, ordenação determinística, paginação limitada e envelopes `jsonSuccess/jsonError` existentes.

### 4.5 Previsão por ticker

Aceitar ticker B3 validado, executar somente contra a versão aprovada e mostrar:

- ticker e `asOf`;
- horizonte fixo de 10 pregões;
- direção `BUY`/`SELL`/`HOLD` como rótulo de pesquisa, não recomendação de ordem;
- score/probabilidade do modelo e retorno previsto/intervalo somente se disponibilizados pelo contrato do motor;
- fatores relevantes e metadados de fonte;
- versão do modelo e snapshot/dataset vinculados.

Não oferecer timeframe, stop, alvo, tamanho de posição ou botão de ordem.

## 5. Navegação e compatibilidade

1. Em `src/app/page.tsx`, remover o tab principal `models`, o import lazy e o render de `MLModelsTab`.
2. Manter apenas `Previsões ML` na navegação principal para o fluxo de ML.
3. `src/app/admin/page.tsx` não é a aba pública removida; seu painel administrativo permanece fora de escopo salvo ajuste mínimo necessário para perfis de custo.
4. Não apagar `MLModelsTab.tsx`, `mlModels.ts`, `backtesting.ts` ou tools MCP existentes neste item. Marcar a área como legado apenas onde necessário, para uma remoção posterior e segura.

## 6. Contratos e camadas esperados

- Reaproveitar `MlHybridService`, `ModelVersion`, `ResearchRun`, `Signal`, `BacktestRun` e `BacktestCostProfile` existentes.
- Adicionar leitura por application service/repositório; UI e MCP nunca acessam Prisma diretamente.
- Não expor paths locais, tokens, stack traces ou conteúdo bruto de artefatos.
- Reutilizar o cliente HTTP e envelopes de `/api/v1`.
- Não alterar o contrato Python de treino/predição salvo se necessário para expor retorno/intervalo que já seja calculado e tenha evidência; qualquer campo novo deve ser opcional e compatível.

## 7. Testes obrigatórios

1. UI/navegação: `Modelos ML` não aparece na navegação principal; `Previsões ML` não renderiza MA Crossover nem Regressão Linear.
2. Treino: request inclui `costProfileId`; ausência dele bloqueia no cliente e falha validada no servidor.
3. Perfis: listagem determinística, paginada e somente ativos; criação restrita a admin; nenhum perfil default é inventado.
4. Pesquisa/backtest: leitura por `modelVersionId` é somente leitura, paginada e sem vazamento de paths/segredos.
5. Estados de UI: sem versão, versão aprovada, pesquisa reprovada e falha sanitizada.
6. Regressões: `prisma validate`, `npx tsc --noEmit`, `npm run build`, `npm run test:ml-hybrid`, `npm run test:backtest-run`, `npm run test:b3-session`, testes Python ML relevantes e `smoke:auth`.
7. Verificar que diffs não incluem `docs/CODEX_HANDOFF.md`, `OrderIntent`, execução/broker ou DEMO-only.

## 8. Critérios de aceite

- só há uma aba pública de ML: **Previsões ML**;
- previsão híbrida opera exclusivamente no horizonte D1 de 10 pregões;
- preço, CVM e TimesFM seguem no pipeline point-in-time existente;
- treino exige custo explícito e evidencia gate/baselines;
- uma previsão só ocorre com versão aprovada;
- o backtest exibido é o BacktestRun econômico canônico, não o proxy legado;
- nenhum caminho cria uma ordem;
- todas as verificações obrigatórias passam.
