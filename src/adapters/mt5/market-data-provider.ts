import type { InstrumentId, MarketDataProvider, MarketDataRequest, Quote, Tick } from '../../domain/v1';
import { mapTick, record, text } from './mapping';
import type { Mt5ReadClient, Mt5Listener } from './types';

type Waiter={resolve:(value:IteratorResult<Tick>)=>void;reject:(error:unknown)=>void};
const abortSignal=(value:unknown):value is AbortSignal=>{
  if(!value||typeof value!=='object')return false;const r=record(value);
  return typeof r?.aborted==='boolean'&&typeof r?.addEventListener==='function'&&typeof r?.removeEventListener==='function';
};
const errorFrom=(errors:unknown[],message:string):Error=>errors.length===1&&errors[0] instanceof Error?errors[0] as Error:new AggregateError(errors,message);

export class Mt5MarketDataProvider implements MarketDataProvider {
  private readonly latest=new Map<string,Quote>(); private readonly refs=new Map<string,number>();
  constructor(private readonly client:Mt5ReadClient,private readonly maxTickBuffer=1024){
    if(!Number.isInteger(maxTickBuffer)||maxTickBuffer<=0)throw new TypeError('maxTickBuffer must be a positive integer');
  }
  async getQuote(id:InstrumentId):Promise<Quote|null>{const symbol=text(id);if(!symbol)throw new TypeError('instrument id is required');const q=this.latest.get(symbol);return q?Object.freeze({...q}):null;}
  streamTicks(request:MarketDataRequest):AsyncIterable<Tick>{
    if(!request||!Array.isArray(request.instrumentIds)||request.instrumentIds.length===0)throw new TypeError('at least one instrument is required');
    const symbols=[...new Set(request.instrumentIds.map(text))]; if(symbols.some(x=>!x))throw new TypeError('instrument ids must be non-empty strings');
    if(request.signal!==undefined&&!abortSignal(request.signal))throw new TypeError('signal must be an AbortSignal');
    const wanted=new Set(symbols as string[]),signal=request.signal;
    return {[Symbol.asyncIterator]:()=>{
      if(signal?.aborted)return {next:async()=>({done:true,value:undefined as never}),return:async()=>({done:true,value:undefined as never}),throw:async(e)=>{throw e;}};
      if(record(this.client.getConnectionState())?.state!=='CONNECTED')throw new Error('MT5 is not connected');
      const queue:Tick[]=[],waiters:Waiter[]=[];let closed=false,terminalError:unknown=null;const acquired:string[]=[];
      const release=():unknown[]=>{const errors:unknown[]=[];this.client.off('tick',onTick);signal?.removeEventListener('abort',onAbort);
        for(const symbol of acquired){const count=this.refs.get(symbol);if(count===undefined)continue;if(count<=1){this.refs.delete(symbol);try{this.client.unsubscribeTicks(symbol);}catch(e){errors.push(e);}}else this.refs.set(symbol,count-1);}acquired.length=0;return errors;};
      const finish=(cause?:unknown):unknown[]=>{if(closed)return[];closed=true;queue.length=0;const errors=release();terminalError=cause??(errors.length?errorFrom(errors,'MT5 tick cleanup failed'):null);
        while(waiters.length){const waiter=waiters.shift()!;if(terminalError)waiter.reject(terminalError);else waiter.resolve({done:true,value:undefined as never});}return errors;};
      const onAbort=()=>{finish();};
      const onTick:Mt5Listener=(raw)=>{if(closed)return;const tick=mapTick(raw);if(!tick||!wanted.has(tick.instrumentId))return;
        const quote=Object.freeze({instrumentId:tick.instrumentId,observedAt:tick.observedAt,...(tick.bid!==undefined?{bid:tick.bid}:{}),...(tick.ask!==undefined?{ask:tick.ask}:{}),...(tick.last!==undefined?{last:tick.last}:{})});this.latest.set(tick.instrumentId,quote);
        const waiter=waiters.shift();if(waiter){waiter.resolve({done:false,value:tick});return;}if(queue.length>=this.maxTickBuffer){finish(new Error('MT5 tick buffer overflow'));return;}queue.push(tick);};
      this.client.on('tick',onTick);
      try{for(const symbol of wanted){
        const count=this.refs.get(symbol)??0;
        if(count===0)this.client.subscribeTicks(symbol);
        this.refs.set(symbol,count+1);
        acquired.push(symbol);
      }signal?.addEventListener('abort',onAbort,{once:true});if(signal?.aborted)finish();}
      catch(e){const cleanupErrors=finish(e);if(cleanupErrors.length)throw errorFrom([e,...cleanupErrors],'MT5 tick subscription failed and cleanup failed');throw e;}
      return {next:()=>{if(queue.length)return Promise.resolve({done:false,value:queue.shift()!});if(closed)return terminalError?Promise.reject(terminalError):Promise.resolve({done:true,value:undefined as never});return new Promise<IteratorResult<Tick>>((resolve,reject)=>waiters.push({resolve,reject}));},
        return:async()=>{const errors=finish();if(errors.length)throw errorFrom(errors,'MT5 tick cleanup failed');return {done:true,value:undefined as never};},
        throw:async(e)=>{const errors=finish(e);if(errors.length)throw errorFrom([e,...errors],'MT5 tick cleanup failed');throw e;}};
    }};
  }
}
