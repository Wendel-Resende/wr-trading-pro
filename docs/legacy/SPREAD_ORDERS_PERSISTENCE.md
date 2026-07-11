# Persistência de Ordens de Spread - WR Trading Pro

## 📋 Resumo da Implementação

As ordens de spread executadas pela Boleta Spread agora são salvas automaticamente no banco de dados da plataforma WR Trading Pro, permitindo análise histórica e monitoramento.

---

## 🗄️ Estrutura do Banco de Dados

### Tabela `SpreadOrder`

```prisma
model SpreadOrder {
  id              String   @id @default(cuid())
  assetId1        String   // ID do primeiro ativo
  assetId2        String   // ID do segundo ativo
  type1           String   // BUY ou SELL (primeira ordem)
  type2           String   // BUY ou SELL (segunda ordem)
  quantity1       Int      // Quantidade da primeira ordem
  quantity2       Int      // Quantidade da segunda ordem
  price1          Float    // Preço da primeira ordem
  price2          Float    // Preço da segunda ordem
  spreadValue     Float    // Valor do spread na execução
  status          String   // PENDING, FILLED, CANCELLED, REJECTED
  isAutomated     Boolean  // true se executada pela automação
  automationTarget Float?   // Valor alvo (se automática)
  automationCondition String? // greater_than, less_than, equal_to
  createdAt       DateTime @default(now())
  filledAt        DateTime?
  mt5OrderTicket1 Int?     // Ticket da ordem 1 no MT5
  mt5OrderTicket2 Int?     // Ticket da ordem 2 no MT5
}
```

---

## 🔧 Funcionalidades Implementadas

### 1. API Routes

#### POST `/api/spread-orders`
Salva uma ordem de spread no banco de dados.

**Request Body:**
```json
{
  "symbol1": "PETR3",
  "symbol2": "PETR4",
  "type1": "SELL",
  "type2": "BUY",
  "quantity1": 100,
  "quantity2": 100,
  "price1": 38.50,
  "price2": 38.30,
  "spreadValue": 0.20,
  "isAutomated": false,
  "automationTarget": null,
  "automationCondition": null,
  "mt5OrderTicket1": 12345,
  "mt5OrderTicket2": 12346
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "cuid_string",
    "asset1": { "id": "...", "symbol": "PETR3", ... },
    "asset2": { "id": "...", "symbol": "PETR4", ... },
    "type1": "SELL",
    "type2": "BUY",
    ...
  }
}
```

#### GET `/api/spread-orders`
Lista todas as ordens de spread.

**Query Parameters:**
- `limit`: Número máximo de registros (padrão: 50)
- `offset`: Pular N registros (padrão: 0)
- `status`: Filtrar por status (opcional)

**Exemplo:**
```
GET /api/spread-orders?limit=10&offset=0&status=FILLED
```

**Response:**
```json
{
  "success": true,
  "data": [...],
  "meta": {
    "total": 150,
    "limit": 10,
    "offset": 0
  }
}
```

### 2. Integração com SpreadOrderForm

O componente `SpreadOrderForm` agora salva automaticamente as ordens no banco de dados após a execução bem-sucedida.

**Fluxo de Execução:**

```
Usuário clica em "Enviar Ordens"
  ↓
Ordem enviada para MT5
  ↓
Aguarda processamento (2 segundos)
  ↓
Verifica sucesso das ordens
  ↓
SE sucesso:
  ↓
  Envia POST para /api/spread-orders
  ↓
  Ordem salva no banco de dados
  ↓
  Log: "✅ Ordem de spread salva no banco de dados"
```

### 3. Script de Análise

O script `analyze_orders.py` foi atualizado para incluir ordens de spread no relatório.

**Executar:**
```bash
python analyze_orders.py
```

**Saída Exemplo:**
```
================================================================================
RELATÓRIO DE ORDENS EXECUTADAS
================================================================================

📊 ORDENS DE SPREAD
================================================================================
✅ Total de ordens de spread: 15

📊 Estatísticas de Spread:
  • Manuais: 10
  • Automáticas: 5

Ordem de Spread #1
  ID: cm1234567890
  Ativo 1: PETR3 (PETROBRAS ON) - STOCK
  Ativo 2: PETR4 (PETROBRAS PN) - STOCK
  Ação 1: SELL 100 @ R$38.50
  Ação 2: BUY 100 @ R$38.30
  Spread: R$0.20
  Status: FILLED
  Tipo: MANUAL
  Criada em: 2026-01-09 11:15:00
  Executada em: 2026-01-09 11:15:02
```

---

## 📊 Campos Disponíveis para Análise

### Informações de Execução
- **spreadValue**: Valor do spread no momento da execução
- **isAutomated**: Indica se foi executada manual ou automaticamente
- **automationTarget**: Valor alvo se foi automática
- **automationCondition**: Condição usada (greater_than, less_than, equal_to)

### Informações de Rastreamento
- **createdAt**: Timestamp de criação da ordem
- **filledAt**: Timestamp de execução da ordem
- **mt5OrderTicket1**: Ticket da ordem 1 no MetaTrader 5
- **mt5OrderTicket2**: Ticket da ordem 2 no MetaTrader 5

### Informações dos Ativos
- **assetId1 / assetId2**: IDs dos ativos no banco
- **type1 / type2**: Tipo de operação (BUY/SELL)
- **quantity1 / quantity2**: Quantidade de cada ativo
- **price1 / price2**: Preço de execução de cada ordem

---

## 🎯 Casos de Uso

### 1. Análise de Performance de Spread

```python
# Exemplo: Calcular lucro médio de spread
conn = sqlite3.connect('prisma/dev.db')
cursor = conn.cursor()

cursor.execute("""
    SELECT AVG(spreadValue) as avg_spread,
           COUNT(*) as total_orders,
           SUM(CASE WHEN isAutomated = 1 THEN 1 ELSE 0 END) as auto_orders
    FROM SpreadOrder
    WHERE status = 'FILLED'
""")

result = cursor.fetchone()
print(f"Spread médio: R${result[0]:.2f}")
print(f"Total de ordens: {result[1]}")
print(f"Ordens automáticas: {result[2]}")
```

### 2. Filtrar Ordens por Período

```python
cursor.execute("""
    SELECT * FROM SpreadOrder
    WHERE createdAt >= ? AND createdAt <= ?
    ORDER BY createdAt DESC
""", (start_date, end_date))
```

### 3. Comparar Ordens Manuais vs Automáticas

```python
cursor.execute("""
    SELECT isAutomated, 
           AVG(spreadValue) as avg_spread,
           COUNT(*) as count
    FROM SpreadOrder
    GROUP BY isAutomated
""")
```

### 4. Análise por Par de Ativos

```python
cursor.execute("""
    SELECT a1.symbol as symbol1,
           a2.symbol as symbol2,
           AVG(so.spreadValue) as avg_spread,
           COUNT(*) as total_orders
    FROM SpreadOrder so
    LEFT JOIN Asset a1 ON so.assetId1 = a1.id
    LEFT JOIN Asset a2 ON so.assetId2 = a2.id
    GROUP BY a1.symbol, a2.symbol
    ORDER BY total_orders DESC
""")
```

---

## 🔍 Consultas SQL Úteis

### Top 10 Pares de Spread Mais Negociados
```sql
SELECT a1.symbol || '/' || a2.symbol as par,
       COUNT(*) as total_ordens,
       AVG(spreadValue) as spread_medio
FROM SpreadOrder so
LEFT JOIN Asset a1 ON so.assetId1 = a1.id
LEFT JOIN Asset a2 ON so.assetId2 = a2.id
GROUP BY a1.symbol, a2.symbol
ORDER BY total_ordens DESC
LIMIT 10;
```

### Ordens Automáticas vs Manuais (Últimos 7 dias)
```sql
SELECT isAutomated,
       COUNT(*) as total,
       AVG(spreadValue) as spread_medio
FROM SpreadOrder
WHERE createdAt >= date('now', '-7 days')
GROUP BY isAutomated;
```

### Evolução do Spread ao Longo do Tempo
```sql
SELECT DATE(createdAt) as data,
       AVG(spreadValue) as spread_medio,
       COUNT(*) as ordens_dia
FROM SpreadOrder
GROUP BY DATE(createdAt)
ORDER BY data DESC;
```

---

## 🚀 Próximos Passos

### Recomendado:
1. **Dashboard de Análise**: Criar um componente frontend para visualizar as ordens de spread
2. **Exportação CSV**: Adicionar funcionalidade para exportar dados de spread
3. **Métricas de Performance**: Implementar cálculo de P&L das operações de spread
4. **Alertas**: Criar alertas baseados em padrões históricos de spread
5. **Backtesting**: Usar dados históricos para testar estratégias de spread

### Futuro:
- Integração com ML para prever spreads
- Análise de correlação entre pares de ativos
- Cálculo de risco de spread
- Otimização automática de parâmetros de spread

---

## 📝 Notas Importantes

1. **Criação Automática de Ativos**: Se os ativos (symbol1, symbol2) não existirem no banco, eles são criados automaticamente com tipo 'STOCK' e exchange 'B3'.

2. **Status das Ordens**: Atualmente todas as ordens são marcadas como 'FILLED'. Futuramente pode-se implementar rastreamento do status real via eventos do MT5.

3. **Timestamps MT5**: Os campos `mt5OrderTicket1` e `mt5OrderTicket2` estão disponíveis mas não estão sendo preenchados. Podem ser usados para rastrear ordens no MetaTrader 5.

4. **Logs**: O componente loga no console do navegador quando salva ou falha ao salvar ordens:
   - `✅ Ordem de spread salva no banco de dados`
   - `❌ Erro ao salvar ordem no banco:`

---

## 🆕 Atualizações Recentes

- ✅ Novo modelo `SpreadOrder` adicionado ao schema Prisma
- ✅ API route `/api/spread-orders` criada (POST e GET)
- ✅ Integração com `SpreadOrderForm` para salvar ordens automaticamente
- ✅ Script `analyze_orders.py` atualizado para incluir ordens de spread
- ✅ Suporte para filtragem por status, limit e offset
- ✅ Criação automática de ativos se não existirem

---

**Data de Implementação:** 09/01/2026  
**Versão:** 1.0.0