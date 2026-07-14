import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { createOptionPositionService } from '../../src/application/option-position';
import { createSpreadOrderAuditService } from '../../src/application/spread-order-audit';
import { ReadModelError } from '../../src/application/read-models-v1/errors';
import { jsonError } from '../../src/app/api/v1/_shared/http';
import { CreateOptionPositionBodySchema } from '../../src/adapters/prisma/option-position';
import { CreateSpreadOrderAuditBodySchema } from '../../src/adapters/prisma/spread-order-audit';
import { validateOptionPositionSubmission } from '../../src/domain/v1/models/option-position';

async function expectReadModelError(promise: Promise<unknown>, code: string, label: string): Promise<void> {
  try {
    await promise;
    assert.fail(`esperava ReadModelError(${code}) em ${label}`);
  } catch (error) {
    if (error instanceof assert.AssertionError) throw error;
    assert.ok(error instanceof ReadModelError, `${label}: esperava ReadModelError, recebeu ${(error as Error)?.constructor?.name}`);
    assert.equal((error as ReadModelError).code, code, `${label}: código esperado ${code}, recebido ${(error as ReadModelError).code}`);
  }
}

function migrationAdditivityTests(): void {
  const sql = readFileSync(
    join(process.cwd(), 'prisma', 'migrations', '20260714150000_add_option_position_spread_audit', 'migration.sql'),
    'utf8',
  );
  assert.doesNotMatch(sql, /\bALTER\s+TABLE\b/i, 'migração aditiva da Fase 6 não pode conter ALTER TABLE');
  assert.doesNotMatch(sql, /\bDROP\s+TABLE\b/i, 'migração aditiva não pode conter DROP TABLE');
  assert.doesNotMatch(sql, /\bDROP\s+COLUMN\b/i, 'migração aditiva não pode conter DROP COLUMN');
  assert.doesNotMatch(sql, /\bDROP\s+INDEX\b/i, 'migração aditiva não pode conter DROP INDEX');
  assert.match(sql, /CREATE TABLE "OptionPosition"/);
  assert.match(sql, /CREATE TABLE "SpreadOrderAudit"/);
  console.log('migration additivity (Fase 6): OK (somente CREATE TABLE/INDEX, sem ALTER/DROP)');
}

function strictBodyRejectsExtraFieldTests(): void {
  const rawWithExtraField = {
    instrumentId: 'PETR4',
    kind: 'CALL',
    strike: 4800,
    expiration: '2099-01-01T00:00:00.000Z',
    side: 'LONG',
    quantity: 100,
    source: 'MANUAL',
    knowledgeTime: '2026-01-01T00:00:00.000Z',
    executeNow: true,
  };
  const parsed = CreateOptionPositionBodySchema.safeParse(rawWithExtraField);
  assert.equal(parsed.success, false, 'corpo com campo extra (executeNow) deve ser rejeitado por Zod .strict()');

  const auditWithExtraField = {
    orderId: 'order-1',
    action: 'CREATE',
    payload: {},
    decisionTime: '2026-01-01T00:00:00.000Z',
    sendToBroker: true,
  };
  const parsedAudit = CreateSpreadOrderAuditBodySchema.safeParse(auditWithExtraField);
  assert.equal(parsedAudit.success, false, 'corpo do ledger com campo extra deve ser rejeitado por Zod .strict()');
  console.log('Zod .strict(): OK (campo extra rejeitado -> 400 INVALID_BODY, em ambos os schemas)');
}

async function internalErrorSanitizationTests(): Promise<void> {
  const fakePrismaError = Object.assign(new Error('SELECT * FROM "OptionPosition" WHERE ... syntax error near "%^&"'), {
    name: 'PrismaClientKnownRequestError',
    code: 'P2010',
    stack: 'PrismaClientKnownRequestError: raw sql failed\n    at file:///C:/secret/path/query.ts:42:17',
  });

  const response = jsonError(fakePrismaError);
  assert.equal(response.status, 500);
  const body = (await response.json()) as { success: boolean; error: { code: string; message: string } };
  assert.equal(body.success, false);
  assert.equal(body.error.code, 'INTERNAL_ERROR');
  const serialized = JSON.stringify(body);
  assert.doesNotMatch(serialized, /SELECT|syntax error|at file:\/\/\//i, 'resposta não pode vazar SQL ou stack trace');
  assert.doesNotMatch(serialized, /P2010/, 'resposta não pode vazar código interno do driver Prisma');
  console.log('sanitização de erro interno: OK (sem stack/SQL/detalhe de driver no corpo da resposta)');
}

function pureRulesTests(): void {
  const ok = validateOptionPositionSubmission({
    instrumentId: 'PETR4',
    kind: 'CALL',
    strike: 4800,
    expiration: '2099-01-01T00:00:00.000Z',
    side: 'LONG',
    quantity: 100,
    source: 'MANUAL',
    knowledgeTime: '2026-01-01T00:00:00.000Z',
  });
  assert.equal(ok.ok, true);

  const badStrike = validateOptionPositionSubmission({
    instrumentId: 'PETR4',
    kind: 'CALL',
    strike: -1,
    expiration: '2099-01-01T00:00:00.000Z',
    side: 'LONG',
    quantity: 100,
    source: 'MANUAL',
    knowledgeTime: '2026-01-01T00:00:00.000Z',
  });
  assert.deepEqual(badStrike, { ok: false, reason: 'INVALID_STRIKE' });

  const badQty = validateOptionPositionSubmission({
    instrumentId: 'PETR4',
    kind: 'CALL',
    strike: 4800,
    expiration: '2099-01-01T00:00:00.000Z',
    side: 'LONG',
    quantity: 0,
    source: 'MANUAL',
    knowledgeTime: '2026-01-01T00:00:00.000Z',
  });
  assert.deepEqual(badQty, { ok: false, reason: 'INVALID_QUANTITY' });

  const expiredBeforeKnowledge = validateOptionPositionSubmission({
    instrumentId: 'PETR4',
    kind: 'PUT',
    strike: 4800,
    expiration: '2020-01-01T00:00:00.000Z',
    side: 'SHORT',
    quantity: 1,
    source: 'MANUAL',
    knowledgeTime: '2026-01-01T00:00:00.000Z',
  });
  assert.deepEqual(expiredBeforeKnowledge, { ok: false, reason: 'EXPIRED_BEFORE_KNOWLEDGE_TIME' });

  console.log('regras puras de opção (strike/expiration/side): OK');
}

async function createGetListTests(prisma: PrismaClient): Promise<{ id: string; instrumentId: string }> {
  const service = createOptionPositionService(prisma);

  await expectReadModelError(
    service.create({
      instrumentId: 'PETR4',
      kind: 'CALL',
      strike: -5,
      expiration: '2099-01-01T00:00:00.000Z',
      side: 'LONG',
      quantity: 100,
      source: 'MANUAL',
      knowledgeTime: '2026-01-01T00:00:00.000Z',
    }),
    'INVALID_OPTION_POSITION',
    'strike inválido rejeitado pelo service',
  );

  const created = await service.create({
    instrumentId: 'PETR4',
    kind: 'CALL',
    strike: 4800,
    expiration: '2099-01-01T00:00:00.000Z',
    side: 'LONG',
    quantity: 100,
    source: 'MANUAL',
    knowledgeTime: '2026-01-01T00:00:00.000Z',
  });
  assert.ok(created.id.length > 0);
  assert.equal(created.instrumentId, 'PETR4');

  const fetched = await service.getById(created.id);
  assert.equal(fetched.id, created.id);
  await expectReadModelError(service.getById('id-inexistente'), 'OPTION_POSITION_NOT_FOUND', 'getById inexistente');

  const list = await service.listByInstrumentId('PETR4');
  assert.equal(list.length, 1);
  assert.equal(list[0].id, created.id);
  console.log('OptionPosition criar/obter/listar: OK (400 em strike inválido; GET :id e ?instrumentId= refletem o estado)');

  return { id: created.id, instrumentId: 'PETR4' };
}

async function seedMarketBars(prisma: PrismaClient): Promise<{ instrumentVersionId: string; sourceKey: string }> {
  const run = await prisma.ingestionRun.create({
    data: { sourceKey: 'test-source', status: 'SUCCEEDED', startedAt: new Date('2026-01-01T00:00:00.000Z'), completedAt: new Date('2026-01-01T00:05:00.000Z') },
  });

  const instrumentVersion = await prisma.instrumentVersion.create({
    data: {
      symbol: 'PETR4',
      exchange: 'B3',
      currency: 'BRL',
      displayName: 'Petrobras PN',
      assetClass: 'EQUITY',
      status: 'ACTIVE',
      validFrom: new Date('2020-01-01T00:00:00.000Z'),
      validFromBasis: 'SOURCE_EFFECTIVE',
      createdByRunId: run.id,
    },
  });

  const closes = [3000, 3010, 2990, 3050, 3020];
  for (let i = 0; i < closes.length; i++) {
    const openedAt = new Date(`2026-01-0${i + 1}T00:00:00.000Z`);
    const closedAt = new Date(`2026-01-0${i + 2}T00:00:00.000Z`);
    await prisma.versionedMarketBar.create({
      data: {
        instrumentVersionId: instrumentVersion.id,
        sourceKey: 'test-source',
        sourceRecordKey: `bar-${i}`,
        timeframe: '1d',
        openedAt,
        closedAt,
        sourceAvailableAt: closedAt,
        openRaw: BigInt(closes[i]),
        highRaw: BigInt(closes[i] + 10),
        lowRaw: BigInt(closes[i] - 10),
        closeRaw: BigInt(closes[i]),
        priceScalePow: -2,
        volumeRaw: BigInt(1000),
        volumeScalePow: 0,
        volumeSemantics: 'SHARES',
        priceBasis: 'TRADE',
        quality: 'FINAL',
        rawSha256: '0'.repeat(64),
        revisionNumber: 1,
        createdByRunId: run.id,
      },
    });
  }

  return { instrumentVersionId: instrumentVersion.id, sourceKey: 'test-source' };
}

async function replayDeterminismTests(prisma: PrismaClient): Promise<void> {
  const { instrumentVersionId, sourceKey } = await seedMarketBars(prisma);
  const service = createOptionPositionService(prisma);

  const input = {
    instrumentId: 'PETR4',
    instrumentVersionId,
    sourceKey,
    kind: 'CALL' as const,
    strike: 3200,
    expiration: '2099-01-01T00:00:00.000Z',
    decisionTime: '2026-01-06T00:00:00.000Z',
    knowledgeTime: '2026-01-06T00:00:00.000Z',
    windowFrom: '2026-01-01T00:00:00.000Z',
    windowTo: '2026-01-10T00:00:00.000Z',
    timeframe: '1d' as const,
  };

  const first = await service.replay(input);
  const second = await service.replay(input);
  assert.deepEqual(first, second, 'replay(mesma entrada) deve produzir a MESMA saída (determinístico)');
  assert.equal(first.barsUsed, 5, 'todas as 5 barras dentro da janela e visíveis em decisionTime devem ser usadas');
  assert.ok(first.spot > 0, 'spot deve ser derivado da última barra visível');

  // point-in-time: decisionTime anterior à sourceAvailableAt da última barra não pode "ver o futuro".
  const earlier = await service.replay({ ...input, decisionTime: '2026-01-02T12:00:00.000Z', knowledgeTime: '2026-01-02T12:00:00.000Z' });
  assert.ok(earlier.barsUsed < first.barsUsed, 'replay em decisionTime anterior deve enxergar menos barras (nunca o futuro)');

  await expectReadModelError(
    service.replay({ ...input, decisionTime: '2026-01-02T00:00:00.000Z', knowledgeTime: '2026-01-06T00:00:00.000Z' }),
    'INVALID_QUERY',
    'knowledgeTime > decisionTime (CR-9)',
  );

  console.log('replay determinístico point-in-time: OK (mesma entrada -> mesma saída; nunca olha o futuro; CR-9 aplicado)');
}

async function ledgerAppendOnlyTests(prisma: PrismaClient): Promise<void> {
  const service = createSpreadOrderAuditService(prisma);
  const orderId = 'spread-order-ledger-1';

  const created = await service.record({
    orderId,
    action: 'CREATE',
    requestedBy: 'tester',
    payload: { assetId1: 'PETRA276', assetId2: 'PETRB400' },
    policyVersion: 'spread-order-audit/v1',
    decisionTime: '2026-01-01T00:00:00.000Z',
    knowledgeTime: '2026-01-01T00:00:00.000Z',
  });
  assert.equal(created.action, 'CREATE');
  assert.ok(created.auditId.length > 0);

  const cancelled = await service.record({
    orderId,
    action: 'CANCEL',
    requestedBy: 'tester',
    payload: { reason: 'manual cancel' },
    policyVersion: 'spread-order-audit/v1',
    decisionTime: '2026-01-02T00:00:00.000Z',
    knowledgeTime: '2026-01-02T00:00:00.000Z',
  });
  assert.equal(cancelled.action, 'CANCEL');

  const entries = await service.listByOrderId(orderId);
  assert.equal(entries.length, 2, 'ledger deve conter as DUAS entradas (append-only: nada é atualizado/removido)');
  assert.deepEqual(entries.map((e) => e.action), ['CREATE', 'CANCEL'], 'ordem cronológica preservada');

  await expectReadModelError(
    service.record({
      orderId,
      action: 'CREATE',
      requestedBy: 'tester',
      payload: {},
      policyVersion: 'spread-order-audit/v1',
      decisionTime: '2026-01-01T00:00:00.000Z',
      knowledgeTime: '2026-01-02T00:00:00.000Z',
    }),
    'INVALID_QUERY',
    'knowledgeTime > decisionTime no ledger (CR-9)',
  );

  console.log('ledger de auditoria append-only: OK (CREATE/CANCEL registrados, sem update/delete; CR-9 aplicado)');
}

async function main(): Promise<void> {
  migrationAdditivityTests();
  strictBodyRejectsExtraFieldTests();
  await internalErrorSanitizationTests();
  pureRulesTests();

  const prisma = new PrismaClient();
  try {
    await createGetListTests(prisma);
    await replayDeterminismTests(prisma);
    await ledgerAppendOnlyTests(prisma);
  } finally {
    await prisma.$disconnect();
  }
  console.log('Fase 6 — Consolidação (option-position + spread-order-audit): TODOS OS TESTES PASSARAM');
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
