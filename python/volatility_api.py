"""
API para Cálculo de Volatilidade usando Pandas-TA
Conecta ao MetaTrader 5 para buscar dados históricos e calcula volatilidade
"""

import logging
from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS
import pandas as pd
import pandas_ta as ta
import MetaTrader5 as mt5
from datetime import datetime, timedelta
import os
import sys

# Configuração de rede segura (loopback + CORS allowlist)
from network_config import NETWORK_HOST, CORS_OPTIONS

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)],
)
logger = logging.getLogger("volatility_api")

app = Flask(__name__)
CORS(app, **CORS_OPTIONS)  # Allowlist estrita de origens locais

# Configurações
MT5_PATH = "C:\\Program Files\\MetaTrader 5\\terminal64.exe"  # Ajuste conforme necessário
MT5_LOGIN = None  # Defina se necessário
MT5_PASSWORD = None  # Defina se necessário
MT5_SERVER = None  # Defina se necessário

def connect_mt5():
    """Conecta ao MetaTrader 5"""
    try:
        if not mt5.initialize(MT5_PATH):
            error_code = mt5.last_error()
            logger.warning(f"Erro ao inicializar MT5: {error_code}")
            return False
        
        if MT5_LOGIN and MT5_PASSWORD and MT5_SERVER:
            authorized = mt5.login(MT5_LOGIN, MT5_PASSWORD, MT5_SERVER)
            if not authorized:
                logger.warning("Falha ao fazer login no MT5")
                mt5.shutdown()
                return False
        
        logger.info("Conectado ao MT5 com sucesso")
        return True
    except Exception as e:
        logger.error(f"Exceção ao conectar ao MT5: {e}")
        return False

def get_historical_data(symbol, days=365):
    """
    Busca dados históricos de um ativo
    
    Args:
        symbol: Símbolo do ativo (ex: VALE3)
        days: Número de dias para buscar (padrão: 365 = 1 ano)
    
    Returns:
        DataFrame com dados históricos ou None
    """
    try:
        # Converter símbolo para formato do MT5 (adicionar .SA para ações brasileiras)
        mt5_symbol = f"{symbol}.SA" if not symbol.endswith('.SA') else symbol
        
        # Verificar se o símbolo existe
        symbol_info = mt5.symbol_info(mt5_symbol)
        if not symbol_info:
            # Tentar sem o .SA
            symbol_info = mt5.symbol_info(symbol)
            if not symbol_info:
                logger.warning(f"Símbolo não encontrado: {mt5_symbol} nem {symbol}")
                return None
            mt5_symbol = symbol
        
        # Habilitar símbolo para trading
        if not mt5.symbol_info(mt5_symbol).visible:
            mt5.symbol_select(mt5_symbol, True)
        
        # Definir período de tempo
        timeframe = mt5.TIMEFRAME_D1  # Dados diários
        
        # Calcular data inicial
        end_time = datetime.now()
        start_time = end_time - timedelta(days=days + 50)  # Buffer extra
        
        # Buscar dados
        rates = mt5.copy_rates_range(mt5_symbol, timeframe, start_time, end_time)
        
        if rates is None or len(rates) == 0:
            logger.warning(f"Nenhum dado encontrado para {mt5_symbol}")
            return None
        
        # Converter para DataFrame
        df = pd.DataFrame(rates)
        df['time'] = pd.to_datetime(df['time'], unit='s')
        df.set_index('time', inplace=True)
        
        # Renomear colunas para padrão pandas-ta
        df.rename(columns={
            'open': 'Open',
            'high': 'High',
            'low': 'Low',
            'close': 'Close',
            'volume': 'Volume'
        }, inplace=True)
        
        # Filtrar apenas os últimos 'days' dias
        df = df.tail(days)
        
        logger.info(f"Obtidos {len(df)} registros para {mt5_symbol}")
        return df
        
    except Exception as e:
        logger.error(f"Erro ao buscar dados históricos: {e}")
        return None

def calculate_volatility(df):
    """
    Calcula volatilidade usando pandas-ta
    
    Args:
        df: DataFrame com dados históricos
    
    Returns:
        Dicionário com volatilidade mensal e anual
    """
    try:
        if df is None or len(df) < 20:
            return None
        
        # Calcular retornos diários
        df['Returns'] = df['Close'].pct_change()
        
        # Remover valores NaN
        df = df.dropna()
        
        # Calcular desvio padrão dos retornos
        std_dev_daily = df['Returns'].std()
        
        # Calcular volatilidade anualizada (std_dev * sqrt(252))
        # 252 é o número aproximado de dias de trading em um ano
        annual_volatility = std_dev_daily * (252 ** 0.5) * 100
        
        # Calcular volatilidade mensal (std_dev * sqrt(21))
        # 21 é o número aproximado de dias de trading em um mês
        monthly_volatility = std_dev_daily * (21 ** 0.5) * 100
        
        # Calcular desvio padrão anual e mensal em percentual
        annual_std_dev = annual_volatility
        monthly_std_dev = monthly_volatility
        
        # Calcular usando pandas-ta (ATR - Average True Range)
        # ATR é uma medida de volatilidade
        atr_period = 14
        df['ATR'] = ta.atr(df['High'], df['Low'], df['Close'], length=atr_period)
        
        # Calcular ATR médio como percentual do preço
        avg_atr = df['ATR'].mean()
        avg_price = df['Close'].mean()
        atr_volatility = (avg_atr / avg_price) * 100
        
        result = {
            'monthly_volatility': round(monthly_volatility, 2),
            'annual_volatility': round(annual_volatility, 2),
            'monthly_std_dev': round(monthly_std_dev, 2),
            'annual_std_dev': round(annual_std_dev, 2),
            'atr_volatility': round(atr_volatility, 2),
            'data_points': len(df),
            'date_range': {
                'start': df.index[0].strftime('%Y-%m-%d'),
                'end': df.index[-1].strftime('%Y-%m-%d')
            }
        }
        
        logger.info(f"Volatilidade calculada: Mensal={monthly_volatility:.2f}%, Anual={annual_volatility:.2f}%")
        return result
        
    except Exception as e:
        logger.error(f"Erro ao calcular volatilidade: {e}")
        return None

@app.route('/api/volatility', methods=['POST'])
def volatility_endpoint():
    """Endpoint para calcular volatilidade de um ativo"""
    try:
        data = request.get_json()
        symbol = data.get('symbol', '').upper()
        days = data.get('days', 365)  # Padrão: 1 ano de dados
        
        if not symbol:
            return jsonify({
                'success': False,
                'error': 'Símbolo não fornecido'
            }), 400
        
        # Conectar ao MT5 se não estiver conectado
        if not mt5.initialize():
            error_code = mt5.last_error()
            logger.warning(f"Erro ao inicializar MT5: {error_code}")
            return jsonify({
                'success': False,
                'error': f'Não foi possível conectar ao MetaTrader 5: {error_code}'
            }), 500
        
        try:
            # Buscar dados históricos
            df = get_historical_data(symbol, days)
            
            if df is None:
                return jsonify({
                    'success': False,
                    'error': f'Não foi possível obter dados históricos para o símbolo {symbol}. Verifique se o símbolo está correto e se o MT5 está conectado.'
                }), 404
            
            # Calcular volatilidade
            volatility = calculate_volatility(df)
            
            if volatility is None:
                return jsonify({
                    'success': False,
                    'error': 'Não foi possível calcular a volatilidade. Dados insuficientes.'
                }), 400
            
            # Retornar resultado
            return jsonify({
                'success': True,
                'data': {
                    'symbol': symbol,
                    'monthlyVolatility': volatility['monthly_volatility'],
                    'annualVolatility': volatility['annual_volatility'],
                    'monthlyStdDev': volatility['monthly_std_dev'],
                    'annualStdDev': volatility['annual_std_dev'],
                    'lastUpdate': datetime.now().isoformat(),
                    'metadata': {
                        'atrVolatility': volatility['atr_volatility'],
                        'dataPoints': volatility['data_points'],
                        'dateRange': volatility['date_range']
                    }
                }
            })
            
        finally:
            # Desconectar do MT5
            mt5.shutdown()
            
    except Exception as e:
        logger.error(f"Erro no endpoint de volatilidade: {e}")
        return jsonify({
            'success': False,
            'error': f'Erro interno: {str(e)}'
        }), 500

@app.route('/health', methods=['GET'])
def health_check():
    """Endpoint para verificação de saúde da API"""
    return jsonify({
        'status': 'ok',
        'service': 'Volatility API',
        'timestamp': datetime.now().isoformat()
    })

if __name__ == '__main__':
    print("=" * 60)
    print("API de Volatilidade usando Pandas-TA")
    print("=" * 60)
    print("Iniciando servidor Flask...")
    print("A API estará disponível em: http://localhost:5555")
    print("Endpoint: POST /api/volatility")
    print("Exemplo de requisição:")
    print('{"symbol": "VALE3", "days": 365}')
    print("=" * 60)
    
    # Iniciar servidor
    app.run(host=NETWORK_HOST, port=5555, debug=False, use_reloader=False)
