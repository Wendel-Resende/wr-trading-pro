import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { PrismaClient } from '@prisma/client';
import { createBacktestCostProfileService } from '../../src/application/backtest-cost-profile';
import { insertResearchRunForTest, PrismaResearchRunRepository } from '../../src/adapters/prisma/research-run';
import { insertModelVersionForTest } from '../../src/adapters/prisma/model-version';
import { insertBacktestRunForTest } from '../../src/adapters/prisma/backtest-run';
import { createBackfillRunService } from '../../src/application/backfill-run';
import { GET as costProfilesGET } from '../../src/app/api/v1/ml/cost-profiles/route';
import { GET as researchRunsGET } from '../../src/app/api/v1/research-runs/route';
import { GET as backtestsGET } from '../../src/app/api/v1/backtests/route';
import { GET as modelVersionsGET } from '../../src/app/api/v1/ml/model-versions/route';
import { GET as backfillRunsGET } from '../../src/app/api/v1/ml/backfill-runs/route';
import { toSourceSummary } from '../../src/app/api/v1/ml/cost-profiles/_dto';
import { normalizeTickerLabel } from '../../src/app/api/v1/_shared/sanitize-text';

interface ApiEnvelopeSuccess<T> {
  success: true;
  data: T;
  meta: Record<string, unknown>;
}
interface ApiEnvelopeError {
  success: false;
  error: { code: string; message: string };
}
type ApiEnvelope<T> = ApiEnvelopeSuccess<T> | ApiEnvelopeError;

function assertLog(cond: unknown, msg: string): void {
  assert.ok(cond, msg);
  console.log(`ok: ${msg}`);
}

async function costProfilesPaginationAndDto(prisma: PrismaClient): Promise<void> {
  const service = createBacktestCostProfileService(prisma);
  await service.create(
    { version: 1, label: 'perfil-a', fixedBrokerage: 1, emolumentsPct: 0.0005, spreadBps: 5, slippageBps: 5, lotSize: 100, source: 'tarifario-teste' },
    'guardiao-admin',
  );
  await service.create(
    { version: 1, label: 'perfil-b', fixedBrokerage: 2, emolumentsPct: 0.0006, spreadBps: 6, slippageBps: 6, lotSize: 100, source: 'tarifario-teste' },
    'guardiao-admin',
  );
  await service.create(
    { version: 1, label: 'perfil-c', fixedBrokerage: 3, emolumentsPct: 0.0007, spreadBps: 7, slippageBps: 7, lotSize: 100, source: 'tarifario-teste' },
    'guardiao-admin',
  );

  const res1 = await costProfilesGET(new Request('http://localhost/api/v1/ml/cost-profiles?limit=2'));
  const json1 = (await res1.json()) as ApiEnvelope<Record<string, unknown>[]>;
  assertLog(json1.success, 'GET cost-profiles?limit=2 responde success:true');
  if (!json1.success) throw new Error('unreachable');
  assertLog(json1.data.length === 2, 'primeira página tem exatamente 2 itens');
  assertLog(json1.meta.nextCursor !== null, 'primeira página tem nextCursor (bloqueador 4: paginação limit+1)');
  for (const item of json1.data) {
    const keys = Object.keys(item);
    assertLog(!keys.includes('createdBy'), 'DTO de cost-profile NÃO tem createdBy (bloqueador 3)');
    assertLog(!keys.includes('createdAt'), 'DTO de cost-profile NÃO tem createdAt (bloqueador 3)');
    assertLog(!keys.includes('archivedAt'), 'DTO de cost-profile NÃO tem archivedAt (bloqueador 3)');
    assertLog(!keys.includes('archivedBy'), 'DTO de cost-profile NÃO tem archivedBy (bloqueador 3)');
    assertLog(!keys.includes('source'), 'DTO de cost-profile NÃO tem source bruto (revisão final: só sourceSummary)');
    assertLog(keys.includes('sourceSummary'), 'DTO de cost-profile TEM sourceSummary (representação segura)');
    assertLog(
      typeof item.sourceSummary === 'string' && (item.sourceSummary as string).length <= 61,
      'sourceSummary é string curta (<=60 chars + reticências)',
    );
  }

  // Revisão final: um perfil com `source` sensível (path local) persistido —
  // a rota HTTP real nunca deve devolver o valor bruto, só a versão redigida.
  const sensitive = await service.create(
    { version: 1, label: 'perfil-sensivel', fixedBrokerage: 4, emolumentsPct: 0.0008, spreadBps: 8, slippageBps: 8, lotSize: 100, source: 'C:\\Users\\rwres\\wr_trade_pro_\\segredo.txt' },
    'guardiao-admin',
  );
  const resAll = await costProfilesGET(new Request('http://localhost/api/v1/ml/cost-profiles?limit=100'));
  const jsonAll = (await resAll.json()) as ApiEnvelope<Record<string, unknown>[]>;
  if (!jsonAll.success) throw new Error('unreachable');
  const sensitiveDto = jsonAll.data.find((item) => item.id === sensitive.id);
  assertLog(sensitiveDto !== undefined, 'perfil sensível aparece na listagem');
  assertLog(
    !JSON.stringify(sensitiveDto).includes('segredo.txt') && !JSON.stringify(sensitiveDto).includes('Users'),
    'source sensível (path local) nunca aparece bruto na resposta HTTP real (revisão final)',
  );

  const cursor = String(json1.meta.nextCursor);
  const res2 = await costProfilesGET(new Request(`http://localhost/api/v1/ml/cost-profiles?limit=2&cursor=${encodeURIComponent(cursor)}`));
  const json2 = (await res2.json()) as ApiEnvelope<Record<string, unknown>[]>;
  assertLog(json2.success, 'segunda página responde success:true');
  if (!json2.success) throw new Error('unreachable');
  assertLog(json2.data.length === 1, 'segunda página tem exatamente o terceiro perfil');
  assertLog(json2.meta.nextCursor === null, 'segunda página não tem próxima página (nextCursor null, sem página fantasma)');
}

/**
 * Revisão final (2026-07-21): prova, isolada da rota HTTP, que
 * `toSourceSummary` nunca devolve path/token bruto e sempre redige para uma
 * mensagem neutra fixa quando o valor de entrada é sensível.
 */
function sourceSummaryRedactsPathAndTokenLikeInput(): void {
  const windowsPath = 'C:\\Users\\rwres\\wr_trade_pro_\\data\\cost-profiles\\b3.json';
  const summary1 = toSourceSummary(windowsPath);
  assertLog(summary1 !== windowsPath, 'sourceSummary nunca devolve path Windows bruto');
  assertLog(!summary1.includes('\\') && !summary1.includes('Users'), 'sourceSummary redige path Windows completamente');

  const unixPath = '/home/wr/secrets/api-key.txt';
  const summary2 = toSourceSummary(unixPath);
  assertLog(summary2 !== unixPath && !summary2.includes('/'), 'sourceSummary redige path Unix completamente');

  const url = 'https://internal.wrtrade.local/admin/cost-profiles?token=abc';
  const summary3 = toSourceSummary(url);
  assertLog(summary3 !== url && !summary3.includes('http'), 'sourceSummary redige URL interna completamente');

  const jwtLike = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpM';
  const summary4 = toSourceSummary(jwtLike);
  assertLog(summary4 !== jwtLike, 'sourceSummary redige token/JWT-like completamente');

  const hexHash = 'd'.repeat(64);
  const summary5 = toSourceSummary(hexHash);
  assertLog(summary5 !== hexHash, 'sourceSummary redige hash hex longo (>=24 chars contíguos)');

  const legit = 'tarifario-b3-2026-01';
  const summary6 = toSourceSummary(legit);
  assertLog(summary6 === legit, 'sourceSummary preserva conteúdo legítimo curto sem path/token (não redige demais)');

  const empty = toSourceSummary('');
  assertLog(empty.length > 0 && empty !== '', 'sourceSummary nunca devolve string vazia para entrada vazia');

  console.log('sourceSummary: redige path/token-like e preserva conteúdo legítimo — OK');
}

async function duplicateAndUnknownQueryParamsRejected(): Promise<void> {
  const dupUrl = new URL('http://localhost/api/v1/ml/cost-profiles?limit=1');
  dupUrl.searchParams.append('limit', '2');
  const resDup = await costProfilesGET(new Request(dupUrl));
  const jsonDup = (await resDup.json()) as ApiEnvelope<unknown>;
  assertLog(!jsonDup.success && jsonDup.error.code === 'INVALID_QUERY', 'query param duplicado (limit=1&limit=2) rejeitado com INVALID_QUERY (bloqueador 4)');

  const resUnknown = await costProfilesGET(new Request('http://localhost/api/v1/ml/cost-profiles?foo=bar'));
  const jsonUnknown = (await resUnknown.json()) as ApiEnvelope<unknown>;
  assertLog(!jsonUnknown.success && jsonUnknown.error.code === 'INVALID_QUERY', 'query param desconhecido (foo=bar) rejeitado com INVALID_QUERY (bloqueador 4)');
}

async function researchRunsByModelVersionDto(prisma: PrismaClient): Promise<void> {
  const repo = new PrismaResearchRunRepository(prisma);

  // Achado médio 7 (auditoria final do Guardião, 2026-07-22): `outcome`
  // só pode ser 'APROVADO' quando a ModelVersion linkada REALMENTE existe e
  // carrega `gate.approved === true` na evidência persistida — nunca só
  // por `modelVersionId !== null`. Cria uma ModelVersion de verdade, com
  // evidência aprovada, para o caso positivo.
  const approvedModelVersionId = await insertModelVersionForTest(prisma, {
    kind: 'ML',
    label: 'ml-hybrid-swing-v1',
    asOf: '2026-06-01T00:00:00.000Z',
    hyperparametersJson: '{}',
    trainingEvidenceJson: JSON.stringify({ gate: { approved: true, comparisons: [] } }),
  });

  const runId = await insertResearchRunForTest(prisma, 'guardiao', {
    name: 'ml-hybrid-swing-v1',
    hypothesis: 'hipótese de teste',
    datasetId: 'dataset:teste',
    windowStart: '2026-01-01T00:00:00.000Z',
    windowEnd: '2026-06-01T00:00:00.000Z',
    paramsJson: JSON.stringify({ max_depth: 6, secret: 'nunca deveria vazar' }),
  });
  await repo.linkModelVersion(runId, approvedModelVersionId);

  const res = await researchRunsGET(new Request(`http://localhost/api/v1/research-runs?modelVersionId=${approvedModelVersionId}`));
  const json = (await res.json()) as ApiEnvelope<Record<string, unknown>[]>;
  assertLog(json.success, 'GET research-runs?modelVersionId= responde success:true');
  if (!json.success) throw new Error('unreachable');
  assertLog(json.data.length === 1, 'retorna exatamente o ResearchRun linkado');
  const dto = json.data[0];
  assertLog(
    dto.outcome === 'APROVADO',
    'DTO tem outcome === APROVADO quando a ModelVersion linkada REALMENTE tem gate.approved === true (achado médio 7)',
  );
  const keys = Object.keys(dto);
  assertLog(!keys.includes('paramsJson'), 'DTO de research-run NÃO tem paramsJson (bloqueador 3)');
  assertLog(!keys.includes('datasetId'), 'DTO de research-run NÃO tem datasetId (bloqueador 3)');
  assertLog(!keys.includes('createdBy'), 'DTO de research-run NÃO tem createdBy (bloqueador 3)');
  assertLog(!keys.includes('hypothesis'), 'DTO de research-run NÃO tem hypothesis (revisão final: texto livre removido)');
  assertLog(
    !JSON.stringify(dto).includes('nunca deveria vazar'),
    'conteúdo de paramsJson/hypothesis nunca aparece na resposta HTTP real (revisão final)',
  );
}

/**
 * Achado médio 7 (auditoria final do Guardião, 2026-07-22): mesmo que um
 * `modelVersionId` esteja linkado, `outcome` NUNCA pode virar 'APROVADO'
 * se a ModelVersion referenciada não existe ou não tem gate aprovado de
 * fato — prova que o campo não é forjável simplesmente linkando qualquer
 * id (o próprio POST de ResearchRun não aceita mais `modelVersionId` no
 * corpo — ver `route.ts` — mas o invariante é checado aqui de novo, na
 * camada de leitura, como defesa em profundidade).
 */
async function researchRunOutcomeNotForgeable(prisma: PrismaClient): Promise<void> {
  const repo = new PrismaResearchRunRepository(prisma);

  // Caso 1: modelVersionId aponta para uma ModelVersion que NÃO existe.
  const runIdDangling = await insertResearchRunForTest(prisma, 'guardiao', {
    name: 'ml-hybrid-swing-v1',
    hypothesis: 'hipótese forjada 1',
    datasetId: 'dataset:forjado-1',
    windowStart: '2026-01-01T00:00:00.000Z',
    windowEnd: '2026-06-01T00:00:00.000Z',
    paramsJson: '{}',
  });
  await repo.linkModelVersion(runIdDangling, 'mv-inexistente-forjado');

  const resDangling = await researchRunsGET(new Request('http://localhost/api/v1/research-runs?modelVersionId=mv-inexistente-forjado'));
  const jsonDangling = (await resDangling.json()) as ApiEnvelope<Record<string, unknown>[]>;
  assertLog(jsonDangling.success, 'GET research-runs?modelVersionId=(inexistente) ainda responde success:true');
  if (!jsonDangling.success) throw new Error('unreachable');
  assertLog(
    jsonDangling.data[0]?.outcome === 'REPROVADO',
    'outcome nunca é APROVADO para modelVersionId apontando a uma ModelVersion inexistente (achado médio 7)',
  );

  // Caso 2: modelVersionId aponta para uma ModelVersion que EXISTE mas
  // cujo gate NÃO foi aprovado.
  const unapprovedModelVersionId = await insertModelVersionForTest(prisma, {
    kind: 'ML',
    label: 'ml-hybrid-swing-v1',
    asOf: '2026-06-02T00:00:00.000Z',
    hyperparametersJson: '{}',
    trainingEvidenceJson: JSON.stringify({ gate: { approved: false, comparisons: [] } }),
  });
  const runIdUnapproved = await insertResearchRunForTest(prisma, 'guardiao', {
    name: 'ml-hybrid-swing-v1',
    hypothesis: 'hipótese forjada 2',
    datasetId: 'dataset:forjado-2',
    windowStart: '2026-01-01T00:00:00.000Z',
    windowEnd: '2026-06-01T00:00:00.000Z',
    paramsJson: '{}',
  });
  await repo.linkModelVersion(runIdUnapproved, unapprovedModelVersionId);

  const resUnapproved = await researchRunsGET(new Request(`http://localhost/api/v1/research-runs?modelVersionId=${unapprovedModelVersionId}`));
  const jsonUnapproved = (await resUnapproved.json()) as ApiEnvelope<Record<string, unknown>[]>;
  assertLog(jsonUnapproved.success, 'GET research-runs?modelVersionId=(não aprovada) ainda responde success:true');
  if (!jsonUnapproved.success) throw new Error('unreachable');
  assertLog(
    jsonUnapproved.data[0]?.outcome === 'REPROVADO',
    'outcome nunca é APROVADO para modelVersionId de uma ModelVersion existente mas com gate.approved !== true (achado médio 7)',
  );
}

/**
 * Bloqueador único (revisão 2026-07-22): a UI SEM_MODELO_APROVADO precisa
 * mostrar a última pesquisa/reprovação por `name=ml-hybrid-swing-v1` mesmo
 * sem nenhum `ModelVersion` ativo — ou seja, o seletor `name` deve retornar
 * runs sem depender de `modelVersionId` e marcar corretamente REPROVADO
 * quando o run não está linkado a nenhuma versão.
 */
async function researchRunsByNameWithoutModelVersion(prisma: PrismaClient): Promise<void> {
  const runId = await insertResearchRunForTest(prisma, 'guardiao', {
    name: 'ml-hybrid-swing-v1',
    hypothesis: 'hipótese reprovada de teste',
    datasetId: 'dataset:teste-reprovado',
    windowStart: '2026-02-01T00:00:00.000Z',
    windowEnd: '2026-05-01T00:00:00.000Z',
    paramsJson: JSON.stringify({ max_depth: 4 }),
  });
  // Não chama linkModelVersion — simula pesquisa reprovada/sem modelo.

  const res = await researchRunsGET(new Request('http://localhost/api/v1/research-runs?name=ml-hybrid-swing-v1&limit=10'));
  const json = (await res.json()) as ApiEnvelope<Record<string, unknown>[]>;
  assertLog(json.success, 'GET research-runs?name=ml-hybrid-swing-v1 responde success:true (sem exigir modelVersionId)');
  if (!json.success) throw new Error('unreachable');
  const dto = json.data.find((item) => item.runId === runId);
  assertLog(dto !== undefined, 'run reprovado/não linkado aparece na consulta por name mesmo sem versão ativa');
  assertLog(dto?.outcome === 'REPROVADO', 'DTO marca outcome REPROVADO quando modelVersionId é null');
  const keys = Object.keys(dto ?? {});
  assertLog(!keys.includes('hypothesis'), 'consulta por name também não expõe hypothesis');
  assertLog(!keys.includes('paramsJson'), 'consulta por name também não expõe paramsJson');
}

async function mutuallyExclusiveSelectorsRejected(): Promise<void> {
  const resNone = await researchRunsGET(new Request('http://localhost/api/v1/research-runs'));
  const jsonNone = (await resNone.json()) as ApiEnvelope<unknown>;
  assertLog(!jsonNone.success && jsonNone.error.code === 'INVALID_QUERY', 'GET research-runs sem seletor nenhum é INVALID_QUERY');

  const resBoth = await researchRunsGET(new Request('http://localhost/api/v1/research-runs?datasetId=x&modelVersionId=y'));
  const jsonBoth = (await resBoth.json()) as ApiEnvelope<unknown>;
  assertLog(!jsonBoth.success && jsonBoth.error.code === 'INVALID_QUERY', 'GET research-runs com dois seletores ao mesmo tempo é INVALID_QUERY');
}

/**
 * Bloqueador 8: comprova, em nível de contrato HTTP, que uma falha de
 * validação nunca é indistinguível de "lista vazia" — a rota sempre
 * responde `success:false` com um `error.code` específico, nunca
 * `success:true, data: []` mascarando um cenário de erro.
 */
async function invalidQueryNeverMasksAsEmptySuccess(): Promise<void> {
  const resEmptyModelVersion = await researchRunsGET(new Request('http://localhost/api/v1/research-runs?modelVersionId='));
  const jsonEmptyModelVersion = (await resEmptyModelVersion.json()) as ApiEnvelope<unknown>;
  assertLog(
    !jsonEmptyModelVersion.success && jsonEmptyModelVersion.error.code === 'INVALID_QUERY',
    'modelVersionId vazio nunca vira success:true,data:[] — sempre INVALID_QUERY explícito (bloqueador 8)',
  );

  const resMalformedCursor = await costProfilesGET(new Request('http://localhost/api/v1/ml/cost-profiles?cursor='));
  const jsonMalformedCursor = (await resMalformedCursor.json()) as ApiEnvelope<unknown>;
  assertLog(
    !jsonMalformedCursor.success && jsonMalformedCursor.error.code === 'INVALID_QUERY',
    'cursor vazio (malformado) nunca vira success:true,data:[] — sempre INVALID_QUERY explícito (bloqueador 8)',
  );
}

/**
 * Bloqueador 1 (revisão final do Guardião, 2026-07-22): `GET /api/v1/ml/model-versions`
 * nunca pode devolver `hyperparametersJson`/`trainingEvidenceJson` brutos —
 * o segundo carrega `artifact.path` (caminho local). Prova ponta a ponta que
 * o path local nunca aparece na resposta HTTP e que o resumo derivado
 * (`evidence`) reflete os campos numéricos/hash esperados.
 */
async function modelVersionsSafeDto(prisma: PrismaClient): Promise<void> {
  const localPath = 'C:\\Users\\rwres\\wr_trade_pro_\\data\\ml\\artifacts\\segredo-de-artefato.bin';
  const trainingEvidence = {
    aggregate: { nSamples: 1200, accuracy: 0.62 },
    baselines: {
      alwaysUp: { accuracy: 0.5 },
      timesfmOnly: { accuracy: 0.55 },
      fundamentalOnly: { accuracy: 0.53 },
      priceOnlyLgbm: { accuracy: 0.58 },
    },
    gate: {
      approved: true,
      comparisons: [{ baseline: 'alwaysUp', accuracyDiff: 0.12, ciLower: 0.02, passed: true }],
    },
    artifact: { hash: 'f'.repeat(64), path: localPath },
    datasetHash: 'a'.repeat(64),
    timesfmVersion: 'timesfm-2.0',
    windowStart: '2026-01-01T00:00:00.000Z',
    windowEnd: '2026-06-01T00:00:00.000Z',
  };
  const insertedId = await insertModelVersionForTest(prisma, {
    kind: 'ML',
    label: 'ml-hybrid-swing-v1',
    asOf: '2026-06-01T00:00:00.000Z',
    hyperparametersJson: JSON.stringify({ max_depth: 6, learning_rate: 0.05 }),
    trainingEvidenceJson: JSON.stringify(trainingEvidence),
  });

  const res = await modelVersionsGET(new Request('http://localhost/api/v1/ml/model-versions?kind=ML&limit=100'));
  const json = (await res.json()) as ApiEnvelope<Record<string, unknown>[]>;
  assertLog(json.success, 'GET ml/model-versions?kind=ML responde success:true');
  if (!json.success) throw new Error('unreachable');
  assertLog(json.data.length >= 1, 'retorna ao menos a ModelVersion criada');

  const raw = JSON.stringify(json.data);
  assertLog(!raw.includes(localPath), 'resposta HTTP nunca contém o path local do artifact (bloqueador 1)');
  assertLog(!raw.includes('segredo-de-artefato'), 'resposta HTTP nunca contém fragmento do path local');
  assertLog(!raw.includes('max_depth'), 'resposta HTTP nunca contém hyperparametersJson bruto (bloqueador 1)');

  // Ordenação global agora é `asOf desc` (não mais `createdAt desc`), então a
  // ModelVersion recém-criada pode não estar no topo se outra tiver `asOf`
  // mais recente — localiza pelo id em vez de assumir a posição 0.
  const dto = json.data.find((d) => d.modelVersion === insertedId);
  assertLog(dto !== undefined, 'ModelVersion recém-criada está presente na resposta (independente da posição)');
  if (!dto) throw new Error('unreachable');
  const keys = Object.keys(dto);
  assertLog(!keys.includes('hyperparametersJson'), 'DTO NÃO tem hyperparametersJson bruto');
  assertLog(!keys.includes('trainingEvidenceJson'), 'DTO NÃO tem trainingEvidenceJson bruto');
  assertLog(keys.includes('gateApproved'), 'DTO TEM gateApproved derivado');
  assertLog(dto.gateApproved === true, 'gateApproved reflete gate.approved === true da evidência');
  const evidence = dto.evidence as Record<string, unknown>;
  assertLog(evidence !== null && typeof evidence === 'object', 'DTO TEM evidence (resumo seguro) quando evidência é válida');
  assertLog(evidence.artifactHash === 'f'.repeat(64), 'evidence.artifactHash preservado');
  assertLog(!('path' in (((evidence as { artifact?: object }).artifact ?? {}) as object)), 'evidence nunca reexpõe artifact.path');
  assertLog(evidence.nSamples === 1200, 'evidence.nSamples preservado');
}

/**
 * Bloqueador 2 (revisão final do Guardião): o caminho legado
 * `GET /api/v1/research-runs?datasetId=` também precisa aplicar o DTO
 * público (nunca `paramsJson`/`createdBy`/`hypothesis` brutos) e paginação
 * `limit+1` — mesmo sendo pré-existente ao Item B.
 */
async function legacyDatasetIdPathUsesSafeDtoAndPagination(prisma: PrismaClient): Promise<void> {
  const datasetId = 'dataset:legado-teste';
  await insertResearchRunForTest(prisma, 'guardiao', {
    name: 'legado-1',
    hypothesis: 'nunca deveria vazar (legado)',
    datasetId,
    windowStart: '2026-01-01T00:00:00.000Z',
    windowEnd: '2026-02-01T00:00:00.000Z',
    paramsJson: JSON.stringify({ secret: 'segredo-legado' }),
  });
  await insertResearchRunForTest(prisma, 'guardiao', {
    name: 'legado-2',
    hypothesis: 'outro texto livre',
    datasetId,
    windowStart: '2026-02-01T00:00:00.000Z',
    windowEnd: '2026-03-01T00:00:00.000Z',
    paramsJson: JSON.stringify({ secret: 'outro-segredo' }),
  });

  const res = await researchRunsGET(new Request(`http://localhost/api/v1/research-runs?datasetId=${encodeURIComponent(datasetId)}&limit=1`));
  const json = (await res.json()) as ApiEnvelope<Record<string, unknown>[]>;
  assertLog(json.success, 'GET research-runs?datasetId=&limit= responde success:true (caminho legado)');
  if (!json.success) throw new Error('unreachable');
  assertLog(json.data.length === 1, 'paginação limit=1 aplicada também ao caminho legado datasetId (bloqueador 2)');
  assertLog((json.meta as { nextCursor?: unknown }).nextCursor !== null, 'caminho legado datasetId tem nextCursor quando há mais páginas');
  const keys = Object.keys(json.data[0]);
  assertLog(!keys.includes('paramsJson'), 'caminho legado datasetId NÃO expõe paramsJson (bloqueador 2)');
  assertLog(!keys.includes('createdBy'), 'caminho legado datasetId NÃO expõe createdBy (bloqueador 2)');
  assertLog(!keys.includes('hypothesis'), 'caminho legado datasetId NÃO expõe hypothesis (bloqueador 2)');
  assertLog(!JSON.stringify(json.data).includes('segredo-legado'), 'conteúdo sensível do paramsJson legado nunca vaza na resposta HTTP');
}

/**
 * Bloqueador 3 (revisão final do Guardião): `/api/v1/backtests?modelVersionId=`
 * precisa paginação server-side estável (`limit+1`/cursor), nunca a coleção
 * inteira de uma vez.
 */
async function backtestsServerSidePagination(prisma: PrismaClient): Promise<void> {
  const modelVersionId = 'mv-fake-backtests-pagination';
  const researchRunId = 'rr-fake-backtests-pagination';
  const baseSubmission = {
    researchRunId,
    modelVersionId,
    instrumentId: 'PETR4',
    entryRule: 'open_next_bar',
    costsJson: JSON.stringify({ fixedBrokerage: 1, emolumentsPct: 0.0005, spreadBps: 5, slippageBps: 5, lotSize: 100 }),
    windowStart: '2026-01-01T00:00:00.000Z',
    windowEnd: '2026-02-01T00:00:00.000Z',
    metricsJson: JSON.stringify({ metrics: { trades: 1, totalNetReturn: 0.01, maxDrawdown: 0.02, sharpe: 1.1, winRate: 1 }, trades: [] }),
    embargoDays: 0,
  };
  await insertBacktestRunForTest(prisma, baseSubmission);
  await insertBacktestRunForTest(prisma, baseSubmission);
  await insertBacktestRunForTest(prisma, baseSubmission);

  const res = await backtestsGET(new Request(`http://localhost/api/v1/backtests?modelVersionId=${encodeURIComponent(modelVersionId)}&limit=2`));
  const json = (await res.json()) as ApiEnvelope<Record<string, unknown>[]>;
  assertLog(json.success, 'GET backtests?modelVersionId=&limit= responde success:true');
  if (!json.success) throw new Error('unreachable');
  assertLog(json.data.length === 2, 'primeira página tem exatamente limit=2 itens (bloqueador 3)');
  const meta = json.meta as { nextCursor?: string | null };
  assertLog(typeof meta.nextCursor === 'string', 'primeira página tem nextCursor quando há mais páginas (bloqueador 3)');

  const res2 = await backtestsGET(
    new Request(`http://localhost/api/v1/backtests?modelVersionId=${encodeURIComponent(modelVersionId)}&limit=2&cursor=${encodeURIComponent(String(meta.nextCursor))}`),
  );
  const json2 = (await res2.json()) as ApiEnvelope<Record<string, unknown>[]>;
  assertLog(json2.success, 'segunda página (via cursor) responde success:true');
  if (!json2.success) throw new Error('unreachable');
  assertLog(json2.data.length === 1, 'segunda página tem exatamente o terceiro item, sem repetir os dois primeiros');
  assertLog((json2.meta as { nextCursor?: unknown }).nextCursor === null, 'última página não tem nextCursor (sem página fantasma)');

  const resDupLimit = new URL('http://localhost/api/v1/backtests');
  resDupLimit.searchParams.set('modelVersionId', modelVersionId);
  resDupLimit.searchParams.append('limit', '1');
  resDupLimit.searchParams.append('limit', '2');
  const resDup = await backtestsGET(new Request(resDupLimit));
  const jsonDup = (await resDup.json()) as ApiEnvelope<unknown>;
  assertLog(!jsonDup.success && jsonDup.error.code === 'INVALID_QUERY', 'query param duplicado (limit) rejeitado com INVALID_QUERY em /api/v1/backtests');
}

/**
 * Bloqueador crítico 1 (auditoria final do Guardião, 2026-07-22): prova que
 * o read model de backfill SOBREVIVE a "reload" — persiste via o mesmo
 * serviço de aplicação usado pela rota `POST /api/v1/ml/backfill`, cria
 * uma NOVA instância de `PrismaClient`-backed service (simulando uma nova
 * requisição/sessão, sem nenhum estado em memória compartilhado) e lê de
 * volta via `GET /api/v1/ml/backfill-runs`.
 */
async function backfillRunPersistsAcrossReload(prisma: PrismaClient): Promise<void> {
  const service = createBackfillRunService(prisma);
  const manyFailures = Array.from({ length: 15 }, (_, i) => ({
    ticker: `ZZZZ${i}`,
    reasonSummary: 'timeout ao consultar fonte upstream',
  }));
  await service.record({
    requestedBy: 'guardiao',
    status: 'PARTIAL',
    eligibleCount: 20,
    updatedCount: 5,
    failedCount: 15,
    updatedSymbols: ['PETR4', 'VALE3'],
    failures: manyFailures,
  });

  // "Nova sessão": nenhuma referência ao objeto `service`/estado acima é
  // reaproveitada — só a leitura via rota HTTP contra o mesmo banco.
  const res1 = await backfillRunsGET(new Request('http://localhost/api/v1/ml/backfill-runs?limit=10&offset=0'));
  const json1 = (await res1.json()) as ApiEnvelopeSuccess<{
    backfillRunId: string;
    status: string;
    eligibleCount: number;
    updatedCount: number;
    failedCount: number;
    updatedSymbols: string[];
    failuresPage: { ticker: string; reasonSummary: string }[];
    failuresNextCursor: number | null;
  }>;
  assertLog(json1.success, 'GET backfill-runs responde success:true após persistência (bloqueador crítico 1)');
  assertLog(json1.data.status === 'PARTIAL', 'relatório persistido sobrevive: status PARTIAL lido de volta');
  assertLog(json1.data.eligibleCount === 20 && json1.data.updatedCount === 5 && json1.data.failedCount === 15, 'contagens sobrevivem ao reload');
  assertLog(json1.data.failuresPage.length === 10, 'primeira página de falhas tem exatamente `limit` itens');
  assertLog(json1.data.failuresNextCursor === 10, 'nextCursor de falhas aponta para o próximo offset (bloqueador crítico 1)');

  const res2 = await backfillRunsGET(new Request(`http://localhost/api/v1/ml/backfill-runs?limit=10&offset=${json1.data.failuresNextCursor}`));
  const json2 = (await res2.json()) as ApiEnvelopeSuccess<{ failuresPage: { ticker: string; reasonSummary: string }[]; failuresNextCursor: number | null }>;
  assertLog(json2.success, 'segunda página de falhas responde success:true');
  assertLog(json2.data.failuresPage.length === 5, 'segunda página tem os 5 restantes, sem repetir a primeira');
  assertLog(json2.data.failuresNextCursor === null, 'última página não tem nextCursor (sem página fantasma)');
}

/**
 * Bloqueador crítico 2 (auditoria final do Guardião, 2026-07-22): mesmo que
 * uma mensagem de falha bruta contenha path/token/URL, o serviço de
 * aplicação nunca persiste/expõe isso cru — só o resumo já sanitizado na
 * fronteira HTTP chega ao read model. Este teste prova o CONTRATO do read
 * model (nunca aceita reasonSummary bruto perigoso vindo da camada
 * acima) — a sanitização em si já é coberta por `sourceSummaryRedacts...`.
 */
async function backfillFailuresNeverExposeRawSensitiveText(prisma: PrismaClient): Promise<void> {
  const service = createBackfillRunService(prisma);
  await service.record({
    requestedBy: 'guardiao',
    status: 'PARTIAL',
    eligibleCount: 2,
    updatedCount: 1,
    failedCount: 1,
    updatedSymbols: ['PETR4'],
    // Mesmo que a camada de rota já sanitize antes de chamar `record`, o
    // read model não deve reintroduzir path/token cru na resposta HTTP —
    // aqui persiste-se já sanitizado, exatamente como a rota faz.
    failures: [{ ticker: 'VALE3', reasonSummary: 'falha não detalhável (formato restrito)' }],
  });

  const res = await backfillRunsGET(new Request('http://localhost/api/v1/ml/backfill-runs?limit=1&offset=0'));
  const json = (await res.json()) as ApiEnvelopeSuccess<{ failuresPage: { ticker: string; reasonSummary: string }[] }>;
  assertLog(json.success, 'GET backfill-runs responde success:true');
  const body = JSON.stringify(json);
  assertLog(!body.includes('C:\\') && !body.includes('/etc/') && !body.includes('..'), 'resposta de backfill-runs nunca contém path bruto');
  assertLog(json.data.failuresPage[0]?.ticker === 'VALE3', 'ticker aparece normalizado');
}

/** Sobe um upstream HTTP adversarial minimalista (substitui o `ml_api.py` real) para exercitar a fronteira HTTP real das rotas POST. */
async function withAdversarialUpstream(handler: (req: http.IncomingMessage) => Promise<unknown> | unknown, run: (baseUrl: string) => Promise<void>): Promise<void> {
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      void Promise.resolve(handler(req))
        .then((body) => {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify(body));
        })
        .catch((err: unknown) => {
          res.writeHead(500, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ error: String(err) }));
        });
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  const prevUrl = process.env.WR_ML_API_URL;
  process.env.WR_ML_API_URL = `http://127.0.0.1:${port}`;
  try {
    await run(process.env.WR_ML_API_URL);
  } finally {
    if (prevUrl === undefined) delete process.env.WR_ML_API_URL;
    else process.env.WR_ML_API_URL = prevUrl;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

/**
 * Bloqueador 1 (auditoria focada do Guardião, 2026-07-22): `POST
 * /api/v1/ml/backfill` não pode mais espalhar `result` bruto do Python na
 * resposta — o upstream adversarial aqui devolve tickers fora do formato
 * canônico e mensagens de falha com path Windows/Unix, URL, token e stack
 * trace; a resposta HTTP real (não só o read model persistido) nunca pode
 * conter esses valores brutos.
 */
async function backfillPostRouteSanitizesAdversarialUpstream(): Promise<void> {
  const { POST: backfillPOST } = await import('../../src/app/api/v1/ml/backfill/route');

  await withAdversarialUpstream(
    () => ({
      ok: ['PETR4', '../../SECRET', 'C:\\Users\\x\\TOKEN', 'PETR-4', 'PETR/4', 'PETR_4', 'PETR 4'],
      failed: {
        VALE3: 'C:\\Users\\x\\secret\\model.txt não encontrado',
        ITUB4: 'https://internal.example.com/token=AAAAAAAAAAAAAAAAAAAAAAAAAAAA falha ao carregar',
        'XXXX99': 'a'.repeat(300),
      },
    }),
    async () => {
      const res = await backfillPOST(new Request('http://localhost/api/v1/ml/backfill', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }));
      const rawBody = await res.text();
      const json = JSON.parse(rawBody) as ApiEnvelopeSuccess<{
        updatedSymbols: string[];
        failures: { ticker: string; reasonSummary: string }[];
        updatedCount: number;
        failedCount: number;
        status: string;
        backfillRunId: string;
      }>;
      assertLog(json.success === true, 'POST /ml/backfill responde success:true com upstream adversarial');
      assertLog(
        !rawBody.includes('C:\\') && !rawBody.includes('/etc/') && !rawBody.includes('..') && !rawBody.includes('internal.example.com') && !rawBody.includes('AAAAAAAAAAAAAAAAAAAAAAAAAAAA'),
        'resposta do POST /ml/backfill nunca contém path/URL/token bruto do upstream adversarial',
      );
      assertLog(!('ok' in json.data) && !('failed' in json.data), 'POST /ml/backfill nunca espalha `result` bruto (`ok`/`failed`) na resposta pública');
      assertLog(json.data.updatedSymbols.includes('PETR4'), 'ticker válido normalizado passa');
      // Item B (correção residual, 2026-07-22, bloqueador 1): pontuado/espaçado
      // (`PETR-4`, `PETR/4`, `PETR_4`, `PETR 4`) precisa virar DESCONHECIDO no
      // POST real, junto com os 2 casos de path traversal já cobertos — 6 no total.
      assertLog(json.data.updatedSymbols.filter((s) => s === 'DESCONHECIDO').length === 6, 'tickers fora do formato canônico (incluindo pontuados/espaçados) viram DESCONHECIDO na resposta do POST real');
      assertLog(json.data.updatedCount === 7 && json.data.failedCount === 3 && json.data.status === 'PARTIAL', 'contagens/status do POST batem com o upstream adversarial');
      assertLog(json.data.failures.every((f) => f.reasonSummary === 'falha não detalhável (formato restrito)'), 'toda razão de falha perigosa vira mensagem fixa redigida no POST');
    },
  );
}

/**
 * Bloqueador 2 (auditoria focada do Guardião, 2026-07-22): `normalizeTickerLabel`
 * só pode devolver um valor que satisfaça exatamente `^[A-Z]{4}\d{1,2}$` — caso
 * contrário, sempre `DESCONHECIDO`. Cobre os exemplos citados pela auditoria
 * (`../../SECRET` → antes virava `SECRET`; `C:\TOKEN` → antes virava `CTOKEN`).
 */
function normalizeTickerLabelRejectsResidualNonCanonicalValues(): void {
  assertLog(normalizeTickerLabel('../../SECRET') === 'DESCONHECIDO', 'path traversal nunca vira ticker residual (bloqueador 2)');
  assertLog(normalizeTickerLabel('C:\\TOKEN') === 'DESCONHECIDO', 'path Windows nunca vira ticker residual (bloqueador 2)');
  assertLog(normalizeTickerLabel('SECRET') === 'DESCONHECIDO', 'texto arbitrário sem dígitos nunca vira ticker');
  assertLog(normalizeTickerLabel('PETR4X') === 'DESCONHECIDO', 'ticker com sufixo extra é rejeitado, não truncado para passar');
  assertLog(normalizeTickerLabel('pEtr4') === 'PETR4', 'ticker canônico válido (case-insensitive na entrada) ainda passa');
  assertLog(normalizeTickerLabel('') === 'DESCONHECIDO', 'string vazia vira DESCONHECIDO');
  assertLog(normalizeTickerLabel('!!!@@@###') === 'DESCONHECIDO', 'apenas caracteres especiais vira DESCONHECIDO');
  // Item B (correção residual, 2026-07-22, bloqueador 1): pontuação/espaço não
  // pode ser removida antes da validação — a entrada inteira precisa casar
  // com o formato canônico, ou vira DESCONHECIDO.
  assertLog(normalizeTickerLabel('PETR-4') === 'DESCONHECIDO', 'ticker com hífen nunca vira PETR4 residual');
  assertLog(normalizeTickerLabel('PETR/4') === 'DESCONHECIDO', 'ticker com barra nunca vira PETR4 residual');
  assertLog(normalizeTickerLabel('PETR_4') === 'DESCONHECIDO', 'ticker com underscore nunca vira PETR4 residual');
  assertLog(normalizeTickerLabel('PETR 4') === 'DESCONHECIDO', 'ticker com espaço interno nunca vira PETR4 residual');
  assertLog(normalizeTickerLabel('  petr4  ') === 'PETR4', 'trim + uppercase nas bordas ainda passa para ticker canônico válido');
}

/**
 * Bloqueador 3 (auditoria focada do Guardião, 2026-07-22): `POST
 * /api/v1/ml/predict` precisa validar/normalizar o payload do upstream com
 * um DTO estrito — digests não-hex64, `sourceMeta` com path/token/URL,
 * nome de feature malicioso, `topFeatures` e propriedades extras nunca
 * podem escapar cru na resposta pública.
 */
async function predictPostRouteSanitizesAdversarialUpstream(prisma: PrismaClient): Promise<void> {
  const { createModelVersionService } = await import('../../src/application/model-version');
  const modelVersionService = createModelVersionService(prisma);
  await modelVersionService.submit({
    kind: 'ML',
    label: 'ml-hybrid-swing-v1',
    asOf: '2026-07-22T00:00:00.000Z',
    hyperparametersJson: '{}',
    trainingEvidenceJson: JSON.stringify({
      gate: { approved: true, comparisons: [] },
      artifact: { hash: 'f'.repeat(64), path: 'unused' },
      datasetHash: 'a'.repeat(64),
    }),
  });

  const { POST: predictPOST } = await import('../../src/app/api/v1/ml/predict/route');

  await withAdversarialUpstream(
    () => ({
      symbol: 'PETR4',
      date: '2026-07-22',
      direction: 'BUY',
      score: 0.87,
      topFeatures: [
        { name: '../../../etc/passwd', importance: 0.9 },
        { name: 'feature_ok_1', importance: 0.5 },
      ],
      sourceMeta: {
        candles: { from: '2026-01-01', to: '2026-07-22', source: 'C:\\Users\\x\\secret\\data.db' },
        model: 'f'.repeat(64),
        timesfm: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAA-token-like-value',
        extraneous: { nested: 'https://internal.example.com/leak', stack: 'at foo (bar.js:1:1)' },
      },
    }),
    async () => {
      const res = await predictPOST(
        new Request('http://localhost/api/v1/ml/predict', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ symbol: 'PETR4' }) }),
      );
      const rawBody = await res.text();
      const json = JSON.parse(rawBody) as ApiEnvelopeSuccess<{
        signalId: string;
        prediction: { topFeatures: { name: string; importance: number }[]; sourceMeta: Record<string, unknown> };
        modelVersionId: string;
        datasetHash: string;
        artifactHash: string;
      }>;
      assertLog(res.status === 201 && json.success === true, 'POST /ml/predict responde 201/success com upstream adversarial');
      assertLog(json.data.datasetHash === 'a'.repeat(64) && json.data.artifactHash === 'f'.repeat(64), 'digests 64-hex passam intactos e validados');
      assertLog(
        !rawBody.includes('etc/passwd') && !rawBody.includes('C:\\') && !rawBody.includes('internal.example.com') && !rawBody.includes('bar.js') && !rawBody.includes('extraneous'),
        'resposta do POST /ml/predict nunca contém path/URL/stack/chave desconhecida do upstream adversarial',
      );
      assertLog(
        json.data.prediction.topFeatures.every((f) => f.name === 'feature_ok_1'),
        'nome de feature malicioso é descartado, só nomes em formato seguro passam',
      );
      assertLog(Object.keys(json.data.prediction.sourceMeta).sort().join(',') === 'candlesFrom,candlesSource,candlesTo,timesfmVersion', 'sourceMeta público é estritamente allowlisted (só as 4 chaves conhecidas)');
      assertLog(json.data.prediction.sourceMeta.candlesSource === null, 'candles.source com path bruto vira null, nunca vaza');
      assertLog(json.data.prediction.sourceMeta.timesfmVersion === null, 'timesfm com valor token-like vira null, nunca vaza');
    },
  );
}

/**
 * Gate do Guardião — fronteira HTTP/data (2026-07-22, prova 2): as provas
 * de `adversarialPredictionPayloadPreEffectTests` (ml-hybrid-test.ts)
 * chamam `MlHybridService` diretamente. Esta atravessa o `POST
 * /api/v1/ml/predict` real com um upstream HTTP adversarial (mesmo padrão
 * de `withAdversarialUpstream`), provando que a resposta HTTP e
 * `prisma.signal.count()` ficam controlados mesmo sem nenhum atalho de
 * chamada direta ao service.
 */
async function predictPostRouteRejectsAdversarialInvalidPayloadOverHttp(prisma: PrismaClient): Promise<void> {
  const { createModelVersionService } = await import('../../src/application/model-version');
  const modelVersionService = createModelVersionService(prisma);

  const existing = await modelVersionService.listByKind('ML');
  for (const v of existing) {
    if (v.label === 'ml-hybrid-swing-v1' && v.invalidatedAt === null) {
      await modelVersionService.invalidate(v.modelVersion, new Date().toISOString(), 'isolamento de teste (predictPostRouteRejectsAdversarialInvalidPayloadOverHttp)');
    }
  }
  await modelVersionService.submit({
    kind: 'ML',
    label: 'ml-hybrid-swing-v1',
    asOf: '2026-07-22T02:00:00.000Z',
    hyperparametersJson: '{}',
    trainingEvidenceJson: JSON.stringify({
      gate: { approved: true, comparisons: [] },
      artifact: { hash: 'c'.repeat(64), path: 'unused' },
      datasetHash: 'b'.repeat(64),
    }),
  });

  const { POST: predictPOST } = await import('../../src/app/api/v1/ml/predict/route');

  const validBase = {
    symbol: 'PETR4',
    date: '2026-07-22',
    direction: 'BUY',
    score: 0.6,
    topFeatures: [{ name: 'feature_ok', importance: 0.4 }],
    sourceMeta: {},
  };

  const cases: { label: string; payload: Record<string, unknown> }[] = [
    { label: 'score acima de 1 (fora do domínio)', payload: { ...validBase, score: 1.7 } },
    { label: 'score negativo (fora do domínio)', payload: { ...validBase, score: -0.3 } },
    { label: 'symbol fora do formato canônico', payload: { ...validBase, symbol: 'PETR-4' } },
    { label: 'data impossível (calendário inexistente, formato válido)', payload: { ...validBase, date: '2026-02-31' } },
    { label: 'importance negativa em topFeatures', payload: { ...validBase, topFeatures: [{ name: 'feature_ok', importance: -0.1 }] } },
  ];

  for (const { label, payload } of cases) {
    await withAdversarialUpstream(
      () => payload,
      async () => {
        const before = await prisma.signal.count();
        const res = await predictPOST(
          new Request('http://localhost/api/v1/ml/predict', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ symbol: 'PETR4' }) }),
        );
        const after = await prisma.signal.count();
        const json = (await res.json()) as ApiEnvelopeError;
        assertLog(res.status === 502, `POST /ml/predict real devolve status controlado (502) para ${label}`);
        assertLog(json.success === false && json.error.code === 'UPSTREAM_ERROR', `POST /ml/predict real devolve UPSTREAM_ERROR para ${label}`);
        assertLog(after === before, `nenhum Signal novo é criado via POST real para ${label} (prisma.signal.count inalterado)`);
      },
    );
  }

  // Prova de que o mesmo caminho HTTP real, sem defeitos, ainda funciona.
  await withAdversarialUpstream(
    () => validBase,
    async () => {
      const before = await prisma.signal.count();
      const res = await predictPOST(
        new Request('http://localhost/api/v1/ml/predict', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ symbol: 'PETR4' }) }),
      );
      const after = await prisma.signal.count();
      assertLog(res.status === 201, 'POST /ml/predict real com payload válido continua respondendo 201 (sem falso positivo)');
      assertLog(after === before + 1, 'POST /ml/predict real com payload válido cria exatamente um Signal novo');
    },
  );
}

/**
 * Correção do parecer independente (2026-07-22): `listByKindPaginated`
 * ordenava por `createdAt desc, modelVersion desc`, divergindo da política
 * canônica `asOf desc, createdAt desc, modelVersion desc` usada por
 * `predictLive`/UI. Prova trans-páginas com `limit=1`: a versão criada
 * DEPOIS (createdAt mais recente) tem `asOf` mais antigo; a versão criada
 * ANTES (createdAt mais antigo) tem `asOf` mais novo. A API deve devolver
 * globalmente a de `asOf` mais novo primeiro — mesmo tendo `createdAt` mais
 * antigo — e o cursor deve levar às páginas seguintes sem repetir IDs.
 */
async function listByKindPaginatedOrdersGloballyByAsOf(prisma: PrismaClient): Promise<void> {
  const kind = 'ML';

  const newerAsOfId = await insertModelVersionForTest(prisma, {
    kind,
    label: 'ordenacao-global-newer-asof',
    asOf: '2030-01-01T00:00:00.000Z',
    hyperparametersJson: JSON.stringify({}),
    trainingEvidenceJson: JSON.stringify({ note: 'ordenacao-global-newer-asof' }),
  });
  await prisma.modelVersion.update({
    where: { modelVersion: newerAsOfId },
    data: { createdAt: new Date('2020-01-01T00:00:00.000Z') },
  });

  const olderAsOfId = await insertModelVersionForTest(prisma, {
    kind,
    label: 'ordenacao-global-older-asof',
    asOf: '2000-01-01T00:00:00.000Z',
    hyperparametersJson: JSON.stringify({}),
    trainingEvidenceJson: JSON.stringify({ note: 'ordenacao-global-older-asof' }),
  });
  await prisma.modelVersion.update({
    where: { modelVersion: olderAsOfId },
    data: { createdAt: new Date('2026-01-01T00:00:00.000Z') },
  });

  const firstRes = await modelVersionsGET(new Request(`http://localhost/api/v1/ml/model-versions?kind=${kind}&limit=1`));
  const firstJson = (await firstRes.json()) as ApiEnvelope<Record<string, unknown>[]>;
  assertLog(firstJson.success, 'primeira página (limit=1) responde success:true');
  if (!firstJson.success) throw new Error('unreachable');
  assertLog(firstJson.data.length === 1, 'primeira página retorna exatamente 1 item (limit=1)');
  assertLog(
    firstJson.data[0].modelVersion === newerAsOfId,
    'primeiro item global é o de asOf mais novo (2030), mesmo tendo createdAt mais antigo (2020) — prova ordenação por asOf desc, não createdAt desc',
  );

  const seenIds = new Set<string>([newerAsOfId]);
  let cursor = (firstJson.meta as { nextCursor?: string | null } | undefined)?.nextCursor ?? null;
  let foundOlderAsOf = false;
  let iterations = 0;
  const MAX_ITERATIONS = 50;
  while (cursor && !foundOlderAsOf && iterations < MAX_ITERATIONS) {
    iterations += 1;
    const res = await modelVersionsGET(
      new Request(`http://localhost/api/v1/ml/model-versions?kind=${kind}&limit=1&cursor=${encodeURIComponent(cursor)}`),
    );
    const json = (await res.json()) as ApiEnvelope<Record<string, unknown>[]>;
    assertLog(json.success, 'página subsequente (cursor) responde success:true');
    if (!json.success) throw new Error('unreachable');
    assertLog(json.data.length <= 1, 'cada página subsequente respeita limit=1');
    for (const item of json.data) {
      const id = item.modelVersion as string;
      assertLog(!seenIds.has(id), `cursor nunca repete um modelVersion já retornado (${id})`);
      seenIds.add(id);
      if (id === olderAsOfId) foundOlderAsOf = true;
    }
    cursor = (json.meta as { nextCursor?: string | null } | undefined)?.nextCursor ?? null;
  }
  assertLog(foundOlderAsOf, 'seguindo o cursor trans-páginas, a versão de asOf mais antigo (2000) é eventualmente encontrada, sem repetição');
}

async function main(): Promise<void> {
  const prisma = new PrismaClient();
  try {
    await costProfilesPaginationAndDto(prisma);
    sourceSummaryRedactsPathAndTokenLikeInput();
    await duplicateAndUnknownQueryParamsRejected();
    await researchRunsByModelVersionDto(prisma);
    await researchRunOutcomeNotForgeable(prisma);
    await researchRunsByNameWithoutModelVersion(prisma);
    await mutuallyExclusiveSelectorsRejected();
    await invalidQueryNeverMasksAsEmptySuccess();
    await modelVersionsSafeDto(prisma);
    await legacyDatasetIdPathUsesSafeDtoAndPagination(prisma);
    await backtestsServerSidePagination(prisma);
    await backfillRunPersistsAcrossReload(prisma);
    await backfillFailuresNeverExposeRawSensitiveText(prisma);
    normalizeTickerLabelRejectsResidualNonCanonicalValues();
    await backfillPostRouteSanitizesAdversarialUpstream();
    await predictPostRouteSanitizesAdversarialUpstream(prisma);
    await predictPostRouteRejectsAdversarialInvalidPayloadOverHttp(prisma);
    await listByKindPaginatedOrdersGloballyByAsOf(prisma);
  } finally {
    await prisma.$disconnect();
  }
  console.log('Item B / ml-unified-reads: TODOS OS TESTES PASSARAM');
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
