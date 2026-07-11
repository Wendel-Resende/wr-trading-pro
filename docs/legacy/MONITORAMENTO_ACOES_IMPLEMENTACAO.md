# Análise e Implementação do Monitoramento de Ações

## Resumo da Análise da Planilha monitoramento.xlsx

A planilha `monitoramento.xlsx` contém um sistema completo de monitoramento de ações de dividendos com os seguintes componentes principais:

### 1. Estrutura Principal
- **Monitoramento de Ações**: Lista de ações monitoradas com dados fundamentais
- **Cálculos Automáticos**: Preço teto, yield on cost, resultados
- **Gatilhos de Compra/Venda**: Baseados em indicadores fundamentais
- **Mapa de Dividendos**: Previsão mensal de recebimento de dividendos
- **Alertas**: Notificações de mudanças de status e preços
- **Relatórios**: Análises de carteira, performance e status

### 2. Campos Principais

#### Dados do Ativo
- **Symbol**: Código da ação (ex: PETR4, VALE3)
- **Tipo**: ON ou PN
- **Composição**: Fator de composição para cálculo do preço teto

#### Dados Financeiros
- **VPA**: Valor Patrimonial por Ação
- **LPA**: Lucro por Ação
- **ROE**: Return on Equity (Retorno sobre Patrimônio)
- **P/VPA**: Preço sobre VPA
- **P/L**: Preço sobre Lucro
- **Patrimônio Líquido**: Valor total do patrimônio
- **Lucro Líquido**: Lucro anual da empresa
- **Ações Emitidas**: Quantidade total de ações

#### Dados de Posição
- **Preço Atual**: Cotação atual da ação
- **Preço Médio de Compra**: Preço médio de aquisição
- **Quantidade**: Número de ações adquiridas
- **Valor Investido**: Quantidade × Preço Médio

#### Indicadores de Dividendos
- **Payout do Estatuto**: % do lucro distribuído como dividendos
- **DY Média 3 Anos**: Dividend Yield médio histórico
- **Previsão Dividendo Anual**: Soma dos dividendos mensais previstos
- **Yield on Cost**: (Dividendo Anual / Valor Investido) × 100

#### Preços de Referência
- **Preço Teto**: VPA × 3/8 × Composição
- **Preço Teto Reajustado**: Limite superior para venda

#### Gatilhos de Compra
- **Gatilho ROE**: Valor mínimo de ROE para compra
- **Gatilho VPA**: Valor máximo de VPA para atenção
- **Gatilho LPA**: Valor mínimo de LPA para compra

#### Status
- **COMPRA**: Preço atual ≤ Preço Teto
- **VENDA**: Preço atual > Preço Teto Reajustado
- **NEUTRO**: Entre preço teto e teto reajustado
- **ATENÇÃO**: Gatilhos fundamentais não atendidos

## Implementação na Plataforma WR Trading Pro

### 1. Banco de Dados (Prisma)

#### Model Criado
```prisma
model StockMonitoring {
  // Campos principais
  id              String    @id @default(cuid())
  assetId         String
  stockType       String    // 'ON' ou 'PN'
  composition     Float     @default(1)
  
  // Gatilhos
  gatilhoROE      Float?
  gatilhoVPA      Float?
  gatilhoLPA      Float?
  
  // Preços
  precoTeto       Float?
  precoTetoReajustado Float?
  precoAtual      Float?
  precoMedioCompra Float?
  
  // Metas
  metaPapeis      Int       @default(0)
  
  // Financeiros
  patrimonioLiquido   Float?
  lucroLiquido        Float?
  acoesEmitidas       BigInt?
  vpa                 Float?
  pVpa                Float?
  lpa                 Float?
  precoLucro          Float?
  roe                 Float?
  
  // Dividendos
  payoutEstatuto      Float?
  dyMedia3Anos        Float?
  previsaoDividendoAnual Float?
  yieldOnCost         Float?
  
  // Posição
  quantidadeAdquirida Int       @default(0)
  valorInvestido      Float?
  valorCarteira       Float?
  resultado           Float     @default(0)
  participacaoCarteira Float?
  
  // Status
  status          String    @default('NEUTRO')
  observacoes     String?
  
  createdAt       DateTime  @default(now())
  updatedAt       DateTime  @updatedAt
  
  asset           Asset     @relation(fields: [assetId], references: [id])
  dividendMaps    DividendMap[]
  alerts          StockAlert[]
  reports         StockReport[]
}

model DividendMap {
  id        String  @id @default(cuid())
  stockId   String
  ano       Int
  jan       Float   @default(0)
  fev       Float   @default(0)
  mar       Float   @default(0)
  abr       Float   @default(0)
  mai       Float   @default(0)
  jun       Float   @default(0)
  jul       Float   @default(0)
  ago       Float   @default(0)
  set       Float   @default(0)
  out       Float   @default(0)
  nov       Float   @default(0)
  dez       Float   @default(0)
  total     Float   @default(0)
  
  stock     StockMonitoring @relation(fields: [stockId], references: [id])
  
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  
  @@unique([stockId, ano])
}

model StockAlert {
  id          String   @id @default(cuid())
  stockId     String
  type        String   // 'PRICE', 'DIVIDEND', 'STATUS', 'PORTFOLIO'
  condition   String   // 'above', 'below', 'equals', 'changed_to'
  value       Float?
  targetValue Float?
  message     String
  severity    String   @default('INFO') // 'INFO', 'WARNING', 'CRITICAL'
  isActive    Boolean  @default(true)
  isRead      Boolean  @default(false)
  triggeredAt DateTime?
  
  stock       StockMonitoring @relation(fields: [stockId], references: [id])
  
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
}

model StockReport {
  id          String   @id @default(cuid())
  name        String
  type        String   // 'PORTFOLIO', 'PERFORMANCE', 'DIVIDENDS', 'STATUS'
  startDate   DateTime
  endDate     DateTime
  data        String   // JSON serializado
  generatedBy String   @default('Sistema')
  
  createdAt   DateTime @default(now())
}
```

### 2. Serviços Implementados

#### StockMonitoringService

**Métodos CRUD Básicos:**
- `getAll()`: Lista todos os monitoramentos
- `getById(id)`: Busca por ID
- `getByAssetId(assetId)`: Busca por ativo
- `create(input)`: Cria novo monitoramento
- `update(id, data)`: Atualiza existente
- `delete(id)`: Remove monitoramento

**Métodos de Cálculo:**
- `calcularPrecoTeto(vpa, composition)`: Calcula preço teto
  - Fórmula: VPA × 0.375 × composição
  
- `calcularYieldOnCost(dividendoAnual, valorInvestido)`: Calcula yield
  - Fórmula: (Dividendo Anual / Valor Investido) × 100
  
- `calcularParticipacaoCarteira(valorPosicao, valorCarteiraTotal)`: 
  - Fórmula: (Valor da Posição / Valor Total) × 100

- `updateCalculations(id)`: Atualiza todos os cálculos automaticamente
- `updateStatus(id)`: Atualiza status baseado em gatilhos

**Métodos de Posição:**
- `updatePrecoAtual(id, precoAtual)`: Atualiza preço e recalcula
- `updatePosicao(id, quantidade, precoMedio)`: Atualiza posição do MT5
- `calcularTodasParticipacoes()`: Recalcula toda a carteira

**Métodos de Dividendos:**
- `createDividendMap(input)`: Cria mapa mensal de dividendos
- `getDividendMap(stockId, ano)`: Busca mapa por ano
- `getDividendMapsByStock(stockId)`: Lista todos os mapas
- `updateDividendMap(id, data)`: Atualiza mapa existente
- `deleteDividendMap(id)`: Remove mapa

**Métodos de Alertas:**
- `createAlert(data)`: Cria novo alerta
- `getAlertsByStock(stockId)`: Lista alertas de uma ação
- `getAllAlerts(options)`: Lista todos com filtros
- `markAlertAsRead(id)`: Marca como lido
- `markAllAlertsAsRead()`: Marca todos como lidos
- `updateAlert(id, data)`: Atualiza alerta
- `deleteAlert(id)`: Remove alerta
- `checkPriceAlerts(stockId, currentPrice)`: Verifica alertas de preço
- `checkStatusAlerts(stockId, newStatus)`: Verifica alertas de status
- `getAlertSummary()`: Resumo de alertas

**Métodos de Relatórios:**
- `createReport(data)`: Cria relatório
- `getReportById(id)`: Busca relatório
- `getReports(options)`: Lista relatórios
- `deleteReport(id)`: Remove relatório
- `generatePortfolioReport()`: Gera relatório de carteira
- `generateDividendReport()`: Gera relatório de dividendos
- `generateStatusReport()`: Gera relatório de status

**Métodos de Consulta:**
- `getCarteiraResumo()`: Resumo da carteira
- `getByStatus(status)`: Busca por status

### 3. APIs Implementadas

#### POST /api/stock-monitoring
Cria novo monitoramento de ação.

**Request:**
```json
{
  "assetId": "string",
  "stockType": "ON" | "PN",
  "composition": number,
  "vpa": number,
  "precoAtual": number,
  "quantidadeAdquirida": number,
  "precoMedioCompra": number,
  // ... outros campos
}
```

#### GET /api/stock-monitoring
Lista todos os monitoramentos.

**Query Params:**
- `status`: Filtra por status (COMPRA, VENDA, NEUTRO, ATENCAO)

#### PUT /api/stock-monitoring/[id]
Atualiza monitoramento existente.

#### DELETE /api/stock-monitoring/[id]
Remove monitoramento.

### 4. Componentes Frontend

#### StockMonitoringForm
Formulário completo para criação/edição com seções:
- Dados do Ativo
- Dados de Dividendos
- Gatilhos de Compra
- Dados Financeiros
- Preço de Venda
- Observações

**Campos Adicionados para Inserção Manual:**
- Preço Atual
- Quantidade Adquirida
- Preço Médio de Compra

#### StockMonitoringTable
Tabela exibindo todas as ações monitoradas com:
- Colunas: Ação, Status, Preço Atual, Preço Teto, VPA, Quantidade, 
  Valor Investido, Resultado, Yield on Cost, Ações
- Filtro por status
- Formatação de moeda e porcentagem
- Cores baseadas no status

#### StockAlertsPanel
Painel de alertas mostrando:
- Resumo (total, não lidos, por severidade)
- Lista de alertas recentes
- Filtros por tipo e severidade
- Marcar como lido

#### StockReportsPanel
Painel de relatórios com:
- Resumo da carteira
- Distribuição por status
- Top performers
- Worst performers
- Diversificação

### 5. Integração com MT5

O sistema está preparado para sincronização com MT5 através dos métodos:
- `updatePrecoAtual(id, precoAtual)`: Atualiza preço em tempo real
- `updatePosicao(id, quantidade, precoMedio)`: Sincroniza posição aberta
- `checkPriceAlerts(stockId, currentPrice)`: Verifica gatilhos de preço
- `checkStatusAlerts(stockId, newStatus)`: Notifica mudanças de status

## Fluxo de Trabalho Completo

### 1. Criar Novo Monitoramento

1. Acessar a página principal
2. Clicar em "Nova Ação"
3. Preencher o formulário:
   - **ID do Ativo**: Código da ação
   - **Tipo**: ON ou PN
   - **Preço Atual**: (opcional) Cotação atual
   - **Quantidade Adquirida**: (opcional) Número de ações
   - **Preço Médio de Compra**: (opcional) Preço médio
   - **VPA**: Valor patrimonial
   - **Gatilhos**: ROE, VPA, LPA
   - **Preço Teto Reajustado**: Limite de venda
4. Salvar
5. Sistema calcula automaticamente:
   - Preço Teto (se VPA informado)
   - Yield on Cost (se dividendo e investimento informados)
   - Valor da carteira
   - Resultado
   - Status

### 2. Atualizar Preço

1. Na tabela, clicar no ícone de detalhes da ação
2. Atualizar o preço atual
3. Sistema recalcula automaticamente:
   - Valor da carteira
   - Resultado
   - Status
   - Verifica alertas de preço

### 3. Criar Mapa de Dividendos

1. Nos detalhes da ação
2. Adicionar valores mensais previstos
3. Sistema calcula:
   - Total anual
   - Atualiza previsão de dividendo no monitoramento
   - Recalcula yield on cost

### 4. Visualizar Relatórios

1. Acessar painel de relatórios
2. Gerar relatórios de:
   - **Carteira**: Composição, top performers, worst performers
   - **Dividendos**: Projeções, distribuição mensal
   - **Status**: Quantidade por status, alertas

### 5. Gerenciar Alertas

1. Criar alertas customizados
2. Sistema verifica automaticamente:
   - Alertas de preço quando preço atualiza
   - Alertas de status quando status muda
3. Receber notificações

## Próximos Passos Recomendados

### 1. Integração Real com MT5
- Implementar serviço que lê posições do MT5
- Atualizar automaticamente preço atual
- Sincronizar quantidade e preço médio

### 2. Coleta Automática de Dados
- Integrar com API de cotações (Alpha Vantage, Yahoo Finance)
- Atualizar VPA, LPA, ROE automaticamente
- Buscar dados fundamentais periódicamente

### 3. Automação de Alertas
- Implementar WebSocket para atualizações em tempo real
- Enviar notificações push ou e-mail
- Criar dashboard de alertas em tempo real

### 4. Importação/Exportação
- Permitir importar dados da planilha Excel
- Exportar relatórios em Excel/PDF
- Backup e restauração de dados

### 5. Analytics Avançados
- Gráficos de performance
- Correlação entre ações
- Backtesting de estratégias
- Indicadores técnicos adicionais

## Conclusão

A funcionalidade de monitoramento de ações da planilha foi completamente implementada na plataforma WR Trading Pro com:

✅ **Todos os campos da planilha** mapeados para o banco de dados
✅ **Cálculos automáticos** implementados no serviço
✅ **Sistema de alertas** funcionando
✅ **Relatórios** gerados dinamicamente
✅ **Interface** integrada na página principal
✅ **Tema ciber** aplicado consistentemente
✅ **Formulário** com campos de entrada manual (preço atual, quantidade, preço médio)

O sistema está pronto para uso e preparado para integrações futuras com MT5 e APIs de dados financeiros.
