# Backtest de Estratégia de Spread com vectorBT

## Resumo

Este documento descreve como implementar um sistema de backtest de estratégias de spread usando a biblioteca **vectorBT** em Python, integrado à plataforma WR Trading Pro.

## 📋 Análise Atual

### Estratégia de Spread Existente

A plataforma WR Trading Pro já possui uma implementação de análise de spread em `Projeto_spread/app.py` que:

1. **Obtém dados históricos** do MetaTrader 5 para dois ativos
2. **Calcula o spread** (diferença absoluta entre preços)
3. **Identifica oportunidades** de arbitragem em dias consecutivos
4. **Valida oportunidades** baseada em volume mínimo
5. **Calcula ganhos** potenciais de cada operação

### Lógica Atual

```python
# Estratégia simplificada
for i in range(len(hist1_daily)-1):
    # Dia atual: Vender ativo1, Comprar ativo2
    preco_a1 = hist1_daily.loc[data_atual, 'Close']  # Vende ativo1
    preco_b1 = hist2_daily.loc[data_atual, 'Close']  # Compra ativo2
    
    # Dia seguinte: Comprar ativo1, Vender ativo2
    preco_a2 = hist1_daily.loc[data_seguinte, 'Close']  # Recompra ativo1
    preco_b2 = hist2_daily.loc[data_seguinte, 'Close']  # Vende ativo2
    
    # Ganho = (Venda A1 - Compra A2) + (Venda B2 - Compra B1)
    ganho = (preco_a1 - preco_a2) + (preco_b2 - preco_b1)
```

## 🎯 Integração com vectorBT

### O que é vectorBT?

**vectorBT** é uma biblioteca Python para backtesting rápido e eficiente que:

- Usa **NumPy** e **Numba** para alta performance
- Permite **backtesting vetorial** (operações em massa)
- Suporta ** múltiplas estratégias** simultâneas
- Gera **métricas detalhadas** de performance
- Integra com **Plotly** para visualização

### Vantagens de Usar vectorBT

1. **Performance**: Backtesting muito mais rápido que loops tradicionais
2. **Escalabilidade**: Testa múltiplos parâmetros simultaneamente
3. **Métricas avançadas**: Sharpe ratio, drawdown, win rate, etc.
4. **Visualização**: Gráficos interativos de resultados
5. **Otimização**: Encontra os melhores parâmetros automaticamente

## 🏗️ Arquitetura Proposta

```
WR Trading Pro
├── Projeto_spread/
│   ├── spread_backtester.py        # NOVO: Backtester com vectorBT
│   ├── spread_strategies.py        # NOVO: Definições de estratégias
│   ├── spread_metrics.py           # NOVO: Cálculo de métricas
│   ├── spread_optimizer.py         # NOVO: Otimização de parâmetros
│   └── backtest_api.py             # NOVO: API Flask para backtest
├── src/
│   ├── services/
│   │   └── spreadBacktestService.ts # NOVO: Serviço TypeScript
│   └── components/
│       └── SpreadBacktestPanel.tsx # NOVO: Componente UI
```

## 📝 Implementação Passo a Passo

### Passo 1: Instalação de Dependências

```bash
pip install vectorbt pandas numpy plotly MetaTrader5
```

### Passo 2: Criar `Projeto_spread/spread_strategies.py`

Este arquivo define as estratégias de spread que podem ser testadas:

```python
"""
Definições de estratégias de spread para backtesting com vectorBT
"""

import numpy as np
import pandas as pd
from typing import Dict, List, Optional
from datetime import datetime

class SpreadStrategy:
    """Classe base para estratégias de spread"""
    
    def __init__(self, name: str, description: str):
        self.name = name
        self.description = description
    
    def calculate_signals(self, df1: pd.DataFrame, df2: pd.DataFrame, 
                         params: Dict) -> pd.DataFrame:
        """Calcula sinais de entrada/saída
        Deve ser implementado pelas subclasses
        """
        raise NotImplementedError
    
    def calculate_returns(self, df1: pd.DataFrame, df2: pd.DataFrame,
                         signals: pd.DataFrame, params: Dict) -> pd.Series:
        """Calcula retornos da estratégia
        Deve ser implementado pelas subclasses
        """
        raise NotImplementedError


class SimpleSpreadStrategy(SpreadStrategy):
    """Estratégia simples de spread baseada em dias consecutivos"""
    
    def __init__(self):
        super().__init__(
            name="Spread Simples",
            description="Estratégia que vende ativo1 e compra ativo2, "
                       "aguarda um dia e reverte a operação"
        )
    
    def calculate_signals(self, df1: pd.DataFrame, df2: pd.DataFrame, 
                         params: Dict) -> pd.DataFrame:
        """
        Calcula sinais de entrada/saída
        
        Estratégia:
        - Sinal 1 (买入): Comprar spread (comprar ativo1, vender ativo2)
        - Sinal -1 (做空): Vender spread (vender ativo1, comprar ativo2)
        - Sinal 0 (持有): Neutro
        
        Args:
            df1: DataFrame do ativo 1
            df2: DataFrame do ativo 2
            params: Parâmetros da estratégia
            
        Returns:
            DataFrame com sinais
        """
        spread = df1['Close'] - df2['Close']
        spread_ma = spread.rolling(window=params.get('ma_period', 20)).mean()
        spread_std = spread.rolling(window=params.get('ma_period', 20)).std()
        
        # Upper e Lower bands
        upper_band = spread_ma + (params.get('std_dev', 2) * spread_std)
        lower_band = spread_ma - (params.get('std_dev', 2) * spread_std)
        
        # Sinais
        signals = pd.Series(0, index=df1.index)
        
        # Vende spread quando acima da upper band
        signals[spread > upper_band] = -1
        
        # Compra spread quando abaixo da lower band
        signals[spread < lower_band] = 1
        
        return signals.to_frame('signal')
    
    def calculate_returns(self, df1: pd.DataFrame, df2: pd.DataFrame,
                         signals: pd.DataFrame, params: Dict) -> pd.Series:
        """Calcula retornos da estratégia de spread"""
        spread = df1['Close'] - df2['Close']
        
        # Retorno do spread
        spread_returns = spread.pct_change()
        
        # Aplica sinais
        strategy_returns = signals['signal'].shift(1) * spread_returns
        
        return strategy_returns.fillna(0)


class MeanReversionSpreadStrategy(SpreadStrategy):
    """Estratégia de mean reversion para spreads"""
    
    def __init__(self):
        super().__init__(
            name="Mean Reversion Spread",
            description="Estratégia que aposta na reversão à média do spread"
        )
    
    def calculate_signals(self, df1: pd.DataFrame, df2: pd.DataFrame, 
                         params: Dict) -> pd.DataFrame:
        """Calcula sinais baseados em z-score do spread"""
        spread = df1['Close'] - df2['Close']
        
        window = params.get('window', 20)
        spread_mean = spread.rolling(window).mean()
        spread_std = spread.rolling(window).std()
        
        # Z-score
        z_score = (spread - spread_mean) / spread_std
        
        # Sinais baseados em z-score
        signals = pd.Series(0, index=df1.index)
        entry_threshold = params.get('entry_threshold', 2.0)
        exit_threshold = params.get('exit_threshold', 0.5)
        
        # Vende spread quando z-score > entry_threshold (spread muito alto)
        signals[z_score > entry_threshold] = -1
        
        # Compra spread quando z-score < -entry_threshold (spread muito baixo)
        signals[z_score < -entry_threshold] = 1
        
        # Sai da posição quando z-score volta para perto de zero
        signals[(z_score > -exit_threshold) & (z_score < exit_threshold)] = 0
        
        return signals.to_frame('signal')
    
    def calculate_returns(self, df1: pd.DataFrame, df2: pd.DataFrame,
                         signals: pd.DataFrame, params: Dict) -> pd.Series:
        """Calcula retornos da estratégia"""
        spread = df1['Close'] - df2['Close']
        spread_returns = spread.pct_change()
        
        strategy_returns = signals['signal'].shift(1) * spread_returns
        
        return strategy_returns.fillna(0)


class MomentumSpreadStrategy(SpreadStrategy):
    """Estratégia de momentum para spreads"""
    
    def __init__(self):
        super().__init__(
            name="Momentum Spread",
            description="Estratégia que segue o momentum do spread"
        )
    
    def calculate_signals(self, df1: pd.DataFrame, df2: pd.DataFrame, 
                         params: Dict) -> pd.DataFrame:
        """Calcula sinais baseados em momentum"""
        spread = df1['Close'] - df2['Close']
        
        window = params.get('momentum_window', 5)
        spread_momentum = spread.diff(window)
        
        # Sinais
        signals = pd.Series(0, index=df1.index)
        threshold = params.get('momentum_threshold', 0.01)
        
        # Compra spread quando momentum é positivo
        signals[spread_momentum > threshold] = 1
        
        # Vende spread quando momentum é negativo
        signals[spread_momentum < -threshold] = -1
        
        return signals.to_frame('signal')
    
    def calculate_returns(self, df1: pd.DataFrame, df2: pd.DataFrame,
                         signals: pd.DataFrame, params: Dict) -> pd.Series:
        """Calcula retornos da estratégia"""
        spread = df1['Close'] - df2['Close']
        spread_returns = spread.pct_change()
        
        strategy_returns = signals['signal'].shift(1) * spread_returns
        
        return strategy_returns.fillna(0)


class PairTradingStrategy(SpreadStrategy):
    """Estratégia de pair trading com cointegração"""
    
    def __init__(self):
        super().__init__(
            name="Pair Trading Cointegration",
            description="Estratégia de pair trading baseada em cointegração"
        )
    
    def calculate_hedge_ratio(self, df1: pd.DataFrame, df2: pd.DataFrame, 
                             window: int) -> pd.Series:
        """Calcula o hedge ratio usando regressão rolling"""
        from statsmodels.regression.rolling import RollingOLS
        
        y = df1['Close']
        x = df2['Close']
        
        hedge_ratios = []
        for i in range(window, len(df1)):
            y_window = y.iloc[i-window:i]
            x_window = x.iloc[i-window:i]
            
            # Regressão OLS
            x_with_const = np.column_stack([np.ones(len(x_window)), x_window])
            coeffs = np.linalg.lstsq(x_with_const, y_window, rcond=None)[0]
            hedge_ratios.append(coeffs[1])
        
        hedge_ratios = [np.nan] * window + hedge_ratios
        return pd.Series(hedge_ratios, index=df1.index)
    
    def calculate_signals(self, df1: pd.DataFrame, df2: pd.DataFrame, 
                         params: Dict) -> pd.DataFrame:
        """Calcula sinais baseados em spread residual"""
        hedge_ratio = self.calculate_hedge_ratio(
            df1, df2, 
            params.get('hedge_window', 60)
        )
        
        # Spread residual: y - hedge_ratio * x
        spread_residual = df1['Close'] - hedge_ratio * df2['Close']
        
        # Média e desvio padrão do residual
        window = params.get('entry_window', 20)
        residual_mean = spread_residual.rolling(window).mean()
        residual_std = spread_residual.rolling(window).std()
        
        # Z-score do residual
        z_score = (spread_residual - residual_mean) / residual_std
        
        # Sinais
        signals = pd.Series(0, index=df1.index)
        entry_threshold = params.get('entry_threshold', 2.0)
        exit_threshold = params.get('exit_threshold', 0.5)
        
        # Vende spread quando z-score > entry_threshold
        signals[z_score > entry_threshold] = -1
        
        # Compra spread quando z-score < -entry_threshold
        signals[z_score < -entry_threshold] = 1
        
        # Sai quando z-score volta para perto de zero
        signals[(z_score > -exit_threshold) & (z_score < exit_threshold)] = 0
        
        return signals.to_frame('signal')
    
    def calculate_returns(self, df1: pd.DataFrame, df2: pd.DataFrame,
                         signals: pd.DataFrame, params: Dict) -> pd.Series:
        """Calcula retornos da estratégia"""
        hedge_ratio = self.calculate_hedge_ratio(
            df1, df2, 
            params.get('hedge_window', 60)
        )
        
        # Retorno do spread: y - hedge_ratio * x
        spread_returns = (df1['Close'].pct_change() - 
                         hedge_ratio.shift(1) * df2['Close'].pct_change())
        
        strategy_returns = signals['signal'].shift(1) * spread_returns
        
        return strategy_returns.fillna(0)


# Registro de estratégias disponíveis
AVAILABLE_STRATEGIES = {
    'simple': SimpleSpreadStrategy,
    'mean_reversion': MeanReversionSpreadStrategy,
    'momentum': MomentumSpreadStrategy,
    'pair_trading': PairTradingStrategy
}


def get_strategy(strategy_name: str) -> SpreadStrategy:
    """Retorna uma instância da estratégia pelo nome"""
    strategy_class = AVAILABLE_STRATEGIES.get(strategy_name)
    if strategy_class is None:
        raise ValueError(f"Estratégia '{strategy_name}' não encontrada. "
                        f"Opções: {list(AVAILABLE_STRATEGIES.keys())}")
    return strategy_class()


def list_strategies() -> List[Dict]:
    """Lista todas as estratégias disponíveis"""
    strategies = []
    for key, cls in AVAILABLE_STRATEGIES.items():
        strategy = cls()
        strategies.append({
            'id': key,
            'name': strategy.name,
            'description': strategy.description
        })
    return strategies
```

### Passo 3: Criar `Projeto_spread/spread_backtester.py`

Este arquivo implementa o backtester usando vectorBT:

```python
"""
Backtester de estratégias de spread usando vectorBT
"""

import vectorbt as vbt
import pandas as pd
import numpy as np
from typing import Dict, List, Optional, Tuple
from datetime import datetime, timedelta
import MetaTrader5 as mt5
from spread_strategies import (
    SpreadStrategy, 
    get_strategy, 
    list_strategies
)


class SpreadBacktester:
    """Classe principal para backtesting de estratégias de spread"""
    
    def __init__(self):
        self.strategies = list_strategies()
    
    def get_stock_data(self, symbol: str, start_date: datetime, 
                      end_date: datetime) -> pd.DataFrame:
        """
        Obtém dados históricos do MetaTrader 5
        
        Args:
            symbol: Símbolo do ativo
            start_date: Data inicial
            end_date: Data final
            
        Returns:
            DataFrame com OHLCV
        """
        if not mt5.initialize():
            raise RuntimeError("Erro ao inicializar MT5")
        
        start_ts = int(start_date.timestamp())
        end_ts = int(end_date.timestamp())
        
        rates = mt5.copy_rates_range(
            symbol, mt5.TIMEFRAME_D1, start_ts, end_ts
        )
        
        if rates is None:
            raise RuntimeError(f"Erro ao obter dados para {symbol}")
        
        df = pd.DataFrame(rates)
        df['time'] = pd.to_datetime(df['time'], unit='s')
        df.set_index('time', inplace=True)
        df = df.rename(columns={
            'open': 'Open',
            'high': 'High',
            'low': 'Low',
            'close': 'Close',
            'tick_volume': 'Volume'
        })
        
        return df
    
    def run_backtest(
        self,
        symbol1: str,
        symbol2: str,
        strategy_name: str,
        start_date: datetime,
        end_date: datetime,
        params: Dict,
        initial_cash: float = 100000.0
    ) -> Dict:
        """
        Executa backtest de uma estratégia de spread
        
        Args:
            symbol1: Símbolo do primeiro ativo
            symbol2: Símbolo do segundo ativo
            strategy_name: Nome da estratégia
            start_date: Data inicial
            end_date: Data final
            params: Parâmetros da estratégia
            initial_cash: Capital inicial
            
        Returns:
            Dicionário com resultados do backtest
        """
        # Obtém dados
        df1 = self.get_stock_data(symbol1, start_date, end_date)
        df2 = self.get_stock_data(symbol2, start_date, end_date)
        
        # Alinha os DataFrames
        df1, df2 = df1.align(df2, join='inner', axis=0)
        
        if len(df1) == 0:
            raise RuntimeError("Nenhum dado disponível após alinhamento")
        
        # Obtém estratégia
        strategy = get_strategy(strategy_name)
        
        # Calcula sinais
        signals = strategy.calculate_signals(df1, df2, params)
        
        # Calcula retornos
        returns = strategy.calculate_returns(df1, df2, signals, params)
        
        # Cria portfolio com vectorBT
        pf = vbt.Portfolio.from_signals(
            df1['Close'].values,
            signals['signal'].values,
            init_cash=initial_cash,
            fees=params.get('fees', 0.001),  # 0.1% de taxa
            slippage=params.get('slippage', 0.0001),  # 0.01% de slippage
            freq='1D'
        )
        
        # Obtém resultados
        results = pf.stats()
        
        # Retornos detalhados
        equity = pf.value()
        trades = pf.trades.records_readable
        
        return {
            'success': True,
            'strategy': strategy_name,
            'symbols': f"{symbol1}-{symbol2}",
            'period': {
                'start': start_date.isoformat(),
                'end': end_date.isoformat(),
                'days': len(df1)
            },
            'params': params,
            'metrics': {
                'total_return': float(results['Total Return [%]']),
                'annual_return': float(results['Annual Return [%]']),
                'sharpe_ratio': float(results['Sharpe Ratio']),
                'sortino_ratio': float(results['Sortino Ratio']),
                'max_drawdown': float(results['Max Drawdown [%]']),
                'win_rate': float(results['Win Rate [%]']),
                'profit_factor': float(results.get('Profit Factor', 0)),
                'total_trades': int(results['# Trades']),
                'avg_trade': float(results['Avg Trade [%]']),
                'best_trade': float(results['Best Trade [%]']),
                'worst_trade': float(results['Worst Trade [%]'])
            },
            'equity': equity.to_dict(),
            'trades': trades.to_dict('records') if len(trades) > 0 else [],
            'signals': signals.to_dict('records'),
            'data1': df1.reset_index().to_dict('records'),
            'data2': df2.reset_index().to_dict('records')
        }
    
    def run_multi_backtest(
        self,
        symbol1: str,
        symbol2: str,
        strategy_name: str,
        start_date: datetime,
        end_date: datetime,
        param_ranges: Dict,
        initial_cash: float = 100000.0
    ) -> Dict:
        """
        Executa backtest com múltiplos parâmetros
        
        Args:
            symbol1: Símbolo do primeiro ativo
            symbol2: Símbolo do segundo ativo
            strategy_name: Nome da estratégia
            start_date: Data inicial
            end_date: Data final
            param_ranges: Dicionário com ranges de parâmetros para testar
            initial_cash: Capital inicial
            
        Returns:
            Dicionário com melhores resultados
        """
        # Gera combinações de parâmetros
        from itertools import product
        
        keys = list(param_ranges.keys())
        values = list(param_ranges.values())
        
        combinations = list(product(*values))
        
        results = []
        
        for combo in combinations:
            params = dict(zip(keys, combo))
            
            try:
                result = self.run_backtest(
                    symbol1, symbol2, strategy_name,
                    start_date, end_date, params, initial_cash
                )
                results.append({
                    'params': params,
                    'metrics': result['metrics']
                })
            except Exception as e:
                print(f"Erro ao testar {params}: {e}")
                continue
        
        if not results:
            return {'success': False, 'error': 'Nenhum resultado válido'}
        
        # Ordena por Sharpe Ratio
        results.sort(key=lambda x: x['metrics']['sharpe_ratio'], reverse=True)
        
        return {
            'success': True,
            'total_combinations': len(combinations),
            'valid_combinations': len(results),
            'best_params': results[0]['params'],
            'best_metrics': results[0]['metrics'],
            'top_10': results[:10]
        }
    
    def compare_strategies(
        self,
        symbol1: str,
        symbol2: str,
        start_date: datetime,
        end_date: datetime,
        params: Dict,
        initial_cash: float = 100000.0
    ) -> Dict:
        """
        Compara todas as estratégias disponíveis
        
        Args:
            symbol1: Símbolo do primeiro ativo
            symbol2: Símbolo do segundo ativo
            start_date: Data inicial
            end_date: Data final
            params: Parâmetros base (serão ajustados por estratégia)
            initial_cash: Capital inicial
            
        Returns:
            Dicionário com comparação de estratégias
        """
        results = []
        
        for strategy_info in self.strategies:
            strategy_name = strategy_info['id']
            
            try:
                result = self.run_backtest(
                    symbol1, symbol2, strategy_name,
                    start_date, end_date, params, initial_cash
                )
                
                results.append({
                    'strategy': strategy_name,
                    'strategy_name': strategy_info['name'],
                    'metrics': result['metrics']
                })
            except Exception as e:
                print(f"Erro ao testar {strategy_name}: {e}")
                continue
        
        if not results:
            return {'success': False, 'error': 'Nenhum resultado válido'}
        
        # Ordena por Sharpe Ratio
        results.sort(key=lambda x: x['metrics']['sharpe_ratio'], reverse=True)
        
        return {
            'success': True,
            'comparison': results,
            'best_strategy': results[0]['strategy'],
            'best_strategy_name': results[0]['strategy_name']
        }


# Funções auxiliares
def quick_backtest(
    symbol1: str,
    symbol2: str,
    strategy: str = 'mean_reversion',
    days: int = 365,
    params: Optional[Dict] = None
) -> Dict:
    """
    Função rápida para executar um backtest
    
    Args:
        symbol1: Símbolo do primeiro ativo
        symbol2: Símbolo do segundo ativo
        strategy: Nome da estratégia
        days: Número de dias para backtest
        params: Parâmetros da estratégia (opcional)
        
    Returns:
        Resultados do backtest
    """
    if params is None:
        params = {
            'window': 20,
            'entry_threshold': 2.0,
            'exit_threshold': 0.5,
            'fees': 0.001,
            'slippage': 0.0001
        }
    
    end_date = datetime.now()
    start_date = end_date - timedelta(days=days)
    
    backtester = SpreadBacktester()
    return backtester.run_backtest(
        symbol1, symbol2, strategy, start_date, end_date, params
    )
```

### Passo 4: Criar `Projeto_spread/backtest_api.py`

API Flask para expor o backtester:

```python
"""
API Flask para backtest de estratégias de spread
"""

from flask import Flask, jsonify, request
from flask_cors import CORS
from datetime import datetime, timedelta
from spread_backtester import SpreadBacktester, quick_backtest
from spread_strategies import list_strategies

app = Flask(__name__)
CORS(app)

backtester = SpreadBacktester()


@app.route('/api/backtest/health', methods=['GET'])
def health_check():
    """Verifica se a API está funcionando"""
    return jsonify({
        'status': 'healthy',
        'timestamp': datetime.now().isoformat()
    })


@app.route('/api/backtest/strategies', methods=['GET'])
def get_strategies():
    """Lista todas as estratégias disponíveis"""
    return jsonify({
        'strategies': list_strategies()
    })


@app.route('/api/backtest/run', methods=['POST'])
def run_backtest():
    """
    Executa um backtest de estratégia de spread
    
    Payload esperado:
    {
        "symbol1": "PETR4",
        "symbol2": "PETR3",
        "strategy": "mean_reversion",
        "start_date": "2024-01-01",
        "end_date": "2024-12-31",
        "params": {
            "window": 20,
            "entry_threshold": 2.0,
            "exit_threshold": 0.5,
            "fees": 0.001,
            "slippage": 0.0001
        },
        "initial_cash": 100000.0
    }
    """
    try:
        data = request.json
        
        symbol1 = data.get('symbol1')
        symbol2 = data.get('symbol2')
        strategy = data.get('strategy', 'mean_reversion')
        
        start_date = datetime.fromisoformat(data.get('start_date'))
        end_date = datetime.fromisoformat(data.get('end_date'))
        
        params = data.get('params', {})
        initial_cash = data.get('initial_cash', 100000.0)
        
        result = backtester.run_backtest(
            symbol1, symbol2, strategy,
            start_date, end_date, params, initial_cash
        )
        
        return jsonify(result)
        
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 400


@app.route('/api/backtest/quick', methods=['POST'])
def quick_backtest_endpoint():
    """
    Executa um backtest rápido com parâmetros padrão
    
    Payload esperado:
    {
        "symbol1": "PETR4",
        "symbol2": "PETR3",
        "strategy": "mean_reversion",
        "days": 365
    }
    """
    try:
        data = request.json
        
        symbol1 = data.get('symbol1')
        symbol2 = data.get('symbol2')
        strategy = data.get('strategy', 'mean_reversion')
        days = data.get('days', 365)
        
        result = quick_backtest(symbol1, symbol2, strategy, days)
        
        return jsonify(result)
        
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 400


@app.route('/api/backtest/optimize', methods=['POST'])
def optimize_backtest():
    """
    Executa otimização de parâmetros com múltiplos valores
    
    Payload esperado:
    {
        "symbol1": "PETR4",
        "symbol2": "PETR3",
        "strategy": "mean_reversion",
        "start_date": "2024-01-01",
        "end_date": "2024-12-31",
        "param_ranges": {
            "window": [10, 20, 30],
            "entry_threshold": [1.5, 2.0, 2.5],
            "exit_threshold": [0.3, 0.5, 0.7]
        }
    }
    """
    try:
        data = request.json
        
        symbol1 = data.get('symbol1')
        symbol2 = data.get('symbol2')
        strategy = data.get('strategy', 'mean_reversion')
        
        start_date = datetime.fromisoformat(data.get('start_date'))
        end_date = datetime.fromisoformat(data.get('end_date'))
        
        param_ranges = data.get('param_ranges', {})
        
        result = backtester.run_multi_backtest(
            symbol1, symbol2, strategy,
            start_date, end_date, param_ranges
        )
        
        return jsonify(result)
        
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 400


@app.route('/api/backtest/compare', methods=['POST'])
def compare_strategies():
    """
    Compara todas as estratégias para um par de ativos
    
    Payload esperado:
    {
        "symbol1": "PETR4",
        "symbol2": "PETR3",
        "start_date": "2024-01-01",
        "end_date": "2024-12-31",
        "params": {
            "window": 20,
            "entry_threshold": 2.0,
            "exit_threshold": 0.5
        }
    }
    """
    try:
        data = request.json
        
        symbol1 = data.get('symbol1')
        symbol2 = data.get('symbol2')
        
        start_date = datetime.fromisoformat(data.get('start_date'))
        end_date = datetime.fromisoformat(data.get('end_date'))
        
        params = data.get('params', {})
        
        result = backtester.compare_strategies(
            symbol1, symbol2,
            start_date, end_date, params
        )
        
        return jsonify(result)
        
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 400


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=8768, debug=True)
```

### Passo 5: Criar `src/services/spreadBacktestService.ts`

Serviço TypeScript para comunicação com a API de backtest:

```typescript
/**
 * Serviço de backtest de estratégias de spread
 */

export interface BacktestStrategy {
  id: string;
  name: string;
  description: string;
}

export interface BacktestParams {
  window?: number;
  entry_threshold?: number;
  exit_threshold?: number;
  ma_period?: number;
  std_dev?: number;
  momentum_window?: number;
  momentum_threshold?: number;
  hedge_window?: number;
  fees?: number;
  slippage?: number;
}

export interface BacktestConfig {
  symbol1: string;
  symbol2: string;
  strategy: string;
  startDate: string;
  endDate: string;
  params: BacktestParams;
  initialCash?: number;
}

export interface BacktestMetrics {
  total_return: number;
  annual_return: number;
  sharpe_ratio: number;
  sortino_ratio: number;
  max_drawdown: number;
  win_rate: number;
  profit_factor: number;
  total_trades: number;
  avg_trade: number;
  best_trade: number;
  worst_trade: number;
}

export interface BacktestResult {
  success: boolean;
  strategy: string;
  symbols: string;
  period: {
    start: string;
    end: string;
    days: number;
  };
  params: BacktestParams;
  metrics: BacktestMetrics;
  equity: { [key: string]: number };
  trades: any[];
  signals: any[];
  data1: any[];
  data2: any[];
  error?: string;
}

export interface OptimizationResult {
  success: boolean;
  total_combinations: number;
  valid_combinations: number;
  best_params: BacktestParams;
  best_metrics: BacktestMetrics;
  top_10: Array<{
    params: BacktestParams;
    metrics: BacktestMetrics;
  }>;
}

export interface StrategyComparison {
  success: boolean;
  comparison: Array<{
    strategy: string;
    strategy_name: string;
    metrics: BacktestMetrics;
  }>;
  best_strategy: string;
  best_strategy_name: string;
}

const BACKTEST_API_URL = process.env.NEXT_PUBLIC_BACKTEST_API_URL || 'http://127.0.0.1:8768';

export class SpreadBacktestService {
  /**
   * Verifica se a API está online
   */
  async healthCheck(): Promise<{ status: string; timestamp: string }> {
    const response = await fetch(`${BACKTEST_API_URL}/api/backtest/health`);
    if (!response.ok) {
      throw new Error('Servidor de backtest não está respondendo');
    }
    return response.json();
  }

  /**
   * Lista todas as estratégias disponíveis
   */
  async getStrategies(): Promise<{ strategies: BacktestStrategy[] }> {
    const response = await fetch(`${BACKTEST_API_URL}/api/backtest/strategies`);
    if (!response.ok) {
      throw new Error('Erro ao obter estratégias disponíveis');
    }
    return response.json();
  }

  /**
   * Executa um backtest completo
   */
  async runBacktest(config: BacktestConfig): Promise<BacktestResult> {
    const response = await fetch(`${BACKTEST_API_URL}/api/backtest/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config),
    });
    
    if (!response.ok) {
      throw new Error('Erro ao executar backtest');
    }
    
    return response.json();
  }

  /**
   * Executa um backtest rápido com parâmetros padrão
   */
  async quickBacktest(
    symbol1: string,
    symbol2: string,
    strategy: string = 'mean_reversion',
    days: number = 365
  ): Promise<BacktestResult> {
    const response = await fetch(`${BACKTEST_API_URL}/api/backtest/quick`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ symbol1, symbol2, strategy, days }),
    });
    
    if (!response.ok) {
      throw new Error('Erro ao executar backtest rápido');
    }
    
    return response.json();
  }

  /**
   * Executa otimização de parâmetros
   */
  async optimizeParams(
    symbol1: string,
    symbol2: string,
    strategy: string,
    startDate: string,
    endDate: string,
    paramRanges: { [key: string]: number[] }
  ): Promise<OptimizationResult> {
    const response = await fetch(`${BACKTEST_API_URL}/api/backtest/optimize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        symbol1,
        symbol2,
        strategy,
        start_date: startDate,
        end_date: endDate,
        param_ranges: paramRanges,
      }),
    });
    
    if (!response.ok) {
      throw new Error('Erro ao otimizar parâmetros');
    }
    
    return response.json();
  }

  /**
   * Compara todas as estratégias
   */
  async compareStrategies(
    symbol1: string,
    symbol2: string,
    startDate: string,
    endDate: string,
    params: BacktestParams = {}
  ): Promise<StrategyComparison> {
    const response = await fetch(`${BACKTEST_API_URL}/api/backtest/compare`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        symbol1,
        symbol2,
        start_date: startDate,
        end_date: endDate,
        params,
      }),
    });
    
    if (!response.ok) {
      throw new Error('Erro ao comparar estratégias');
    }
    
    return response.json();
  }
}

export const spreadBacktestService = new SpreadBacktestService();

export const backtestUtils = {
  /**
   * Formata métrica como porcentagem
   */
  formatPercent(value: number, decimals: number = 2): string {
    return `${value.toFixed(decimals)}%`;
  },

  /**
   * Formata número como moeda
   */
  formatCurrency(value: number): string {
    return `R$ ${value.toFixed(2)}`;
  },

  /**
   * Retorna cor baseada no valor
   */
  getColor(value: number, threshold: number = 0): string {
    if (value > threshold) return 'text-green-500';
    if (value < threshold) return 'text-red-500';
    return 'text-gray-500';
  },

  /**
   * Avalia qualidade do backtest
   */
  assessQuality(metrics: BacktestMetrics): {
    overall: 'excellent' | 'good' | 'average' | 'poor';
    details: string[];
  } {
    const details: string[] = [];
    let score = 0;

    // Sharpe Ratio
    if (metrics.sharpe_ratio > 2) {
      score += 3;
      details.push('Excelente Sharpe Ratio');
    } else if (metrics.sharpe_ratio > 1) {
      score += 2;
      details.push('Bom Sharpe Ratio');
    } else if (metrics.sharpe_ratio > 0.5) {
      score += 1;
      details.push('Sharpe Ratio razoável');
    }

    // Win Rate
    if (metrics.win_rate > 60) {
      score += 2;
      details.push('Alta taxa de acerto');
    } else if (metrics.win_rate > 50) {
      score += 1;
      details.push('Taxa de acerto aceitável');
    }

    // Max Drawdown
    if (metrics.max_drawdown > -10) {
      score += 2;
      details.push('Drawdown controlado');
    } else if (metrics.max_drawdown > -20) {
      score += 1;
      details.push('Drawdown moderado');
    }

    // Total Return
    if (metrics.total_return > 20) {
      score += 2;
      details.push('Retorno excelente');
    } else if (metrics.total_return > 10) {
      score += 1;
      details.push('Retorno bom');
    }

    let overall: 'excellent' | 'good' | 'average' | 'poor';
    if (score >= 8) overall = 'excellent';
    else if (score >= 6) overall = 'good';
    else if (score >= 4) overall = 'average';
    else overall = 'poor';

    return { overall, details };
  },
};
```

### Passo 6: Criar componente UI

Exemplo de componente React/Next.js para backtest:

```tsx
'use client';

import React, { useState, useEffect } from 'react';
import {
  spreadBacktestService,
  type BacktestConfig,
  type BacktestResult,
  type BacktestStrategy
} from '@/services/spreadBacktestService';

export function SpreadBacktestPanel() {
  const [strategies, setStrategies] = useState<BacktestStrategy[]>([]);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<BacktestResult | null>(null);
  
  const [config, setConfig] = useState<BacktestConfig>({
    symbol1: 'PETR4',
    symbol2: 'PETR3',
    strategy: 'mean_reversion',
    startDate: new Date(Date.now() - 365 * 24 * 60 * 60 * 1000)
      .toISOString()
      .split('T')[0],
    endDate: new Date().toISOString().split('T')[0],
    params: {
      window: 20,
      entry_threshold: 2.0,
      exit_threshold: 0.5,
      fees: 0.001,
      slippage: 0.0001,
    },
    initialCash: 100000,
  });

  useEffect(() => {
    loadStrategies();
  }, []);

  const loadStrategies = async () => {
    try {
      const data = await spreadBacktestService.getStrategies();
      setStrategies(data.strategies);
    } catch (error) {
      console.error('Erro ao carregar estratégias:', error);
    }
  };

  const handleRunBacktest = async () => {
    setLoading(true);
    try {
      const data = await spreadBacktestService.runBacktest(config);
      setResult(data);
    } catch (error) {
      console.error('Erro ao executar backtest:', error);
      alert('Erro ao executar backtest');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-6">
      <h2 className="text-2xl font-bold mb-6">Backtest de Estratégia de Spread</h2>
      
      {/* Configuração */}
      <div className="bg-white rounded-lg shadow p-6 mb-6">
        <h3 className="text-lg font-semibold mb-4">Configuração</h3>
        
        <div className="grid grid-cols-2 gap-4 mb-4">
          <div>
            <label className="block text-sm font-medium mb-2">Ativo 1</label>
            <input
              type="text"
              value={config.symbol1}
              onChange={(e) => setConfig({ ...config, symbol1: e.target.value })}
              className="w-full p-2 border rounded"
            />
          </div>
          
          <div>
            <label className="block text-sm font-medium mb-2">Ativo 2</label>
            <input
              type="text"
              value={config.symbol2}
              onChange={(e) => setConfig({ ...config, symbol2: e.target.value })}
              className="w-full p-2 border rounded"
            />
          </div>
          
          <div>
            <label className="block text-sm font-medium mb-2">Estratégia</label>
            <select
              value={config.strategy}
              onChange={(e) => setConfig({ ...config, strategy: e.target.value })}
              className="w-full p-2 border rounded"
            >
              {strategies.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
          
          <div>
            <label className="block text-sm font-medium mb-2">Capital Inicial</label>
            <input
              type="number"
              value={config.initialCash}
              onChange={(e) => setConfig({ ...config, initialCash: Number(e.target.value) })}
              className="w-full p-2 border rounded"
            />
          </div>
          
          <div>
            <label className="block text-sm font-medium mb-2">Data Inicial</label>
            <input
              type="date"
              value={config.startDate}
              onChange={(e) => setConfig({ ...config, startDate: e.target.value })}
              className="w-full p-2 border rounded"
            />
          </div>
          
          <div>
            <label className="block text-sm font-medium mb-2">Data Final</label>
            <input
              type="date"
              value={config.endDate}
              onChange={(e) => setConfig({ ...config, endDate: e.target.value })}
              className="w-full p-2 border rounded"
            />
          </div>
        </div>
        
        <button
          onClick={handleRunBacktest}
          disabled={loading}
          className="bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600 disabled:bg-gray-300"
        >
          {loading ? 'Executando...' : 'Executar Backtest'}
        </button>
      </div>
      
      {/* Resultados */}
      {result && (
        <div className="bg-white rounded-lg shadow p-6">
          <h3 className="text-lg font-semibold mb-4">Resultados</h3>
          
          {/* Métricas */}
          <div className="grid grid-cols-4 gap-4 mb-6">
            <div className="p-4 bg-blue-50 rounded">
              <div className="text-sm text-gray-600">Retorno Total</div>
              <div className="text-2xl font-bold text-blue-600">
                {result.metrics.total_return.toFixed(2)}%
              </div>
            </div>
            
            <div className="p-4 bg-green-50 rounded">
              <div className="text-sm text-gray-600">Sharpe Ratio</div>
              <div className="text-2xl font-bold text-green-600">
                {result.metrics.sharpe_ratio.toFixed(2)}
              </div>
            </div>
            
            <div className="p-4 bg-red-50 rounded">
              <div className="text-sm text-gray-600">Max Drawdown</div>
              <div className="text-2xl font-bold text-red-600">
                {result.metrics.max_drawdown.toFixed(2)}%
              </div>
            </div>
            
            <div className="p-4 bg-purple-50 rounded">
              <div className="text-sm text-gray-600">Win Rate</div>
              <div className="text-2xl font-bold text-purple-600">
                {result.metrics.win_rate.toFixed(1)}%
              </div>
            </div>
          </div>
          
          {/* Mais métricas */}
          <div className="grid grid-cols-3 gap-4">
            <div>
              <div className="text-sm text-gray-600">Retorno Anual</div>
              <div className="font-semibold">
                {result.metrics.annual_return.toFixed(2)}%
              </div>
            </div>
            
            <div>
              <div className="text-sm text-gray-600">Sortino Ratio</div>
              <div className="font-semibold">
                {result.metrics.sortino_ratio.toFixed(2)}
              </div>
            </div>
            
            <div>
              <div className="text-sm text-gray-600">Profit Factor</div>
              <div className="font-semibold">
                {result.metrics.profit_factor.toFixed(2)}
              </div>
            </div>
            
            <div>
              <div className="text-sm text-gray-600">Total de Trades</div>
              <div className="font-semibold">
                {result.metrics.total_trades}
              </div>
            </div>
            
            <div>
              <div className="text-sm text-gray-600">Trade Médio</div>
              <div className="font-semibold">
                {result.metrics.avg_trade.toFixed(2)}%
              </div>
            </div>
            
            <div>
              <div className="text-sm text-gray-600">Melhor Trade</div>
              <div className="font-semibold text-green-600">
                {result.metrics.best_trade.toFixed(2)}%
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
```

## 📊 Exemplos de Uso

### Exemplo 1: Backtest Simples

```python
from spread_backtester import quick_backtest

# Backtest rápido com parâmetros padrão
result = quick_backtest(
    symbol1='PETR4',
    symbol2='PETR3',
    strategy='mean_reversion',
    days=365
)

print(f"Retorno Total: {result['metrics']['total_return']:.2f}%")
print(f"Sharpe Ratio: {result['metrics']['sharpe_ratio']:.2f}")
print(f"Win Rate: {result['metrics']['win_rate']:.1f}%")
```

### Exemplo 2: Otimização de Parâmetros

```python
from spread_backtester import SpreadBacktester
from datetime import datetime, timedelta

backtester = SpreadBacktester()

param_ranges = {
    'window': [10, 15, 20, 25, 30],
    'entry_threshold': [1.5, 2.0, 2.5, 3.0],
    'exit_threshold': [0.3, 0.5, 0.7]
}

result = backtester.run_multi_backtest(
    symbol1='PETR4',
    symbol2='PETR3',
    strategy_name='mean_reversion',
    start_date=datetime(2024, 1, 1),
    end_date=datetime(2024, 12, 31),
    param_ranges=param_ranges
)

print(f"Melhores parâmetros: {result['best_params']}")
print(f"Melhor Sharpe Ratio: {result['best_metrics']['sharpe_ratio']:.2f}")
```

### Exemplo 3: Comparação de Estratégias

```python
from spread_backtester import SpreadBacktester
from datetime import datetime, timedelta

backtester = SpreadBacktester()

result = backtester.compare_strategies(
    symbol1='PETR4',
    symbol2='PETR3',
    start_date=datetime(2024, 1, 1),
    end_date=datetime(2024, 12, 31),
    params={'window': 20, 'entry_threshold': 2.0, 'exit_threshold': 0.5}
)

print(f"Melhor estratégia: {result['best_strategy_name']}")
for item in result['comparison']:
    print(f"{item['strategy_name']}: {item['metrics']['sharpe_ratio']:.2f}")
```

## 🔧 Próximos Passos

### 1. Implementação
- [ ] Criar `spread_strategies.py` com definições de estratégias
- [ ] Criar `spread_backtester.py` com lógica de backtest
- [ ] Criar `backtest_api.py` com API Flask
- [ ] Criar `spreadBacktestService.ts` no frontend
- [ ] Criar componente UI para backtest

### 2. Testes
- [ ] Testar cada estratégia individualmente
- [ ] Validar cálculos de métricas
- [ ] Comparar com resultados do sistema atual
- [ ] Testar otimização de parâmetros

### 3. Melhorias
- [ ] Adicionar mais estratégias (Bollinger Bands, RSI, MACD)
- [ ] Implementar gestão de risco no backtest
- [ ] Adicionar validação de overfitting
- [ ] Criar relatórios detalhados em PDF
- [ ] Implementar walk-forward analysis

### 4. Integração
- [ ] Integrar com painel de spread existente
- [ ] Adicionar alertas quando estratégias performam bem
- [ ] Salvar resultados no banco de dados
- [ ] Criar histórico de backtests

## 📚 Referências

- [vectorBT Documentation](https://vectorbt.dev/)
- [MetaTrader5 Python API](https://www.mql5.com/en/docs/python_metatrader5)
- [Pandas Documentation](https://pandas.pydata.org/)
- [NumPy Documentation](https://numpy.org/)

## 🎯 Conclusão

A implementação do backtest com vectorBT proporcionará:

1. **Performance**: Backtesting muito mais rápido
2. **Flexibilidade**: Fácil adicionar novas estratégias
3. **Precisão**: Cálculos vetoriais mais precisos
4. **Escalabilidade**: Testar múltiplos parâmetros simultaneamente
5. **Análise**: Métricas avançadas e visualizações

A integração será feita de forma não invasiva, mantendo a funcionalidade atual e adicionando novas capacidades de backtest avançado.