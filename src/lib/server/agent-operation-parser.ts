export type AgentOperationJson = {
  action: 'BUY' | 'SELL' | 'HOLD';
  entry_price: number;
  stop_loss: number;
  take_profit: number;
  quantity: number;
  risk_score: number;
  confidence: number;
  rationale: string;
};

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * Extrai exclusivamente o objeto JSON de uma resposta de LLM. Modelos locais
 * frequentemente obedecem ao JSON solicitado, mas ainda o cercam com ```json.
 * A validação mantém a rota fail-closed para resposta truncada ou sem schema.
 */
export function parseAgentOperationJson(raw: string): AgentOperationJson {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)?.[1]?.trim();
  const objectStart = trimmed.indexOf('{');
  const objectEnd = trimmed.lastIndexOf('}');
  const objectSlice = objectStart >= 0 && objectEnd > objectStart ? trimmed.slice(objectStart, objectEnd + 1) : undefined;
  const candidates = [fenced, objectSlice, trimmed].filter((value, index, values): value is string =>
    typeof value === 'string' && value.length > 0 && values.indexOf(value) === index
  );

  let parsed: unknown;
  for (const candidate of candidates) {
    try {
      parsed = JSON.parse(candidate);
      break;
    } catch {
      // Tenta a próxima forma canônica, sem reparar ou inventar conteúdo.
    }
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('JSON de sugestão inválido ou incompleto');
  }

  const value = parsed as Record<string, unknown>;
  if (value.action !== 'BUY' && value.action !== 'SELL' && value.action !== 'HOLD') {
    throw new Error('JSON de sugestão inválido: action deve ser BUY, SELL ou HOLD');
  }

  const numericFields = ['entry_price', 'stop_loss', 'take_profit', 'quantity', 'risk_score', 'confidence'] as const;
  for (const field of numericFields) {
    if (!isFiniteNumber(value[field])) {
      throw new Error(`JSON de sugestão inválido: ${field} deve ser numérico`);
    }
  }
  const entryPrice = value.entry_price as number;
  const stopLoss = value.stop_loss as number;
  const takeProfit = value.take_profit as number;
  const quantity = value.quantity as number;
  const riskScore = value.risk_score as number;
  const confidence = value.confidence as number;
  if (entryPrice < 0 || stopLoss < 0 || takeProfit < 0 || quantity < 0) {
    throw new Error('JSON de sugestão inválido: preços e quantidade não podem ser negativos');
  }
  if (riskScore < 0 || riskScore > 1 || confidence < 0 || confidence > 1) {
    throw new Error('JSON de sugestão inválido: risco e confiança devem estar entre 0 e 1');
  }
  if (typeof value.rationale !== 'string' || value.rationale.trim().length === 0) {
    throw new Error('JSON de sugestão inválido: rationale ausente');
  }

  return {
    action: value.action,
    entry_price: entryPrice,
    stop_loss: stopLoss,
    take_profit: takeProfit,
    quantity,
    risk_score: riskScore,
    confidence,
    rationale: value.rationale.trim(),
  };
}
