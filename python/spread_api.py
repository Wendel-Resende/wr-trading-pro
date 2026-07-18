"""
API para análise de spread B3 usando Python
Esta API permite que o frontend Next.js faça análises de spread usando Python
"""
from flask import Flask, jsonify, request
from flask_cors import CORS
import MetaTrader5 as mt5
import pandas as pd
from datetime import datetime, timedelta
import logging
from typing import Dict, List, Any, Set, Optional
from dataclasses import dataclass, field
from threading import Lock
import math
import os
import sys

# Configuração de rede segura (loopback + CORS allowlist)
from network_config import NETWORK_HOST, CORS_OPTIONS

# Configuração de logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("spread_api")

# Adiciona o diretório Projeto_spread ao path
sys.path.append(os.path.join(os.path.dirname(__file__), 'Projeto_spread'))

app = Flask(__name__)
CORS(app, **CORS_OPTIONS)  # Allowlist estrita de origens locais

# Importa lista de pares do arquivo pares_acoes.py
try:
    from pares_acoes import PARES_SUGERIDOS as PARES_COMPLETOS
    logger.info(f"Carregados {len(PARES_COMPLETOS)} pares do arquivo pares_acoes.py")
except ImportError as e:
    logger.warning(f"Não foi possível importar pares_acoes.py: {e}")
    PARES_COMPLETOS = []

app = Flask(__name__)
CORS(app, **CORS_OPTIONS)  # Allowlist estrita de origens locais

@dataclass
class AssetCache:
    """Thread-safe cache para ativos verificados"""
    valid: Set[str] = field(default_factory=set)
    invalid: Set[str] = field(default_factory=set)
    verified: Set[str] = field(default_factory=set)
    _lock: Lock = field(default_factory=Lock)

    def is_verified(self, symbol: str) -> Optional[bool]:
        with self._lock:
            if symbol not in self.verified:
                return None
            return symbol in self.valid

    def mark_valid(self, symbol: str) -> None:
        with self._lock:
            self.valid.add(symbol)
            self.verified.add(symbol)

    def mark_invalid(self, symbol: str) -> None:
        with self._lock:
            self.invalid.add(symbol)
            self.verified.add(symbol)

    def clear(self) -> None:
        with self._lock:
            self.valid.clear()
            self.invalid.clear()
            self.verified.clear()

# Instância global thread-safe
asset_cache = AssetCache()

class SpreadCalculator:
    """Calculadora de spreads usando Python e MetaTrader5"""

    def __init__(self):
        self.initialized = False
        self.min_periodos_filtro = 60
        self.min_correlacao_filtro = 0.55
        self.min_abs_zscore_filtro = 1.00
        self.max_half_life_filtro = 45.0
        self.min_cruzamentos_media_filtro = 2

    def verificar_ativo(self, symbol: str) -> bool:
        """Verifica se um ativo existe na B3 via MT5"""
        # Verifica cache thread-safe
        cached = asset_cache.is_verified(symbol)
        if cached is not None:
            return cached

        try:
            if not self.initialize_mt5():
                asset_cache.mark_invalid(symbol)
                return False

            # Tenta obter informações do ativo
            info = mt5.symbol_info(symbol)
            if info is not None and info.visible:
                asset_cache.mark_valid(symbol)
                logger.info(f"Ativo {symbol} existe na B3")
                return True
            else:
                asset_cache.mark_invalid(symbol)
                logger.warning(f"Ativo {symbol} não existe na B3")
                return False

        except Exception as e:
            logger.error(f"Erro ao verificar ativo {symbol}: {str(e)}")
            asset_cache.mark_invalid(symbol)
            return False
    
    def initialize_mt5(self) -> bool:
        """Inicializa conexão com MetaTrader5"""
        if not self.initialized:
            try:
                if mt5.initialize():
                    self.initialized = True
                    logger.info("MetaTrader5 inicializado com sucesso")
                    return True
                else:
                    error_code = mt5.last_error()
                    logger.error(f"Erro ao inicializar MT5: {error_code}")
                    return False
            except Exception as e:
                logger.error(f"Exceção ao inicializar MT5: {str(e)}")
                return False
        return True
    
    def get_stock_data(self, symbol: str, data_inicial: datetime, data_final: datetime) -> pd.DataFrame:
        """Obtém dados históricos de um ativo"""
        try:
            if not self.initialize_mt5():
                return None
            
            # Converte datas para timestamp
            data_inicial_ts = int(datetime.combine(data_inicial, datetime.min.time()).timestamp())
            data_final_ts = int(datetime.combine(data_final, datetime.min.time()).timestamp())
            
            # Obtém dados históricos
            rates = mt5.copy_rates_range(symbol, mt5.TIMEFRAME_D1, data_inicial_ts, data_final_ts)
            
            if rates is None or len(rates) == 0:
                logger.warning(f"Nenhum dado encontrado para {symbol}")
                return None
            
            # Converte para DataFrame
            df = pd.DataFrame(rates)
            df['time'] = pd.to_datetime(df['time'], unit='s')
            
            return df
            
        except Exception as e:
            logger.error(f"Erro ao obter dados de {symbol}: {str(e)}")
            return None

    def preparar_historico_alinhado(self, hist1: pd.DataFrame, hist2: pd.DataFrame) -> pd.DataFrame:
        """Agrupa candles por dia e mantém apenas datas comuns aos dois ativos."""
        hist1_daily = hist1.groupby(hist1['time'].dt.date).agg({
            'open': 'first',
            'high': 'max',
            'low': 'min',
            'close': 'last',
            'tick_volume': 'sum'
        })

        hist2_daily = hist2.groupby(hist2['time'].dt.date).agg({
            'open': 'first',
            'high': 'max',
            'low': 'min',
            'close': 'last',
            'tick_volume': 'sum'
        })

        aligned = hist1_daily.join(
            hist2_daily,
            how='inner',
            lsuffix='_1',
            rsuffix='_2'
        ).dropna()

        return aligned.sort_index()

    def calcular_half_life(self, spread: pd.Series) -> Optional[float]:
        """Estima a meia-vida de reversão à média do spread por regressão AR(1)."""
        if len(spread) < 3:
            return None

        spread_lag = spread.shift(1).dropna()
        delta_spread = spread.diff().dropna()
        spread_lag, delta_spread = spread_lag.align(delta_spread, join='inner')

        if spread_lag.empty or delta_spread.empty:
            return None

        x = spread_lag - spread_lag.mean()
        denominator = float((x * x).sum())
        if denominator == 0:
            return None

        beta = float((x * delta_spread).sum() / denominator)
        if beta >= 0:
            return None

        half_life = -math.log(2) / beta
        if not math.isfinite(half_life):
            return None

        return float(half_life)

    def calcular_qualidade_par(
        self,
        symbol1: str,
        symbol2: str,
        hist1: pd.DataFrame,
        hist2: pd.DataFrame,
        current_price1: Optional[float] = None,
        current_price2: Optional[float] = None
    ) -> Dict:
        """Calcula filtros para responder se o par é bom para estratégia de spread."""
        aligned = self.preparar_historico_alinhado(hist1, hist2)
        motivos = []

        if len(aligned) < 2:
            return {
                'ideal': False,
                'score': 0.0,
                'motivos': ['Histórico insuficiente para comparar o par'],
                'periodos': int(len(aligned)),
                'sinal': 'AGUARDAR',
                'direcao_entrada': 'Sem dados suficientes'
            }

        close1 = aligned['close_1'].astype(float)
        close2 = aligned['close_2'].astype(float)
        returns1 = close1.pct_change().dropna()
        returns2 = close2.pct_change().dropna()
        returns1, returns2 = returns1.align(returns2, join='inner')

        spread = close1 - close2
        spread_medio = float(spread.mean())
        desvio_spread = float(spread.std())
        spread_atual_assinado = (
            float(current_price1 - current_price2)
            if current_price1 is not None and current_price2 is not None
            else float(spread.iloc[-1])
        )

        correlacao_precos = close1.corr(close2)
        correlacao_retornos = returns1.corr(returns2) if len(returns1) > 1 else None
        half_life = self.calcular_half_life(spread)
        zscore = 0.0 if desvio_spread == 0 else float((spread_atual_assinado - spread_medio) / desvio_spread)

        centered = spread - spread_medio
        sinais = centered.apply(lambda value: 1 if value > 0 else (-1 if value < 0 else 0))
        cruzamentos_media = int(((sinais.shift(1) * sinais) < 0).sum())

        correlacao_base = correlacao_retornos
        if correlacao_base is None or pd.isna(correlacao_base):
            correlacao_base = correlacao_precos
        correlacao_base = 0.0 if correlacao_base is None or pd.isna(correlacao_base) else float(correlacao_base)

        periodos_ok = len(aligned) >= self.min_periodos_filtro
        correlacao_ok = correlacao_base >= self.min_correlacao_filtro
        zscore_ok = abs(zscore) >= self.min_abs_zscore_filtro
        half_life_ok = half_life is not None and 1 <= half_life <= self.max_half_life_filtro
        cruzamentos_ok = cruzamentos_media >= self.min_cruzamentos_media_filtro

        if not periodos_ok:
            motivos.append(f"Histórico curto: {len(aligned)} pregões")
        if not correlacao_ok:
            motivos.append(f"Correlação baixa: {correlacao_base:.2f}")
        if not zscore_ok:
            motivos.append(f"Spread perto da média: z-score {zscore:.2f}")
        if not half_life_ok:
            motivos.append("Meia-vida de reversão fora do alvo")
        if not cruzamentos_ok:
            motivos.append("Poucos cruzamentos da média no período")

        if zscore > 0:
            sinal = 'VENDER_SPREAD'
            direcao_entrada = f"Vender {symbol1} e comprar {symbol2}"
        elif zscore < 0:
            sinal = 'COMPRAR_SPREAD'
            direcao_entrada = f"Comprar {symbol1} e vender {symbol2}"
        else:
            sinal = 'AGUARDAR'
            direcao_entrada = 'Aguardar spread se afastar da média'

        score_correlacao = max(0.0, min(1.0, correlacao_base))
        score_zscore = max(0.0, min(1.0, abs(zscore) / 2.5))
        score_half_life = 0.0 if half_life is None else max(0.0, min(1.0, 1 - (half_life / self.max_half_life_filtro)))
        score_cruzamentos = max(0.0, min(1.0, cruzamentos_media / 8))
        score_periodos = max(0.0, min(1.0, len(aligned) / 252))
        score = (
            score_correlacao * 30
            + score_zscore * 30
            + score_half_life * 20
            + score_cruzamentos * 10
            + score_periodos * 10
        )

        ideal = periodos_ok and correlacao_ok and zscore_ok and half_life_ok and cruzamentos_ok
        if ideal:
            motivos.append("Par dentro dos filtros estatísticos para entrada")

        return {
            'ideal': bool(ideal),
            'score': round(float(score), 2),
            'motivos': motivos,
            'sinal': sinal,
            'direcao_entrada': direcao_entrada,
            'periodos': int(len(aligned)),
            'correlacao': round(float(correlacao_base), 4),
            'correlacao_precos': None if correlacao_precos is None or pd.isna(correlacao_precos) else round(float(correlacao_precos), 4),
            'correlacao_retornos': None if correlacao_retornos is None or pd.isna(correlacao_retornos) else round(float(correlacao_retornos), 4),
            'zscore': round(float(zscore), 4),
            'spread_medio': round(float(spread_medio), 4),
            'desvio_spread': round(float(desvio_spread), 4),
            'spread_atual_assinado': round(float(spread_atual_assinado), 4),
            'half_life': None if half_life is None else round(float(half_life), 2),
            'cruzamentos_media': cruzamentos_media
        }

    def classificar_operacional(self, qualidade: Dict, oportunidades_count: int) -> str:
        """Classifica o par em uma leitura prática para decisão operacional."""
        score = float(qualidade.get('score') or 0)
        correlacao = float(qualidade.get('correlacao') or 0)
        zscore = abs(float(qualidade.get('zscore') or 0))
        half_life = qualidade.get('half_life')
        ideal = bool(qualidade.get('ideal'))

        if ideal:
            if (
                score >= 75
                and correlacao >= 0.65
                and half_life is not None
                and float(half_life) <= 25
            ):
                return 'Ideal Forte'
            return 'Ideal Limite'

        if oportunidades_count > 0 and (zscore >= 1.0 or score >= 50):
            return 'Acompanhar'

        return 'Fraco'
    
    def encontrar_oportunidades(self, hist1: pd.DataFrame, hist2: pd.DataFrame, ganho_minimo: float = 0.10) -> List[Dict]:
        """Encontra oportunidades de arbitragem entre dois ativos"""
        oportunidades = []
        historico = self.preparar_historico_alinhado(hist1, hist2)
        
        # Analisa dias consecutivos
        for i in range(len(historico)-1):
            data_atual = historico.index[i]
            data_seguinte = historico.index[i+1]
            linha_atual = historico.iloc[i]
            linha_seguinte = historico.iloc[i + 1]
            
            # Valida volume
            volume1 = linha_atual['tick_volume_1']
            volume2 = linha_atual['tick_volume_2']
            
            if volume1 == 0 or volume2 == 0:
                continue
            
            # Preços do dia atual
            preco_a1 = linha_atual['close_1']
            preco_b1 = linha_atual['close_2']
            
            # Preços do dia seguinte
            preco_a2 = linha_seguinte['close_1']
            preco_b2 = linha_seguinte['close_2']
            
            # Calcula ganho assumindo a direção do spread no dia de entrada.
            if preco_a1 >= preco_b1:
                acao_1 = 'sell'
                acao_2 = 'buy'
                ganho = (preco_a1 - preco_a2) + (preco_b2 - preco_b1)
            else:
                acao_1 = 'buy'
                acao_2 = 'sell'
                ganho = (preco_a2 - preco_a1) + (preco_b1 - preco_b2)
            
            # Considera apenas ganhos positivos
            if ganho <= 0:
                continue
            
            # Calcula volume médio
            volume_medio_a = (linha_atual['tick_volume_1'] + linha_seguinte['tick_volume_1']) / 2
            volume_medio_b = (linha_atual['tick_volume_2'] + linha_seguinte['tick_volume_2']) / 2
            
            # Filtra por ganho mínimo e volume
            if ganho >= ganho_minimo and volume_medio_a > 0 and volume_medio_b > 0:
                oportunidade = {
                    'data_entrada': data_atual.isoformat(),
                    'data_saida': data_seguinte.isoformat(),
                    'preco_venda_a1': float(preco_a1),
                    'preco_compra_b1': float(preco_b1),
                    'preco_venda_b2': float(preco_b2),
                    'preco_compra_a2': float(preco_a2),
                    'ganho': float(ganho),
                    'volume_medio_a': float(volume_medio_a),
                    'volume_medio_b': float(volume_medio_b),
                    'retorno_percentual': float((ganho / max(preco_a1, preco_b1)) * 100),
                    'acao_1': acao_1,
                    'acao_2': acao_2
                }
                oportunidades.append(oportunidade)
        
        return oportunidades
    
    def get_current_price(self, symbol: str) -> float:
        """Obtém o preço atual em tempo real de um ativo"""
        try:
            if not self.initialize_mt5():
                return None
            
            # Obtém o último tick
            tick = mt5.symbol_info_tick(symbol)
            if tick is None:
                logger.warning(f"Não foi possível obter tick atual para {symbol}")
                return None
            
            # Retorna o preço médio entre bid e ask
            current_price = (tick.bid + tick.ask) / 2
            return current_price
            
        except Exception as e:
            logger.error(f"Erro ao obter preço atual de {symbol}: {str(e)}")
            return None
    
    def calcular_spread(self, symbol1: str, symbol2: str, data_inicial: datetime, data_final: datetime, ganho_minimo: float = 0.10) -> Dict:
        """Calcula spread entre dois ativos"""
        try:
            logger.info(f"Calculando spread para {symbol1}-{symbol2}")
            
            # Obtém dados
            hist1 = self.get_stock_data(symbol1, data_inicial, data_final)
            hist2 = self.get_stock_data(symbol2, data_inicial, data_final)
            
            if hist1 is None or hist2 is None:
                logger.warning(f"Dados não disponíveis para {symbol1}-{symbol2}")
                return None
            
            # Encontra oportunidades
            oportunidades = self.encontrar_oportunidades(hist1, hist2, ganho_minimo)

            # Preços atuais (obtém em tempo real do MT5)
            current_price1 = self.get_current_price(symbol1)
            current_price2 = self.get_current_price(symbol2)
            
            # Se falhou obter preço atual, usa último preço do histórico
            if current_price1 is None:
                current_price1 = float(hist1['close'].iloc[-1])
                logger.warning(f"Usando preço histórico para {symbol1}")
            if current_price2 is None:
                current_price2 = float(hist2['close'].iloc[-1])
                logger.warning(f"Usando preço histórico para {symbol2}")

            qualidade = self.calcular_qualidade_par(
                symbol1,
                symbol2,
                hist1,
                hist2,
                current_price1,
                current_price2
            )

            if len(oportunidades) == 0:
                qualidade['ideal'] = False
                qualidade.setdefault('motivos', []).append(
                    f"Nenhuma oportunidade histórica atingiu o ganho mínimo de R$ {ganho_minimo:.2f}"
                )

            qualidade['classificacao_operacional'] = self.classificar_operacional(
                qualidade,
                len(oportunidades)
            )
            
            # Agrupa oportunidades por mês
            oportunidades_por_mes = {}
            for op in oportunidades:
                data = datetime.fromisoformat(op['data_entrada'])
                mes = data.strftime('%Y-%m')
                if mes not in oportunidades_por_mes:
                    oportunidades_por_mes[mes] = 0
                oportunidades_por_mes[mes] += 1
            
            logger.info(f"Spread calculado para {symbol1}-{symbol2}: {len(oportunidades)} oportunidades")
            
            return {
                'symbol1': symbol1,
                'symbol2': symbol2,
                'current_price1': current_price1,
                'current_price2': current_price2,
                'spread_atual': abs(current_price1 - current_price2),
                'qualidade': qualidade,
                'oportunidades': oportunidades,
                'oportunidades_por_mes': oportunidades_por_mes,
                'total_oportunidades': len(oportunidades)
            }
            
        except Exception as e:
            logger.error(f"Erro ao calcular spread para {symbol1}-{symbol2}: {str(e)}")
            return None
    
    def filtrar_pares_validos(self, pares: List[tuple]) -> List[tuple]:
        """Filtra pares mantendo apenas ativos válidos"""
        logger.info(f"Filtrando {len(pares)} pares... Ativos já verificados: {len(asset_cache.verified)}")

        pares_filtrados = []
        for symbol1, symbol2 in pares:
            # Verifica se ambos os ativos são válidos
            if self.verificar_ativo(symbol1) and self.verificar_ativo(symbol2):
                pares_filtrados.append((symbol1, symbol2))

        logger.info(f"Pares válidos após filtragem: {len(pares_filtrados)}/{len(pares)}")
        logger.info(f"Ativos válidos: {len(asset_cache.valid)}, Ativos inválidos: {len(asset_cache.invalid)}")

        return pares_filtrados

    def encontrar_melhores_pares(self, data_inicial: datetime, data_final: datetime, ganho_minimo: float = 0.10) -> List[Dict]:
        """Encontra os melhores pares para arbitragem"""
        logger.info(f"Iniciando busca de melhores pares (ganho_minimo: {ganho_minimo})")

        # Usa lista completa de pares do arquivo pares_acoes.py
        pares_para_analisar = PARES_COMPLETOS if PARES_COMPLETOS else []

        if not pares_para_analisar:
            logger.warning("Nenhum par encontrado para análise")
            return []

        # Filtra apenas pares com ativos válidos
        pares_validos = self.filtrar_pares_validos(pares_para_analisar)

        if not pares_validos:
            logger.warning("Nenhum par válido encontrado após filtragem")
            return []

        resultados_pares = []

        for i, (symbol1, symbol2) in enumerate(pares_validos):
            logger.info(f"Analisando par {i+1}/{len(pares_validos)}: {symbol1}-{symbol2}")
            
            resultado = self.calcular_spread(symbol1, symbol2, data_inicial, data_final, ganho_minimo)
            
            if resultado:
                # Calcula métricas
                if resultado['oportunidades']:
                    maior_ganho = max(op['ganho'] for op in resultado['oportunidades'])
                    melhor_retorno = max(op['retorno_percentual'] for op in resultado['oportunidades'])
                else:
                    maior_ganho = 0
                    melhor_retorno = 0
                
                par_resultado = {
                    'par': f"{symbol1}-{symbol2}",
                    'symbol1': symbol1,
                    'symbol2': symbol2,
                    'oportunidades': resultado['total_oportunidades'],
                    'maior_ganho': maior_ganho,
                    'melhor_retorno': melhor_retorno,
                    'spread_atual': resultado['spread_atual'],
                    'current_price1': resultado['current_price1'],
                    'current_price2': resultado['current_price2'],
                    **resultado.get('qualidade', {})
                }
                
                resultados_pares.append(par_resultado)
            
            oportunidades_count = resultado['total_oportunidades'] if resultado else 0
            logger.info(f"Par {symbol1}-{symbol2}: {oportunidades_count} oportunidades")

        resultados_pares.sort(
            key=lambda par: (
                {
                    'Ideal Forte': 3,
                    'Ideal Limite': 2,
                    'Acompanhar': 1,
                    'Fraco': 0
                }.get(par.get('classificacao_operacional'), 0),
                par.get('score', 0),
                par.get('oportunidades', 0)
            ),
            reverse=True
        )

        logger.info(f"Análise concluída: {len(resultados_pares)} pares analisados de {len(pares_validos)} pares válidos")
        return resultados_pares


# Instância da calculadora
calculator = SpreadCalculator()


@app.route('/api/spread/health', methods=['GET'])
def health_check():
    """Verifica se a API está funcionando"""
    return jsonify({
        'status': 'ok',
        'mt5_initialized': calculator.initialize_mt5(),
        'timestamp': datetime.now().isoformat()
    })


@app.route('/api/spread/analyze', methods=['POST'])
def analyze_spread():
    """Analisa spread entre dois ativos específicos"""
    try:
        data = request.json
        symbol1 = data.get('symbol1')
        symbol2 = data.get('symbol2')
        data_inicial = datetime.fromisoformat(data['data_inicial'])
        data_final = datetime.fromisoformat(data['data_final'])
        ganho_minimo = data.get('ganho_minimo', 0.10)
        
        logger.info(f"Requisição de análise: {symbol1}-{symbol2}")
        
        resultado = calculator.calcular_spread(symbol1, symbol2, data_inicial, data_final, ganho_minimo)
        
        if resultado:
            return jsonify({
                'success': True,
                'data': resultado
            })
        else:
            return jsonify({
                'success': False,
                'error': 'Não foi possível obter dados dos ativos'
            }), 400
            
    except Exception as e:
        logger.error(f"Erro na análise: {str(e)}")
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500


@app.route('/api/spread/find-best-pairs', methods=['POST'])
def find_best_pairs():
    """Encontra os melhores pares para arbitragem"""
    try:
        data = request.json
        data_inicial = datetime.fromisoformat(data['data_inicial'])
        data_final = datetime.fromisoformat(data['data_final'])
        ganho_minimo = data.get('ganho_minimo', 0.10)
        
        logger.info(f"Requisição de busca de melhores pares (ganho_minimo: {ganho_minimo})")
        
        resultados = calculator.encontrar_melhores_pares(data_inicial, data_final, ganho_minimo)
        
        return jsonify({
            'success': True,
            'data': resultados
        })
        
    except Exception as e:
        logger.error(f"Erro na busca de pares: {str(e)}")
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500


@app.route('/api/options/scan', methods=['POST'])
def scan_options_route():
    """Roda o scan de opções (covered call / cash-secured put) server-side
    para um ativo, reutilizando `scan_options` de `python/options/scanner_opcoes.py`
    (mesma regra OTM da plataforma; persiste o scan em data/options/options_data.db).

    Import feito dentro do handler (não no topo do módulo): `scanner_opcoes.py`
    importa `MetaTrader5` no carregamento — se isso falhar/travar sem MT5
    disponível, não deve derrubar a inicialização do `spread_api.py`.
    """
    data: Dict[str, Any] = {}
    try:
        data = request.json or {}
        symbol = data.get('symbol')
        if not symbol:
            return jsonify({'error': 'symbol é obrigatório'}), 400
        capital = data.get('capital', 10_000)
        strike_range_pct_input = data.get('strike_range_pct', 10)
        min_annual_pct_input = data.get('min_annual_pct', 5)
        # Rota recebe percentuais "humanos" (10 = 10%); scan_options espera fração decimal.
        strike_range_pct = strike_range_pct_input / 100
        min_annual_pct = min_annual_pct_input / 100

        sys.path.append(os.path.join(os.path.dirname(__file__), 'options'))
        from scanner_opcoes import scan_options

        resultado = scan_options(symbol, capital, strike_range_pct, min_annual_pct)
        return jsonify(resultado)
    except RuntimeError as e:
        logger.warning(f"Scan de opções indisponível para {data.get('symbol') if isinstance(data, dict) else '?'}: {e}")
        return jsonify({'error': str(e), 'code': 'MT5_DISCONNECTED'}), 503
    except Exception as e:
        logger.error(f"Erro no scan de opções: {str(e)}")
        return jsonify({'error': str(e)}), 500


@app.route('/api/spread/pares-sugeridos', methods=['GET'])
def get_pares_sugeridos():
    """Retorna a lista de pares sugeridos"""
    return jsonify({
        'success': True,
        'data': PARES_COMPLETOS if PARES_COMPLETOS else []
    })

@app.route('/api/spread/status-ativos', methods=['GET'])
def get_status_ativos():
    """Retorna status dos ativos verificados"""
    return jsonify({
        'success': True,
        'data': {
            'ativos_validos': sorted(list(asset_cache.valid)),
            'ativos_invalidos': sorted(list(asset_cache.invalid)),
            'total_verificados': len(asset_cache.verified),
            'total_validos': len(asset_cache.valid),
            'total_invalidos': len(asset_cache.invalid)
        }
    })


if __name__ == '__main__':
    logger.info("Iniciando API de Spread B3...")
    app.run(host=NETWORK_HOST, port=5000, debug=False, use_reloader=False)
