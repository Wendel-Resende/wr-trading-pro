/**
 * Builders de DAG para `agent_run.submit` — espelham exatamente
 * `buildDefaultDag`/`buildCommitteeDag` de `src/components/AgentRunsPanel.tsx`
 * (mesmos nós/edges que `COMMITTEE_DAG` em `scripts/agent-run/agent-run-test.ts`).
 * Divergir aqui quebraria o contrato visual do painel — qualquer node/edge
 * novo deve nascer nos três lugares ao mesmo tempo.
 */
import type { AgentRunDag } from '../../../domain/v1/models/agent-run';

/** DAG simples: INPUT → AGENT → EVIDENCE → SYNTHESIS → OUTPUT. */
export function buildSimpleDag(kind: 'RESEARCH' | 'PROPOSAL'): AgentRunDag {
  const role = kind === 'RESEARCH' ? 'analista-pesquisa' : 'analista-proposta';
  return {
    nodes: [
      { id: 'in', type: 'INPUT' },
      { id: 'agent', type: 'AGENT', role },
      { id: 'evidence', type: 'EVIDENCE' },
      { id: 'synthesis', type: 'SYNTHESIS' },
      { id: 'out', type: 'OUTPUT' },
    ],
    edges: [
      ['in', 'agent'],
      ['agent', 'evidence'],
      ['evidence', 'synthesis'],
      ['synthesis', 'out'],
    ],
  };
}

/** DAG do Comitê: 3 analistas em paralelo → cético rebate → gestor sintetiza. */
export function buildCommitteeDag(): AgentRunDag {
  return {
    nodes: [
      { id: 'in', type: 'INPUT' },
      { id: 'fund', type: 'AGENT', role: 'fundamentalista-cvm', provides: ['parecer'] },
      { id: 'divs', type: 'AGENT', role: 'dividendos', provides: ['parecer'] },
      { id: 'risco', type: 'AGENT', role: 'risco', provides: ['parecer'] },
      {
        id: 'cetico',
        type: 'AGENT',
        role: 'cetico',
        reads: ['fund.parecer', 'divs.parecer', 'risco.parecer'],
        provides: ['parecer'],
      },
      {
        id: 'evidence',
        type: 'EVIDENCE',
        reads: ['fund.parecer', 'divs.parecer', 'risco.parecer', 'cetico.parecer'],
      },
      { id: 'synthesis', type: 'SYNTHESIS', role: 'gestor', provides: ['finding'] },
      { id: 'out', type: 'OUTPUT', reads: ['synthesis.finding'] },
    ],
    edges: [
      ['in', 'fund'],
      ['in', 'divs'],
      ['in', 'risco'],
      ['fund', 'cetico'],
      ['divs', 'cetico'],
      ['risco', 'cetico'],
      ['cetico', 'evidence'],
      ['evidence', 'synthesis'],
      ['synthesis', 'out'],
    ],
  };
}
