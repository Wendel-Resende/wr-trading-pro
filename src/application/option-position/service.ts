import type { OptionPosition, OptionReplayResult } from '../../domain/v1/models/option-position';
import { replayOptionPosition, validateOptionPositionSubmission } from '../../domain/v1/models/option-position';
import type { Timeframe } from '../../domain/v1/models/market-bar';
import type { OptionPositionRepository } from '../../domain/v1/ports/option-repository';
import type { MarketBarRepository } from '../../domain/v1/ports/market-bar-repository';
import { ReadModelError } from '../read-models-v1/errors';

export interface OptionPositionServicePorts {
  readonly optionPositionRepository: OptionPositionRepository;
  readonly marketBarRepository: MarketBarRepository;
}

export interface CreateOptionPositionInputV1 {
  readonly instrumentId: string;
  readonly kind: 'CALL' | 'PUT';
  readonly strike: number;
  readonly expiration: string;
  readonly side: 'LONG' | 'SHORT';
  readonly quantity: number;
  readonly source: 'MT5' | 'MANUAL' | 'REPLAY';
  readonly knowledgeTime: string;
}

export interface ReplayOptionPositionInputV1 {
  readonly instrumentId: string;
  readonly instrumentVersionId: string;
  readonly sourceKey: string;
  readonly kind: 'CALL' | 'PUT';
  readonly strike: number;
  readonly expiration: string;
  readonly decisionTime: string;
  readonly knowledgeTime: string;
  readonly windowFrom: string;
  readonly windowTo: string;
  readonly timeframe: Timeframe;
}

/**
 * Application service for governed `OptionPosition` persistence +
 * point-in-time replay (Fase 6 — Consolidação). Depends only on the
 * injected ports — never calls `mt5Service`, a Python API, or
 * `ExecutionBroker`. `replay` never mutates state; it only reads
 * `MarketBar` with `knowledgeTime <= decisionTime` (CR-9) and computes a
 * pure result.
 */
export class OptionPositionService {
  constructor(private readonly ports: OptionPositionServicePorts) {}

  async create(input: CreateOptionPositionInputV1): Promise<OptionPosition> {
    const validation = validateOptionPositionSubmission(input);
    if (!validation.ok) {
      throw new ReadModelError('INVALID_OPTION_POSITION', `submissão inválida: ${validation.reason}`);
    }
    return this.ports.optionPositionRepository.save(input);
  }

  async getById(id: string): Promise<OptionPosition> {
    const position = await this.ports.optionPositionRepository.findById(id);
    if (!position) throw new ReadModelError('OPTION_POSITION_NOT_FOUND', 'OptionPosition não encontrada');
    return position;
  }

  async listByInstrumentId(instrumentId: string): Promise<readonly OptionPosition[]> {
    return this.ports.optionPositionRepository.findByInstrumentId(instrumentId);
  }

  async replay(input: ReplayOptionPositionInputV1): Promise<OptionReplayResult> {
    if (new Date(input.knowledgeTime).getTime() > new Date(input.decisionTime).getTime()) {
      throw new ReadModelError('INVALID_QUERY', 'knowledgeTime não pode exceder decisionTime (CR-9)');
    }

    const bars = await this.ports.marketBarRepository.findBars(
      input.instrumentVersionId,
      input.sourceKey,
      input.timeframe,
      input.windowFrom,
      input.windowTo,
      { decisionTime: input.decisionTime, knowledgeTime: input.knowledgeTime },
    );

    return replayOptionPosition(
      { instrumentId: input.instrumentId, kind: input.kind, strike: input.strike, expiration: input.expiration },
      bars.map((bar) => ({ openedAt: bar.openedAt, closeRaw: bar.closeRaw, priceScalePow: bar.priceScalePow })),
      input.decisionTime,
      input.knowledgeTime,
    );
  }
}
