import type { KnowledgeView } from '../models/ingestion';
import type { InstrumentVersion } from '../models/instrument-version';

/**
 * Bitemporal read view: `knowledgeTime` selects which facts the caller
 * is allowed to see (system time); `asOf`, when present, additionally
 * restricts to the version whose business-time interval
 * [validFrom, validTo) contains that instant.
 *
 * Implementations MUST derive each row's knowledge-time-visible
 * `validTo` independently of the row's stored `closedByRun`: if the run
 * that closed the interval completed AFTER `knowledgeTime` (or has not
 * completed), the interval MUST be reported as still open (`validTo`
 * null) for this view, even though a later run has since closed it.
 * A later closedByRun must never leak a close into an earlier
 * knowledge-time view.
 */
export interface InstrumentAsOfView extends KnowledgeView {
  readonly asOf?: string;
}

export interface InstrumentRepository {
  /** All knowledge-visible versions for (symbol, exchange), optionally narrowed to the one covering `asOf`. */
  findInstrumentVersions(
    symbol: string,
    exchange: string,
    view: InstrumentAsOfView,
  ): Promise<readonly InstrumentVersion[]>;
}
