import type { HistoricalBarsProvider, HistoricalBarsRequest, MarketBar } from '../../domain/v1';
import { parseInstant } from '../../domain/v1/workflow/time';
import { mapBar, text, TIMEFRAMES } from './mapping';
import type { Mt5ReadClient } from './types';

const sameBar=(a:MarketBar,b:MarketBar):boolean=>a.instrumentId===b.instrumentId&&a.timeframe===b.timeframe&&a.open===b.open&&a.high===b.high&&a.low===b.low&&a.close===b.close&&a.volume===b.volume;
export class Mt5HistoricalBarsProvider implements HistoricalBarsProvider {
  private readonly lanes=new Map<string,Promise<void>>();
  constructor(private readonly client:Mt5ReadClient){}
  async getBars(request:HistoricalBarsRequest):Promise<readonly MarketBar[]>{
    const symbol=text(request?.instrumentId),timeframe=request?.timeframe,mt5Timeframe=timeframe&&TIMEFRAMES[timeframe];
    const fromInstant=typeof request?.from==='string'?parseInstant(request.from):null,toInstant=typeof request?.to==='string'?parseInstant(request.to):null;
    if(!symbol||!mt5Timeframe||!fromInstant||!toInstant||fromInstant.milliseconds>toInstant.milliseconds)throw new TypeError('invalid historical bars request');
    if(request.limit!==undefined&&(!Number.isInteger(request.limit)||request.limit<1))throw new TypeError('limit must be a positive integer');
    const from=new Date(fromInstant.milliseconds).toISOString(),to=new Date(toInstant.milliseconds).toISOString();
    const laneKey=`${symbol}\u0000${mt5Timeframe}`;
    const predecessor=this.lanes.get(laneKey)??Promise.resolve();
    const operation=predecessor.catch(()=>undefined).then(async()=>{
    const raw=await this.client.getChartData(symbol,mt5Timeframe,10_000,{from,to});if(!Array.isArray(raw))throw new Error('Malformed MT5 chart response');
    const mapped=raw.map(item=>mapBar(item,symbol,timeframe));if(mapped.some(x=>x===null))throw new Error('Malformed MT5 candle');
    const byTime=new Map<string,MarketBar>();for(const bar of mapped as MarketBar[]){const at=Date.parse(bar.openedAt);if(at<fromInstant.milliseconds||at>toInstant.milliseconds)continue;const prior=byTime.get(bar.openedAt);if(prior&&!sameBar(prior,bar))throw new Error(`Conflicting MT5 candles at ${bar.openedAt}`);byTime.set(bar.openedAt,bar);}
    const result=[...byTime.values()].sort((a,b)=>Date.parse(a.openedAt)-Date.parse(b.openedAt));
    return Object.freeze(request.limit===undefined?result:result.slice(0,request.limit));
    });
    let tail:Promise<void>;
    tail=operation.then(()=>undefined,()=>undefined).finally(()=>{if(this.lanes.get(laneKey)===tail)this.lanes.delete(laneKey);});
    this.lanes.set(laneKey,tail);
    return operation;
  }
}
