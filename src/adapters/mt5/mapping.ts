import type { Account, AssetClass, Instrument, MarketBar, Position, Tick, Timeframe } from '../../domain/v1';
import { parseInstant } from '../../domain/v1/workflow/time';

export const record = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
export const pick = (r: Record<string, unknown>, ...keys: string[]): unknown => keys.map(k => r[k]).find(v => v !== undefined);
export const text = (value: unknown): string | null => typeof value === 'string' && value.trim() ? value.trim() : null;
export const finite = (value: unknown): number | null => typeof value === 'number' && Number.isFinite(value) ? value : null;
const nonnegative = (value: unknown): number | null => { const n = finite(value); return n !== null && n >= 0 ? n : null; };
const positive = (value: unknown): number | null => { const n = finite(value); return n !== null && n > 0 ? n : null; };
export const instant = (value: unknown): string | null => {
  if (value instanceof Date) return Number.isFinite(value.valueOf()) ? value.toISOString() : null;
  if (typeof value === 'number' && Number.isFinite(value)) {
    const date = new Date(Math.abs(value) < 1e12 ? value * 1000 : value);
    return Number.isFinite(date.valueOf()) ? date.toISOString() : null;
  }
  if (typeof value !== 'string') return null;
  const parsed = parseInstant(value);
  return parsed ? new Date(parsed.milliseconds).toISOString() : null;
};

export const inferAssetClass = (...raw: unknown[]): AssetClass => {
  const value = raw.map(text).filter((x): x is string => !!x).join(' ').toUpperCase();
  if (!value) return 'other';
  if (/OP(COES|ÇÕES)|OPTION/.test(value)) return 'option';
  if (/FUTUR|FUTURES?/.test(value)) return 'future';
  if (/\bETF\b|\bFUND\b|FUNDO/.test(value)) return 'fund';
  if (/A VISTA|STOCK|EQUITY|SHARE/.test(value)) return 'equity';
  if (/FOREX|CURRENCY|\bFX\b/.test(value)) return 'currency';
  if (/FIXED.INCOME|BOND|RENDA FIXA/.test(value)) return 'fixed-income';
  if (/INDEX|INDICE|ÍNDICE/.test(value)) return 'index';
  return 'other';
};

export const mapInstrument = (raw: unknown): Instrument | null => {
  const r = record(raw); if (!r) return null;
  const symbol = text(pick(r, 'symbol', 'name'));
  const currency = text(pick(r, 'currency', 'currencyProfit', 'currency_profit', 'currencyBase', 'currency_base', 'quote'));
  if (!symbol || !currency) return null;
  const priceScaleValue = pick(r, 'priceScale', 'price_scale');
  const quantityScaleValue = pick(r, 'quantityScale', 'quantity_scale');
  const digitsValue = pick(r, 'digits', 'price_digits');
  const volumeStepValue = pick(r, 'volumeStep', 'volume_step');
  let priceScale = positive(priceScaleValue), quantityScale = positive(quantityScaleValue);
  if (priceScaleValue !== undefined && priceScale === null || quantityScaleValue !== undefined && quantityScale === null) return null;
  if (priceScale === null) {
    const digits = nonnegative(digitsValue);
    if (digits === null || !Number.isInteger(digits) || digits > 12) return null;
    priceScale = 10 ** digits;
  }
  if (quantityScale === null) {
    const step = positive(volumeStepValue);
    if (step === null) return null;
    quantityScale = 1 / step;
  }
  if (!Number.isFinite(priceScale) || !Number.isFinite(quantityScale)) return null;
  const activeValue = pick(r, 'active', 'isActive', 'is_active');
  const tradeModeValue = pick(r, 'tradeMode', 'trade_mode');
  let active: boolean;
  if (activeValue !== undefined) { if (typeof activeValue !== 'boolean') return null; active = activeValue; }
  else { const mode = finite(tradeModeValue); if (mode === null || !Number.isInteger(mode)) return null; active = mode !== 0; }
  const path = text(r.path), exchange = text(r.exchange) ?? path;
  return Object.freeze({ id: symbol, symbol, displayName: text(pick(r, 'displayName','display_name','description')) ?? symbol,
    assetClass: inferAssetClass(pick(r, 'assetClass','asset_class','type'), pick(r,'description','displayName','display_name'), path), currency,
    ...(exchange ? { exchange } : {}), priceScale, quantityScale, active });
};

export const mapTick = (raw: unknown): Tick | null => {
  const r = record(raw); if (!r) return null;
  const symbol = text(pick(r,'symbol','name')); const observedAt = instant(pick(r,'observedAt','observed_at','time','timestamp'));
  if (!symbol || !observedAt) return null;
  const values = { bid: positive(r.bid), ask: positive(r.ask), last: positive(r.last), quantity: nonnegative(pick(r,'quantity','volume')), sequence: nonnegative(pick(r,'sequence','time_msc')) };
  if (values.bid === null && values.ask === null && values.last === null) return null;
  if (values.bid !== null && values.ask !== null && values.bid > values.ask) return null;
  return Object.freeze({ instrumentId: symbol, observedAt, ...(values.bid !== null?{bid:values.bid}:{}), ...(values.ask !== null?{ask:values.ask}:{}),
    ...(values.last !== null?{last:values.last}:{}), ...(values.quantity !== null?{quantity:values.quantity}:{}), ...(values.sequence !== null?{sequence:values.sequence}:{}) });
};

export const TIMEFRAMES: Readonly<Record<Timeframe,string>> = Object.freeze({ '1m':'M1','5m':'M5','15m':'M15','30m':'M30','1h':'H1','4h':'H4','1d':'D1','1w':'W1' });
export const mapBar = (raw: unknown, instrumentId: string, timeframe: Timeframe): MarketBar | null => {
  const r=record(raw); if(!r) return null; const openedAt=instant(pick(r,'openedAt','opened_at','time','timestamp'));
  const open=positive(r.open), high=positive(r.high), low=positive(r.low), close=positive(r.close); const volume=nonnegative(pick(r,'volume','tick_volume'));
  if(!openedAt||open===null||high===null||low===null||close===null||high<Math.max(open,close,low)||low>Math.min(open,close,high)) return null;
  if (pick(r,'volume','tick_volume') !== undefined && volume===null) return null;
  return Object.freeze({instrumentId,timeframe,openedAt,open,high,low,close,...(volume!==null?{volume}:{})});
};

export const mapAccount = (state: unknown, observedAt: string): Account | null => {
  const s=record(state), a=record(s?.accountInfo ?? s?.account_info); if(!s||s.state!=='CONNECTED'||!a) return null;
  const idValue=pick(a,'login','id','accountId','account_id'); const id=typeof idValue==='number'&&Number.isSafeInteger(idValue)?String(idValue):text(idValue);
  const balance=finite(a.balance), equity=finite(a.equity), available=finite(pick(a,'availableFunds','available_funds','marginFree','margin_free'));
  const currency=text(a.currency); if(!id||balance===null||equity===null||!currency) return null;
  if(pick(a,'availableFunds','available_funds','marginFree','margin_free')!==undefined&&available===null)return null;
  return Object.freeze({id,displayName:text(pick(a,'name','displayName','display_name'))??id,currency,balance,equity,...(available!==null?{availableFunds:available}:{}),observedAt});
};
export const mapPosition = (raw: unknown, accountId: string): Position | null => {
  const r=record(raw); if(!r)return null; const symbol=text(r.symbol), quantity=positive(pick(r,'quantity','volume')), avg=positive(pick(r,'averagePrice','average_price','priceOpen','price_open'));
  const type=pick(r,'side','type'); const side=type==='long'||type==='BUY'||type===0?'long':type==='short'||type==='SELL'||type===1?'short':null;
  const market=positive(pick(r,'marketPrice','market_price','priceCurrent','price_current')), pnl=finite(pick(r,'unrealizedPnl','unrealized_pnl','profit'));
  if(!symbol||quantity===null||avg===null||!side)return null;
  if(pick(r,'marketPrice','market_price','priceCurrent','price_current')!==undefined&&market===null)return null;
  if(pick(r,'unrealizedPnl','unrealized_pnl','profit')!==undefined&&pnl===null)return null;
  return Object.freeze({accountId,instrumentId:symbol,side,quantity,averagePrice:avg,...(market!==null?{marketPrice:market}:{}),...(pnl!==null?{unrealizedPnl:pnl}:{})});
};
