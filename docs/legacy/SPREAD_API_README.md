# Sistema de Análise de Spread - API Python

## Visão Geral

Este sistema analisa oportunidades de arbitragem entre pares de ações da B3 usando uma API Python em Flask com integração ao MetaTrader 5.

## Arquitetura

### Componentes

1. **API Python** (`spread_api.py`)
   - Servidor Flask na porta 5000
   - Integração com MetaTrader 5
   - Análise de spread entre pares de ativos
   - Busca de melhores oportunidades

2. **Serviço TypeScript** (`src/services/spreadService.ts`)
   - Comunicação com a API Python
   - Formatação de dados
   - Cálculo de métricas

3. **Componentes React**
   - `SpreadAnalysis.tsx`: Análise detalhada de um par específico
   - `SpreadPairsFinder.tsx`: Busca dos melhores pares

## Instalação

### 1. Instalar Dependências Python

```bash
pip install -r spread_requirements.txt
```

### 2. Iniciar a API Python

```bash
python spread_api.py
```

A API iniciará em `http://localhost:5000`

### 3. Iniciar o Frontend

```bash
npm run dev
```

## API Endpoints

### GET `/api/spread/health`

Verifica se a API está funcionando.

**Resposta:**
```json
{
  "status": "ok",
  "mt5_initialized": true
}
```

### POST `/api/spread/analyze`

Calcula spread entre dois ativos.

**Request:**
```json
{
  "symbol1": "PETR4",
  "symbol2": "PETR3",
  "data_inicial": "2025-01-01",
  "data_final": "2025-12-31",
  "ganho_minimo": 0.10
}
```

**Resposta:**
```json
{
  "success": true,
  "data": {
    "hist1": [...],
    "hist2": [...],
    "spread": [...],
    "oportunidades": [...],
    "current_price1": 30.50,
    "current_price2": 31.50,
    "oportunidades_por_mes": {
      "2025-01": 5,
      "2025-02": 3
    }
  }
}
```

### POST `/api/spread/find-best-pairs`

Busca os melhores pares para arbitragem.

**Request:**
```json
{
  "data_inicial": "2025-01-01",
  "data_final": "2025-12-31",
  "ganho_minimo": 0.10
}
```

**Resposta:**
```json
{
  "success": true,
  "data": [
    {
      "par": "PETR4-PETR3",
      "oportunidades": 25,
      "maior_ganho": 1.50,
      "melhor_retorno": 5.0,
      "spread_atual": 1.00,
      "current_price1": 30.50,
      "current_price2": 31.50,
      "symbol1": "PETR4",
      "symbol2": "PETR3"
    }
  ]
}
```

## Uso no Frontend

### Análise de Um Par Específico

```tsx
import { spreadService } from '@/services/spreadService';

// Calcular spread
const result = await spreadService.calcularSpread({
  symbol1: "PETR4",
  symbol2: "PETR3",
  startDate: new Date('2025-01-01'),
  endDate: new Date('2025-12-31'),
  ganhoMinimo: 0.10
});

if (result) {
  console.log('Oportunidades:', result.oportunidades);
  console.log('Por mês:', result.oportunidadesPorMes);
  
  const metrics = spreadService.calcularMetrics(result);
  console.log('Ganho médio:', metrics.ganhoMedio);
  console.log('Retorno médio:', metrics.retornoMedio);
}
```

### Buscar Melhores Pares

```tsx
// Buscar todos os pares analisados
const allPairs = await spreadService.obterTodosPares(
  startDate,
  endDate,
  0.10
);

console.log('Total analisado:', allPairs.length);
console.log('Com oportunidades:', allPairs.filter(p => p.oportunidades > 0).length);

// Criar ranking dos melhores
const ranking = await spreadService.criarRanking(
  startDate,
  endDate,
  0.10
);

console.log('Top 5 - Maior Ganho:', ranking.rankingGanho);
console.log('Top 5 - Melhor Retorno:', ranking.rankingRetorno);
console.log('Top 5 - Mais Oportunidades:', ranking.rankingOportunidades);
```

## Estratégia de Arbitragem

### Conceito

A estratégia de spread consiste em:

1. **Identificar pares de ações** com alta correlação e diferença de preços:
   - Ações da mesma empresa (ON/PN)
   - Empresas do mesmo setor
   - Empresas com modelos de negócio similares

2. **Vender a ação mais cara** e comprar a mais barata

3. **Aguardar a convergência** dos preços

4. **Reverter as operações**: vender a ação comprada e recomprar a ação vendida

5. **Lucrar com a diferença** das operações

### Exemplo Prático

```
Par: PETR4 (ON) - PETR3 (PN)
Preço PETR4: R$ 30,50
Preço PETR3: R$ 31,50
Spread: R$ 1,00

Estratégia:
1. Vender PETR3 a R$ 31,50
2. Comprar PETR4 a R$ 30,50
3. Aguardar convergência
4. Vender PETR4 a R$ 31,20
5. Recomprar PETR3 a R$ 31,20

Resultado:
Venda PETR3: +R$ 31,50
Compra PETR3: -R$ 31,20
Venda PETR4: +R$ 31,20
Compra PETR4: -R$ 30,50
Lucro Total: R$ 1,00
```

## Novidades

### ✅ Oportunidades por Mês

Agora é possível visualizar a distribuição das oportunidades por mês, permitindo:
- Identificar períodos de maior atividade
- Entender sazonalidade nos spreads
- Planejar melhor as operações

### ✅ Lista Completa de Pares

O componente `SpreadPairsFinder` agora mostra TODOS os pares analisados, incluindo:
- Pares com oportunidades (destacados em verde)
- Pares sem oportunidades (mostrados em cinza)
- Métricas detalhadas para cada par

### ✅ Informações Adicionais

Cada par na lista completa mostra:
- Preço atual dos dois ativos
- Spread atual
- Número de oportunidades
- Maior ganho e melhor retorno
- Status (com/sem oportunidade)

## Pares Sugeridos

O sistema inclui uma lista de 50+ pares sugeridos para análise:

- **Mesma empresa (ON/PN):** PETR4/PETR3, ITUB4/ITUB3, etc.
- **Mesmo setor:** PETR4/VALE3, ITUB4/BBDC4, etc.
- **Setor varejo:** LREN3/MGLU3, PETZ3/MGLU3, etc.
- **Setor commodities:** CSNA3/VALE3, USIM5/USIM3, etc.

## Requisitos

- MetaTrader 5 instalado e conectado
- Python 3.8+ com as dependências instaladas
- Node.js 18+ com Next.js
- Acesso à B3 via MT5

## Troubleshooting

### Erro: "API não está funcionando"

**Solução:**
1. Verifique se a API Python está rodando (`python spread_api.py`)
2. Confirme que o MT5 está conectado na página principal do Dashboard
3. Verifique se não há conflito na porta 5000

### Erro: "Nenhum dado encontrado"

**Solução:**
1. Verifique se os ativos existem na B3
2. Confirme se há dados no período selecionado
3. Aumente o período de análise
4. Reduza o ganho mínimo

### Erro: "MT5 não inicializado"

**Solução:**
1. Vá para a página principal do Dashboard
2. Clique no botão "Conectar" no topo
3. Aguarde a confirmação de conexão
4. Volte para a página de spread

## Próximos Passos

- [ ] Adicionar filtros avançados (por setor, por tipo de ação)
- [ ] Criar alertas em tempo real para novas oportunidades
- [ ] Implementar backtesting de estratégias
- [ ] Adicionar gráficos de spread histórico
- [ ] Exportar relatórios em PDF/Excel