"""
MetaTrader 5 Bridge Server
Servidor WebSocket que faz a ponte entre a API do MetaTrader 5 e a aplicação Next.js
"""

import asyncio
import json
import logging
import os
from datetime import datetime
from typing import Dict, Set, Any
import websockets
from websockets.legacy.server import serve

# Configuração de rede segura (loopback + CORS allowlist)
from network_config import NETWORK_HOST, CORS_OPTIONS
# Token efêmero de autenticação do WebSocket (Fase 0, Item 10)
import ws_token as ws_token_mod
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Campos sensíveis que nunca devem aparecer em logs
_SENSITIVE_KEYS = {
    'password', 'pass', 'pwd', 'token', 'api_key', 'apikey', 'secret',
    'accesskey', 'access_key', 'secretkey', 'secret_key', 'privatekey',
    'private_key', 'authorization', 'auth', 'credentials', 'credential',
}


def _redact_value(key: str, value: Any) -> Any:
    """Mascara valores de campos sensíveis."""
    if isinstance(key, str) and key.lower().replace('-', '_') in _SENSITIVE_KEYS:
        return '***'
    return value


def redact(obj: Any, _depth: int = 0) -> Any:
    """Retorna uma cópia do objeto com campos sensíveis mascarados.

    Suporta dict, list e tipos primitivos. Evita recursão infinita
    limitando a profundidade.
    """
    if _depth > 10:
        return '...'
    if isinstance(obj, dict):
        return {k: _redact_value(k, redact(v, _depth + 1)) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [redact(v, _depth + 1) for v in obj]
    if isinstance(obj, str) and any(s in obj.lower() for s in ('password', 'token', 'secret', 'api_key', 'authorization')):
        # strings brutas que parecem conter segredos
        return '***'
    return obj


def redacted_str(obj: Any) -> str:
    """Serializa objeto para log já com redação de segredos."""
    try:
        return json.dumps(redact(obj), default=str)
    except (TypeError, ValueError):
        return '***'

# Tentar importar MetaTrader5
try:
    import MetaTrader5 as mt5
    MT5_AVAILABLE = True
except ImportError:
    logger.warning("MetaTrader5 não disponível - instale com: pip install MetaTrader5")
    MT5_AVAILABLE = False


class MT5Bridge:
    """Classe principal do bridge para MetaTrader 5"""
    
    def __init__(self):
        self.clients: Set[Any] = set()
        self.is_connected = False
        self.account_info = None
        self.config = {}
        self.subscribed_symbols = set()
        self.subscribed_order_books = set()  # Símbolos com book de ofertas em atualização contínua
        self.previous_close_prices: Dict[str, float] = {}  # Armazenar fechamento do dia anterior
    
    def to_camel_case(self, data: Dict[str, Any]) -> Dict[str, Any]:
        """Converter chaves de snake_case para camelCase para compatibilidade com TypeScript"""
        result = {}
        for key, value in data.items():
            # Converter snake_case para camelCase
            if '_' in key:
                parts = key.split('_')
                camel_case = parts[0] + ''.join(word.capitalize() for word in parts[1:])
                result[camel_case] = value
            else:
                result[key] = value
        return result
        
    async def register_client(self, websocket: Any):
        """Registrar novo cliente WebSocket"""
        self.clients.add(websocket)
        logger.info(f"Cliente conectado. Total: {len(self.clients)}")
        # Se já está logado no MT5, informar o novo cliente imediatamente
        if self.is_connected and self.account_info:
            await self.send_to_client(websocket, {
                'type': 'STATE',
                'data': {
                    'state': 'CONNECTED',
                    'accountInfo': self.account_info,
                },
                'timestamp': __import__('datetime').datetime.now().isoformat(),
            })
            logger.info("Estado CONNECTED reenviado para novo cliente")
        
    async def unregister_client(self, websocket: Any):
        """Remover cliente WebSocket"""
        self.clients.discard(websocket)
        logger.info(f"Cliente desconectado. Total: {len(self.clients)}")
        
    async def broadcast(self, message: Dict[str, Any]):
        """Enviar mensagem para todos os clientes conectados"""
        if self.clients:
            message_str = json.dumps(message, default=str)
            await asyncio.gather(
                *[client.send(message_str) for client in self.clients],
                return_exceptions=True
            )
    
    async def send_to_client(self, websocket: Any, message: Dict[str, Any]):
        """Enviar mensagem para um cliente específico"""
        try:
            await websocket.send(json.dumps(message, default=str))
        except Exception as e:
            logger.error(f"Erro ao enviar mensagem para cliente: {e}")

    async def _send_error(self, message: str, code: str, websocket: Any = None, broadcast: bool = False):
        """Helper para enviar mensagens de erro de forma padronizada"""
        msg = {
            'type': 'ERROR',
            'data': {'message': message, 'code': code},
            'timestamp': datetime.now().isoformat(),
        }
        if websocket and not broadcast:
            await self.send_to_client(websocket, msg)
        else:
            await self.broadcast(msg)
    
    async def handle_message(self, websocket: Any, message: str):
        """Processar mensagem recebida do cliente"""
        try:
            data = json.loads(message)
            msg_type = data.get('type')
            msg_data = data.get('data', {})
            
            logger.info(f"Recebido: {msg_type}")
            # Logar data apenas se não estiver vazia para evitar spam.
            # Aplica redação de segredos (senha, token, api_key etc.).
            if msg_data:
                logger.info(f"Data: {redacted_str(msg_data)}")
            
            if msg_type == 'LOGIN':
                await self.handle_login(websocket, msg_data)
            elif msg_type == 'SUBSCRIBE_TICKS':
                await self.handle_subscribe_ticks(msg_data)
            elif msg_type == 'UNSUBSCRIBE_TICKS':
                await self.handle_unsubscribe_ticks(msg_data)
            elif msg_type == 'GET_SYMBOLS':
                await self.handle_get_symbols(websocket, msg_data)
            elif msg_type == 'GET_SYMBOL_INFO':
                await self.handle_get_symbol_info(msg_data)
            elif msg_type == 'SELECT_SYMBOL':
                await self.handle_select_symbol(msg_data)
            elif msg_type == 'UNSELECT_SYMBOL':
                await self.handle_unselect_symbol(msg_data)
            elif msg_type == 'GET_EQUITIES':
                await self.handle_get_equities(websocket, msg_data)
            elif msg_type == 'GET_POSITIONS':
                await self.handle_get_positions(msg_data)
            elif msg_type == 'GET_ORDERS':
                await self.handle_get_orders(msg_data)
            elif msg_type == 'GET_ORDER_BOOK':
                await self.handle_get_order_book(msg_data)
            elif msg_type == 'SUBSCRIBE_ORDER_BOOK':
                await self.handle_subscribe_order_book(msg_data)
            elif msg_type == 'UNSUBSCRIBE_ORDER_BOOK':
                await self.handle_unsubscribe_order_book(msg_data)
            elif msg_type == 'GET_HISTORY':
                await self.handle_get_history(msg_data)
            elif msg_type == 'GET_CHART_DATA':
                await self.handle_get_chart_data(msg_data)
            elif msg_type == 'SEND_ORDER':
                await self.handle_send_order(msg_data)
            elif msg_type == 'MODIFY_ORDER':
                await self.handle_modify_order(msg_data)
            elif msg_type == 'CANCEL_ORDER':
                await self.handle_cancel_order(msg_data)
            elif msg_type == 'CLOSE_POSITION':
                await self.handle_close_position(msg_data)
            elif msg_type == 'CLOSE_POSITION_BY':
                await self.handle_close_position_by(msg_data)
            else:
                logger.warning(f"Tipo de mensagem desconhecido: {msg_type}")
                
        except json.JSONDecodeError as e:
            logger.error(f"Erro ao decodificar JSON: {e}")
        except Exception as e:
            logger.error(f"Erro ao processar mensagem: {e}")
    
    async def handle_login(self, websocket: Any, data: Dict[str, Any]):
        """Processar login no MetaTrader 5"""
        # Logar dados recebidos
        login = data.get('login')
        password = data.get('password')
        server = data.get('server')
        
        logger.info(f"Dados de login recebidos:")
        logger.info(f"  Login: {login} (tipo: {type(login).__name__})")
        logger.info(f"  Password: {'***' if password else 'NÃO FORNECIDO'}")
        logger.info(f"  Server: {server}")
        
        # Validar dados
        if not login or not password or not server:
            error_msg = "Credenciais incompletas. Todos os campos (login, password, server) são obrigatórios."
            logger.error(error_msg)
            await self.send_to_client(websocket, {
                'type': 'ERROR',
                'data': {
                    'message': error_msg,
                },
                'timestamp': datetime.now().isoformat(),
            })
            return
        
        self.config = {
            'login': login,
            'password': password,
            'server': server,
            'path': data.get('path'),
        }
        
        if not MT5_AVAILABLE:
            await self.send_to_client(websocket, {
                'type': 'ERROR',
                'data': {
                    'message': 'MetaTrader5 não está disponível. Instale com: pip install MetaTrader5',
                },
                'timestamp': datetime.now().isoformat(),
            })
            return
        
        # Inicializar MT5
        logger.info("Inicializando MT5...")
        if not mt5.initialize():
            error_code = mt5.last_error()
            logger.error(f"Falha ao inicializar MT5: {error_code}")
            await self.send_to_client(websocket, {
                'type': 'ERROR',
                'data': {
                    'message': f'Falha ao inicializar MT5: {error_code}. Verifique se o MetaTrader 5 está instalado.',
                },
                'timestamp': datetime.now().isoformat(),
            })
            return
        
        # Login - Converter login para número se necessário
        login = self.config['login']
        password = self.config['password']
        server = self.config['server']
        
        # Converter login para número se for string
        if isinstance(login, str):
            try:
                login = int(login)
                logger.info(f"Login convertido de string para número: {login}")
            except ValueError:
                logger.error(f"Login inválido: {login}")
                await self.send_to_client(websocket, {
                    'type': 'ERROR',
                    'data': {
                        'message': f'Login inválido: {login}. Deve ser um número.',
                    },
                    'timestamp': datetime.now().isoformat(),
                })
                mt5.shutdown()
                return
        
        logger.info(f"Tentando fazer login: login={login}, server={server}")
        
        if not mt5.login(login, password, server):
            error_code = mt5.last_error()
            logger.error(f"Falha no login MT5: {error_code}")
            await self.send_to_client(websocket, {
                'type': 'ERROR',
                'data': {
                    'message': f'Falha no login: {error_code}',
                },
                'timestamp': datetime.now().isoformat(),
            })
            mt5.shutdown()
            return
        
        # Obter informações da conta
        account_info = mt5.account_info()
        if account_info is None:
            logger.error("Falha ao obter informações da conta")
            mt5.shutdown()
            return
        
        self.account_info = account_info._asdict()
        self.is_connected = True
        
        # Converter snake_case para camelCase para compatibilidade com TypeScript
        self.account_info = self.to_camel_case(self.account_info)
        
        # Limpar símbolos e fechamentos anteriores de contas anteriores
        self.subscribed_symbols.clear()
        self.previous_close_prices.clear()
        logger.info("Símbolos e fechamentos anteriores limpos (nova conta)")
        
        logger.info(f"Login MT5 bem-sucedido: {login}")
        
        # Enviar estado de conexão
        await self.send_to_client(websocket, {
            'type': 'STATE',
            'data': {
                'state': 'CONNECTED',
                'accountInfo': self.account_info,
            },
            'timestamp': datetime.now().isoformat(),
        })
    
    async def handle_subscribe_ticks(self, data: Dict[str, Any]):
        """Inscrever em ticks de símbolo"""
        symbol = data.get('symbol')
        logger.info(f"Inscrevendo em ticks: {symbol}")
        
        if not MT5_AVAILABLE or not self.is_connected:
            return
        
        # Em produção, iniciaria monitoramento de ticks
        self.subscribed_symbols.add(symbol)
    
    async def handle_unsubscribe_ticks(self, data: Dict[str, Any]):
        """Desinscrever de ticks de símbolo"""
        symbol = data.get('symbol')
        logger.info(f"Desinscrevendo de ticks: {symbol}")
        
        if symbol in self.subscribed_symbols:
            self.subscribed_symbols.remove(symbol)
    
    async def handle_get_symbols(self, websocket: Any, data: Dict[str, Any]):
        """Obter lista de símbolos com filtro opcional por prefixo/caminho"""
        prefix = data.get('prefix', '')
        group = data.get('group', '')

        logger.info(f"Buscando símbolos. prefix={prefix}, group={group}")

        if not MT5_AVAILABLE or not self.is_connected:
            return

        try:
            # Se tiver prefixo (ex: BOVESPA\OPCOES\PETR), filtrar por path
            if prefix:
                all_symbols = mt5.symbols_get()
                # Usar startswith para filtrar por path (ex: BOVESPA\OPCOES\PETR)
                filtered = [s.name for s in all_symbols if s.path.startswith(prefix)]
                logger.info(f"Encontrados {len(filtered)} símbolos com prefixo '{prefix}'")
                await self.send_to_client(websocket, {
                    'type': 'SYMBOLS',
                    'data': { 'symbols': filtered },
                    'timestamp': datetime.now().isoformat(),
                })
            elif group:
                # Usar wildcards como no script Python (group=*PETR*)
                symbols = mt5.symbols_get(group=f"*{group}*")
                symbol_names = [s.name for s in symbols]
                logger.info(f"Encontrados {len(symbol_names)} símbolos no grupo '*{group}*'")
                await self.send_to_client(websocket, {
                    'type': 'SYMBOLS',
                    'data': { 'symbols': symbol_names },
                    'timestamp': datetime.now().isoformat(),
                })
            else:
                symbols = mt5.symbols_get()
                symbol_names = [s.name for s in symbols]
                logger.info(f"Encontrados {len(symbol_names)} símbolos (sem filtro)")
                await self.send_to_client(websocket, {
                    'type': 'SYMBOLS',
                    'data': { 'symbols': symbol_names },
                    'timestamp': datetime.now().isoformat(),
                })
        except Exception as e:
            logger.error(f"Erro ao buscar símbolos: {e}")
            await self.send_to_client(websocket, {
                'type': 'SYMBOLS',
                'data': { 'symbols': [], 'error': str(e) },
                'timestamp': datetime.now().isoformat(),
            })

    async def handle_get_symbol_info(self, data: Dict[str, Any]):
        """Obter informações de símbolo"""
        symbol = data.get('symbol')
        logger.info(f"Obtendo informações do símbolo: {symbol}")
        
        if not MT5_AVAILABLE or not self.is_connected:
            return
        
        symbol_info = mt5.symbol_info(symbol)
        if symbol_info is None:
            logger.error(f"Símbolo não encontrado: {symbol}")
            return
        
        info_dict = symbol_info._asdict()
        info_dict['symbol'] = symbol  # Add symbol to data for client matching
        await self.broadcast({
            'type': 'SYMBOL_INFO',
            'data': info_dict,
            'timestamp': datetime.now().isoformat(),
        })

    async def handle_select_symbol(self, data: Dict[str, Any]):
        """Selecionar símbolo no Market Watch (obrigatório antes de consultar dados)"""
        symbol = data.get('symbol')
        if not symbol:
            logger.warning("SELECT_SYMBOL: símbolo não fornecido")
            return

        logger.info(f"Selecionando símbolo no Market Watch: {symbol}")
        if mt5.symbol_select(symbol, True):
            logger.info(f"Símbolo {symbol} selecionado com sucesso")
        else:
            logger.warning(f"symbol_select({symbol}, True) falhou: {mt5.last_error()}")

    async def handle_unselect_symbol(self, data: Dict[str, Any]):
        """Remover símbolo do Market Watch (libera memória)"""
        symbol = data.get('symbol')
        if not symbol:
            return

        logger.info(f"Removendo símbolo {symbol} do Market Watch")
        if mt5.symbol_select(symbol, False):
            logger.info(f"Símbolo {symbol} removido com sucesso")
        else:
            logger.warning(f"symbol_select({symbol}, False) falhou: {mt5.last_error()}")

    async def handle_get_equities(self, websocket: Any, data: Dict[str, Any]):
        """Obter lista de ações (equities) da B3 disponíveis"""
        try:
            all_symbols = mt5.symbols_get()
            # Filtrar apenas ações da BOVESPA (equities)
            equities = [
                s.name for s in all_symbols
                if s.path.startswith('BOVESPA\\A VISTA\\')
                and not s.name.endswith(('F', 'ED', 'EF', 'P', 'PC', 'PD', 'PE', 'PG', 'PH', 'PJ', 'PL', 'PM', 'PN', 'PP', 'PQ', 'PR', 'PS', 'PT', 'PU', 'PV', 'PW', 'PX', 'PY'))
                and len(s.name) <= 6  # Ações normais têm no máximo 6 caracteres (ex: PETR4, VALE3)
            ]
            equities.sort()
            logger.info(f"Encontrados {len(equities)} equities B3")
            await self.send_to_client(websocket, {
                'type': 'EQUITIES',
                'data': { 'equities': equities },
                'timestamp': datetime.now().isoformat(),
            })
        except Exception as e:
            logger.error(f"Erro ao buscar equities: {e}")
            await self.send_to_client(websocket, {
                'type': 'EQUITIES',
                'data': { 'equities': [], 'error': str(e) },
                'timestamp': datetime.now().isoformat(),
            })

    async def handle_get_positions(self, data: Dict[str, Any]):
        """Obter posições"""
        symbol = data.get('symbol')
        logger.info(f"Obtendo posições: {symbol}")
        
        if not MT5_AVAILABLE or not self.is_connected:
            return
        
        # Passar symbol apenas se fornecido
        if symbol:
            positions = mt5.positions_get(symbol=symbol)
        else:
            positions = mt5.positions_get()
            
        if positions is None:
            error_code = mt5.last_error()
            if error_code[0] != 0:  # Verifica se há erro real (erro não é (0, 'no error'))
                logger.error(f"Falha ao obter posições: {error_code}")
            else:
                logger.info("Nenhuma posição encontrada")
            return
        
        for position in positions:
            await self.broadcast({
                'type': 'POSITION',
                'data': position._asdict(),
                'timestamp': datetime.now().isoformat(),
            })
    
    async def handle_get_orders(self, data: Dict[str, Any]):
        """Obter ordens"""
        symbol = data.get('symbol')
        logger.info(f"Obtendo ordens: {symbol}")
        
        if not MT5_AVAILABLE or not self.is_connected:
            return
        
        # Passar symbol apenas se fornecido
        if symbol:
            orders = mt5.orders_get(symbol=symbol)
        else:
            orders = mt5.orders_get()
            
        if orders is None:
            error_code = mt5.last_error()
            if error_code[0] != 0:  # Verifica se há erro real (erro não é (0, 'no error'))
                logger.error(f"Falha ao obter ordens: {error_code}")
            else:
                logger.info("Nenhuma ordem encontrada")
            return
        
        for order in orders:
            await self.broadcast({
                'type': 'ORDER',
                'data': order._asdict(),
                'timestamp': datetime.now().isoformat(),
            })
    
    async def handle_get_order_book(self, data: Dict[str, Any]):
        """Obter book de ofertas (order book)"""
        symbol = data.get('symbol')
        logger.info(f"Obtendo book de ofertas: {symbol}")
        
        if not MT5_AVAILABLE or not self.is_connected:
            logger.error("MT5 não disponível ou não conectado")
            await self._send_error('MT5 não disponível ou não conectado', 'NOT_CONNECTED', broadcast=True)
            return
        
        if not symbol:
            logger.error("Símbolo não fornecido para book de ofertas")
            await self.broadcast({
                'type': 'ERROR',
                'data': {
                    'message': 'Símbolo não fornecido',
                    'code': 'NO_SYMBOL',
                },
                'timestamp': datetime.now().isoformat(),
            })
            return
        
        # Verificar se o símbolo existe e está disponível
        logger.info(f"Verificando se símbolo {symbol} existe...")
        symbol_info = mt5.symbol_info(symbol)
        
        if symbol_info is None:
            logger.error(f"Símbolo {symbol} não encontrado!")
            await self.broadcast({
                'type': 'ORDERBOOK',
                'data': {
                    'symbol': symbol,
                    'bids': [],
                    'asks': [],
                    'error': f'Símbolo {symbol} não encontrado na corretora. Verifique se o nome está correto (ex: PETR4, VALE3, etc)',
                    'code': 'SYMBOL_NOT_FOUND',
                },
                'timestamp': datetime.now().isoformat(),
            })
            return
        
        logger.info(f"Símbolo {symbol} encontrado. Info: trade_mode={symbol_info.trade_mode}, description={symbol_info.description}")
        
        # Verificar se o símbolo está disponível para trading
        if symbol_info.trade_mode != mt5.SYMBOL_TRADE_MODE_FULL:
            logger.warning(f"Símbolo {symbol} não está em modo de trading completo (trade_mode={symbol_info.trade_mode})")
        
        # Verificar se o book de ofertas está habilitado para este símbolo
        logger.info(f"Verificando se book de ofertas está disponível para {symbol}...")
        
        # IMPORTANTE: Habilitar o símbolo na janela de observação do mercado
        # Isso é necessário antes de chamar market_book_get()
        logger.info(f"Habilitando símbolo {symbol} na janela de observação do mercado...")
        if not mt5.symbol_select(symbol, True):
            logger.warning(f"symbol_select({symbol}, True) falhou. O símbolo pode já estar habilitado ou ter erro: {mt5.last_error()}")
        else:
            logger.info(f"Símbolo {symbol} habilitado com sucesso na janela de observação")
        
        # Obter book de ofertas do MT5
        # Usar market_book_get() para obter o Depth of Market (DOM)
        # Documentação: https://www.mql5.com/en/docs/python_metatrader5/mt5marketbookget_py
        
        # Tenta múltiplos métodos para obter o book
        order_book = None
        
        if hasattr(mt5, 'market_book_get'):
            logger.info(f"Usando mt5.market_book_get() para obter DOM de {symbol}...")
            
            # IMPORTANTE: Subscrever ao DOM antes de obter os dados
            # Isso é necessário para alguns símbolos, especialmente futuros
            if hasattr(mt5, 'market_book_add'):
                logger.info(f"Subscrevendo ao DOM de {symbol}...")
                if mt5.market_book_add(symbol):
                    logger.info(f"Subscrição ao DOM de {symbol} realizada com sucesso")
                    
                    # Agora obter os dados do DOM
                    order_book = mt5.market_book_get(symbol)
                    
                    # Liberar a subscrição após obter os dados
                    mt5.market_book_release(symbol)
                    logger.info(f"Subscrição ao DOM de {symbol} liberada")
                else:
                    error_code = mt5.last_error()
                    logger.warning(f"market_book_add() falhou para {symbol}: {error_code}")
                    # Tentar obter diretamente mesmo sem subscribe
                    order_book = mt5.market_book_get(symbol)
            else:
                # Se market_book_add não está disponível, tentar diretamente
                order_book = mt5.market_book_get(symbol)
            
            if order_book is None or len(order_book) == 0:
                error_code = mt5.last_error()
                logger.warning(f"market_book_get() falhou para {symbol}: {error_code}")
                logger.info(f"O DOM pode não estar disponível para este símbolo. Tentando alternativas...")
                order_book = None
        
        elif hasattr(mt5, 'book_info'):
            logger.info(f"Usando mt5.book_info() para {symbol}...")
            order_book = mt5.book_info(symbol)
            
            if order_book is None:
                error_code = mt5.last_error()
                logger.warning(f"book_info() falhou para {symbol}: {error_code}")
                order_book = None
        
        elif hasattr(mt5, 'book_get'):
            logger.info(f"Usando mt5.book_get() para {symbol}...")
            order_book = mt5.book_get(symbol)
            
            if order_book is None:
                error_code = mt5.last_error()
                logger.warning(f"book_get() falhou para {symbol}: {error_code}")
                order_book = None
        
        # Se ainda não conseguiu obter o book, tentar ordens pendentes
        if order_book is None:
            logger.info(f"Tentando buscar ordens pendentes como alternativa para {symbol}...")
            
            # Buscar ordens pendentes do símbolo
            logger.info(f"Chamando mt5.orders_get() para {symbol}...")
            orders = mt5.orders_get(symbol=symbol)
            logger.info(f"mt5.orders_get() retornou: {orders}")
            
            if orders is None:
                error_code = mt5.last_error()
                logger.error(f"mt5.orders_get() retornou None. Erro: {error_code}")
                
                await self.broadcast({
                    'type': 'ORDERBOOK',
                    'data': {
                        'symbol': symbol,
                        'bids': [],
                        'asks': [],
                        'error': 'Book de ofertas não disponível nesta versão do MT5. Não foi possível obter ordens pendentes.',
                        'errorCode': 'NOT_SUPPORTED',
                        'mt5Error': str(error_code),
                        'debug': {
                            'trade_mode': symbol_info.trade_mode,
                            'visible': symbol_info.visible,
                            'message': 'O método book_get/book_info não está disponível. mt5.orders_get() também falhou.',
                        }
                    },
                    'timestamp': datetime.now().isoformat(),
                })
                return
            
            if len(orders) == 0:
                logger.info(f"Nenhuma ordem pendente encontrada para {symbol}")
                
                # Verificar se há posições abertas para este símbolo
                logger.info(f"Verificando se há posições abertas para {symbol}...")
                positions = mt5.positions_get(symbol=symbol)
                
                if positions and len(positions) > 0:
                    logger.info(f"Encontradas {len(positions)} posições abertas para {symbol}")
                    
                    # Criar book simulado baseado nas posições
                    bids = []
                    asks = []
                    
                    for pos in positions:
                        pos_dict = pos._asdict()
                        price = pos_dict.get('price_open')
                        volume = pos_dict.get('volume')
                        pos_type = pos_dict.get('type')
                        
                        # POSITION_TYPE_BUY = 0 (compra)
                        # POSITION_TYPE_SELL = 1 (venda)
                        if pos_type == 0:  # BUY position
                            # Posição de compra - mostra como se fosse "demandando" venda
                            asks.append({'price': price, 'volume': volume, 'type': 'POSITION_BUY'})
                        else:  # SELL position
                            # Posição de venda - mostra como se fosse "demandando" compra
                            bids.append({'price': price, 'volume': volume, 'type': 'POSITION_SELL'})
                    
                    # Ordenar
                    bids.sort(key=lambda x: x['price'], reverse=True)
                    asks.sort(key=lambda x: x['price'])
                    
                    logger.info(f"Book simulado a partir de posições: {len(bids)} bids, {len(asks)} asks")
                    
                    await self.broadcast({
                        'type': 'ORDERBOOK',
                        'data': {
                            'symbol': symbol,
                            'bids': bids,
                            'asks': asks,
                            'digits': symbol_info.digits if symbol_info else 2,
                            'note': f'Mostrando {len(positions)} posições abertas. Book completo não disponível nesta versão do MT5.',
                            'isSimulated': True,
                        },
                        'timestamp': datetime.now().isoformat(),
                    })
                    return
                else:
                    logger.info(f"Nenhuma posição aberta encontrada para {symbol}")
                
                await self.broadcast({
                    'type': 'ORDERBOOK',
                    'data': {
                        'symbol': symbol,
                        'bids': [],
                        'asks': [],
                        'error': 'Book de ofertas não disponível nesta versão do MT5. Esta funcionalidade depende da corretora e do tipo de mercado.',
                        'errorCode': 'NOT_SUPPORTED',
                        'debug': {
                            'trade_mode': symbol_info.trade_mode,
                            'visible': symbol_info.visible,
                            'message': 'O método book_get/book_info não está disponível nesta versão do MT5.',
                            'details': [
                                'Para Forex (EURUSD, GBPUSD, etc): Geralmente book completo é disponível',
                                'Para bolsa brasileira (PETR4, VALE3, etc): A maioria das corretoras não fornece book via API do MT5',
                                'Soluções alternativas:',
                                '  - Usar ordens pendentes (LIMIT/STOP) que você mesmo criou',
                                '  - Usar posições abertas para visualização parcial',
                                '  - Ver book diretamente no terminal MT5 da corretora',
                            ]
                        }
                    },
                    'timestamp': datetime.now().isoformat(),
                })
                return
            
            logger.info(f"Encontradas {len(orders)} ordens pendentes para {symbol}")
            
            # Processar ordens como alternativa
            bids = []
            asks = []
            
            for order in orders:
                order_dict = order._asdict()
                order_type = order_dict.get('type')
                price = order_dict.get('price')
                volume = order_dict.get('volume')
                
                if order_type in [mt5.ORDER_TYPE_BUY_LIMIT, mt5.ORDER_TYPE_BUY_STOP]:
                    bids.append({'price': price, 'volume': volume})
                elif order_type in [mt5.ORDER_TYPE_SELL_LIMIT, mt5.ORDER_TYPE_SELL_STOP]:
                    asks.append({'price': price, 'volume': volume})
            
            # Ordenar bids (maior preço primeiro) e asks (menor preço primeiro)
            bids.sort(key=lambda x: x['price'], reverse=True)
            asks.sort(key=lambda x: x['price'])
            
            logger.info(f"Ordens obtidas: {len(bids)} bids, {len(asks)} asks")
            
            await self.broadcast({
                'type': 'ORDERBOOK',
                'data': {
                    'symbol': symbol,
                    'bids': bids,
                    'asks': asks,
                    'digits': symbol_info.digits if symbol_info else 2,
                    'note': 'Mostrando ordens pendentes em vez de book completo',
                },
                'timestamp': datetime.now().isoformat(),
            })
            return
        
        # Se order_book ainda for None após tentar market_book_get
        if order_book is None:
            error_code = mt5.last_error()
            logger.error(f"Falha ao obter book de ofertas para {symbol}: {error_code}")
            logger.error(f"  Código do erro: {error_code[0]}")
            logger.error(f"  Mensagem do erro: {error_code[1]}")
            
            # Informações adicionais para debug
            logger.info(f"Informações adicionais sobre {symbol}:")
            logger.info(f"  trade_mode: {symbol_info.trade_mode}")
            logger.info(f"  session_deals: {symbol_info.session_deals}")
            logger.info(f"  session_buy_orders: {symbol_info.session_buy_orders}")
            logger.info(f"  session_sell_orders: {symbol_info.session_sell_orders}")
            logger.info(f"  visible: {symbol_info.visible}")
            logger.info(f"  description: {symbol_info.description}")
            
            # Para Forex demo, o book pode estar vazio - enviar mensagem informativa
            await self.broadcast({
                'type': 'ORDERBOOK',
                'data': {
                    'symbol': symbol,
                    'bids': [],
                    'asks': [],
                    'error': f'Book de ofertas não disponível: {error_code[1]}',
                    'errorCode': error_code[0],
                    'debug': {
                        'trade_mode': symbol_info.trade_mode,
                        'visible': symbol_info.visible,
                        'session_deals': symbol_info.session_deals,
                        'session_buy_orders': symbol_info.session_buy_orders,
                        'session_sell_orders': symbol_info.session_sell_orders,
                    }
                },
                'timestamp': datetime.now().isoformat(),
            })
            return
        
        # Extrair informações do símbolo
        symbol_info = mt5.symbol_info(symbol)
        digits = symbol_info.digits if symbol_info else 5
        
        # market_book_get() retorna uma lista de objetos (não bids/asks separados)
        # type=1 = ask (venda), type=2 = bid (compra)
        logger.info(f"Processando book de {len(order_book)} entradas...")
        
        bids = []
        asks = []
        
        for entry in order_book:
            # entry é um objeto com: time, type, price, volume, volume2
            entry_dict = entry._asdict()
            entry_type = entry_dict.get('type')
            price = entry_dict.get('price')
            volume = entry_dict.get('volume')
            volume2 = entry_dict.get('volume2', 0)
            total_volume = volume + volume2
            
            # type=1 = ask (ordem de venda), type=2 = bid (ordem de compra)
            if entry_type == 1:
                asks.append({
                    'price': price,
                    'volume': total_volume,
                })
                logger.info(f"  Ask: preço={price:.{digits}f}, volume={total_volume}")
            elif entry_type == 2:
                bids.append({
                    'price': price,
                    'volume': total_volume,
                })
                logger.info(f"  Bid: preço={price:.{digits}f}, volume={total_volume}")
        
        # Ordenar bids (maior preço primeiro) e asks (menor preço primeiro)
        bids.sort(key=lambda x: x['price'], reverse=True)
        asks.sort(key=lambda x: x['price'])
        
        logger.info(f"Book de ofertas processado: {len(bids)} bids, {len(asks)} asks")
        
        # Enviar book de ofertas
        await self.broadcast({
            'type': 'ORDERBOOK',
            'data': {
                'symbol': symbol,
                'bids': bids,
                'asks': asks,
                'digits': digits,
            },
            'timestamp': datetime.now().isoformat(),
        })
    
    async def handle_subscribe_order_book(self, data: Dict[str, Any]):
        """Inscrever em atualizações contínuas do book de ofertas"""
        symbol = data.get('symbol')
        logger.info(f"Inscrevendo em atualizações contínuas do book: {symbol}")
        
        if not MT5_AVAILABLE or not self.is_connected:
            logger.error("MT5 não disponível ou não conectado")
            return
        
        if not symbol:
            logger.error("Símbolo não fornecido para subscrição do book")
            return
        
        # Adicionar à lista de símbolos com book em atualização
        self.subscribed_order_books.add(symbol)
        
        # Subscrever ao DOM no MT5
        if hasattr(mt5, 'market_book_add'):
            if mt5.market_book_add(symbol):
                logger.info(f"Subscrição contínua ao DOM de {symbol} realizada com sucesso")
            else:
                error_code = mt5.last_error()
                logger.warning(f"Falha ao fazer market_book_add para {symbol}: {error_code}")
        
        # Enviar confirmação
        await self.broadcast({
            'type': 'ORDERBOOK_SUBSCRIBED',
            'data': {
                'symbol': symbol,
                'message': f'Subscrição ao book de ofertas de {symbol} realizada com sucesso',
            },
            'timestamp': datetime.now().isoformat(),
        })
    
    async def handle_unsubscribe_order_book(self, data: Dict[str, Any]):
        """Desinscrever de atualizações contínuas do book de ofertas"""
        symbol = data.get('symbol')
        logger.info(f"Desinscrevendo de atualizações contínuas do book: {symbol}")
        
        if not MT5_AVAILABLE or not self.is_connected:
            return
        
        # Remover da lista de símbolos com book em atualização
        if symbol in self.subscribed_order_books:
            self.subscribed_order_books.remove(symbol)
        
        # Liberar subscrição ao DOM no MT5
        if hasattr(mt5, 'market_book_release'):
            mt5.market_book_release(symbol)
            logger.info(f"Subscrição ao DOM de {symbol} liberada")
        
        # Enviar confirmação
        await self.broadcast({
            'type': 'ORDERBOOK_UNSUBSCRIBED',
            'data': {
                'symbol': symbol,
                'message': f'Desinscrição do book de ofertas de {symbol} realizada',
            },
            'timestamp': datetime.now().isoformat(),
        })
    
    async def handle_get_chart_data(self, data: Dict[str, Any]):
        """Obter dados de candlestick para o gráfico"""
        symbol = data.get('symbol')
        timeframe = data.get('timeframe', '1H')  # Padrão: 1 hora
        count = data.get('count', 100)  # Número de candles
        
        logger.info(f"Obtendo dados de gráfico: symbol={symbol}, timeframe={timeframe}, count={count}")
        
        if not MT5_AVAILABLE or not self.is_connected:
            logger.error("MT5 não disponível ou não conectado")
            await self._send_error('MT5 não disponível ou não conectado', 'NOT_CONNECTED', broadcast=True)
            return
        
        if not symbol:
            logger.error("Símbolo não fornecido")
            await self.broadcast({
                'type': 'ERROR',
                'data': {
                    'message': 'Símbolo não fornecido',
                    'code': 'NO_SYMBOL',
                },
                'timestamp': datetime.now().isoformat(),
            })
            return
        
        # Mapear timeframes do frontend para MT5
        tf_mapping = {
            '1m': mt5.TIMEFRAME_M1,
            '5m': mt5.TIMEFRAME_M5,
            '15m': mt5.TIMEFRAME_M15,
            '30m': mt5.TIMEFRAME_M30,
            '1H': mt5.TIMEFRAME_H1,
            '4H': mt5.TIMEFRAME_H4,
            '1D': mt5.TIMEFRAME_D1,
            '1W': mt5.TIMEFRAME_W1,
            '1M': mt5.TIMEFRAME_MN1,
        }
        
        mt5_timeframe = tf_mapping.get(timeframe, mt5.TIMEFRAME_H1)
        
        # Obter candles do MT5
        rates = mt5.copy_rates_from(symbol, mt5_timeframe, datetime.now(), count)
        
        if rates is None:
            error_code = mt5.last_error()
            logger.error(f"Erro ao obter dados de gráfico: {error_code}")
            await self.broadcast({
                'type': 'ERROR',
                'data': {
                    'message': f'Erro ao obter dados de gráfico: {error_code}',
                    'code': 'CHART_DATA_ERROR',
                },
                'timestamp': datetime.now().isoformat(),
            })
            return
        
        logger.info(f"Obtidos {len(rates)} candles para {symbol} ({timeframe})")
        
        # Converter para formato do TradingView
        chart_data = []
        for rate in rates:
            chart_data.append({
                'time': int(rate['time']),  # Já está em segundos
                'open': float(rate['open']),
                'high': float(rate['high']),
                'low': float(rate['low']),
                'close': float(rate['close']),
                'volume': int(rate['tick_volume']) if rate['tick_volume'] > 0 else 0,
            })
        
        # Enviar para o cliente
        await self.broadcast({
            'type': 'CHART_DATA',
            'data': {
                'symbol': symbol,
                'timeframe': timeframe,
                'candles': chart_data,
            },
            'timestamp': datetime.now().isoformat(),
        })
        
        logger.info(f"Dados de gráfico enviados: {len(chart_data)} candles")
    
    async def handle_get_history(self, data: Dict[str, Any]):
        """Obter histórico de trades"""
        from_date = data.get('fromDate')
        to_date = data.get('toDate')
        symbol = data.get('symbol')
        logger.info(f"Obtendo histórico: {symbol}")
        
        if not MT5_AVAILABLE or not self.is_connected:
            return
        
        # Se não fornecer datas, usar hoje
        if not from_date or not to_date:
            from_dt = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)
            to_dt = datetime.now()
        else:
            # Converter datas se fornecidas
            from_dt = datetime.fromisoformat(from_date) if from_date else datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)
            to_dt = datetime.fromisoformat(to_date) if to_date else datetime.now()
        
        # Passar symbol apenas se fornecido
        if symbol:
            history = mt5.history_deals_get(from_dt, to_dt, symbol=symbol)
        else:
            history = mt5.history_deals_get(from_dt, to_dt)
            
        if history is None:
            error_code = mt5.last_error()
            if error_code[0] != 0:  # Verifica se há erro real (erro não é (0, 'no error'))
                logger.error(f"Falha ao obter histórico: {error_code}")
            else:
                logger.info("Nenhum histórico encontrado")
            return
        
        for trade in history:
            await self.broadcast({
                'type': 'TRADE',
                'data': trade._asdict(),
                'timestamp': datetime.now().isoformat(),
            })
    
    async def handle_send_order(self, data: Dict[str, Any]):
        """Enviar ordem"""
        logger.info(f"=== INICIANDO ENVIO DE ORDEM ===")
        logger.info(f"Dados recebidos: {data}")
        
        if not MT5_AVAILABLE or not self.is_connected:
            logger.error("MT5 não disponível ou não conectado")
            await self._send_error('MT5 não disponível ou não conectado', 'NOT_CONNECTED', broadcast=True)
            return
        
        logger.info(f"MT5 disponível e conectado. Continuando...")
        
        # Criar estrutura de ordem
        symbol = data.get('symbol')
        order_type = data.get('type')
        volume = data.get('volume')
        price = data.get('price')
        sl = data.get('sl')
        tp = data.get('tp')
        comment = data.get('comment')
        
        logger.info(f"Parâmetros da ordem:")
        logger.info(f"  Símbolo: {symbol}")
        logger.info(f"  Tipo: {order_type}")
        logger.info(f"  Volume original: {volume}")
        logger.info(f"  Preço: {price}")
        logger.info(f"  SL: {sl}")
        logger.info(f"  TP: {tp}")
        logger.info(f"  Comment: {comment}")
        
        # Kill switch: bloqueia envio de ordens reais quando desabilitado.
        # Variável de ambiente WR_TRADING_ENABLED deve ser 'true' para operar.
        # Padrão: desabilitado (fail-closed) — nenhuma ordem real sem autorização explícita.
        trading_enabled = os.environ.get('WR_TRADING_ENABLED', 'false').lower() in ('true', '1', 'yes')
        if not trading_enabled:
            logger.warning("Envio de ordens BLOQUEADO por kill switch (WR_TRADING_ENABLED != 'true')")
            await self.broadcast({
                'type': 'ERROR',
                'data': {
                    'message': 'Operação de ordem desabilitada (kill switch ativo). Defina WR_TRADING_ENABLED=true para operar.',
                    'code': 'TRADING_DISABLED',
                },
                'timestamp': datetime.now().isoformat(),
            })
            return
        
        # Validações básicas
        if not symbol:
            logger.error("Símbolo não fornecido")
            await self.broadcast({
                'type': 'ERROR',
                'data': {
                    'message': 'Símbolo não fornecido',
                    'code': 'NO_SYMBOL',
                },
                'timestamp': datetime.now().isoformat(),
            })
            return
        
        if not volume or volume <= 0:
            logger.error(f"Volume inválido: {volume}")
            await self.broadcast({
                'type': 'ERROR',
                'data': {
                    'message': 'Volume inválido',
                    'code': 'INVALID_VOLUME',
                },
                'timestamp': datetime.now().isoformat(),
            })
            return
        
        # Mapear tipos de ordem
        mt5_order_type_mapping = {
            'ORDER_TYPE_BUY': mt5.ORDER_TYPE_BUY,
            'ORDER_TYPE_SELL': mt5.ORDER_TYPE_SELL,
            'ORDER_TYPE_BUY_LIMIT': mt5.ORDER_TYPE_BUY_LIMIT,
            'ORDER_TYPE_SELL_LIMIT': mt5.ORDER_TYPE_SELL_LIMIT,
            'ORDER_TYPE_BUY_STOP': mt5.ORDER_TYPE_BUY_STOP,
            'ORDER_TYPE_SELL_STOP': mt5.ORDER_TYPE_SELL_STOP,
        }
        mt5_order_type = mt5_order_type_mapping.get(order_type)
        if mt5_order_type is None:
            logger.error(f"Tipo de ordem desconhecido: {order_type}")
            await self.broadcast({
                'type': 'ERROR',
                'data': {
                    'message': f'Tipo de ordem desconhecido: {order_type}',
                    'code': 'INVALID_ORDER_TYPE',
                },
                'timestamp': datetime.now().isoformat(),
            })
            return
        logger.info(f"Tipo de ordem MT5: {mt5_order_type} (constante)")
        
        # Obter informações do símbolo para configurar volume e preenchimento
        logger.info(f"Obtendo informações do símbolo {symbol}...")
        symbol_info = mt5.symbol_info(symbol)
        if symbol_info is None:
            logger.error(f"Símbolo não encontrado: {symbol}")
            await self.broadcast({
                'type': 'ERROR',
                'data': {
                    'message': f'Símbolo não encontrado: {symbol}',
                    'code': 'SYMBOL_NOT_FOUND',
                },
                'timestamp': datetime.now().isoformat(),
            })
            return
        
        logger.info(f"Informações do símbolo {symbol}:")
        logger.info(f"  volume_min: {symbol_info.volume_min}")
        logger.info(f"  volume_max: {symbol_info.volume_max}")
        logger.info(f"  volume_step: {symbol_info.volume_step}")
        logger.info(f"  filling_mode: {symbol_info.filling_mode}")
        
        # O volume já vem em lotes do frontend, apenas normalizar para o step do símbolo
        logger.info(f"Normalizando volume {volume} para step do símbolo...")
        
        # Arredondar para o step de volume do símbolo
        volume_lots = round(volume / symbol_info.volume_step) * symbol_info.volume_step
        logger.info(f"  Volume normalizado: {volume_lots} lotes")
        
        # Verificar volume mínimo
        if volume_lots < symbol_info.volume_min:
            logger.error(f"Volume abaixo do mínimo: {volume_lots} < {symbol_info.volume_min}")
            await self.broadcast({
                'type': 'ERROR',
                'data': {
                    'message': f'Volume mínimo é {symbol_info.volume_min} lotes',
                    'code': 'VOLUME_TOO_SMALL',
                },
                'timestamp': datetime.now().isoformat(),
            })
            return
        
        # Verificar volume máximo
        if volume_lots > symbol_info.volume_max:
            logger.error(f"Volume acima do máximo: {volume_lots} > {symbol_info.volume_max}")
            await self.broadcast({
                'type': 'ERROR',
                'data': {
                    'message': f'Volume máximo é {symbol_info.volume_max} lotes',
                    'code': 'VOLUME_TOO_LARGE',
                },
                'timestamp': datetime.now().isoformat(),
            })
            return
        
        logger.info(f"Volume validado: {volume_lots} lotes")
        
        # Determinar tipo de preenchimento baseado no símbolo
        # ORDER_FILLING_FOK = 0 (Fill or Kill)
        # ORDER_FILLING_IOC = 1 (Immediate or Cancel)
        # ORDER_FILLING_RETURN = 2 (Return)
        filling_modes = symbol_info.filling_mode
        
        logger.info(f"Modos de preenchimento disponíveis: {filling_modes}")
        logger.info(f"  ORDER_FILLING_FOK (0): {bool(filling_modes & mt5.ORDER_FILLING_FOK)}")
        logger.info(f"  ORDER_FILLING_IOC (1): {bool(filling_modes & mt5.ORDER_FILLING_IOC)}")
        logger.info(f"  ORDER_FILLING_RETURN (2): {bool(filling_modes & mt5.ORDER_FILLING_RETURN)}")
        
        # Selecionar o tipo de preenchimento disponível
        if filling_modes & mt5.ORDER_FILLING_FOK:
            type_filling = mt5.ORDER_FILLING_FOK
        elif filling_modes & mt5.ORDER_FILLING_IOC:
            type_filling = mt5.ORDER_FILLING_IOC
        elif filling_modes & mt5.ORDER_FILLING_RETURN:
            type_filling = mt5.ORDER_FILLING_RETURN
        else:
            logger.warning(f"Não foi possível determinar tipo de preenchimento para {symbol}, usando padrão")
            type_filling = mt5.ORDER_FILLING_IOC
        
        logger.info(f"Tipo de preenchimento selecionado: {type_filling}")
        
        # Para ordens MARKET, obter preço atual do tick
        # ORDER_TYPE_BUY e ORDER_TYPE_SELL são ordens de mercado
        logger.info(f"Verificando preço. price={price}, mt5_order_type={mt5_order_type}")
        if price is None or price == 0:
            logger.info("Preço não fornecido, verificando se é ordem MARKET...")
            if mt5_order_type in [mt5.ORDER_TYPE_BUY, mt5.ORDER_TYPE_SELL]:
                logger.info(f"Obtendo tick atual para {symbol}...")
                tick = mt5.symbol_info_tick(symbol)
                if tick:
                    if mt5_order_type == mt5.ORDER_TYPE_BUY:
                        price = tick.ask
                        logger.info(f"Preço de compra (ASK): {price}")
                    else:
                        price = tick.bid
                        logger.info(f"Preço de venda (BID): {price}")
                    logger.info(f"Tick obtido: bid={tick.bid}, ask={tick.ask}")
                else:
                    logger.error(f"Não foi possível obter tick para {symbol}")
                    await self.broadcast({
                        'type': 'ERROR',
                        'data': {
                            'message': f'Não foi possível obter preço atual para {symbol}',
                            'code': 'NO_PRICE',
                        },
                        'timestamp': datetime.now().isoformat(),
                    })
                    return
            else:
                # Para ordens LIMIT/STOP, o preço é obrigatório
                logger.error(f"Preço obrigatório para ordem {order_type}")
                await self.broadcast({
                    'type': 'ERROR',
                    'data': {
                        'message': f'Preço obrigatório para ordens LIMIT/STOP',
                        'code': 'NO_PRICE',
                    },
                    'timestamp': datetime.now().isoformat(),
                })
                return
        else:
            logger.info(f"Preço fornecido: {price}")
        
        # Enviar ordem - preparar request
        request = {
            'action': mt5.TRADE_ACTION_DEAL,
            'symbol': symbol,
            'volume': volume_lots,
            'type': mt5_order_type,
            'price': price,
            'deviation': 20,
            'magic': 234000,
            'type_time': mt5.ORDER_TIME_GTC,
            'type_filling': type_filling,
        }
        
        # Adicionar campos opcionais apenas se forem válidos
        if comment:
            request['comment'] = comment
        
        # Adicionar Stop Loss apenas se for válido (não None e > 0)
        if sl is not None and sl > 0:
            request['sl'] = sl
        
        # Adicionar Take Profit apenas se for válido (não None e > 0)
        if tp is not None and tp > 0:
            # Validar direção do TP baseada no tipo de ordem
            # Para BUY/BUY_LIMIT/BUY_STOP: TP deve ser MAIOR que preço
            # Para SELL/SELL_LIMIT/SELL_STOP: TP deve ser MENOR que preço
            if mt5_order_type in [mt5.ORDER_TYPE_BUY, mt5.ORDER_TYPE_BUY_LIMIT, mt5.ORDER_TYPE_BUY_STOP]:
                if tp <= price:
                    logger.error(f"TP inválido para ordem BUY: TP ({tp}) deve ser MAIOR que preço ({price})")
                    await self.broadcast({
                        'type': 'ERROR',
                        'data': {
                            'message': f'Para ordem BUY, Take Profit deve ser MAIOR que preço de entrada. TP: {tp}, Preço: {price}',
                            'code': 'INVALID_TP',
                            'tp': tp,
                            'price': price,
                        },
                        'timestamp': datetime.now().isoformat(),
                    })
                    return
                logger.info(f"TP validado para BUY: {tp} > {price}")
            elif mt5_order_type in [mt5.ORDER_TYPE_SELL, mt5.ORDER_TYPE_SELL_LIMIT, mt5.ORDER_TYPE_SELL_STOP]:
                if tp >= price:
                    logger.error(f"TP inválido para ordem SELL: TP ({tp}) deve ser MENOR que preço ({price})")
                    await self.broadcast({
                        'type': 'ERROR',
                        'data': {
                            'message': f'Para ordem SELL, Take Profit deve ser MENOR que preço de entrada. TP: {tp}, Preço: {price}',
                            'code': 'INVALID_TP',
                            'tp': tp,
                            'price': price,
                        },
                        'timestamp': datetime.now().isoformat(),
                    })
                    return
                logger.info(f"TP validado para SELL: {tp} < {price}")
            
            request['tp'] = tp
        
        logger.info(f"Request final de ordem: {request}")
        logger.info(f"Enviando ordem para MT5...")
        
        logger.info(f"=== VERIFICANDO ORDEM (order_check) ===")
        check = mt5.order_check(request)
        if check is None or check.retcode != 0:
            error_code = check.retcode if check else mt5.last_error()
            logger.error(f"order_check falhou: {error_code}")
            await self.broadcast({
                'type': 'ERROR',
                'data': {
                    'message': f'Ordem rejeitada pela verificação prévia do broker: {error_code}',
                    'code': 'ORDER_CHECK_FAILED',
                    'mt5_code': error_code if isinstance(error_code, int) else None,
                },
                'timestamp': datetime.now().isoformat(),
            })
            return

        logger.info(f"=== ENVIANDO ORDEM PARA MT5 ===")
        logger.info(f"Request: {redacted_str(request)}")
        
        result = mt5.order_send(request)
        
        if result is None:
            error_code = mt5.last_error()
            logger.error(f"=== ERRO AO ENVIAR ORDEM ===")
            logger.error(f"Erro MT5: {error_code}")
            logger.error(f"  Código do erro: {error_code[0]}")
            logger.error(f"  Mensagem do erro: {error_code[1]}")
            logger.error(f"Request completo: {request}")
            
            await self.broadcast({
                'type': 'ERROR',
                'data': {
                    'message': f'{error_code[1] if error_code else "Falha ao enviar ordem"} (código: {error_code[0] if error_code else "desconhecido"})',
                    'code': 'SEND_FAILED',
                    'mt5_code': error_code[0] if error_code else None,
                    'mt5_message': error_code[1] if error_code else None,
                    'request': request,
                },
                'timestamp': datetime.now().isoformat(),
            })
            return
        
        logger.info(f"=== RESULTADO DA ORDEM ===")
        logger.info(f"retcode: {result.retcode}")
        logger.info(f"deal: {result.deal}")
        logger.info(f"order: {result.order}")
        logger.info(f"volume: {result.volume}")
        logger.info(f"price: {result.price}")
        # Acessar atributos diretamente (result é namedtuple, não dict)
        logger.info(f"sl: {result.sl if hasattr(result, 'sl') else 'N/A'}")
        logger.info(f"tp: {result.tp if hasattr(result, 'tp') else 'N/A'}")
        logger.info(f"comment: {result.comment}")
        logger.info(f"request_id: {result.request_id}")
        
        # Verificar se houve erro no resultado (retcode diferente de 10009)
        if result.retcode != 10009:  # 10009 = TRADE_RETCODE_DONE
            logger.error(f"=== ERRO NO RESULTADO DA ORDEM ===")
            logger.error(f"Código de retorno: {result.retcode}")
            logger.error(f"Comentário: {result.comment}")
            
            await self.broadcast({
                'type': 'ERROR',
                'data': {
                    'message': f'Ordem não executada: {result.comment} (código: {result.retcode})',
                    'code': 'ORDER_REJECTED',
                    'mt5_code': result.retcode,
                    'mt5_message': result.comment,
                    'order': result.order,
                },
                'timestamp': datetime.now().isoformat(),
            })
            return
        else:
            logger.info("Ordem executada com sucesso!")
            
        logger.info(f"=== FIM DA ORDEM ===")
        
        await self.broadcast({
            'type': 'ORDER_RESULT',
            'data': result._asdict(),
            'timestamp': datetime.now().isoformat(),
        })
    
    async def handle_modify_order(self, data: Dict[str, Any]):
        """Modificar ordem"""
        ticket = data.get('ticket')
        logger.info(f"Modificando ordem: {ticket}")
        
        if not MT5_AVAILABLE or not self.is_connected:
            return
        
        # Implementar modificação de ordem
        # Em produção, usaria mt5.order_send() com TRADE_ACTION_MODIFY
        pass
    
    async def handle_cancel_order(self, data: Dict[str, Any]):
        """Cancelar ordem"""
        ticket = data.get('ticket')
        logger.info(f"Cancelando ordem: {ticket}")
        
        if not MT5_AVAILABLE or not self.is_connected:
            return
        
        # Implementar cancelamento de ordem
        # Em produção, usaria mt5.order_send() com TRADE_ACTION_REMOVE
        pass
    
    async def handle_close_position(self, data: Dict[str, Any]):
        """Fechar posição"""
        ticket = data.get('ticket')
        volume = data.get('volume')
        logger.info(f"=== FECHAR POSIÇÃO ===")
        logger.info(f"Ticket: {ticket}")
        logger.info(f"Volume: {volume}")
        
        if not MT5_AVAILABLE or not self.is_connected:
            logger.error("MT5 não disponível ou não conectado")
            await self._send_error('MT5 não disponível ou não conectado', 'NOT_CONNECTED', broadcast=True)
            return
        
        # Buscar a posição para obter informações
        logger.info(f"Buscando posição #{ticket}...")
        positions = mt5.positions_get(ticket=ticket)
        if positions is None or len(positions) == 0:
            logger.error(f"Posição #{ticket} não encontrada")
            await self.broadcast({
                'type': 'ERROR',
                'data': {
                    'message': f'Posição #{ticket} não encontrada',
                    'code': 'POSITION_NOT_FOUND',
                },
                'timestamp': datetime.now().isoformat(),
            })
            return
        
        position = positions[0]
        logger.info(f"Posição encontrada: {position.symbol} - Tipo: {position.type} - Volume: {position.volume}")
        
        # Determinar tipo de ordem de fechamento (oposto ao tipo da posição)
        # POSITION_TYPE_BUY = 0 (posição de compra), fechar com SELL
        # POSITION_TYPE_SELL = 1 (posição de venda), fechar com BUY
        if position.type == 0:  # BUY position, close with SELL
            close_type = mt5.ORDER_TYPE_SELL
            logger.info("Fechando posição BUY com ordem SELL")
        else:  # SELL position, close with BUY
            close_type = mt5.ORDER_TYPE_BUY
            logger.info("Fechando posição SELL com ordem BUY")
        
        # Obter tick atual para preço
        tick = mt5.symbol_info_tick(position.symbol)
        if not tick:
            logger.error(f"Não foi possível obter tick para {position.symbol}")
            await self.broadcast({
                'type': 'ERROR',
                'data': {
                    'message': f'Não foi possível obter preço para {position.symbol}',
                    'code': 'NO_PRICE',
                },
                'timestamp': datetime.now().isoformat(),
            })
            return
        
        # Usar preço do tick (bid para SELL, ask para BUY)
        price = tick.bid if close_type == mt5.ORDER_TYPE_SELL else tick.ask
        logger.info(f"Preço de fechamento: {price}")
        
        # Determinar tipo de preenchimento
        symbol_info = mt5.symbol_info(position.symbol)
        if symbol_info:
            filling_modes = symbol_info.filling_mode
            if filling_modes & mt5.ORDER_FILLING_FOK:
                type_filling = mt5.ORDER_FILLING_FOK
            elif filling_modes & mt5.ORDER_FILLING_IOC:
                type_filling = mt5.ORDER_FILLING_IOC
            elif filling_modes & mt5.ORDER_FILLING_RETURN:
                type_filling = mt5.ORDER_FILLING_RETURN
            else:
                type_filling = mt5.ORDER_FILLING_IOC
        else:
            type_filling = mt5.ORDER_FILLING_IOC
        
        # Preparar requisição de fechamento
        request = {
            'action': mt5.TRADE_ACTION_DEAL,
            'symbol': position.symbol,
            'volume': position.volume,  # Usar volume atual da posição
            'type': close_type,
            'position': ticket,  # Ticket da posição para fechar
            'price': price,
            'deviation': 20,
            'magic': 234000,
            'comment': 'Fechamento via WR Trading Pro',
            'type_time': mt5.ORDER_TIME_GTC,
            'type_filling': type_filling,
        }
        
        logger.info(f"Enviando requisição de fechamento: {request}")
        
        # Enviar ordem de fechamento
        result = mt5.order_send(request)
        
        if result is None:
            error_code = mt5.last_error()
            logger.error(f"Falha ao fechar posição: {error_code}")
            await self.broadcast({
                'type': 'ERROR',
                'data': {
                    'message': f'Falha ao fechar posição: {error_code}',
                    'code': 'CLOSE_FAILED',
                },
                'timestamp': datetime.now().isoformat(),
            })
            return
        
        logger.info(f"=== RESULTADO DO FECHAMENTO ===")
        logger.info(f"retcode: {result.retcode}")
        logger.info(f"deal: {result.deal}")
        logger.info(f"order: {result.order}")
        logger.info(f"volume: {result.volume}")
        logger.info(f"price: {result.price}")
        
        if result.retcode == 10009:  # TRADE_RETCODE_DONE
            logger.info(f"Posição #{ticket} fechada com sucesso!")
            await self.broadcast({
                'type': 'ORDER_RESULT',
                'data': result._asdict(),
                'timestamp': datetime.now().isoformat(),
            })
        else:
            logger.error(f"Falha ao fechar posição (código {result.retcode})")
            await self.broadcast({
                'type': 'ERROR',
                'data': {
                    'message': f'Falha ao fechar posição (código: {result.retcode})',
                    'code': result.retcode,
                },
                'timestamp': datetime.now().isoformat(),
            })
    
    async def handle_close_position_by(self, data: Dict[str, Any]):
        """Fechar posição por posição oposta"""
        ticket = data.get('ticket')
        ticket_by = data.get('ticketBy')
        logger.info(f"Fechando posição por: {ticket} -> {ticket_by}")
        
        if not MT5_AVAILABLE or not self.is_connected:
            return
        
        # Implementar fechamento por posição oposta
        # Em produção, usaria mt5.order_send() com TRADE_ACTION_CLOSE_BY
        pass
    
    def get_symbol_digits(self, symbol: str) -> int:
        """Obter número de casas decimais do símbolo"""
        try:
            symbol_info = mt5.symbol_info(symbol)
            if symbol_info:
                return symbol_info.digits
            return 2  # Padrão: 2 casas decimais
        except Exception as e:
            logger.error(f"Erro ao obter digits de {symbol}: {e}")
            return 2  # Padrão: 2 casas decimais
    
    def get_previous_close_price(self, symbol: str) -> float:
        """Obter preço de fechamento do dia anterior"""
        try:
            # Buscar candles diárias - pegar mais candles para garantir que pegamos o fechamento correto
            rates = mt5.copy_rates_from(symbol, mt5.TIMEFRAME_D1, datetime.now(), 10)
            if rates is None or len(rates) == 0:
                logger.warning(f"Não foi possível obter histórico para {symbol}")
                return 0
            
            # copy_rates_from retorna candles em ordem crescente (mais antiga -> mais recente)
            # A candle mais recente é a última (índice -1)
            # Se a última candle é de hoje, usar a anterior (índice -2)
            # Se a última candle é de ontem, usar ela mesma
            if len(rates) >= 1:
                now = datetime.now()
                last_candle_time = datetime.fromtimestamp(rates[-1]['time'])
                days_since_last_candle = (now - last_candle_time).days
                
                if days_since_last_candle == 0:
                    # Última candle é de hoje, usar a anterior se disponível
                    if len(rates) >= 2:
                        return rates[-2]['close']
                    else:
                        # Não há candle anterior, usar a última mesmo
                        return rates[-1]['close']
                else:
                    # Última candle não é de hoje, usar ela como fechamento anterior
                    return rates[-1]['close']
            else:
                logger.warning(f"Não há candles suficientes para {symbol}")
                return 0
        except Exception as e:
            logger.error(f"Erro ao obter fechamento anterior de {symbol}: {e}")
            return 0
    
    def get_daily_change(self, symbol: str, current_price: float, previous_close: float) -> tuple[float, float]:
        """Calcular variação diária do ativo
        
        Returns:
            (change, change_percent): Variação absoluta e percentual
        """
        try:
            # Calcular variação em relação ao fechamento anterior
            # Fórmula: [(Preço Atual - Fechamento Anterior) / Fechamento Anterior] x 100
            if previous_close > 0:
                change = current_price - previous_close
                change_percent = (change / previous_close) * 100
                return change, change_percent
            else:
                return 0, 0
        except Exception as e:
            logger.error(f"Erro ao calcular variação diária de {symbol}: {e}")
            return 0, 0

    async def simulate_market_data(self):
        """Obter dados de mercado reais do MT5"""
        while True:
            if self.is_connected and self.clients:
                if MT5_AVAILABLE:
                    # Buscar tick real do MT5 para cada símbolo inscrito
                    # Criar cópia para evitar erro: Set changed size durante iteração
                    for symbol in list(self.subscribed_symbols):
                        # Obter fechamento do dia anterior se ainda não tiver
                        if symbol not in self.previous_close_prices:
                            self.previous_close_prices[symbol] = self.get_previous_close_price(symbol)
                        
                        tick = mt5.symbol_info_tick(symbol)
                        if tick:
                            prev_close = self.previous_close_prices.get(symbol, 0)
                            change, change_percent = self.get_daily_change(symbol, tick.bid, prev_close)
                            digits = self.get_symbol_digits(symbol)
                            
                            await self.broadcast({
                                'type': 'TICK',
                                'data': {
                                    'symbol': symbol,
                                    'time': datetime.fromtimestamp(tick.time).isoformat() if tick.time else datetime.now().isoformat(),
                                    'bid': tick.bid,
                                    'ask': tick.ask,
                                    'last': tick.last,
                                    'volume': tick.volume,
                                    'volumeReal': tick.volume_real,
                                    'timeMsc': tick.time_msc,
                                    'flags': tick.flags,
                                    'volumeDiff': 0,
                                    'previousClose': prev_close,
                                    'change': change,
                                    'changePercent': change_percent,
                                    'digits': digits,  # Número de casas decimais do símbolo
                                },
                                'timestamp': datetime.now().isoformat(),
                            })
                            logger.info(f"Tick enviado para {symbol}: bid={tick.bid}, change={change:.2f}, change_percent={change_percent:.4f}%, digits={digits}")
                        else:
                            logger.warning(f"Não foi possível obter tick para {symbol}")
                            error_code = mt5.last_error()
                            if error_code[0] != 0:
                                logger.error(f"Erro ao obter tick: {error_code}")
                    
                    # Buscar atualizações do book de ofertas para símbolos inscritos
                    # Criar cópia para evitar erro: Set changed size durante iteração
                    for symbol in list(self.subscribed_order_books):
                        order_book = mt5.market_book_get(symbol)
                        if order_book and len(order_book) > 0:
                            # Processar book
                            symbol_info = mt5.symbol_info(symbol)
                            digits = symbol_info.digits if symbol_info else 5
                            
                            bids = []
                            asks = []
                            
                            for entry in order_book:
                                entry_dict = entry._asdict()
                                entry_type = entry_dict.get('type')
                                price = entry_dict.get('price')
                                volume = entry_dict.get('volume')
                                volume2 = entry_dict.get('volume2', 0)
                                total_volume = volume + volume2
                                
                                if entry_type == 1:  # Ask
                                    asks.append({'price': price, 'volume': total_volume})
                                elif entry_type == 2:  # Bid
                                    bids.append({'price': price, 'volume': total_volume})
                            
                            # Ordenar
                            bids.sort(key=lambda x: x['price'], reverse=True)
                            asks.sort(key=lambda x: x['price'])
                            
                            # Enviar atualização do book
                            await self.broadcast({
                                'type': 'ORDERBOOK',
                                'data': {
                                    'symbol': symbol,
                                    'bids': bids,
                                    'asks': asks,
                                    'digits': digits,
                                },
                                'timestamp': datetime.now().isoformat(),
                            })
                    
                    # Buscar ordens pendentes periodicamente (a cada 2 segundos)
                    await self.broadcast_orders_and_trades()
                    
                    # Atualizar e enviar informações da conta periodicamente
                    await self.broadcast_account_info()
            
            await asyncio.sleep(0.5)  # Atualizar a cada 500ms para resposta mais rápida
    
    async def broadcast_orders_and_trades(self):
        """Buscar e enviar ordens e trades periodicamente"""
        try:
            # Buscar apenas ordens pendentes ativas (não executadas)
            orders = mt5.orders_get()
            if orders and len(orders) > 0:
                for order in orders:
                    order_dict = order._asdict()
                    # Enviar apenas ordens pendentes (state != FILLED/CANCELED/REJECTED)
                    state = order_dict.get('state')
                    if state and state not in [4, 5, 6]:  # FILLED, REJECTED, EXPIRED
                        await self.broadcast({
                            'type': 'ORDER',
                            'data': order_dict,
                            'timestamp': datetime.now().isoformat(),
                        })
            
            # Não enviar histórico de ordens automaticamente para evitar spam de logs
            # Histórico pode ser solicitado explicitamente via GET_HISTORY
        except Exception as e:
            logger.error(f"Erro ao buscar ordens: {e}")

    async def broadcast_account_info(self):
        """Buscar e enviar informações da conta periodicamente"""
        try:
            # Obter informações atualizadas da conta
            account_info = mt5.account_info()
            if account_info:
                account_dict = account_info._asdict()
                
                # Converter snake_case para camelCase
                account_dict = self.to_camel_case(account_dict)
                
                # Logar informações de margem para debug
                logger.info(f"Account Info - Margem Livre: {account_dict.get('marginFree')}, Nível: {account_dict.get('marginLevel')}")
                
                # Enviar para todos os clientes
                await self.broadcast({
                    'type': 'ACCOUNT',
                    'data': account_dict,
                    'timestamp': datetime.now().isoformat(),
                })
        except Exception as e:
            logger.error(f"Erro ao buscar informações da conta: {e}")


async def main():
    """Função principal do servidor"""
    bridge = MT5Bridge()

    if ws_token_mod.get_ws_token_secret() is None:
        logger.warning(
            "WR_WS_TOKEN_SECRET não configurado (mínimo 32 caracteres) — "
            "todas as conexões WebSocket serão rejeitadas (fail-closed). "
            "Ver docs/WS_AUTH.md."
        )

    # Iniciar tarefa de simulação de dados de mercado
    asyncio.create_task(bridge.simulate_market_data())
    
    # Iniciar servidor WebSocket com retry na porta 8766
    port = 8766
    max_retries = 5
    retry_delay = 2  # segundos entre tentativas
    
    for attempt in range(max_retries):
        try:
            logger.info(f"Iniciando servidor MT5 Bridge na porta {port}... (tentativa {attempt + 1}/{max_retries})")
            
            # Criar servidor com SO_REUSEADDR para evitar TIME_WAIT
            import socket as socket_mod
            sock = socket_mod.socket(socket_mod.AF_INET, socket_mod.SOCK_STREAM)
            sock.setsockopt(socket_mod.SOL_SOCKET, socket_mod.SO_REUSEADDR, 1)
            sock.setblocking(False)
            sock.bind(('localhost', port))
            
            server = await serve(
                lambda ws: handle_client(bridge, ws),
                sock=sock,
                ping_interval=20,
                ping_timeout=20,
            )
            logger.info(f"Servidor WebSocket iniciado com sucesso na porta {port}")
            await asyncio.Future()  # Rodar indefinidamente
        except OSError as e:
            if hasattr(e, 'winerror') and e.winerror == 10048:  # Porta já em uso
                if attempt < max_retries - 1:
                    logger.warning(f"Porta {port} ainda em uso (TIME_WAIT?). Aguardando {retry_delay}s e tentando novamente...")
                    await asyncio.sleep(retry_delay)
                    retry_delay *= 2  # backoff exponencial
                else:
                    logger.error(f"Não foi possível iniciar o servidor. Portas {8766}-{port} já estão em uso.")
                    logger.error("Por favor, feche outras instâncias do mt5_bridge.py ou use uma porta diferente.")
                    return
            else:
                logger.error(f"Erro ao iniciar servidor: {e}")
                return


# Tempo máximo para o cliente enviar a mensagem AUTH após conectar
AUTH_TIMEOUT_SECONDS = 5

# Replay cache global: cada jti de token WS só pode ser consumido uma vez
_ws_replay_cache = ws_token_mod.ReplayCache()


async def authenticate_client(websocket: Any) -> bool:
    """Exige AUTH com token efêmero válido antes de registrar o cliente.

    Fail-closed: secret ausente, timeout, token inválido/expirado ou replay
    fecham a conexão com 1008 e razão genérica. O token nunca é logado.
    """
    secret = ws_token_mod.get_ws_token_secret()
    if not secret:
        logger.warning(
            "Conexão WebSocket rejeitada — WR_WS_TOKEN_SECRET ausente ou curto demais "
            "(mínimo 32 caracteres). Configure o mesmo secret no Next e no bridge."
        )
        await websocket.close(code=1008, reason='Authentication unavailable')
        return False

    try:
        raw = await asyncio.wait_for(websocket.recv(), timeout=AUTH_TIMEOUT_SECONDS)
    except asyncio.TimeoutError:
        logger.warning("Conexão WebSocket rejeitada — AUTH não recebido a tempo")
        await websocket.close(code=1008, reason='Authentication required')
        return False
    except websockets.exceptions.ConnectionClosed:
        return False

    token = None
    try:
        message = json.loads(raw)
        if isinstance(message, dict) and message.get('type') == 'AUTH':
            data = message.get('data')
            if isinstance(data, dict):
                token = data.get('token')
    except (ValueError, TypeError):
        token = None

    payload = ws_token_mod.verify_ws_token(token, secret)
    if payload is None:
        logger.warning("Conexão WebSocket rejeitada — token de autenticação inválido")
        await websocket.close(code=1008, reason='Authentication failed')
        return False

    if not _ws_replay_cache.consume(payload['jti'], payload['exp']):
        logger.warning("Conexão WebSocket rejeitada — token de autenticação reutilizado")
        await websocket.close(code=1008, reason='Authentication failed')
        return False

    await websocket.send(json.dumps({
        'type': 'AUTH_OK',
        'data': {'sub': payload['sub']},
        'timestamp': datetime.now().isoformat(),
    }))
    return True


async def handle_client(bridge: MT5Bridge, websocket: Any):
    """Handler para conexões de clientes"""
    # Validar Origin para mitigar Cross-Site WebSocket Hijacking.
    # Apenas origens locais são aceitas; 'null' ou ausente são rejeitados.
    origin = getattr(websocket, 'request_headers', {}).get('Origin') if hasattr(websocket, 'request_headers') else None
    allowed_origins = set(CORS_OPTIONS.get('origins', []))
    if origin is not None and origin not in allowed_origins:
        logger.warning(f"Conexão WebSocket rejeitada — Origin não autorizada: {origin}")
        await websocket.close(code=1008, reason='Origin not allowed')
        return
    if origin is None:
        logger.warning("Conexão WebSocket com Origin ausente — rejeitada por segurança")
        await websocket.close(code=1008, reason='Origin required')
        return

    # Autenticação obrigatória ANTES de registrar: clientes não autenticados
    # nunca entram em bridge.clients (não recebem broadcasts nem enviam comandos)
    try:
        if not await authenticate_client(websocket):
            return
    except Exception:
        # Razão genérica; nunca logar o conteúdo da mensagem AUTH
        logger.warning("Conexão WebSocket rejeitada — falha na autenticação")
        try:
            await websocket.close(code=1008, reason='Authentication failed')
        except Exception:
            pass
        return

    await bridge.register_client(websocket)
    
    try:
        async for message in websocket:
            await bridge.handle_message(websocket, message)
    except websockets.exceptions.ConnectionClosed:
        logger.info("Conexão fechada pelo cliente")
    except Exception as e:
        logger.error(f"Erro na conexão do cliente: {e}")
    finally:
        await bridge.unregister_client(websocket)


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        logger.info("Servidor encerrado pelo usuário")
        if MT5_AVAILABLE and mt5.initialize():
            mt5.shutdown()
    except Exception as e:
        logger.error(f"Erro fatal: {e}")
