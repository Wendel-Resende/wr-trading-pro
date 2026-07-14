export interface SignalReadModelV1 {
  readonly signalId: string;
  readonly modelVersionId: string;
  readonly instrumentId: string;
  readonly barTime: string;
  readonly direction: string;
  readonly score: number | null;
  readonly knowledgeTime: string;
  readonly createdAt: string;
}
