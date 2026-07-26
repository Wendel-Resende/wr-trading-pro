import type {
  DirectionalMetrics,
  DirectionalQuantileBucket,
} from '../../domain/v1/models/ml-directional';

/**
 * Item D — economia líquida do fator.
 *
 * Substitui, para um modelo de RANKING, o papel que o `BacktestRun` cumpria no
 * motor híbrido: provar que a vantagem sobrevive aos custos. O backtest por
 * instrumento (`BacktestRunService.runGoverned`) foi desenhado para sequências
 * de trades BUY/HOLD com horizonte de 10 pregões — não é a forma de sinal deste
 * modelo, que ordena a seção transversal e mantém posição por um trimestre
 * inteiro. Forçá-lo aqui produziria um número correto para a pergunta errada.
 *
 * Fecha também um buraco real: até 2026-07-25 o `BacktestCostProfile` era
 * obrigatório para treinar, validado e gravado na proveniência — e não
 * alimentava cálculo nenhum.
 */

export interface DirectionalCostInputs {
  readonly emolumentsPct: number;
  readonly spreadBps: number;
  readonly slippageBps: number;
}

/**
 * Custo de ida-e-volta de uma posição, em fração do notional.
 *
 * Cada trimestre o quintil é reconstruído do zero: entra uma cesta, sai a
 * anterior. Isso é uma ida e uma volta por posição por período — spread,
 * slippage e emolumentos contam DUAS vezes. Corretagem fixa fica de fora por
 * ser proporcional ao número de ordens, não ao notional, e depender do tamanho
 * da carteira, que o modelo não conhece; declarado aqui para que a omissão
 * seja deliberada e visível, não um esquecimento.
 */
export function roundTripCost(costs: DirectionalCostInputs): number {
  const porPerna = costs.spreadBps / 10_000 + costs.slippageBps / 10_000 + costs.emolumentsPct;
  return 2 * porPerna;
}

function netBucket(bucket: DirectionalQuantileBucket, custo: number): DirectionalQuantileBucket {
  return { ...bucket, meanExcess: bucket.meanExcess - custo };
}

/**
 * Acrescenta a visão LÍQUIDA às métricas brutas do walk-forward.
 *
 * O excesso bruto por quintil já é relativo aos pares, então o custo é o do
 * lado que se opera: comprar o quintil superior custa uma ida-e-volta por
 * trimestre. O spread topo-fundo, por envolver duas pontas, custa duas.
 *
 * As métricas brutas são preservadas lado a lado — a diferença entre bruto e
 * líquido é a informação, e escondê-la deixaria o número parecendo melhor do
 * que é.
 */
export function withNetEconomics(
  metrics: DirectionalMetrics,
  costs: DirectionalCostInputs,
): DirectionalMetrics {
  const custo = roundTripCost(costs);
  const buckets = metrics.quantileExcess;

  const netQuantileExcess = buckets ? buckets.map((b) => netBucket(b, custo)) : undefined;
  const netTopBottomSpread =
    metrics.topBottomSpread === null || metrics.topBottomSpread === undefined
      ? metrics.topBottomSpread
      : metrics.topBottomSpread - 2 * custo;

  return {
    ...metrics,
    roundTripCost: custo,
    netQuantileExcess,
    netTopBottomSpread,
  };
}
