/**
 * Cliente WS do bridge MT5 (`python/mt5_bridge.py`) para o wr-mcp-pilot.
 *
 * Handshake: ao conectar, envia `{type:'AUTH', data:{token}}` com token
 * efêmero de `createWsToken` (ver `src/lib/auth/ws-token.ts`); o bridge
 * responde `{type:'AUTH_OK', ...}` (ou fecha com 1008 em caso de falha).
 * Requests são correlacionados por TIPO de resposta esperado (fila FIFO
 * por tipo) — o bridge não ecoa um id de correlação em todas as rotas
 * (só `CHART_DATA` carrega `requestId`), então uma única requisição por
 * tipo em voo é a garantia que este cliente oferece.
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

interface PendingEntry {
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

export function createBridgeClient(url: string): BridgeClient {
  let socket: WebSocket | null = null;
  let connecting: Promise<WebSocket> | null = null;
  // Fila global FIFO: cobre tanto o caso feliz (dispatch por tipo) quanto
  // `ERROR`, que não indica a qual request pertence — assume-se que é a
  // requisição mais antiga ainda pendente.
  let queue: PendingEntry[] = [];

  function rejectAllPending(error: unknown): void {
    const pending = queue;
    queue = [];
    for (const entry of pending) {
      clearTimeout(entry.timer);
      entry.reject(error);
    }
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
      const entry = queue.shift();
      if (!entry) return;
      clearTimeout(entry.timer);
      entry.reject(bridgeErrorToReadModelError(data));
      return;
    }

    const index = queue.findIndex((entry) => entry.expectedType === msg.type);
    if (index === -1) return;
    const [entry] = queue.splice(index, 1);
    clearTimeout(entry.timer);
    entry.resolve(data);
  }

  async function attemptConnect(): Promise<WebSocket> {
    const secret = getWsTokenSecret();
    if (!secret) {
      throw new ReadModelError('BRIDGE_AUTH_UNAVAILABLE', 'WR_WS_TOKEN_SECRET ausente — não é possível autenticar no bridge MT5');
    }
    const token = await createWsToken(secret, 'mcp-pilot', 30);
    const ws = new WebSocket(url);

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
      const onMessage = (event: MessageEvent) => {
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
      rejectAllPending(new ReadModelError('BRIDGE_ERROR', 'conexão com o bridge MT5 encerrada'));
    });
    ws.addEventListener('error', () => {
      if (socket === ws) socket = null;
    });

    return ws;
  }

  async function ensureConnected(): Promise<WebSocket> {
    if (socket && socket.readyState === WebSocket.OPEN) return socket;
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

  return {
    async request(type: string, data?: Record<string, unknown>): Promise<Record<string, unknown>> {
      const expectedType = REQUEST_RESPONSE[type];
      if (!expectedType) {
        throw new ReadModelError('BRIDGE_ERROR', `tipo de requisição desconhecido: ${type}`);
      }
      const ws = await ensureConnected();

      return new Promise<Record<string, unknown>>((resolve, reject) => {
        const timer = setTimeout(() => {
          const index = queue.findIndex((entry) => entry.resolve === resolve);
          if (index !== -1) queue.splice(index, 1);
          reject(new ReadModelError('BRIDGE_ERROR', `sem resposta do bridge (${type}) — verifique conexão MT5`));
        }, REQUEST_TIMEOUT_MS);

        queue.push({ expectedType, resolve, reject, timer });

        try {
          ws.send(JSON.stringify({ type, data: data ?? {}, timestamp: new Date().toISOString() }));
        } catch (error) {
          const index = queue.findIndex((entry) => entry.resolve === resolve);
          if (index !== -1) queue.splice(index, 1);
          clearTimeout(timer);
          reject(error);
        }
      });
    },
  };
}
