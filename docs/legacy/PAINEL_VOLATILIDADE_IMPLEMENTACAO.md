# 📊 Painel de Monitoramento de Volatilidade

## 📅 Data: 13/01/2026

## 🎯 Objetivo

Implementar um painel de monitoramento de volatilidade na seção Spread B3 da plataforma WR Trading Pro, que calcula a volatilidade mensal e anual de ativos usando pandas-ta e dados do MetaTrader 5.

## ✅ Implementação Realizada

### 1. Componente React: VolatilityPanel

**Arquivo:** `src/components/VolatilityPanel.tsx`

**Funcionalidades:**
- Campo de entrada para símbolo do ativo (ex: VALE3)
- Botão de busca para calcular volatilidade
- Exibição de símbolos recentes (armazenados no localStorage)
- Cards de volatilidade mensal e anual
- Classificação do nível de volatilidade (Baixa, Moderada, Alta, Muito Alta)
- Desvio padrão mensal e anual
- Explicação de como interpretar os resultados
- Exemplos rápidos para teste (VALE3, PETR4, ITUB4, BBAS3, WEGE3)

**Interface Visual:**
- Design cyberpunk consistente com o resto da plataforma
- Indicador visual de nível de volatilidade com cores (verde, amarelo, laranja, vermelho)
- Ícones de atividade e tendência
- Efeitos neon nas métricas principais

### 2. API Python: volatility_api.py

**Arquivo:** `volatility_api.py`

**Funcionalidades:**
- Conecta ao MetaTrader 5 para buscar dados históricos
- Usa pandas-ta para calcular indicadores de volatilidade
- Calcula volatilidade anualizada (std_dev * √252)
- Calcula volatilidade mensal (std_dev * √21)
- Calcula ATR (Average True Range) como medida alternativa
- Retorna dados em formato JSON

**Fórmulas Utilizadas:**

```python
# Volatilidade Anual
annual_volatility = std_dev_daily * (252 ** 0.5) * 100

# Volatilidade Mensal
monthly_volatility = std_dev_daily * (21 ** 0.5) * 100

# ATR (Average True Range)
df['ATR'] = ta.atr(df['High'], df['Low'], df['Close'], length=14)
```

**Endpoints:**
- `POST /api/volatility` - Calcula volatilidade de um ativo
- `GET /health` - Verificação de saúde da API

### 3. API Next.js: /api/volatility

**Arquivo:** `src/app/api/volatility/route.ts`

**Funcionalidades:**
- Endpoint que atua como proxy entre frontend e API Python
- Timeout de 30 segundos para cálculos
- Tratamento de erros adequado
- Validação de parâmetros

**Parâmetros:**
- `symbol` (obrigatório): Símbolo do ativo (ex: VALE3)
- `days` (opcional): Número de dias de dados históricos (padrão: 365)

**Resposta:**
```json
{
  "success": true,
  "data": {
    "symbol": "VALE3",
    "monthlyVolatility": 15.5,
    "annualVolatility": 53.7,
    "monthlyStdDev": 15.5,
    "annualStdDev": 53.7,
    "lastUpdate": "2026-01-13T20:00:00.000Z",
    "metadata": {
      "atrVolatility": 2.3,
      "dataPoints": 252,
      "dateRange": {
        "start": "2025-01-13",
        "end": "2026-01-13"
      }
    }
  }
}
```

### 4. Integração na Página Principal

**Arquivo:** `src/app/page.tsx`

**Posição:**
- Na aba "Spread B3"
- Coluna Esquerda (lg:col-span-1)
- Logo abaixo da Boleta Spread (SpreadOrderForm)
- Em um container `space-y-4` para espaçamento adequado

## 📊 Como Funciona

### Fluxo de Dados:

```
Usuário digita símbolo (ex: VALE3)
         ↓
Frontend faz POST para /api/volatility
         ↓
Next.js API faz proxy para http://localhost:5555/api/volatility
         ↓
Python API conecta ao MT5
         ↓
Python busca dados históricos (1 ano)
         ↓
Python calcula volatilidade usando pandas-ta
         ↓
Python retorna resultado JSON
         ↓
Next.js API encaminha para frontend
         ↓
Frontend exibe resultados no painel
```

### Cálculos de Volatilidade:

#### Volatilidade Anual:
- Fórmula: `desvio_padrao_diario * √252 * 100`
- 252 = número aproximado de dias de trading em um ano
- Resultado em porcentagem (%)

#### Volatilidade Mensal:
- Fórmula: `desvio_padrao_diario * √21 * 100`
- 21 = número aproximado de dias de trading em um mês
- Resultado em porcentagem (%)

#### ATR (Average True Range):
- Período: 14 dias
- Mede a volatilidade baseada em range de preço
- Calculado como percentual do preço médio

## 🎨 Interface Visual

### Níveis de Volatilidade:

| Volatilidade | Nível | Cor | Significado |
|--------------|--------|------|-------------|
| < 10% | Baixa | Verde 🟢 | Ativo estável, movimentos pequenos |
| 10-20% | Moderada | Amarelo 🟡 | Movimentos moderados |
| 20-30% | Alta | Laranja 🟠 | Movimentos significativos |
| > 30% | Muito Alta | Vermelho 🔴 | Movimentos muito voláteis |

### Layout do Painel:

1. **Header:**
   - Ícone de Activity
   - Título "Monitoramento de Volatilidade"

2. **Formulário de Busca:**
   - Campo de entrada para símbolo
   - Botão "Analisar"
   - Estado de loading com ícone girando

3. **Símbolos Recentes:**
   - Badges clicáveis para acesso rápido
   - Armazenados no localStorage
   - Máximo de 5 símbolos

4. **Resultado Principal:**
   - Nível de volatilidade (ex: "Alta")
   - Card com cor de destaque
   - Ícone grande de atividade

5. **Cards de Métricas:**
   - Volatilidade Mensal (ciano)
   - Volatilidade Anual (rosa)
   - Desvio padrão em cada card

6. **Informações Adicionais:**
   - Símbolo
   - Última atualização
   - Fonte (Pandas-TA)

7. **Explicação:**
   - Como interpretar os resultados
   - Classificação dos níveis de volatilidade

8. **Estado Inicial:**
   - Ícone grande de atividade
   - Texto explicativo
   - Exemplos rápidos para teste

## 🚀 Como Usar

### Passo 1: Iniciar a API Python

```bash
# Instalar dependências se necessário
pip install flask flask-cors pandas pandas_ta MetaTrader5

# Iniciar o servidor
python volatility_api.py
```

O servidor iniciará em: `http://localhost:5555`

### Passo 2: Acessar a Plataforma

1. Abra a plataforma WR Trading Pro
2. Navegue para a aba "Spread B3"
3. Encontre o painel "Monitoramento de Volatilidade" na coluna esquerda

### Passo 3: Analisar um Ativo

1. Digite o símbolo do ativo (ex: VALE3)
2. Clique no botão "Analisar"
3. Aguarde o cálculo (aprox. 2-5 segundos)
4. Visualize os resultados

### Passo 4: Interpretar os Resultados

- **Volatilidade Baixa (<10%):** Ativo estável, menor risco, menor potencial de retorno
- **Volatilidade Moderada (10-20%):** Equilíbrio entre risco e retorno
- **Volatilidade Alta (20-30%):** Maior risco, maior potencial de retorno
- **Volatilidade Muito Alta (>30%):** Altíssimo risco, volatilidade extrema

## 📝 Exemplo Prático

### Análise de VALE3:

```
Entrada: VALE3
Dados: 365 dias (1 ano)
```

**Resultado Exemplo:**
```json
{
  "symbol": "VALE3",
  "monthlyVolatility": 15.5,
  "annualVolatility": 53.7,
  "monthlyStdDev": 15.5,
  "annualStdDev": 53.7,
  "atrVolatility": 2.3
}
```

**Interpretação:**
- Volatilidade Mensal: 15.5% - Moderada
- Volatilidade Anual: 53.7% - Alta
- ATR Volatility: 2.3% - Medidor adicional de volatilidade

## 🔧 Configuração

### Ajustes no volatility_api.py:

```python
# Caminho do MT5 (ajuste conforme necessário)
MT5_PATH = "C:\\Program Files\\MetaTrader 5\\terminal64.exe"

# Credenciais MT5 (se necessário)
MT5_LOGIN = None
MT5_PASSWORD = None
MT5_SERVER = None
```

### Porta da API Python:

```python
# Alterar no final do arquivo volatility_api.py
app.run(host='0.0.0.0', port=5555, debug=True)
```

Se alterar a porta, atualize também em `src/app/api/volatility/route.ts`:

```typescript
const pythonApiUrl = 'http://localhost:NOVA_PORTA/api/volatility';
```

## ⚠️ Requisitos

### Bibliotecas Python:

```bash
pip install flask flask-cors pandas pandas_ta MetaTrader5
```

- **flask:** Framework web para API
- **flask-cors:** Habilita CORS
- **pandas:** Manipulação de dados
- **pandas-ta:** Análise técnica e cálculos de volatilidade
- **MetaTrader5:** Conexão com MT5

### Conexão MT5:

- MetaTrader 5 deve estar instalado
- Terminal deve estar aberto (ou configurar auto-start)
- Ativos devem ter dados históricos disponíveis

## 🐛 Troubleshooting

### Erro: "Não foi possível conectar com o serviço de volatilidade"

**Solução:**
1. Verifique se o script Python está rodando
2. Verifique se está na porta correta (5555)
3. Verifique logs do Python para erros

### Erro: "Não foi possível obter dados históricos"

**Solução:**
1. Verifique se o MT5 está conectado
2. Verifique se o símbolo existe no MT5
3. Tente com sufixo ".SA" (ex: VALE3.SA)
4. Verifique se há dados históricos disponíveis

### Erro: "Não foi possível calcular a volatilidade"

**Solução:**
1. Aumente o número de dias (days parameter)
2. Verifique se há dados suficientes no MT5
3. Tente com outro ativo para teste

### Volatilidade retornando 0

**Solução:**
1. Verifique se há dados suficientes (mínimo 20 dias)
2. Verifique se os dados são válidos (preço > 0)
3. Verifique logs do Python para debugging

## 📚 Referências

### Pandas-TA:
- Documentação: https://twopirllc.github.io/pandas-ta/
- Fórmulas: https://twopirllc.github.io/pandas-ta/study/ta/

### Volatilidade:
- **Volatilidade Histórica:** Mede a variação passada dos preços
- **Volatilidade Anualizada:** Extrapolada para um ano
- **Desvio Padrão:** Mede a dispersão dos retornos
- **ATR:** Média do range de preço em um período

### MetaTrader 5:
- Documentação Python: https://www.mql5.com/en/docs/python_metatrader5

## 🎉 Conclusão

✅ **Componente React criado** - Interface completa e funcional
✅ **API Python criada** - Cálculos usando pandas-ta e MT5
✅ **API Next.js criada** - Proxy entre frontend e Python
✅ **Integração concluída** - Painel posicionado na seção Spread B3
✅ **Documentação completa** - Guia de uso e troubleshooting

O painel de monitoramento de volatilidade está pronto para uso e está integrado na seção Spread B3 da plataforma WR Trading Pro, logo abaixo da Boleta Spread.

---

**Última Atualização:** 13/01/2026  
**Arquivos Criados/Modificados:**
- `src/components/VolatilityPanel.tsx` (novo)
- `volatility_api.py` (novo)
- `src/app/api/volatility/route.ts` (novo)
- `src/app/page.tsx` (modificado - integração)
  
**Status:** ✅ Implementado e Testado
