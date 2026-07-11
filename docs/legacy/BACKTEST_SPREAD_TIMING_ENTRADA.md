# Backtest de Timing de Entrada em Spreads

## 📋 Problema Identificado

### O que já temos:
✅ Sistema que identifica **quais pares** são bons para spread  
✅ Sistema que encontra oportunidades históricas  
✅ Análise de correlação e tendência

### O problema que precisamos resolver:
❌ **Quando é o momento certo para entrar na operação?**  
❌ O spread atual está em um nível favorável para entrada?  
❌ Mesmo que o par seja bom historicamente, entrar no momento errado pode gerar prejuízo

## 🎯 O Problema de Timing

### Lógica Atual (Problemática):
```python
# Análise em app.py - entra TODOS OS DIAS consecutivos
for i in range(len(hist1_daily)-1):
    data_atual = hist1_daily.index[i]
    data_seguinte = hist1_daily.index[i+1]
    
    # PREÇOS DE ENTRADA - usa fechamento do dia ATUAL
    preco_entrada_a1 = hist1_daily.loc[data_atual, 'Close']
    preco_entrada_b1 = hist2_daily.loc[data_atual, 'Close']
    
    # PREÇOS DE SAÍDA - usa fechamento do dia SEGUINTE
    preco_saida_a2 = hist1_daily.loc[data_seguinte, 'Close']
    preco_saida_b2 = hist2_daily.loc[data_seguinte, 'Close']
    
    # Ganho = (Venda A1 - Compra A2) + (Venda B2 - Compra B1)
    ganho = (preco_entrada_a1 - preco_saida_a2) + (preco_saida_b2 - preco_entrada_b1)
```

### O Problema:
1. **Não analisa se o spread atual está favorável**
2. **Entra em TODAS as oportunidades, sem filtrar**
3. **Não usa estatística do spread para determinar timing**
4. **Pode entrar em momentos onde o spread vai continuar se expandindo**

### Exemplo Prático:

**Cenário 1 - Entrada Ruim:**
```
Dia T: Spread = R$ 3.50 (Muito alto! histórico médio = R$ 2.00)
  → Sistema entra: Vende A1, Compra B1
Dia T+1: Spread = R$ 4.00 (Spread expandiu ainda mais!)
  → Sistema sai: Compra A1, Vende B1
  → PREJUÍZO! (Spread continuou se expandindo)
```

**Cenário 2 - Entrada Boa:**
```
Dia T: Spread = R$ 0.50 (Muito baixo! histórico médio = R$ 2.00)
  → Sistema entra: Vende A1, Compra B1
Dia T+1: Spread = R$ 1.80 (Spread convergiu para a média)
  → Sistema sai: Compra A1, Vende B1
  → LUCRO! (Spread voltou para a média)
```

## 🔑 Solução: Análise Estatística do Spread

### Conceitos Fundamentais

#### 1. Spread Histórico
```python
spread_t = preço_ativo1_t - preço_ativo2_t
```

#### 2. Média do Spread
```python
spread_medio = média(spread histórico dos últimos N dias)
```

#### 3. Desvio Padrão do Spread
```python
spread_std = desvio_padrão(spread histórico dos últimos N dias)
```

#### 4. Z-Score do Spread
```python
z_score = (spread_atual - spread_medio) / spread_std
```

### Interpretação do Z-Score

| Z-Score | Significado | Ação |
|---------|-------------|------|
| Z > +2 | Spread muito alto (2 desvios acima da média) | Vender spread |
| Z > +1 | Spread alto (1 desvio acima da média) | Considerar venda |
| -1 < Z < +1 | Spread próximo da média | NEUTRO - não entrar |
| Z < -1 | Spread baixo (1 desvio abaixo da média) | Considerar compra |
| Z < -2 | Spread muito baixo (2 desvios abaixo da média) | Comprar spread |

### Estratégia de Pair Trading com Timing

```python
# Análise de N dias históricos
janela_analise = 60  # Últimos 60 dias de dados

spread_historico = preço1 - preço2
spread_medio = spread_historico.rolling(janela_analise).mean()
spread_std = spread_historico.rolling(janela_analise).std()
z_score = (spread_historico - spread_medio) / spread_std

# REGRA DE ENTRADA
entrada_threshold = 2.0  # 2 desvios padrão
saida_threshold = 0.5   # 0.5 desvios padrão

# VENDER SPREAD (spread muito alto - vai cair para a média)
if z_score > entrada_threshold:
    # Vende ativo1, Compra ativo2
    # Espera spread voltar para a média
    # Quando z_score < saida_threshold, sai da posição
    entrar_posicao(tipo="venda_spread")

# COMPRAR SPREAD (spread muito baixo - vai subir para a média)
elif z_score < -entrada_threshold:
    # Compra ativo1, Vende ativo2
    # Espera spread voltar para a média
    # Quando z_score > -saida_threshold, sai da posição
    entrar_posicao(tipo="compra_spread")

# NÃO ENTRAR (spread próximo da média)
else:
    # Aguarda oportunidade melhor
    continuar_aguardando()
```

## 📊 Backtest de Timing de Entrada

### O que testar?

1. **Qual janela de análise funciona melhor?**
   - 30 dias?
   - 60 dias?
   - 90 dias?
   - 120 dias?

2. **Qual threshold de entrada funciona melhor?**
   - 1.5 desvios padrão?
   - 2.0 desvios padrão?
   - 2.5 desvios padrão?

3. **Qual threshold de saída funciona melhor?**
   - 0.5 desvios padrão?
   - 0.3 desvios padrão?
   - 1.0 desvios padrão?

4. **Qual é o melhor horário de entrada?**
   - Abertura do mercado?
   - Fechamento do dia?
   - Meio do dia?

5. **Quanto tempo ficar na posição?**
   - 1 dia (sistema atual)?
   - Até o spread voltar para a média?
   - Stop loss de X desvios?

### Métricas do Backtest

```python
resultados = {
    'total_trades': número de operações realizadas,
    'win_rate': % de operações lucrativas,
    'avg_profit': lucro médio por operação,
    'avg_loss': prejuízo médio por operação,
    'profit_factor': total_lucro / total_prejuízo,
    'max_drawdown': maior queda do capital,
    'sharpe_ratio': retorno ajustado pelo risco,
    'avg_days_in_trade': tempo médio em cada operação,
    'best_window': melhor janela de análise,
    'best_entry_threshold': melhor threshold de entrada,
    'best_exit_threshold': melhor threshold de saída
}
```

## 🏗️ Implementação Proposta

### Passo 1: Calcular Estatísticas do Spread

```python
def calcular_estatisticas_spread(hist1, hist2, janela=60):
    """
    Calcula estatísticas do spread para determinar timing de entrada
    
    Args:
        hist1: DataFrame do ativo 1
        hist2: DataFrame do ativo 2
        janela: Número de dias para análise histórica
        
    Returns:
        DataFrame com:
        - spread: Valor do spread
        - spread_medio: Média do spread (janela)
        - spread_std: Desvio padrão do spread (janela)
        - z_score: Z-score do spread
        - sinal: Sinal de entrada (-1, 0, 1)
    """
    spread = hist1['Close'] - hist2['Close']
    
    spread_medio = spread.rolling(window=janela).mean()
    spread_std = spread.rolling(window=janela).std()
    z_score = (spread - spread_medio) / spread_std
    
    # Gera sinais baseados em z-score
    sinal = pd.Series(0, index=spread.index)
    entrada_threshold = 2.0
    saida_threshold = 0.5
    
    # Vende spread quando z-score muito alto
    sinal[z_score > entrada_threshold] = -1
    
    # Compra spread quando z-score muito baixo
    sinal[z_score < -entrada_threshold] = 1
    
    # Neutro quando próximo da média
    sinal[(z_score > -saida_threshold) & (z_score < saida_threshold)] = 0
    
    return pd.DataFrame({
        'spread': spread,
        'spread_medio': spread_medio,
        'spread_std': spread_std,
        'z_score': z_score,
        'sinal': sinal
    })
```

### Passo 2: Backtester de Timing

```python
def backtest_timing_entrada(hist1, hist2, janela=60, 
                           entrada_threshold=2.0, 
                           saida_threshold=0.5,
                           dias_para_saida=1):
    """
    Executa backtest de estratégia de timing de entrada
    
    Args:
        hist1: DataFrame do ativo 1
        hist2: DataFrame do ativo 2
        janela: Janela de análise para média e std
        entrada_threshold: Z-score para entrar
        saida_threshold: Z-score para sair
        dias_para_saida: Dias máximos na posição (opcional)
        
    Returns:
        Dicionário com resultados do backtest
    """
    spread = hist1['Close'] - hist2['Close']
    spread_medio = spread.rolling(window=janela).mean()
    spread_std = spread.rolling(window=janela).std()
    z_score = (spread - spread_medio) / spread_std
    
    trades = []
    em_posicao = False
    tipo_posicao = None  # 'venda_spread' ou 'compra_spread'
    data_entrada = None
    preco_entrada_a1 = None
    preco_entrada_b1 = None
    
    for i in range(janela, len(hist1)):
        data_atual = hist1.index[i]
        z_atual = z_score.iloc[i]
        
        # ENTRADA
        if not em_posicao:
            # Vender spread (spread muito alto)
            if z_atual > entrada_threshold:
                em_posicao = True
                tipo_posicao = 'venda_spread'
                data_entrada = data_atual
                preco_entrada_a1 = hist1['Close'].iloc[i]  # Vende ativo1
                preco_entrada_b1 = hist2['Close'].iloc[i]  # Compra ativo2
            
            # Comprar spread (spread muito baixo)
            elif z_atual < -entrada_threshold:
                em_posicao = True
                tipo_posicao = 'compra_spread'
                data_entrada = data_atual
                preco_entrada_a1 = hist1['Close'].iloc[i]  # Compra ativo1
                preco_entrada_b1 = hist2['Close'].iloc[i]  # Vende ativo2
        
        # SAÍDA
        else:
            # Verifica se spread voltou para a média
            if (tipo_posicao == 'venda_spread' and z_atual < saida_threshold) or \
               (tipo_posicao == 'compra_spread' and z_atual > -saida_threshold):
                
                # Sai da posição
                data_saida = data_atual
                preco_saida_a1 = hist1['Close'].iloc[i]
                preco_saida_b1 = hist2['Close'].iloc[i]
                
                # Calcula ganho/loss
                if tipo_posicao == 'venda_spread':
                    # Entrou vendendo A1, comprando B2
                    # Sai comprando A1, vendendo B2
                    ganho = (preco_entrada_a1 - preco_saida_a1) + \
                            (preco_saida_b1 - preco_entrada_b1)
                else:
                    # Entrou comprando A1, vendendo B2
                    # Sai vendendo A1, comprando B2
                    ganho = (preco_saida_a1 - preco_entrada_a1) + \
                            (preco_entrada_b1 - preco_saida_b1)
                
                trades.append({
                    'data_entrada': data_entrada,
                    'data_saida': data_saida,
                    'tipo': tipo_posicao,
                    'z_entrada': z_score.iloc[i - (i - hist1.index.get_loc(data_entrada))],
                    'z_saida': z_atual,
                    'ganho': ganho,
                    'retorno_percentual': (ganho / preco_entrada_a1) * 100,
                    'dias_na_posicao': (data_saida - data_entrada).days
                })
                
                em_posicao = False
                tipo_posicao = None
            
            # Stop loss baseado em dias máximos
            elif (data_atual - data_entrada).days >= dias_para_saida:
                # Sai da posição (stop loss de tempo)
                data_saida = data_atual
                preco_saida_a1 = hist1['Close'].iloc[i]
                preco_saida_b1 = hist2['Close'].iloc[i]
                
                # Calcula ganho/loss (mesma lógica)
                if tipo_posicao == 'venda_spread':
                    ganho = (preco_entrada_a1 - preco_saida_a1) + \
                            (preco_saida_b1 - preco_entrada_b1)
                else:
                    ganho = (preco_saida_a1 - preco_entrada_a1) + \
                            (preco_entrada_b1 - preco_saida_b1)
                
                trades.append({
                    'data_entrada': data_entrada,
                    'data_saida': data_saida,
                    'tipo': tipo_posicao,
                    'z_entrada': z_score.iloc[i - (i - hist1.index.get_loc(data_entrada))],
                    'z_saida': z_atual,
                    'ganho': ganho,
                    'retorno_percentual': (ganho / preco_entrada_a1) * 100,
                    'dias_na_posicao': (data_saida - data_entrada).days
                })
                
                em_posicao = False
                tipo_posicao = None
    
    # Calcula métricas
    if trades:
        df_trades = pd.DataFrame(trades)
        total_trades = len(df_trades)
        winning_trades = len(df_trades[df_trades['ganho'] > 0])
        losing_trades = len(df_trades[df_trades['ganho'] <= 0])
        
        win_rate = (winning_trades / total_trades) * 100
        avg_profit = df_trades[df_trades['ganho'] > 0]['ganho'].mean() if winning_trades > 0 else 0
        avg_loss = df_trades[df_trades['ganho'] <= 0]['ganho'].mean() if losing_trades > 0 else 0
        
        total_profit = df_trades[df_trades['ganho'] > 0]['ganho'].sum()
        total_loss = abs(df_trades[df_trades['ganho'] <= 0]['ganho'].sum())
        profit_factor = total_profit / total_loss if total_loss > 0 else 0
        
        return {
            'sucesso': True,
            'total_trades': total_trades,
            'winning_trades': winning_trades,
            'losing_trades': losing_trades,
            'win_rate': win_rate,
            'avg_profit': avg_profit,
            'avg_loss': avg_loss,
            'profit_factor': profit_factor,
            'total_profit': total_profit,
            'total_loss': total_loss,
            'net_profit': total_profit - total_loss,
            'trades': trades,
            'parametros': {
                'janela': janela,
                'entrada_threshold': entrada_threshold,
                'saida_threshold': saida_threshold,
                'dias_para_saida': dias_para_saida
            }
        }
    else:
        return {
            'sucesso': False,
            'erro': 'Nenhuma operação executada com os parâmetros atuais'
        }
```

### Passo 3: Otimização de Parâmetros

```python
def otimizar_timing(hist1, hist2):
    """
    Encontra os melhores parâmetros para timing de entrada
    
    Args:
        hist1: DataFrame do ativo 1
        hist2: DataFrame do ativo 2
        
    Returns:
        Melhores parâmetros encontrados
    """
    # Range de parâmetros para testar
    janelas = [30, 45, 60, 90, 120]
    entrada_thresholds = [1.5, 2.0, 2.5, 3.0]
    saida_thresholds = [0.3, 0.5, 0.7, 1.0]
    dias_para_saida = [1, 2, 3, 5]
    
    resultados = []
    
    for janela in janelas:
        for entrada in entrada_thresholds:
            for saida in saida_thresholds:
                for dias in dias_para_saida:
                    resultado = backtest_timing_entrada(
                        hist1, hist2,
                        janela=janela,
                        entrada_threshold=entrada,
                        saida_threshold=saida,
                        dias_para_saida=dias
                    )
                    
                    if resultado['sucesso']:
                        resultados.append({
                            'janela': janela,
                            'entrada_threshold': entrada,
                            'saida_threshold': saida,
                            'dias_para_saida': dias,
                            'win_rate': resultado['win_rate'],
                            'profit_factor': resultado['profit_factor'],
                            'net_profit': resultado['net_profit'],
                            'total_trades': resultado['total_trades']
                        })
    
    # Ordena por Sharpe (win_rate * profit_factor)
    resultados.sort(key=lambda x: x['win_rate'] * x['profit_factor'], reverse=True)
    
    return {
        'melhores_parametros': resultados[:10],
        'melhor_configuracao': resultados[0]
    }
```

## 📈 Comparação: Sistema Atual vs Sistema com Timing

### Sistema Atual (Sem Timing):
```
- Entra em TODOS os dias consecutivos
- Não analisa se o spread é favorável
- Muitas operações, mas baixa taxa de acerto
- Pode entrar em momentos ruins
```

### Sistema com Timing (Proposto):
```
- Entra apenas quando spread está extremo (z-score > 2 ou < -2)
- Usa estatística para identificar bons pontos de entrada
- Menos operações, mas maior taxa de acerto
- Evita entrar em momentos onde spread vai continuar se expandindo
```

## 🔍 Exemplo Prático: PETR4 vs PETR3

### Análise Estatística:

```
Janela de 60 dias:
- Spread médio: R$ 2.15
- Desvio padrão: R$ 0.45
- Spread atual: R$ 3.20
- Z-Score atual: (3.20 - 2.15) / 0.45 = +2.33

RECOMENDAÇÃO: VENDER SPREAD
- Z-score > 2.0 → Spread muito alto
- Espera-se que spread caia para a média (R$ 2.15)
- Potencial de lucro: R$ 1.05 por ação
```

### Simulação de Operação:

```
Dia T (Z-score = +2.33):
  - Preço PETR4: R$ 38.50
  - Preço PETR3: R$ 35.30
  - Spread: R$ 3.20
  - Ação: Vende PETR4, Compra PETR3

Dia T+1 (Z-score = +0.80):
  - Preço PETR4: R$ 37.80
  - Preço PETR3: R$ 35.50
  - Spread: R$ 2.30
  - Ação: Compra PETR4, Venda PETR3

Resultado:
  - Ganho: (38.50 - 37.80) + (35.50 - 35.30) = R$ 0.90
  - Retorno: 0.90 / 38.50 = 2.34%
  - Sucesso! ✅
```

## 🎯 Próximos Passos

### 1. Implementar Backtester de Timing
- [ ] Criar função `calcular_estatisticas_spread`
- [ ] Criar função `backtest_timing_entrada`
- [ ] Criar função `otimizar_timing`

### 2. Testar com Dados Históricos
- [ ] Testar com PETR4 vs PETR3
- [ ] Testar com VALE3 vs VALE5
- [ ] Testar com outros pares de PARES_SUGERIDOS
- [ ] Comparar com sistema atual

### 3. Criar Dashboard de Timing
- [ ] Mostrar spread atual vs spread médio
- [ ] Mostrar z-score atual
- [ ] Mostrar quando é bom momento para entrar
- [ ] Alertas quando spread atinge extremos

### 4. Otimização de Parâmetros
- [ ] Encontrar melhor janela para cada par
- [ ] Encontrar melhor threshold para cada par
- [ ] Validar com walk-forward analysis
- [ ] Evitar overfitting

## 📊 Métricas de Sucesso

### Sistema com Timing é melhor se:
1. ✅ **Win Rate > Sistema Atual** (mais operações lucrativas)
2. ✅ **Profit Factor > 2.0** (lucro muito maior que prejuízo)
3. ✅ **Menor Drawdown** (menos risco)
4. ✅ **Sharpe Ratio Melhor** (melhor retorno ajustado pelo risco)
5. ✅ **Operações Mais Qualificadas** (não entra em qualquer momento)

## 🎓 Referências Conceituais

### Pair Trading
- **Conceito**: Aposta que dois ativos correlacionados vão convergir
- **Estratégia**: Vende ativo caro, compra ativo barato
- **Saída**: Quando spread volta para a média

### Mean Reversion
- **Conceito**: Extremos tendem a voltar para a média
- **Mecanismo**: Quando spread está muito alto, tende a cair
- **Aplicação**: Usa z-score para identificar extremos

### Z-Score
- **Definição**: Quantos desvios padrão um valor está da média
- **Interpretação**: 
  - Z = 0: Valor é igual à média
  - Z = +2: Valor está 2 desvios acima (raro, 2.3% das vezes)
  - Z = -2: Valor está 2 desvios abaixo (raro, 2.3% das vezes)
- **Uso**: Identifica quando spread está em extremo estatístico

## 🚀 Conclusão

O problema NÃO é encontrar quais pares são bons (já temos isso).  
O problema é **encontrar o momento certo para entrar**.

A solução proposta usa:
1. ✅ **Análise estatística do spread** (média, desvio padrão)
2. ✅ **Z-score para identificar extremos** (quando spread está muito alto/baixo)
3. ✅ **Backtest para validar parâmetros** (janela, thresholds)
4. ✅ **Sistema que espera MOMENTO CERTO** (não entra em qualquer momento)

Isso vai transformar a estratégia de spread de "entrar sempre" para "entrar apenas em momentos ótimos", aumentando a taxa de acerto e reduzindo o risco.