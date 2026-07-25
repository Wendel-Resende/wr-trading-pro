import { PrismaClient } from '@prisma/client';
import {
  DIRECTIONAL_GATE_THRESHOLDS,
  DirectionalService,
  createHttpDirectionalMlApiPort,
  evaluateDirectionalGate,
  toDirectionalModelVersionPublicDTO,
  toDirectionalPredictionPublicDTO,
  type DirectionalMlApiPort,
  type DirectionalPredictResponse,
  type DirectionalTrainResponse,
} from '../../src/application/ml-directional';
import { ReadModelError } from '../../src/application/read-models-v1/errors';
import { createBacktestCostProfileService } from '../../src/application/backtest-cost-profile';
import { PrismaDirectionalRepository } from '../../src/adapters/prisma/ml-directional';
import type { DirectionalMetrics } from '../../src/domain/v1/models/ml-directional';

/**
 * Item D — suíte do classificador direcional (§7, bloco TypeScript).
 *
 * O motor Python entra como porta fake: estes testes verificam GOVERNANÇA
 * (gate no servidor, ciclo de vida da versão, persistência idempotente,
 * contrato do gate de confiança, obrigatoriedade do cost profile e ausência
 * de vazamento de path no DTO) — a qualidade estatística do ensemble é
 * responsabilidade da suíte Python.
 */

function assert(cond: unknown, msg: string): void {
  if (!cond) {
    console.error(`FALHOU: ${msg}`);
    process.exit(1);
  }
  console.log(`ok: ${msg}`);
}

async function expectError(code: string, fn: () => Promise<unknown>, msg: string): Promise<void> {
  try {
    await fn();
    assert(false, msg);
  } catch (error) {
    assert(error instanceof ReadModelError && error.code === code, `${msg} (${code})`);
  }
}

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);
const HASH_C = 'c'.repeat(64);

function metrics(overrides: Partial<DirectionalMetrics> = {}): DirectionalMetrics {
  return {
    nSamples: 2000,
    nHighConfidence: 400,
    accuracy: 0.9,
    accuracyAllSamples: 0.7,
    brier: 0.1,
    coverage: 40,
    coveragePeriod: '2025T4',
    baselineAllUp: 0.5,
    baselineOnSignals: 0.6,
    baselineDelta: 0.3,
    confusionMatrix: { truePositive: 200, falsePositive: 20, trueNegative: 160, falseNegative: 20 },
    reliability: [{ binStart: 0.9, binEnd: 1, n: 100, meanPredicted: 0.95, observedRate: 0.94 }],
    byFold: [{ foldId: 0, testYear: 2025, n: 500, nHighConfidence: 100, accuracy: 0.9, brier: 0.1 }],
    ...overrides,
  };
}

function trainResponse(overrides: Partial<DirectionalTrainResponse> = {}): DirectionalTrainResponse {
  return {
    modelVersion: HASH_A,
    datasetDigest: HASH_B,
    universeBarsDigest: HASH_C,
    universe: ['WEGE3', 'PETR4'],
    horizonTradingDays: 60,
    gate: { upper: 0.9, lower: 0.1 },
    windowStart: '2011-08-14',
    windowEnd: '2026-05-15',
    hyperparameters: { lightgbm: { max_depth: 6 } },
    features: ['roe', 'roic'],
    metrics: metrics(),
    // Path local do servidor — o teste de DTO abaixo prova que ele nunca sai.
    artifactPath: 'C:/WR/wr_trade_pro_/data/ml/directional_models/aaa/model.pkl',
    ...overrides,
  } as DirectionalTrainResponse;
}

function predictResponse(overrides: Partial<DirectionalPredictResponse> = {}): DirectionalPredictResponse {
  return {
    modelVersion: HASH_A,
    universeDigest: HASH_C,
    generatedAt: '2026-07-25T12:00:00.000Z',
    predictions: [
      { ticker: 'WEGE3', cdCvm: '005410', signal: 'COMPRA', confidence: 0.95, prob: 0.95,
        knowledgeDate: '2026-05-15', topFeatures: [{ feature: 'roe', importance: 12.5 }] },
      { ticker: 'PETR4', cdCvm: '009512', signal: 'VENDA', confidence: 0.93, prob: 0.07,
        knowledgeDate: '2026-05-15', topFeatures: [{ feature: 'roic', importance: 9.1 }] },
      { ticker: 'VALE3', cdCvm: '004170', signal: 'NEUTRO', confidence: 0.52, prob: 0.52,
        knowledgeDate: '2026-05-15', topFeatures: [{ feature: 'roe', importance: 12.5 }] },
    ],
    ...overrides,
  };
}

function fakePort(train: DirectionalTrainResponse, predict?: DirectionalPredictResponse): DirectionalMlApiPort {
  return {
    backfill: async () => ({ ok: [], failed: {} }),
    train: async () => train,
    predict: async () => predict ?? predictResponse(),
  };
}

// ---------------------------------------------------------------------------
function gateTests(): void {
  const approved = evaluateDirectionalGate(metrics());
  assert(approved.approved && approved.failures.length === 0, 'gate aprova métricas acima de todos os limiares');
  assert(approved.checks.length === 4, 'gate expõe as 4 conferências da §4.7');

  assert(
    evaluateDirectionalGate(metrics({ accuracy: 0.84 })).failures.includes('ACCURACY_BELOW_MIN'),
    'gate 1 reprova acurácia abaixo de 85%',
  );
  assert(
    evaluateDirectionalGate(metrics({ brier: 0.15 })).failures.includes('BRIER_ABOVE_MAX'),
    'gate 2 reprova Brier igual ao teto (limite é estrito)',
  );
  assert(
    evaluateDirectionalGate(metrics({ coverage: 29 })).failures.includes('COVERAGE_BELOW_MIN'),
    'gate 3 reprova cobertura abaixo de 30 empresas',
  );
  assert(
    evaluateDirectionalGate(metrics({ baselineDelta: 0.149 })).failures.includes('BASELINE_DELTA_BELOW_MIN'),
    'gate 4 reprova vantagem abaixo de 15pp',
  );

  // Métrica ausente NUNCA passa: ausência de evidência não é aprovação.
  const semSinal = evaluateDirectionalGate(metrics({ accuracy: null, baselineDelta: null, nHighConfidence: 0, coverage: 0 }));
  assert(!semSinal.approved, 'gate reprova quando não houve nenhum sinal de alta confiança');
  assert(
    semSinal.failures.includes('ACCURACY_BELOW_MIN') && semSinal.failures.includes('BASELINE_DELTA_BELOW_MIN'),
    'métrica null conta como reprovação explícita, não como aprovação silenciosa',
  );

  assert(
    DIRECTIONAL_GATE_THRESHOLDS.minAccuracy === 0.85 &&
      DIRECTIONAL_GATE_THRESHOLDS.maxBrier === 0.15 &&
      DIRECTIONAL_GATE_THRESHOLDS.minCoverage === 30 &&
      DIRECTIONAL_GATE_THRESHOLDS.minBaselineDelta === 0.15,
    'limiares do gate são exatamente os da spec §4.7',
  );

  console.log('directional gate: OK');
}

// ---------------------------------------------------------------------------
async function trainingTests(prisma: PrismaClient): Promise<void> {
  const costProfileService = createBacktestCostProfileService(prisma);
  const costProfile = await costProfileService.create(
    { version: 1, label: 'b3-directional-v1', fixedBrokerage: 0, emolumentsPct: 0.0005,
      spreadBps: 5, slippageBps: 5, lotSize: 100, source: 'tarifario-teste' },
    'guardiao-admin',
  );

  // --- test_cost_profile_required ---
  const service = new DirectionalService({ prisma, mlApi: fakePort(trainResponse()) });
  await expectError('COST_PROFILE_REQUIRED', () => service.runTraining('test-user', ''), 'treino sem costProfileId falha');
  await expectError(
    'COST_PROFILE_NOT_FOUND',
    () => service.runTraining('test-user', 'nao-existe'),
    'treino com costProfile inexistente falha',
  );

  // --- test_api_train (caminho aprovado) ---
  const approved = await service.runTraining('test-user', costProfile.id);
  assert(approved.status === 'ACTIVE' && approved.gate.approved, 'treino aprovado no gate vira ACTIVE');
  assert(approved.modelVersion === HASH_A, 'modelVersion vem do motor, não é gerada no Node');

  const researchRun = await prisma.researchRun.findUnique({ where: { runId: approved.researchRunId } });
  assert(researchRun !== null, 'ResearchRun é sempre persistido');
  assert(researchRun!.datasetId === `sha256:${HASH_B}`, 'ResearchRun carrega o digest do dataset treinado');
  assert(researchRun!.modelVersionId === HASH_A, 'ResearchRun é linkado à versão aprovada');
  assert(
    JSON.parse(researchRun!.paramsJson).costProfileId === costProfile.id,
    'perfil de custo fica registrado na proveniência do treino',
  );

  // Retreino idempotente: mesma versão não duplica linha.
  const again = await service.runTraining('test-user', costProfile.id);
  assert(again.modelVersion === approved.modelVersion, 'retreino idêntico devolve a mesma versão');
  const count = await prisma.directionalModelVersion.count({ where: { modelVersion: HASH_A } });
  assert(count === 1, 'retreino idêntico não cria uma segunda linha (identidade canônica)');

  // --- test_api_train (caminho reprovado) ---
  const rejectedService = new DirectionalService({
    prisma,
    mlApi: fakePort(trainResponse({ modelVersion: HASH_B, metrics: metrics({ accuracy: 0.55, brier: 0.33, coverage: 1, baselineDelta: 0.12 }) })),
  });
  const rejected = await rejectedService.runTraining('test-user', costProfile.id);
  assert(rejected.status === 'FAILED', 'treino reprovado no gate vira FAILED, não some');
  assert(rejected.gate.failures.length === 4, 'os 4 gates reprovados são registrados');
  const rejectedRun = await prisma.researchRun.findUnique({ where: { runId: rejected.researchRunId } });
  assert(rejectedRun !== null && rejectedRun.modelVersionId === null,
    'ResearchRun de treino reprovado existe mas NÃO é linkado a versão ativa');

  console.log('directional training: OK');
}

// ---------------------------------------------------------------------------
async function modelVersionLifecycleTests(prisma: PrismaClient): Promise<void> {
  const repository = new PrismaDirectionalRepository(prisma);
  const costProfileService = createBacktestCostProfileService(prisma);
  const costProfile = await costProfileService.create(
    { version: 2, label: 'b3-directional-v2', fixedBrokerage: 0, emolumentsPct: 0.0005,
      spreadBps: 5, slippageBps: 5, lotSize: 100, source: 'tarifario-teste' },
    'guardiao-admin',
  );

  // Uma segunda versão aprovada supersede a anterior — e só ela fica ACTIVE.
  const service = new DirectionalService({ prisma, mlApi: fakePort(trainResponse({ modelVersion: HASH_C })) });
  const segunda = await service.runTraining('test-user', costProfile.id);
  assert(segunda.status === 'ACTIVE', 'nova versão aprovada nasce ACTIVE');

  const anterior = await repository.findModelVersionById(HASH_A);
  assert(anterior!.status === 'SUPERSEDED', 'versão ACTIVE anterior é marcada SUPERSEDED');

  const reprovada = await repository.findModelVersionById(HASH_B);
  assert(reprovada!.status === 'FAILED', 'versão FAILED nunca é tocada pelo supersede (auditoria preservada)');

  // --- test_api_list_models ---
  const ativas = await service.listModels({ status: 'ACTIVE', limit: 10 });
  assert(ativas.length === 1 && ativas[0].modelVersion === HASH_C, 'listagem filtra por status ACTIVE');
  const todas = await service.listModels({ limit: 10 });
  assert(todas.length === 3, 'listagem sem filtro devolve todas as versões');
  assert(
    todas.every((m, i) => i === 0 || todas[i - 1].createdAt >= m.createdAt),
    'listagem vem da mais recente para a mais antiga',
  );

  await expectError('MODEL_VERSION_NOT_FOUND', () => service.getModel('f'.repeat(64)), 'versão inexistente falha explícito');

  // --- DTO não vaza path do servidor ---
  const dto = toDirectionalModelVersionPublicDTO(ativas[0]);
  assert(!JSON.stringify(dto).includes('model.pkl'), 'DTO público NUNCA expõe artifactPath (path do servidor)');
  assert(!JSON.stringify(dto).includes('wr_trade_pro_'), 'DTO público não contém nenhum trecho de caminho local');
  assert(dto.gateChecks.length === 4 && dto.gateApproved, 'DTO carrega as conferências do gate para a UI');

  console.log('directional model lifecycle: OK');
}

// ---------------------------------------------------------------------------
async function predictionTests(prisma: PrismaClient): Promise<void> {
  const service = new DirectionalService({
    prisma,
    mlApi: fakePort(trainResponse({ modelVersion: HASH_C }), predictResponse({ modelVersion: HASH_C })),
  });

  // --- test_api_predict + test_confidence_gate_contract ---
  const result = await service.generatePredictions(HASH_C);
  assert(result.saved === 3, 'lote de previsões é persistido inteiro');
  assert(result.predictions.length === 3, 'previsões voltam da persistência, não do upstream');

  const porTicker = new Map(result.predictions.map((p) => [p.ticker, p]));
  assert(porTicker.get('WEGE3')!.signal === 'COMPRA' && porTicker.get('WEGE3')!.prob > 0.9,
    'prob > 0.90 é COMPRA');
  assert(porTicker.get('PETR4')!.signal === 'VENDA' && porTicker.get('PETR4')!.prob < 0.1,
    'prob < 0.10 é VENDA');
  assert(porTicker.get('VALE3')!.signal === 'NEUTRO', 'zona ambígua é NEUTRO');
  assert(
    porTicker.get('VALE3')!.confidence === porTicker.get('VALE3')!.prob,
    'NEUTRO carrega a probabilidade crua, sem virar recomendação',
  );

  // --- test_prediction_persistence (idempotência) ---
  const denovo = await service.generatePredictions(HASH_C);
  assert(denovo.saved === 3, 'regerar o mesmo lote é idempotente');
  const total = await prisma.directionalPrediction.count({ where: { modelVersion: HASH_C } });
  assert(total === 3, 'mesma geração (modelVersion, cdCvm, generatedAt) não duplica linha');

  // --- test_api_get_predictions ---
  const lidas = await service.listPredictions(HASH_C);
  assert(lidas.length === 3, 'leitura devolve a última geração persistida');
  assert(
    lidas.every((p, i) => i === 0 || lidas[i - 1].confidence >= p.confidence),
    'previsões vêm ordenadas por confiança decrescente',
  );
  const predDto = toDirectionalPredictionPublicDTO(lidas[0]);
  assert(predDto.knowledgeDate.startsWith('2026-05-15'), 'carimbo point-in-time preservado no DTO');
  assert(predDto.topFeatures.length === 1, 'top features chegam parseadas do JSON persistido');

  // Modelo não-ACTIVE nunca gera sinal, mesmo chamando a API direto.
  await expectError('INVALID_STATE', () => service.generatePredictions(HASH_A),
    'modelo SUPERSEDED não gera sinais');
  await expectError('INVALID_STATE', () => service.generatePredictions(HASH_B),
    'modelo FAILED (reprovado no gate) não gera sinais');
  await expectError('MODEL_VERSION_NOT_FOUND', () => service.generatePredictions('e'.repeat(64)),
    'modelo inexistente não gera sinais');

  // Upstream respondendo com outra versão é rejeitado.
  const mentiroso = new DirectionalService({
    prisma,
    mlApi: fakePort(trainResponse(), predictResponse({ modelVersion: HASH_A })),
  });
  await expectError('UPSTREAM_MALFORMED_RESPONSE', () => mentiroso.generatePredictions(HASH_C),
    'resposta com modelVersion divergente é rejeitada');

  console.log('directional predictions: OK');
}

// ---------------------------------------------------------------------------
async function httpPortTests(): Promise<void> {
  // Conexão recusada vira erro acionável, nunca `TypeError: fetch failed`.
  const recusa = createHttpDirectionalMlApiPort('http://127.0.0.1:1', undefined);
  await expectError('UPSTREAM_ERROR', () => recusa.train(), 'motor ML inacessível vira UPSTREAM_ERROR');

  // Resposta fora do contrato é barrada ANTES de virar objeto de domínio —
  // a lição do campo `orphan` que quebrou o Item C.
  const malformado = createHttpDirectionalMlApiPort('http://motor.local', (async () =>
    new Response(JSON.stringify({ modelVersion: 'nao-e-hash' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })) as unknown as typeof fetch);
  await expectError('UPSTREAM_MALFORMED_RESPONSE', () => malformado.train(),
    'resposta fora do contrato vira UPSTREAM_MALFORMED_RESPONSE');

  const semDados = createHttpDirectionalMlApiPort('http://motor.local', (async () =>
    new Response(JSON.stringify({ error: 'INSUFFICIENT_DATA' }), {
      status: 422,
      headers: { 'content-type': 'application/json' },
    })) as unknown as typeof fetch);
  await expectError('INSUFFICIENT_DATA', () => semDados.train(), '422 do motor vira INSUFFICIENT_DATA');

  const semArtefato = createHttpDirectionalMlApiPort('http://motor.local', (async () =>
    new Response(JSON.stringify({ error: 'MODEL_NOT_FOUND' }), {
      status: 404,
      headers: { 'content-type': 'application/json' },
    })) as unknown as typeof fetch);
  await expectError('MODEL_VERSION_NOT_FOUND', () => semArtefato.predict(HASH_A),
    '404 do motor vira MODEL_VERSION_NOT_FOUND');

  console.log('directional http port: OK');
}

// ---------------------------------------------------------------------------
async function main(): Promise<void> {
  const prisma = new PrismaClient();
  try {
    gateTests();
    await trainingTests(prisma);
    await modelVersionLifecycleTests(prisma);
    await predictionTests(prisma);
    await httpPortTests();
    console.log('directional-classifier: TODOS OS TESTES PASSARAM');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
