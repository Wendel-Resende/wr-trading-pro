import type { PrismaClient } from '@prisma/client';
import type { ResearchSessionPersistedShape } from '../../../domain/v1/models/research-session';
import { toResearchSession } from './mapping';

export interface ResearchSessionTestOverrides {
  readonly kind?: string;
  readonly status?: string;
  readonly label?: string;
  readonly configJson?: string;
  readonly createdBy?: string;
}

/** Insere uma sessão direto no banco, para testes de repositório. */
export async function insertResearchSessionForTest(
  prisma: PrismaClient,
  overrides: ResearchSessionTestOverrides = {},
): Promise<ResearchSessionPersistedShape> {
  const row = await prisma.researchSession.create({
    data: {
      kind: overrides.kind ?? 'SIGNIFICANCE',
      status: overrides.status ?? 'DRAFT',
      label: overrides.label ?? 'sessão de teste',
      notes: null,
      configJson: overrides.configJson ?? '{}',
      createdBy: overrides.createdBy ?? 'test',
    },
  });
  return toResearchSession(row);
}
