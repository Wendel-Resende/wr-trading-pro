# Indicadores Técnicos Disponíveis - WR Trading Pro

## Visão Geral

O sistema de feature engineering foi atualizado para usar a biblioteca **pandas-ta**, que fornece mais de **130 indicadores técnicos** e analíticos para análise financeira. Isso representa um aumento significativo em relação à implementação anterior, que tinha apenas alguns indicadores básicos.

## Total de Features: **165 colunas**

### Categorias de Indicadores

## 1. Médias Móveis (29 indicadores)

### Simples Moving Averages (SMA)
- `sma_5`, `sma_10`, `sma_20`, `sma_50`, `sma_100`, `sma_200`
- Médias móveis simples de diferentes períodos

### Exponential Moving Averages (EMA)
- `ema_5`, `ema_10`, `ema_20`, `ema_21`, `ema_50`, `ema_100`, `ema_200`
- Médias móveis exponenciais com maior peso nos dados recentes

### Outras Médias Móveis
- `wma_20` - Weighted Moving Average
- `hma_20` - Hull Moving Average
- `tema_20` - Triple Exponential Moving Average
- `t3_20` - Triple Exponential Moving Average (T3)
- `dema_20` - Double Exponential Moving Average

### Preços Médios
- `midpoint_20` - Ponto médio do período
- `midprice_20` - Preço médio do período (high + low) / 2
- `vwap` - Volume Weighted Average Price

### Relacionados a Médias
- `ema_20_slope` - Inclinação da EMA de 20 períodos
- `price_above_sma_20/50/200` - Booleana: preço acima da SMA
- `price_above_ema_20/50/200` - Booleana: preço acima da EMA
- `sma_cross` - Booleana: SMA 20 acima de SMA 50
- `ema_cross` - Booleana: EMA 20 acima de EMA 50

## 2. Indicadores de Momentum (18 indicadores)

### RSI (Relative Strength Index)
- `rsi_7`, `rsi_14`, `rsi_21`
- Indica condições de sobrecompra/sobrevenda

### Stochastic
- `stoch_k` - Linha %K do Stochastic Oscillator
- `stoch_d` - Linha %D do Stochastic Oscillator

### Stochastic RSI
- `stochrsi_k` - Stochastic RSI %K
- `stochrsi_d` - Stochastic RSI %D

### MACD (Moving Average Convergence Divergence)
- `macd_12_26_9` - Linha MACD
- `macd_hist_12_26_9` - Histograma MACD
- `macd_signal_12_26_9` - Linha de sinal MACD

### Outros Indicadores de Momentum
- `willr_14` - Williams %R
- `roc_5`, `roc_10`, `roc_20` - Rate of Change
- `mom_10` - Momentum
- `ppo_12_26_9` - Percentage Price Oscillator
- `ppo_hist_12_26_9` - Histograma PPO
- `ppo_signal_12_26_9` - Sinal PPO

### Features de Momentum Adicionais
- `price_momentum_5/10/20` - Momentum do preço
- `acceleration_5` - Aceleração do momentum
- `momentum_5/10/20` - Diferença de preço
- `rate_of_change_5/10/20` - Taxa de mudança em porcentagem

## 3. Indicadores de Volume (8 indicadores)

### Indicadores de Volume
- `obv` - On Balance Volume
- `mfi_14` - Money Flow Index
- `ad` - Accumulation/Distribution
- `cmf_20` - Chaikin Money Flow
- `fi_13` - Force Index
- `eom_14` - Ease of Movement
- `vwap` - Volume Weighted Average Price

### Features de Volume
- `volume_sma_5`, `volume_sma_20` - Média móvel do volume
- `volume_ema_5`, `volume_ema_20` - EMA do volume
- `volume_ratio_5`, `volume_ratio_20` - Razão do volume vs média
- `volume_change` - Mudança percentual do volume
- `volume_trend_5`, `volume_trend_20` - Tendência do volume
- `volume_volatility_5`, `volume_volatility_20` - Volatilidade do volume

## 4. Indicadores de Volatilidade (16 indicadores)

### ATR (Average True Range)
- `atr_7`, `atr_14` - Average True Range
- `natr_14` - Normalized Average True Range
- `atr_ratio_14` - ATR relativo ao preço

### Bollinger Bands
- `bb_upper` - Banda superior
- `bb_middle` - Banda média (SMA)
- `bb_lower` - Banda inferior
- `bb_width` - Largura das bandas
- `bb_pct` - Percentual de posição dentro das bandas
- `bb_std` - Desvio padrão usado

### Canais de Volatilidade
- `kc_upper`, `kc_middle`, `kc_lower` - Keltner Channels
- `dc_upper`, `dc_middle`, `dc_lower` - Donchian Channels

### Volatilidade Avançada
- `volatility_5`, `volatility_10`, `volatility_20`, `volatility_50` - Desvio padrão dos retornos
- `parkinson_volatility_20` - Estimativa de volatilidade de Parkinson
- `gk_volatility_20` - Volatilidade Garman-Klass
- `yz_volatility_20` - Volatilidade Yang-Zhang
- `volatility_ratio_20` - Volatilidade atual vs média histórica

## 5. Indicadores de Tendência (9 indicadores)

### ADX (Average Directional Index)
- `adx_14` - Força da tendência
- `dmp_14` - +DI (Directional Index positivo)
- `dmn_14` - -DI (Directional Index negativo)

### Aroon
- `aroon_up` - Aroon Up
- `aroon_down` - Aroon Down
- `aroon_osc` - Aroon Oscillator

### Outros Indicadores de Tendência
- `trend_strength` - Força da tendência baseada em SMAs
- `minus_dm`, `plus_dm` - Direcional Movement

## 6. Outros Indicadores Técnicos (10 indicadores)

### Ichimoku Cloud
- `ichimoku_a` - Senkou Span A
- `ichimoku_b` - Senkou Span B
- `ichimoku_base` - Kijun-sen
- `ichimoku_conversion` - Tenkan-sen
- `ichimoku_lagging` - Chikou Span
- `ichimoku_a_span` - Span A
- `ichimoku_b_span` - Span B

### Parabolic SAR
- `psar` - Parabolic SAR
- `psar_long` - Parabolic SAR (long)
- `psar_short` - Parabolic SAR (short)

### Outros
- `cci_20` - Commodity Channel Index
- `dpo_20` - Detrended Price Oscillator
- `kst`, `kst_sig` - Know Sure Thing
- `tsi` - True Strength Index
- `uo` - Ultimate Oscillator
- `ao` - Awesome Oscillator
- `mi` - Mass Index
- `vortex_pos`, `vortex_neg` - Vortex Indicator
- `zscore_20` - Z-Score estatístico
- `qstick` - Qstick Indicator

## 7. Features Estatísticas (36 indicadores)

### Rolling Statistics
- `returns_mean_5/10/20/50` - Média dos retornos
- `returns_median_5/10/20/50` - Mediana dos retornos
- `returns_skew_5/10/20/50` - Assimetria dos retornos
- `returns_kurt_5/10/20/50` - Curtose dos retornos
- `returns_min_5/10/20/50` - Mínimo dos retornos
- `returns_max_5/10/20/50` - Máximo dos retornos
- `returns_range_5/10/20/50` - Range dos retornos

### Quantis
- `returns_q25_20/50` - Quantil 25%
- `returns_q75_20/50` - Quantil 75%
- `returns_iqr_20/50` - Interquartile Range

### Features de Preço
- `price_zscore_20/50` - Z-Score do preço
- `price_percentile_20/50/200` - Percentil rank do preço

## 8. Features de Tempo (18 indicadores)

### Componentes de Tempo
- `hour` - Hora do dia (0-23)
- `day_of_week` - Dia da semana (0-6)
- `day_of_month` - Dia do mês (1-31)
- `month` - Mês (1-12)
- `quarter` - Trimestre (1-4)

### Features Booleanas
- `is_weekend` - É fim de semana?
- `session_asian` - Sessão Asiática
- `session_london` - Sessão de Londres
- `session_newyork` - Sessão de Nova York
- `session_off_hours` - Fora do horário de trading

### Features Normalizadas
- `time_of_day` - Hora do dia normalizada (0-1)
- `day_of_year` - Dia do ano normalizado (0-1)

### Features Cíclicas
- `hour_sin`, `hour_cos` - Representação cíclica da hora
- `day_of_week_sin`, `day_of_week_cos` - Representação cíclica do dia da semana
- `month_sin`, `month_cos` - Representação cíclica do mês

## 9. Features de Preço (12 indicadores)

### Retornos
- `returns` - Retorno simples
- `log_returns` - Retorno logarítmico
- `returns_2/3/5/10` - Retornos multi-período

### Features Relativas
- `price_rel_ma20` - Preço relativo à média móvel
- `high_low_range` - Range da vela (high - low) / close
- `open_close_diff` - Diferença open-close / open

### Análise de Velas
- `candle_body` - Corpo da vela
- `candle_upper_shadow` - Sombra superior
- `candle_lower_shadow` - Sombra inferior

## Benefícios da Nova Implementação

### 1. **Muito Mais Indicadores**
- De ~10 indicadores básicos para **165 features**
- Mais de **130 indicadores técnicos** diferentes

### 2. **Melhor Precisão**
- Implementações testadas e otimizadas da pandas-ta
- Menos chance de erros em cálculos complexos

### 3. **Performance**
- pandas-ta usa Numba para otimização
- Cálculos mais rápidos para grandes datasets

### 4. **Manutenibilidade**
- Código mais limpo e organizado
- Fácil adicionar novos indicadores
- Documentação extensa da pandas-ta

### 5. **Flexibilidade**
- Suporte para fallback manual se pandas-ta não estiver disponível
- Adaptação automática a diferentes formatos de dados

## Como Usar

### Exemplo Básico

```python
from ml.data.feature_engineering import FeatureEngineer

# Criar instância
fe = FeatureEngineer()

# Criar features
df_features = fe.create_features(df_raw)

# Resultado: DataFrame com 165 colunas
print(f"Features criadas: {len(df_features.columns)}")
```

### Preparar Dados para Treinamento

```python
# Para classificação de tendência
X_seq, y_seq, feature_cols = fe.prepare_training_data(
    df, 
    lookback=100, 
    horizon=5
)

# Para predição de preço
X_seq, y_seq, scaler, feature_cols = fe.prepare_price_data(
    df, 
    lookback=100, 
    horizon=5
)
```

## Indicadores Mais Importantes para Trading

### Para Identificar Tendências
1. **SMA/EMA Crossovers** - `sma_cross`, `ema_cross`
2. **ADX** - `adx_14` (acima de 25 = tendência forte)
3. **Ichimoku Cloud** - Preço acima/abaixo da nuvem

### Para Momentum
1. **RSI** - `rsi_14` (sobrecompra > 70, sobrevenda < 30)
2. **MACD** - `macd_12_26_9` vs `macd_signal_12_26_9`
3. **Stochastic** - `stoch_k` vs `stoch_d`

### Para Volatilidade
1. **ATR** - `atr_14` (mede volatilidade)
2. **Bollinger Bands** - `bb_upper`, `bb_lower` (squeeze)
3. **Volatility Ratio** - `volatility_ratio_20`

### Para Volume
1. **OBV** - Confirma tendência pelo volume
2. **MFI** - Money Flow Index (volume + preço)
3. **VWAP** - Preço médio ponderado por volume

## Próximos Passos

1. **Retreinar Modelos** - Use as novas 165 features para treinar modelos mais robustos
2. **Feature Selection** - Identifique as features mais importantes para cada par/periodicidade
3. **A/B Testing** - Compare modelos antigos vs novos
4. **Backtesting** - Teste estratégias com os novos indicadores
5. **Otimização** - Ajuste parâmetros dos indicadores para melhor performance

## Referências

- [pandas-ta Documentation](https://twopirllc.github.io/pandas-ta/)
- [Technical Analysis Library](https://github.com/twopirllc/pandas-ta)
- [Investopedia Technical Analysis](https://www.investopedia.com/terms/t/technicalanalysis.asp)

---

**Última Atualização:** Janeiro 2026
**Versão:** 2.0
