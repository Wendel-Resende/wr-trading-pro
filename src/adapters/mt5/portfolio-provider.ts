import type { Account, Portfolio, PortfolioProvider, PortfolioRequest, Position } from '../../domain/v1';
import { mapAccount, mapPosition, record, text } from './mapping';
import type { Mt5ReadClient } from './types';

export class Mt5PortfolioProvider implements PortfolioProvider {
  constructor(private readonly client:Mt5ReadClient,private readonly clock:()=>Date=()=>new Date()){}
  private snapshot():{account:Account;positions:readonly Position[];observedAt:string}|null{
    const state=this.client.getConnectionState();if(record(state)?.state!=='CONNECTED')return null;let now:unknown;try{now=this.clock();}catch{throw new Error('Invalid MT5 portfolio clock');}if(!(now instanceof Date)||!Number.isFinite(now.valueOf()))throw new Error('Invalid MT5 portfolio clock');const observedAt=now.toISOString();const account=mapAccount(state,observedAt);if(!account)throw new Error('Malformed MT5 account snapshot');
    const raw=this.client.getPositionsCache();if(!Array.isArray(raw))throw new Error('Malformed MT5 positions snapshot');const positions=raw.map(x=>mapPosition(x,account.id));if(positions.some(x=>x===null))throw new Error('Malformed MT5 position snapshot');
    return {account,positions:Object.freeze(positions as Position[]),observedAt};
  }
  async listAccounts():Promise<readonly Account[]>{const snapshot=this.snapshot();return Object.freeze(snapshot?[Object.freeze({...snapshot.account})]:[]);}
  async getPortfolio(request:PortfolioRequest):Promise<Portfolio>{const requested=text(request?.accountId);if(!requested)throw new TypeError('account id is required');const snapshot=this.snapshot();if(!snapshot)throw new Error('MT5 is not connected');if(snapshot.account.id!==requested)throw new Error('Requested account does not match connected MT5 account');
    return Object.freeze({account:Object.freeze({...snapshot.account}),positions:Object.freeze(snapshot.positions.map(x=>Object.freeze({...x}))),observedAt:snapshot.observedAt});}
}
