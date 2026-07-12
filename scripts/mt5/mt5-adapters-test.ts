import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { DisabledMt5ExecutionBroker, mapInstrument, mapTick, Mt5HistoricalBarsProvider, Mt5InstrumentCatalog, Mt5MarketDataProvider, Mt5PortfolioProvider } from '../../src/adapters/mt5';

type Fn=(x:unknown)=>void;
type ChartCall={symbol:string;timeframe:string;count?:number;range?:Readonly<{from:string;to:string}>};
class Fake {
  listeners=new Map<string,Set<Fn>>();
  state:any={state:'CONNECTED',accountInfo:{login:7,currency:'BRL',balance:-10,equity:-5,marginFree:-2,name:'Demo'}};
  positions:any[]=[];calls:string[]=[];charts:unknown=[];throwSubscribe:string|null=null;throwUnsubscribe=new Set<string>();chartCalls:ChartCall[]=[];
  chartResponder:(call:ChartCall)=>Promise<unknown>=()=>Promise.resolve(this.charts);
  on(event:string,fn:Fn){if(!this.listeners.has(event))this.listeners.set(event,new Set());this.listeners.get(event)!.add(fn);}
  off(event:string,fn:Fn){this.listeners.get(event)?.delete(fn);}
  emit(event:string,value:unknown){for(const fn of [...(this.listeners.get(event)??[])])fn(value);}
  count(event:string){return this.listeners.get(event)?.size??0;}
  getConnectionState(){return this.state;}
  getSymbols(){this.calls.push('symbols');}
  getSymbolInfo(symbol:string){this.calls.push(`info:${symbol}`);}
  subscribeTicks(symbol:string){this.calls.push(`sub:${symbol}`);if(this.throwSubscribe===symbol)throw new Error(`subscribe ${symbol}`);}
  unsubscribeTicks(symbol:string){this.calls.push(`unsub:${symbol}`);if(this.throwUnsubscribe.has(symbol))throw new Error(`unsubscribe ${symbol}`);}
  getChartData(symbol:string,timeframe:string,count?:number,range?:Readonly<{from:string;to:string}>){const call={symbol,timeframe,count,range};this.chartCalls.push(call);return this.chartResponder(call);}
  getPositionsCache(){return this.positions;}
}
const full=(symbol:string,extra:Record<string,unknown>={})=>({name:symbol,description:symbol,path:'BOVESPA\\FUTUROS',currency_profit:'BRL',digits:2,volume_step:.5,trade_mode:4,...extra});
const sleep=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));

async function catalogTests(){
  assert.equal(mapInstrument('WIN'),null);
  assert.equal(mapInstrument({name:'WIN'}),null);
  assert.equal(mapInstrument(full('WIN'))?.assetClass,'future');
  assert.equal(mapInstrument(full('PETR4',{path:'BOVESPA\\A VISTA',trade_mode:0}))?.active,false);
  assert.equal(mapInstrument(full('X',{select:true,visible:true,trade_mode:0}))?.active,false);
  assert.equal(mapInstrument({symbol:'ETF',currency:'BRL',priceScale:100,quantityScale:1,active:true,type:'ETF'})?.assetClass,'fund');
  assert.equal(mapInstrument(full('X',{volume_step:undefined})),null);
  assert.equal(mapInstrument(full('X',{currency_profit:undefined})),null);
  assert.throws(()=>new Mt5InstrumentCatalog(new Fake(),0),/greater than zero/);

  const fake=new Fake(),catalog=new Mt5InstrumentCatalog(fake,30);
  const first=catalog.findInstruments({text:'pet'}),all=catalog.findInstruments();
  assert.equal(fake.calls.filter(x=>x==='symbols').length,1);
  fake.emit('symbols',{symbols:[full('PETR4'),full('WIN')]});
  assert.deepEqual((await first).map(x=>x.symbol),['PETR4']);
  assert.equal((await all).length,2);

  const sameA=catalog.getInstrument('WIN'),sameB=catalog.getInstrument('WIN');
  assert.equal(sameA,sameB);assert.equal(fake.calls.filter(x=>x==='info:WIN').length,1);
  fake.emit('symbolInfo',{name:'OTHER',price_scale:Infinity});
  fake.emit('error',{type:'ERROR',data:{code:'NOT_CONNECTED'}});
  fake.emit('error',{type:'SYMBOL_INFO_ERROR',data:{symbol:'OTHER'}});
  fake.emit('symbolInfo',full('WIN'));
  assert.equal((await sameA)?.symbol,'WIN');assert.equal(fake.count('symbolInfo'),0);assert.equal(fake.count('error'),0);

  const missing=catalog.getInstrument('MISS');
  fake.emit('error',{type:'ERROR',data:{code:'SYMBOL_NOT_FOUND',symbol:'MISS'}});
  assert.equal(await missing,null);

  const operational=catalog.getInstrument('BROKEN');
  fake.emit('error',{type:'ERROR',data:{code:'SYMBOL_INFO_ERROR',symbol:'BROKEN'}});
  await assert.rejects(operational,/failed/);

  const malformed=catalog.getInstrument('BAD');fake.emit('symbolInfo',{name:'BAD'});await assert.rejects(malformed,/Malformed/);
  const listError=new Mt5InstrumentCatalog(fake,20).findInstruments();fake.emit('symbols',{symbols:[],error:'terminal'});await assert.rejects(listError,/failed/);
  const listTimeout=new Mt5InstrumentCatalog(fake,5).findInstruments();await assert.rejects(listTimeout,/timed out/);assert.equal(fake.count('symbols'),0);
}

async function tickTests(){
  const fake=new Fake(),market=new Mt5MarketDataProvider(fake,2),iterable=market.streamTicks({instrumentIds:['WIN']});
  assert.equal(fake.count('tick'),0);assert.equal(fake.calls.filter(x=>x.startsWith('sub:')).length,0);
  const a=iterable[Symbol.asyncIterator](),b=iterable[Symbol.asyncIterator]();assert.equal(fake.count('tick'),2);assert.equal(fake.calls.filter(x=>x==='sub:WIN').length,1);
  fake.emit('tick',{symbol:'WIN',time:1,bid:10,ask:11,last:10.5});assert.equal((await a.next()).value?.last,10.5);assert.equal((await b.next()).value?.last,10.5);
  await a.return?.();assert.equal(fake.calls.filter(x=>x==='unsub:WIN').length,0);await b.return?.();assert.equal(fake.calls.filter(x=>x==='unsub:WIN').length,1);assert.equal(fake.count('tick'),0);

  const aborted=new AbortController();aborted.abort();const closed=market.streamTicks({instrumentIds:['WIN'],signal:aborted.signal})[Symbol.asyncIterator]();assert.equal((await closed.next()).done,true);assert.equal(fake.count('tick'),0);
  const structural={aborted:true,addEventListener(){},removeEventListener(){}} as unknown as AbortSignal;
  assert.equal((await market.streamTicks({instrumentIds:['WIN'],signal:structural})[Symbol.asyncIterator]().next()).done,true);
  assert.throws(()=>market.streamTicks({instrumentIds:['WIN'],signal:{} as AbortSignal}),/AbortSignal/);

  const overflowMarket=new Mt5MarketDataProvider(fake,1),overflow=overflowMarket.streamTicks({instrumentIds:['OVER']})[Symbol.asyncIterator]();
  fake.emit('tick',{symbol:'OVER',time:1,bid:1});fake.emit('tick',{symbol:'OVER',time:2,bid:2});await assert.rejects(overflow.next(),/overflow/);assert.equal(fake.count('tick'),0);

  const broken=new Fake();broken.throwSubscribe='B';assert.throws(()=>new Mt5MarketDataProvider(broken).streamTicks({instrumentIds:['A','B']})[Symbol.asyncIterator](),/subscribe B/);assert.ok(broken.calls.includes('unsub:A'));assert.equal(broken.calls.includes('unsub:B'),false);assert.equal(broken.count('tick'),0);
  const cleanup=new Fake();cleanup.throwUnsubscribe.add('A');const iterator=new Mt5MarketDataProvider(cleanup).streamTicks({instrumentIds:['A','B']})[Symbol.asyncIterator]();await assert.rejects(iterator.return!(),/unsubscribe A/);assert.ok(cleanup.calls.includes('unsub:B'));assert.equal(cleanup.count('tick'),0);
}

async function historicalTests(){
  const fake=new Fake(),provider=new Mt5HistoricalBarsProvider(fake);fake.charts=[
    {time:'2025-01-02T00:00:00Z',open:2,high:3,low:1,close:2,volume:1},
    {time:'2025-01-01T00:00:00+00:00',open:1,high:2,low:.5,close:1.5,tick_volume:2},
    {time:'2024-12-01T00:00:00Z',open:9,high:10,low:8,close:9},
  ];
  const bars=await provider.getBars({instrumentId:'WIN',timeframe:'1m',from:'2025-01-01T00:00:00Z',to:'2025-01-03T00:00:00Z',limit:1});
  assert.equal(bars.length,1);assert.equal(bars[0].open,1);assert.deepEqual(fake.chartCalls[0],{symbol:'WIN',timeframe:'M1',count:10000,range:{from:'2025-01-01T00:00:00.000Z',to:'2025-01-03T00:00:00.000Z'}});
  await assert.rejects(provider.getBars({instrumentId:'WIN',timeframe:'1m',from:'2025-01-01',to:'2025-01-03T00:00:00Z'}),/invalid/);
  await assert.rejects(provider.getBars({instrumentId:'WIN',timeframe:'1m',from:'2025-01-01T00:00:00',to:'2025-01-03T00:00:00Z'}),/invalid/);
  fake.charts=[{time:1_700_000_000,open:1,high:2,low:.5,close:1},{time:1_700_000_000_000,open:2,high:3,low:1,close:2}];
  await assert.rejects(provider.getBars({instrumentId:'WIN',timeframe:'1m',from:'2023-11-14T22:13:20Z',to:'2023-11-14T22:13:20Z'}),/Conflicting/);
  let releaseFirst:(value:unknown)=>void=()=>{};let calls=0;
  fake.chartResponder=()=>{calls+=1;return calls===1?new Promise(resolve=>{releaseFirst=resolve;}):Promise.resolve([]);};
  const range={instrumentId:'WIN',timeframe:'1m' as const,from:'2025-01-01T00:00:00Z',to:'2025-01-03T00:00:00Z'};
  const concurrentA=provider.getBars(range),concurrentB=provider.getBars(range);
  await sleep(0);assert.equal(calls,1);releaseFirst([]);await concurrentA;await concurrentB;assert.equal(calls,2);
  assert.equal(mapTick({symbol:'X',time:'2025-01-01',bid:1}),null);assert.ok(mapTick({symbol:'X',time:1,bid:1}));assert.ok(mapTick({symbol:'X',time:1_700_000_000_000,bid:1}));
}

async function portfolioAndStaticTests(){
  const fake=new Fake();fake.positions=[{symbol:'WIN',type:'BUY',volume:2,priceOpen:100,priceCurrent:101,profit:-2},{symbol:'WDO',side:'short',quantity:1,average_price:5,market_price:4,unrealized_pnl:1}];
  const provider=new Mt5PortfolioProvider(fake,()=>new Date('2025-01-01T00:00:00Z'));const account=(await provider.listAccounts())[0];assert.equal(account.balance,-10);assert.equal(account.availableFunds,-2);assert.equal((await provider.getPortfolio({accountId:'7'})).positions.length,2);
  await assert.rejects(new Mt5PortfolioProvider(fake,()=>new Date(NaN)).listAccounts(),/Invalid MT5 portfolio clock/);
  await assert.rejects(new Mt5PortfolioProvider(fake,()=>{throw new Error('clock');}).listAccounts(),/Invalid MT5 portfolio clock/);
  const disabled=new DisabledMt5ExecutionBroker();assert.equal((await disabled.execute({} as never)).status,'UNKNOWN');
  const adapterDir=join(process.cwd(),'src/adapters/mt5');const forbidden=['send'+'Order','place'+'Order','modify'+'Order','cancel'+'Order','remove'+'Order','close'+'Position','close'+'PositionBy','SEND_'+'ORDER','PLACE_'+'ORDER','MODIFY_'+'ORDER','CANCEL_'+'ORDER','REMOVE_'+'ORDER','CLOSE_'+'POSITION','CLOSE_'+'POSITION_BY','order_'+'send'];
  for(const file of readdirSync(adapterDir)){if(!file.endsWith('.ts'))continue;const body=readFileSync(join(adapterDir,file),'utf8');for(const word of forbidden)assert.equal(body.includes(word),false,`${file} contains forbidden execution token`);}
  const typeSource=readFileSync(join(adapterDir,'types.ts'),'utf8');const clientBody=/interface Mt5ReadClient\s*{([\s\S]*?)\n}/.exec(typeSource)?.[1]??'';for(const word of forbidden)assert.equal(clientBody.includes(word),false,`read client contains ${word}`);
  const methods=[...clientBody.matchAll(/^\s*(\w+)\s*\(/gm)].map(match=>match[1]);
  assert.deepEqual(methods,['getConnectionState','on','off','getSymbols','getSymbolInfo','subscribeTicks','unsubscribeTicks','getChartData','getPositionsCache']);
}

async function main(){await catalogTests();await tickTests();await historicalTests();await portfolioAndStaticTests();await sleep(0);console.log('MT5 adapter tests passed');}
main().catch(error=>{console.error(error);process.exitCode=1});
