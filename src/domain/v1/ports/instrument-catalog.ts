import type { Instrument, InstrumentId, InstrumentQuery } from '../models';

export interface InstrumentCatalog {
  getInstrument(id: InstrumentId): Promise<Instrument | null>;
  findInstruments(query?: InstrumentQuery): Promise<readonly Instrument[]>;
}
