# 📊 Cálculos Atualizados - Monitoramento de Ações WR Trading Pro

## 📅 Data de Atualização
11/01/2026

## 🎯 Visão Geral

Este documento documenta todas as fórmulas e cálculos implementados no sistema de monitoramento de ações da plataforma WR Trading Pro, baseados na planilha `monitoramento.xlsx`.

---

## ✅ Fórmulas Implementadas e Verificadas

### 1. **Preço Teto**
**Fórmula:**
```
Preço Teto = DY Média 3 Anos / 0,08
```

**Descrição:**
- Calcula o preço máximo de compra baseado no Dividend Yield médio dos últimos 3 anos
- O divisor 0,08 representa um yield mínimo esperado de 8% ao ano
- Se DY Média 3 Anos não for informado, retorna 0

**Implementação:**
```typescript
calcularPrecoTeto(dyMedia3Anos: number): number {
  if (!dyMedia3Anos || dyMedia3Anos === 0) return 0;
  return dyMedia3Anos / 0.08;
}
```

**Status:** ✅ **IMPLEMENTADO E CORRETO**

---

### 2. **Preço Teto Reajustado**
**Fórmula:**
```
Se VPA >= Preço Teto:
  Preço Teto Reajustado = (VPA - Preço Teto) / 2
  
Se VPA < Preço Teto:
  Preço Teto Reajustado = 0
```

**Descrição:**
- Ajusta o preço de venda quando o VPA é maior que o preço teto
- Indica que a ação está sobrevalorizada em relação ao valor patrimonial
- A metade da diferença entre VPA e preço teto é adicionada como margem de segurança

**Implementação:**
```typescript
calcularPrecoTetoReajustado(vpa: number, precoTeto: number): number {
  if (!vpa || !precoTeto || precoTeto === 0) return 0;
  
  if (vpa >= precoTeto) {
    return (vpa - precoTeto) / 2;
  }
  
  return 0;
}
```

**Status:** ✅ **IMPLEMENTADO E CORRETO**

---

### 3. **Preço Médio de Compra**
**Fórmula:**
```
Preço Médio de Compra = Valor Investido / Quantidade de Ações
```

**Descrição:**
- Calcula o preço médio pago por ação
- Usado para calcular o custo base da posição
- O Valor Investido é inserido manualmente pelo usuário

**Implementação:**
```typescript
calcularPrecoMedioCompra(valorInvestido: number, quantidade: number): number {
  if (!quantidade || quantidade === 0) return 0;
  return valorInvestido / quantidade;
}
```

**Status:** ✅ **IMPLEMENTADO E CORRETO**

---

### 4. **Investimento Necessário para Meta**
**Fórmula:**
```
Investimento Necessário = (Meta Papeis - Quant. Adquirida) × Preço Teto
```

**Descrição:**
- Calcula quanto ainda precisa ser investido para atingir a meta de quantidade de papéis
- Se Meta < Quantidade, o resultado é negativo (indica excesso de posição)
- Se Meta = Quantidade, o resultado é 0 (meta atingida)

**Implementação:**
```typescript
calcularInvestimentoNecessarioParaMeta(
  metaPapeis: number, 
  quantidadeAdquirida: number, 
  precoTeto: number
): number {
  if (!metaPapeis || !quantidadeAdquirida || !precoTeto || precoTeto === 0) return 0;
  const diferenca = metaPapeis - quantidadeAdquirida;
  return diferenca * precoTeto;
}
```

**Status:** ✅ **IMPLEMENTADO E CORRETO**

---

### 5. **VPA - Valor Patrimonial por Ação**
**Fórmula:**
```
VPA = Patrimônio Líquido / Ações Emitidas
```

**Descrição:**
- Calcula o valor contábil de cada ação
- Indica quanto valeria a ação se a empresa fosse liquidada
- O Patrimônio Líquido e Ações Emitidas são inseridos manualmente

**Status:** ✅ **IMPLEMENTADO E CORRETO** (cálculo manual do usuário)

---

### 6. **Valor da Carteira**
**Fórmula:**
```
Valor Carteira = Preço Atual × Quantidade Adquirida
```

**Descrição:**
- Valor atual da posição no mercado
- Usado para calcular lucros/prejuízos e participações

**Implementação:**
```typescript
if (stock.precoAtual && stock.quantidadeAdquirida) {
  updates.valorCarteira = stock.precoAtual * stock.quantidadeAdquirida;
}
```

**Status:** ✅ **IMPLEMENTADO E CORRETO**

---

### 7. **Resultado (Lucro/Prejuízo)**
**Fórmula:**
```
Resultado = Valor Carteira - (Preço Médio × Quantidade)
```

**Descrição:**
- Calcula o lucro ou prejuízo não realizado da posição
- Positivo = lucro, Negativo = prejuízo

**Implementação:**
```typescript
if (stock.precoAtual && stock.quantidadeAdquirida && stock.precoMedioCompra) {
  const valorTotalAtual = stock.precoAtual * stock.quantidadeAdquirida;
  const valorTotalCompra = stock.precoMedioCompra * stock.quantidadeAdquirida;
  updates.resultado = valorTotalAtual - valorTotalCompra;
}
```

**Status:** ✅ **IMPLEMENTADO E CORRETO**

---

### 8. **Yield on Cost**
**Fórmula:**
```
Yield on Cost = (Dividendo Anual / Valor Investido) × 100
```

**Descrição:**
- Retorna o percentual de dividendos em relação ao custo de aquisição
- Indica o rendimento anual sobre o valor investido original

**Implementação:**
```typescript
calcularYieldOnCost(dividendoAnual: number, valorInvestido: number): number {
  if (!valorInvestido || valorInvestido === 0) return 0;
  return (dividendoAnual / valorInvestido) * 100;
}
```

**Status:** ✅ **IMPLEMENTADO E CORRETO**

---

### 9. **Participação na Carteira**
**Fórmula:**
```
Participação % = (Valor da Posição / Total da Carteira) × 100
```

**Descrição:**
- Mostra o peso percentual de cada ação na carteira total
- Usado para análise de diversificação

**Implementação:**
```typescript
calcularParticipacaoCarteira(
  valorPosicao: number, 
  valorCarteiraTotal: number
): number {
  if (!valorCarteiraTotal || valorCarteiraTotal === 0) return 0;
  return (valorPosicao / valorCarteiraTotal) * 100;
}
```

**Status:** ✅ **IMPLEMENTADO E CORRETO**

---

## 🔧 Campos Atualizados na Tabela

A tabela de monitoramento agora exibe:

1. ✅ **Preço Teto** - Calculado automaticamente
2. ✅ **Preço Teto Reajustado** - Calculado automaticamente (destacado em rosa)
3. ✅ **VPA** - Inserido manualmente
4. ✅ **P. Médio** - Calculado automaticamente
5. ✅ **Quantidade** - Inserido manualmente
6. ✅ **Valor Investido** - Inserido manualmente
7. ✅ **Investimento Necessário** - Calculado automaticamente
8. ✅ **Resultado** - Calculado automaticamente
9. ✅ **Yield on Cost** - Calculado automaticamente

---

## 📝 Campos Manuais vs Automáticos

### Campos Manuais (Inseridos pelo Usuário)
- Código da Ação
- Tipo de Ação (ON/PN)
- Composição
- Payout do Estatuto
- **DY Média 3 Anos** ⭐ (usado no cálculo do Preço Teto)
- Gatilhos (ROE, VPA, LPA)
- Meta de Papéis
- Patrimônio Líquido
- Lucro Líquido
- Ações Emitidas
- VPA
- P/VPA
- LPA
- Preço/Lucro
- ROE
- Previsão de Dividendo Anual
- **Valor Investido** ⭐ (usado no cálculo de Preço Médio)
- Quantidade Adquirida

### Campos Calculados (Automáticos)
- **Preço Teto** = DY Média 3 Anos / 0,08
- **Preço Teto Reajustado** = (VPA >= Preço Teto) ? (VPA - Preço Teto)/2 : 0
- **Preço Médio de Compra** = Valor Investido / Quantidade
- **Valor da Carteira** = Preço Atual × Quantidade
- **Resultado** = Valor Carteira - (Preço Médio × Quantidade)
- **Yield on Cost** = (Dividendo Anual / Valor Investido) × 100
- **Participação na Carteira** = (Valor Posição / Total Carteira) × 100
- **Investimento Necessário para Meta** = (Meta - Quantidade) × Preço Teto

---

## 🎨 Interface Visual

### Tabela Principal
- **Preço Teto Reajustado** é destacado em cor rosa para fácil visualização
- **Resultado** é verde (lucro) ou vermelho (prejuízo)
- **Yield on Cost** é destacado em roxo
- **Investimento Necessário** é destacado em ciano

### Status Automáticos
- **COMPRA** (verde) - Preço atual ≤ Preço Teto
- **VENDA** (vermelho) - Preço atual > Preço Teto Reajustado
- **ATENCAO** (amarelo) - Gatilhos acionados
- **NEUTRO** (cinza) - Nenhum critério atendido

---

## 🔗 Integração com MT5

O sistema de monitoramento:
1. ✅ NÃO envia ordens para o MT5 (apenas monitoramento)
2. ✅ Pode importar dados de posição do MT5
3. ✅ Atualiza preços automaticamente quando conectado
4. ✅ Sincroniza quantidade e preço médio se necessário

---

## 📊 Relatórios Disponíveis

### Relatório de Carteira
- Valor total investido
- Valor atual da carteira
- Lucro/prejuízo total
- Top performers
- Piores performers
- Diversificação por ação

### Relatório de Dividendos
- Total recebido
- Projeção anual
- Dividend Yield da carteira
- Yield on Cost
- Dividendos por mês

### Relatório de Status
- Total de ações por status
- Contagem de alertas por severidade
- Ações recomendadas para compra/venda

---

## ✅ Checklist de Implementação

- [x] Preço Teto (DY Média 3 Anos / 0,08)
- [x] Preço Teto Reajustado (condicional baseado em VPA)
- [x] Preço Médio de Compra (Valor Investido / Quantidade)
- [x] Investimento Necessário para Meta ((Meta - Quantidade) × Preço Teto)
- [x] Valor da Carteira (Preço Atual × Quantidade)
- [x] Resultado (Valor Carteira - Custo Total)
- [x] Yield on Cost (Dividendos / Valor Investido)
- [x] Participação na Carteira (Valor Posição / Total)
- [x] VPA (Patrimônio Líquido / Ações Emitidas - manual)
- [x] Atualização automática de cálculos
- [x] Atualização automática de status
- [x] Exibição completa na tabela
- [x] Fórmulas no banco de dados (Prisma)
- [x] Tipos TypeScript atualizados

---

## 🚀 Próximas Melhorias Sugeridas

1. **Importação em massa** - Upload de Excel para criar múltiplos monitoramentos
2. **Alertas avançados** - Notificações baseadas em mudanças de status
3. **Histórico de preços** - Gráficos de evolução de VPA, Preço Teto, etc.
4. **Análise comparativa** - Comparar diferentes ações lado a lado
5. **Backtest de estratégias** - Simular resultados baseados em regras de compra/venda

---

## 📞 Suporte

Para dúvidas ou problemas:
1. Verifique os logs no painel de administração
2. Confira se o MT5 está conectado para atualizações de preço
3. Valide os campos manuais inseridos (DY Média 3 Anos, VPA, etc.)
4. Verifique a documentação em `MONITORAMENTO_ACOES_ANALISE.md`

---

## 📝 Notas Importantes

1. **Valor Investido Manual**: O Valor Investido deve ser inserido manualmente pelo usuário, não é calculado automaticamente.

2. **DY Média 3 Anos**: Campo essencial para o cálculo do Preço Teto. Sem este valor, o Preço Teto será 0.

3. **Atualização Automática**: Todos os cálculos são atualizados automaticamente quando:
   - Um monitoramento é criado ou atualizado
   - O preço atual muda
   - A posição (quantidade/preço médio) é sincronizada do MT5

4. **Precisão**: Todos os valores são armazenados com precisão de 2 casas decimais para valores monetários.

---

**Última Atualização:** 11/01/2026
**Versão:** 1.0.0
**Plataforma:** WR Trading Pro
