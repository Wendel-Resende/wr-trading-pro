/**
 * Cliente WS do bridge MT5 (`python/mt5_bridge.py`) para o wr-mcp-pilot.
 *
 * Handshake: ao conectar, envia `{type:'AUTH', data:{token}}` com token
 * efêmero de `createWsToken` (ver `src/lib/auth/ws-token.ts`); o bridge
 * responde `{type:'AUTH_OK', ...}` (ou fecha com 1008 em caso de falha).
 *
 * Correlação de requests: o bridge não ecoa nenhum id de correlação em
 * `ERROR` (só `CHART_DATA` carrega `requestId`, e mesmo assim não em todo
 * lugar) — não há como saber, ao receber um `ERROR`, a qual request ele
 * pertence quando há mais de um em voo. Por isso este cliente SERIALIZA
 * todos os requests: no máximo um em voo por vez, encadeados numa promise
 * chain interna (`inflight`). Com um único request ativo, qualquer `ERROR`
 * ou mensagem de resposta recebida pertence inequivocamente a ele. Para um
 * cliente de agente (que não faz chamadas de altíssima frequência), a
 * latência extra da serialização é irrelevante perto do risco de resolver/
 * rejeitar a Promise errada.
 *
 * NOTA (decisão do controller, Task 4): os handlers de posições/ordens/
 * histórico do bridge fazem `broadcast` de mensagens por item (`POSITION`,
 * `ORDER`, `TRADE`) para manter a UI existente funcionando — não servem
 * para um request/response unicast. Por isso este cliente usa os
 * handlers ADITIVOS `GET_POSITIONS_SNAPSHOT` / `GET_ORDERS_SNAPSHOT` /
 * `GET_HISTORY_SNAPSHOT`, que respondem unicast e agregado
 * (`POSITIONS_SNAPSHOT` / `ORDERS_SNAPSHOT` / `HISTORY_SNAPSHOT`) sem
 * tocar nos handlers de broadcast já usados pela UI.
 *
 * `GET_ORDER_BOOK` é uma exceção conhecida: o handler atual do bridge
 * envia erros de `NOT_CONNECTED` via `broadcast=True` (não unicast) — não
 * foi alterado para não arriscar quebrar a UI. Se isso acontecer com este
 * cliente sem MT5 conectado, a requisição simplesmente não recebe
 * resposta e estoura o timeout de 15s, tratado abaixo como `BRIDGE_ERROR`
 * com mensagem explicando o cenário.
 */
import { createWsToken, getWsTokenSecret } from '../../../lib/auth/ws-token';
import { ReadModelError } from '../../../application/read-models-v1/errors';

export interface BridgeClient {
  request(type: string, data?: Record<string, unknown>): Promise<Record<string, unknown>>;
}

/**
 * Subconjunto do `WebSocket` global usado por este cliente — permite
 * injetar um socket fake em teste (`socketFactory`) sem depender de um
 * servidor WS real nem de uma lib externa.
 */
export interface WebSocketLike {
  readonly readyState: number;
  send(data: string): void;
  close(): void;
  addEventListener(type: 'open' | 'message' | 'close' | 'error', listener: (event: any) => void): void;
  removeEventListener(type: 'open' | 'message' | 'close' | 'error', listener: (event: any) => void): void;
}

const OPEN_STATE = 1;

/** Tipo de request → tipo de resposta esperado. */
const REQUEST_RESPONSE: Record<string, string> = {
  GET_ACCOUNT_INFO: 'ACCOUNT_INFO',
  GET_POSITIONS_SNAPSHOT: 'POSITIONS_SNAPSHOT',
  GET_ORDERS_SNAPSHOT: 'ORDERS_SNAPSHOT',
  GET_HISTORY_SNAPSHOT: 'HISTORY_SNAPSHOT',
  GET_ORDER_BOOK: 'ORDERBOOK',
  GET_CHART_DATA: 'CHART_DATA',
  SEND_ORDER: 'ORDER_RESULT',
};

const REQUEST_TIMEOUT_MS = 15_000;
const AUTH_TIMEOUT_MS = 5_000;

interface ActiveRequest {
  readonly expectedType: string;
  readonly resolve: (data: Record<string, unknown>) => void;
  readonly reject: (error: unknown) => void;
  readonly timer: ReturnType<typeof setTimeout>;
}

function bridgeErrorToReadModelError(data: Record<string, unknown>): ReadModelError {
  const code = typeof data.code === 'string' ? data.code : undefined;
  const message = typeof data.message === 'string' ? data.message : 'erro do bridge MT5';
  if (code === 'NOT_CONNECTED') {
    return new ReadModelError('MT5_DISCONNECTED', message);
  }
  return new ReadModelError('BRIDGE_ERROR', message);
}

export interface CreateBridgeClientOptions {
  /** Fábrica de socket injetável — só usada em teste; produção usa `new WebSocket(url)`. */
  socketFactory?: (url: string) => WebSocketLike;
}

export function createBridgeClient(url: string, options: CreateBridgeClientOptions = {}): BridgeClient {
  // O bridge valida Origin (anti-CSWSH, Fase 0) e rejeita conexões sem o
  // header. O WebSocket do Node (undici) não envia Origin por padrão, mas
  // aceita `{ headers }` como extensão — enviamos uma origem da allowlist
  // local do bridge (network_config.ALLOWED_ORIGINS). Achado do E2E real:
  // sem isto, toda chamada via bridge falha com "Origin ausente".
  const socketFactory =
    options.socketFactory ??
    ((u: string) =>
      new (WebSocket as unknown as new (url: string, opts?: object) => WebSocketLike)(u, {
        headers: { Origin: 'http://127.0.0.1:3001' },
      }));

  let socket: WebSocketLike | null = null;
  let connecting: Promise<WebSocketLike> | null = null;
  // Único request ativo por vez — ver docblock do módulo.
  let active: ActiveRequest | null = null;
  // Encadeamento interno que garante serialização mesmo sob chamadas
  // concorrentes de `request()`; nunca deve rejeitar (erros ficam no
  // resultado da chamada individual, não na cadeia).
  let inflight: Promise<void> = Promise.resolve();

  function rejectActive(error: unknown): void {
    if (!active) return;
    const entry = active;
    active = null;
    clearTimeout(entry.timer);
    entry.reject(error);
  }

  function handleMessage(raw: string): void {
    let msg: { type?: unknown; data?: unknown };
    try {
      msg = JSON.parse(raw) as { type?: unknown; data?: unknown };
    } catch {
      return;
    }
    if (typeof msg.type !== 'string') return;
    const data = (msg.data && typeof msg.data === 'object' ? msg.data : {}) as Record<string, unknown>;

    if (msg.type === 'ERROR') {
      // Com no máximo um request em voo, o ERROR só pode pertencer a ele.
      if (active) rejectActive(bridgeErrorToReadModelError(data));
      return;
    }

    if (active && msg.type === active.expectedType) {
      const entry = active;
      active = null;
      clearTimeout(entry.timer);
      entry.resolve(data);
    }
  }

  async function attemptConnect(): Promise<WebSocketLike> {
    const secret = getWsTokenSecret();
    if (!secret) {
      throw new ReadModelError('BRIDGE_AUTH_UNAVAILABLE', 'WR_WS_TOKEN_SECRET ausente — não é possível autenticar no bridge MT5');
    }
    const token = await createWsToken(secret, 'mcp-pilot', 30);
    const ws = socketFactory(url);

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        try { ws.close(); } catch { /* noop */ }
        reject(new ReadModelError('BRIDGE_ERROR', 'timeout aguardando handshake AUTH do bridge MT5'));
      }, AUTH_TIMEOUT_MS);

      const onOpen = () => {
        try {
          ws.send(JSON.stringify({ type: 'AUTH', data: { token }, timestamp: new Date().toISOString() }));
        } catch (error) {
          cleanup();
          reject(error);
        }
      };
      const onMessage = (event: { data: unknown }) => {
        let msg: { type?: unknown };
        try {
          msg = JSON.parse(String(event.data)) as { type?: unknown };
        } catch {
          return;
        }
        if (msg.type === 'AUTH_OK') {
          cleanup();
          resolve();
        } else if (msg.type === 'ERROR') {
          cleanup();
          reject(new ReadModelError('BRIDGE_ERROR', 'falha de autenticação no bridge MT5'));
        }
      };
      const onError = () => {
        cleanup();
        reject(new ReadModelError('BRIDGE_ERROR', 'falha ao conectar no bridge MT5'));
      };
      const onClose = () => {
        cleanup();
        reject(new ReadModelError('BRIDGE_ERROR', 'conexão com o bridge MT5 encerrada durante o handshake'));
      };
      function cleanup(): void {
        clearTimeout(timer);
        ws.removeEventListener('open', onOpen);
        ws.removeEventListener('message', onMessage);
        ws.removeEventListener('error', onError);
        ws.removeEventListener('close', onClose);
      }
      ws.addEventListener('open', onOpen);
      ws.addEventListener('message', onMessage);
      ws.addEventListener('error', onError);
      ws.addEventListener('close', onClose);
    });

    ws.addEventListener('message', (event) => handleMessage(String(event.data)));
    ws.addEventListener('close', () => {
      if (socket === ws) socket = null;
      rejectActive(new ReadModelError('BRIDGE_ERROR', 'conexão com o bridge MT5 encerrada'));
    });
    ws.addEventListener('error', () => {
      if (socket === ws) socket = null;
    });

    return ws;
  }

  async function ensureConnected(): Promise<WebSocketLike> {
    if (socket && socket.readyState === OPEN_STATE) return socket;
    if (connecting) return connecting;
    connecting = (async () => {
      try {
        return await attemptConnect();
      } catch {
        // 1 retry simples de reconexão sob demanda.
        return await attemptConnect();
      }
    })()
      .then((ws) => {
        socket = ws;
        return ws;
      })
      .finally(() => {
        connecting = null;
      });
    return connecting;
  }

  async function doRequest(type: string, data?: Record<string, unknown>): Promise<Record<string, unknown>> {
    const expectedType = REQUEST_RESPONSE[type];
    if (!expectedType) {
      throw new ReadModelError('BRIDGE_ERROR', `tipo de requisição desconhecido: ${type}`);
    }
    const ws = await ensureConnected();

    return new Promise<Record<string, unknown>>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (active && active.resolve === resolve) active = null;
        reject(new ReadModelError('BRIDGE_ERROR', `sem resposta do bridge (${type}) — verifique conexão MT5`));
      }, REQUEST_TIMEOUT_MS);

      active = { expectedType, resolve, reject, timer };

      try {
        ws.send(JSON.stringify({ type, data: data ?? {}, timestamp: new Date().toISOString() }));
      } catch (error) {
        active = null;
        clearTimeout(timer);
        reject(error);
      }
    });
  }

  return {
    request(type: string, data?: Record<string, unknown>): Promise<Record<string, unknown>> {
      // Encadeia no `inflight` para serializar chamadas concorrentes; o
      // resultado exposto ao chamador é sempre o de `doRequest`, nunca o
      // da cadeia interna (que nunca rejeita, só sequencia).
      const result = inflight.then(() => doRequest(type, data));
      inflight = result.then(
        () => undefined,
        () => undefined,
      );
      return result;
    },
  };
}
