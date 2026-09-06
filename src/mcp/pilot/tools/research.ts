/**
 * MCP Piloto — tools `research.*`: o padrão draft→run→session portado do
 * Jesse. Camada FINA de tradução Zod -> `ResearchSessionService`; nenhuma
 * regra de negócio aqui.
 *
 * Todas `privilege: 'free'` — leitura e computação; nenhuma envia ordem.
 *
 * SEGURANÇA: `createdBy` NÃO é argumento de nenhuma tool — é fixado aqui
 * como `'mcp:hermes'`. Mesmo raciocínio do docblock de `trade.ts` sobre
 * `requestedBy`: se viesse do argumento, o agente poderia variar o valor
 * para forjar autoria.
 */
import { z } from 'zod';
import { parseToolArgs, toToolError, type McpToolDefinition, type McpToolResult } from '../../tools/registry-types';
import type { ResearchSessionService } from '../../../application/research-session';
import type { ResearchSessionKind } from '../../../domain/v1/models/research-session';

const MCP_CREATED_BY = 'mcp:hermes';

const CREATE_SHAPE = {
  label: z.string().min(1).max(200),
  notes: z.string().max(4000).nullish(),
  config: z.unknown(),
};

const UPDATE_SHAPE = {
  sessionId: z.string().min(1).max(64),
  label: z.string().min(1).max(200).optional(),
  notes: z.string().max(4000).nullish(),
  config: z.unknown().optional(),
};

const ID_SHAPE = {
  sessionId: z.string().min(1).max(64),
};

const LIST_SHAPE = {
  status: z.enum(['DRAFT', 'RUNNING', 'DONE', 'FAILED', 'CANCELLED']).optional(),
  limit: z.number().int().min(1).max(100).optional(),
  cursor: z.string().min(1).max(64).optional(),
};

const ok = (payload: unknown): McpToolResult => ({
  content: [{ type: 'text' as const, text: JSON.stringify(payload) }],
});

const KIND_DESCRIPTION: Readonly<Record<ResearchSessionKind, string>> = {
  SIGNIFICANCE:
    'teste de significância — mede se o retorno médio da barra seguinte aos sinais poderia vir do acaso, por bootstrap estacionário. Abaixo de 30 observações devolve pValue null em vez de um número. Um p-valor alto não prova que a regra é inútil: prova que esta amostra não sustenta a afirmação de que ela funciona',
  MONTE_CARLO:
    'Monte Carlo de ordem dos trades — mede quanto do drawdown observado é sorte de sequência. No motor da WR retorno total, Sharpe e win rate são invariantes à ordem e vêm em `invariants` sem percentil; só drawdown e Calmar variam, em `pathDependent`',
};

function toolsForKind(
  service: ResearchSessionService,
  kind: ResearchSessionKind,
  prefix: string,
): McpToolDefinition[] {
  return [
    {
      name: `research.${prefix}.create_draft`,
      description: `Cria um rascunho de ${KIND_DESCRIPTION[kind]}. O rascunho não roda nada — use research.${prefix}.run depois de montar a configuração.`,
      privilege: 'free',
      inputSchema: CREATE_SHAPE,
      handler: async (args) => {
        try {
          const parsed = parseToolArgs(CREATE_SHAPE, args);
          return ok(
            await service.createDraft({
              kind,
              label: parsed.label,
              notes: parsed.notes ?? null,
              config: parsed.config,
              // NUNCA vem de `args` — ver docblock do módulo.
              createdBy: MCP_CREATED_BY,
            }),
          );
        } catch (error) {
          return toToolError(error);
        }
      },
    },
    {
      name: `research.${prefix}.update_draft`,
      description: `Atualiza rótulo, notas ou configuração de um rascunho de ${prefix} ainda em DRAFT. Sessão em execução ou já concluída é recusada.`,
      privilege: 'free',
      inputSchema: UPDATE_SHAPE,
      handler: async (args) => {
        try {
          const parsed = parseToolArgs(UPDATE_SHAPE, args);
          return ok(
            await service.updateDraft(parsed.sessionId, {
              ...(parsed.label === undefined ? {} : { label: parsed.label }),
              ...(parsed.notes === undefined ? {} : { notes: parsed.notes ?? null }),
              ...(parsed.config === undefined ? {} : { config: parsed.config }),
            }),
          );
        } catch (error) {
          return toToolError(error);
        }
      },
    },
    {
      name: `research.${prefix}.get`,
      description: `Lê uma sessão de ${prefix} pelo id — status, configuração e, quando concluída, o resultado.`,
      privilege: 'free',
      inputSchema: ID_SHAPE,
      handler: async (args) => {
        try {
          return ok(await service.get(parseToolArgs(ID_SHAPE, args).sessionId));
        } catch (error) {
          return toToolError(error);
        }
      },
    },
    {
      name: `research.${prefix}.list`,
      description: `Lista sessões de ${prefix}, mais recentes primeiro, com filtro opcional por status.`,
      privilege: 'free',
      inputSchema: LIST_SHAPE,
      handler: async (args) => {
        try {
          const parsed = parseToolArgs(LIST_SHAPE, args);
          return ok(
            await service.list({
              kind,
              ...(parsed.status === undefined ? {} : { status: parsed.status }),
              limit: parsed.limit ?? 20,
              ...(parsed.cursor === undefined ? {} : { cursor: parsed.cursor }),
            }),
          );
        } catch (error) {
          return toToolError(error);
        }
      },
    },
    {
      name: `research.${prefix}.run`,
      description: `Executa o rascunho de ${prefix} e persiste o resultado. Roda uma vez só: uma sessão já executada devolve RESEARCH_SESSION_ALREADY_RUNNING.`,
      privilege: 'free',
      inputSchema: ID_SHAPE,
      handler: async (args) => {
        try {
          return ok(await service.run(parseToolArgs(ID_SHAPE, args).sessionId));
        } catch (error) {
          return toToolError(error);
        }
      },
    },
    {
      name: `research.${prefix}.cancel`,
      description: `Cancela uma sessão de ${prefix} em DRAFT ou RUNNING. Idempotente: cancelar de novo não é erro.`,
      privilege: 'free',
      inputSchema: ID_SHAPE,
      handler: async (args) => {
        try {
          return ok(await service.cancel(parseToolArgs(ID_SHAPE, args).sessionId));
        } catch (error) {
          return toToolError(error);
        }
      },
    },
  ];
}

export function buildResearchTools(service: ResearchSessionService): readonly McpToolDefinition[] {
  return Object.freeze([
    ...toolsForKind(service, 'SIGNIFICANCE', 'significance'),
    ...toolsForKind(service, 'MONTE_CARLO', 'monte_carlo'),
  ]);
}
