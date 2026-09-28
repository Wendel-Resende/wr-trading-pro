import assert from 'node:assert/strict';
import { parseAgentOperationJson } from '../../src/lib/server/agent-operation-parser';

function main(): void {
  const fenced = `\`\`\`json
{
  "action": "HOLD",
  "entry_price": 38.35,
  "stop_loss": 37.20,
  "take_profit": 40.10,
  "quantity": 100,
  "risk_score": 0.25,
  "confidence": 0.62,
  "rationale": "Cotação fora do pregão; aguardar confirmação."
}
\`\`\``;

  const parsed = parseAgentOperationJson(fenced);
  assert.equal(parsed.action, 'HOLD');
  assert.equal(parsed.entry_price, 38.35);
  assert.equal(parsed.rationale, 'Cotação fora do pregão; aguardar confirmação.');

  assert.throws(
    () => parseAgentOperationJson('```json\n{"action":"BUY"\n```'),
    /JSON de sugestão inválido/,
    'JSON incompleto não pode virar uma decisão'
  );

  console.log('parser de sugestão do agente: JSON cercado por Markdown aceito; JSON incompleto rejeitado');
}

main();
