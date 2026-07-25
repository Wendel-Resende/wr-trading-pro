import type { PrismaClient } from '@prisma/client';
import type {
  DirectionalModelStatus,
  DirectionalModelVersion,
  DirectionalModelVersionSubmission,
  DirectionalPrediction,
  DirectionalPredictionSubmission,
} from '../../../domain/v1/models/ml-directional';
import type { DirectionalRepository } from '../../../domain/v1/ports/ml-directional-repository';
import { toDirectionalModelVersion, toDirectionalPrediction } from './mapping';
import {
  DirectionalModelVersionSubmissionSchema,
  DirectionalPredictionSubmissionSchema,
} from './schemas';

const MAX_LIMIT = 200;

export class PrismaDirectionalRepository implements DirectionalRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async createModelVersion(submission: DirectionalModelVersionSubmission): Promise<DirectionalModelVersion> {
    const parsed = DirectionalModelVersionSubmissionSchema.parse(submission);
    const row = await this.prisma.directionalModelVersion.create({
      data: {
        modelVersion: parsed.modelVersion,
        researchRunId: parsed.researchRunId,
        metrics: JSON.stringify(parsed.metrics),
        artifactPath: parsed.artifactPath,
        status: parsed.status,
        // Lista vazia é gravada como NULL (e não `"[]"`) para que "sem falha
        // de gate" tenha uma representação única no banco.
        gateFailures: parsed.gateFailures.length > 0 ? JSON.stringify(parsed.gateFailures) : null,
      },
    });
    return toDirectionalModelVersion(row);
  }

  async findModelVersionById(modelVersion: string): Promise<DirectionalModelVersion | null> {
    const row = await this.prisma.directionalModelVersion.findUnique({ where: { modelVersion } });
    return row ? toDirectionalModelVersion(row) : null;
  }

  async listModelVersions(params: {
    readonly status?: DirectionalModelStatus;
    readonly limit: number;
    readonly cursor?: string;
  }): Promise<readonly DirectionalModelVersion[]> {
    const take = Math.min(Math.max(params.limit, 1), MAX_LIMIT);
    const rows = await this.prisma.directionalModelVersion.findMany({
      where: params.status ? { status: params.status } : undefined,
      // Desempate por `modelVersion` para que a paginação por cursor seja
      // determinística mesmo com dois registros no mesmo milissegundo.
      orderBy: [{ createdAt: 'desc' }, { modelVersion: 'desc' }],
      take,
      ...(params.cursor ? { cursor: { modelVersion: params.cursor }, skip: 1 } : {}),
    });
    return Object.freeze(rows.map(toDirectionalModelVersion));
  }

  async supersedeOthers(keepModelVersion: string): Promise<number> {
    const result = await this.prisma.directionalModelVersion.updateMany({
      // FAILED nunca é tocado: reprovado no gate permanece reprovado, para
      // que a auditoria mostre o que foi tentado e por quê.
      where: { status: 'ACTIVE', modelVersion: { not: keepModelVersion } },
      data: { status: 'SUPERSEDED' },
    });
    return result.count;
  }

  async savePredictions(submissions: readonly DirectionalPredictionSubmission[]): Promise<number> {
    if (submissions.length === 0) return 0;
    const parsed = submissions.map((s) => DirectionalPredictionSubmissionSchema.parse(s));

    // Idempotência pela única (modelVersion, cdCvm, generatedAt): reenviar o
    // MESMO lote não duplica linha nem estoura erro. Usa `upsert` em vez de
    // `createMany({ skipDuplicates })` porque o conector SQLite do Prisma não
    // suporta `skipDuplicates`. Tudo numa transação: o lote de uma geração
    // entra inteiro ou não entra — nunca meia previsão visível na UI.
    await this.prisma.$transaction(
      parsed.map((p) => {
        const data = {
          modelVersion: p.modelVersion,
          cdCvm: p.cdCvm,
          ticker: p.ticker,
          signal: p.signal,
          confidence: p.confidence,
          prob: p.prob,
          knowledgeDate: new Date(p.knowledgeDate),
          topFeatures: JSON.stringify(p.topFeatures),
          universeDigest: p.universeDigest,
          generatedAt: new Date(p.generatedAt),
        };
        return this.prisma.directionalPrediction.upsert({
          where: {
            modelVersion_cdCvm_generatedAt: {
              modelVersion: p.modelVersion,
              cdCvm: p.cdCvm,
              generatedAt: data.generatedAt,
            },
          },
          create: data,
          update: {},
        });
      }),
    );
    return parsed.length;
  }

  async listLatestPredictions(modelVersion: string): Promise<readonly DirectionalPrediction[]> {
    const newest = await this.prisma.directionalPrediction.findFirst({
      where: { modelVersion },
      orderBy: { generatedAt: 'desc' },
      select: { generatedAt: true },
    });
    if (!newest) return Object.freeze([]);

    const rows = await this.prisma.directionalPrediction.findMany({
      where: { modelVersion, generatedAt: newest.generatedAt },
      orderBy: [{ confidence: 'desc' }, { ticker: 'asc' }],
    });
    return Object.freeze(rows.map(toDirectionalPrediction));
  }
}
