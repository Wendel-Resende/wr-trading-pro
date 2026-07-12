import type { Instrument, InstrumentCatalog, InstrumentId, InstrumentQuery } from '../../domain/v1';
import { mapInstrument, pick, record, text } from './mapping';
import type { Mt5ReadClient } from './types';

const connected = (client: Mt5ReadClient): boolean => record(client.getConnectionState())?.state === 'CONNECTED';
const operationError = (raw: unknown, operation: 'SYMBOLS'|'SYMBOL_INFO', symbol?: string): string|null => {
  const outer=record(raw); const body=record(outer?.data) ?? outer; if(!outer||!body)return null;
  const identifiers=[text(outer.type),text(outer.code),text(body.type),text(body.code)].filter((x):x is string=>!!x).map(x=>x.toUpperCase());
  const identified=operation==='SYMBOL_INFO'
    ? identifiers.some(x=>/(^|_)SYMBOL_INFO(_|$)/.test(x))
    : identifiers.some(x=>/(^|_)(GET_)?SYMBOLS(_|$)/.test(x)) && !identifiers.some(x=>x.includes('SYMBOL_INFO'));
  const notFound=operation==='SYMBOL_INFO' && identifiers.includes('SYMBOL_NOT_FOUND');
  if(!identified && !notFound) return null;
  const target=text(pick(body,'symbol','target')) ?? text(pick(outer,'symbol','target'));
  const correlated=symbol===undefined ? target===null : target===symbol;
  return correlated ? (notFound ? 'SYMBOL_NOT_FOUND' : 'OPERATION_ERROR') : null;
};
const symbolOf=(raw:unknown):string|null=>{const r=record(raw);return r?text(pick(r,'symbol','name')):null;};

export class Mt5InstrumentCatalog implements InstrumentCatalog {
  private listRequest: Promise<readonly Instrument[]> | null=null;
  private readonly symbolRequests=new Map<string,Promise<Instrument|null>>();
  constructor(private readonly client: Mt5ReadClient, private readonly timeoutMs=5_000) {
    if(!Number.isFinite(timeoutMs)||timeoutMs<=0)throw new TypeError('timeoutMs must be greater than zero');
  }
  private requestList(): Promise<readonly Instrument[]> {
    if(this.listRequest)return this.listRequest;
    const request=new Promise<readonly Instrument[]>((resolve,reject)=>{
      if(!connected(this.client)){reject(new Error('MT5 is not connected'));return;}
      let timer: ReturnType<typeof setTimeout>|undefined;
      const cleanup=()=>{if(timer)clearTimeout(timer);this.client.off('symbols',onSymbols);this.client.off('error',onError);};
      const fail=(e:Error)=>{cleanup();reject(e);};
      const onSymbols=(raw:unknown)=>{const body=record(raw); const payload=record(body?.data)??body;
        if(payload && text(payload.error)){fail(new Error('MT5 symbols request failed'));return;}
        const list=Array.isArray(raw)?raw:Array.isArray(payload?.symbols)?payload.symbols:null;
        if(!list){fail(new Error('Malformed MT5 symbols response'));return;} const mapped=list.map(mapInstrument); if(mapped.some(x=>x===null)){fail(new Error('Malformed MT5 symbol entry'));return;}
        cleanup();resolve(Object.freeze(mapped as Instrument[]));};
      const onError=(raw:unknown)=>{if(operationError(raw,'SYMBOLS'))fail(new Error('MT5 symbols request failed'));};
      this.client.on('symbols',onSymbols);this.client.on('error',onError);timer=setTimeout(()=>fail(new Error('MT5 symbols request timed out')),this.timeoutMs);
      try{this.client.getSymbols();}catch(e){fail(e instanceof Error?e:new Error('MT5 symbols request failed'));}
    });
    let shared:Promise<readonly Instrument[]>;
    shared=request.finally(()=>{if(this.listRequest===shared)this.listRequest=null;}); this.listRequest=shared; return shared;
  }
  async findInstruments(query: InstrumentQuery={}): Promise<readonly Instrument[]> {
    if(query.limit!==undefined&&(!Number.isInteger(query.limit)||query.limit<1))throw new TypeError('query.limit must be a positive integer');
    const textQuery=query.text?.trim().toLocaleLowerCase(); let values=[...await this.requestList()];
    if(textQuery)values=values.filter(x=>x.symbol.toLocaleLowerCase().includes(textQuery)||x.displayName.toLocaleLowerCase().includes(textQuery));
    if(query.assetClass)values=values.filter(x=>x.assetClass===query.assetClass); if(query.active!==undefined)values=values.filter(x=>x.active===query.active);
    return Object.freeze(query.limit===undefined?values:values.slice(0,query.limit));
  }
  getInstrument(id: InstrumentId): Promise<Instrument|null> {
    const symbol=text(id); if(!symbol)throw new TypeError('instrument id is required');
    const pending=this.symbolRequests.get(symbol);if(pending)return pending;
    if(!connected(this.client))return Promise.reject(new Error('MT5 is not connected'));
    const request=new Promise<Instrument|null>((resolve,reject)=>{let timer:ReturnType<typeof setTimeout>|undefined;
      const cleanup=()=>{if(timer)clearTimeout(timer);this.client.off('symbolInfo',onInfo);this.client.off('error',onError);}; const fail=(e:Error)=>{cleanup();reject(e);};
      const onInfo=(raw:unknown)=>{const rawSymbol=symbolOf(raw);if(rawSymbol!==symbol)return;const mapped=mapInstrument(raw);if(!mapped){fail(new Error('Malformed MT5 symbol info'));return;}cleanup();resolve(mapped);};
      const onError=(raw:unknown)=>{const kind=operationError(raw,'SYMBOL_INFO',symbol);if(kind==='SYMBOL_NOT_FOUND'){cleanup();resolve(null);}else if(kind){fail(new Error('MT5 symbol info request failed'));}};
      this.client.on('symbolInfo',onInfo);this.client.on('error',onError);timer=setTimeout(()=>fail(new Error('MT5 symbol info request timed out')),this.timeoutMs);
      try{this.client.getSymbolInfo(symbol);}catch(e){fail(e instanceof Error?e:new Error('MT5 symbol info request failed'));}
    });
    let shared:Promise<Instrument|null>;shared=request.finally(()=>{if(this.symbolRequests.get(symbol)===shared)this.symbolRequests.delete(symbol);});this.symbolRequests.set(symbol,shared);return shared;
  }
}
