# 💰 Implementação do Campo "Valor Investido"

## 📅 Data: 12/01/2026

## 🎯 Objetivo

Adicionar o campo "Valor Investido" no formulário de monitoramento para que o usuário possa preencher manualmente o quanto gastou na compra de cada ação. O "Total Investido" deve ser a soma desses valores.

## ✅ Implementação Realizada

### 1. Campo "Valor Investido" na Tabela

**Arquivo:** `src/components/StockMonitoringTable.tsx`

A coluna "Valor Investido" já estava sendo exibida na tabela (linha 104):

```typescript
<th className="px-6 py-3 text-right text-xs font-bold font-orbitron text-cyber-cyan uppercase tracking-wider">
  Valor Investido
</th>

// ...

<td className="px-6 py-4 whitespace-nowrap text-right text-sm text-white font-jetbrains">
  {formatCurrency(stock.valorInvestido)}
</td>
```

### 2. Campo "Valor Investido" no Formulário

**Arquivo:** `src/components/StockMonitoringForm.tsx`

**Alterações Realizadas:**

#### a) Adicionado ao estado inicial (linha 33):
```typescript
const [formData, setFormData] = useState<StockMonitoringInput>({
  // ... outros campos
  quantidadeAdquirida: stock?.quantidadeAdquirida || 0,
  valorInvestido: stock?.valorInvestido || undefined,  // ✅ ADICIONADO
  precoMedioCompra: stock?.precoMedioCompra || undefined,
  // ...
});
```

#### b) Campo no formulário (linha 251):
```typescript
<div>
  <label className="block text-sm font-bold font-orbitron text-cyber-cyan mb-1">
    Valor Investido *
  </label>
  <input
    type="number"
    name="valorInvestido"
    value={formData.valorInvestido || ''}
    onChange={handleChange}
    step="0.01"
    placeholder="0.00"
    className="w-full bg-cyber-dark/50 border border-cyber-border rounded-lg px-4 py-2 text-white font-space focus:border-cyber-cyan focus:outline-none focus:ring-1 focus:ring-cyber-cyan transition-colors"
    required  // ✅ Campo obrigatório
  />
</div>
```

### 3. Cálculo do "Total Investido"

**Arquivo:** `src/services/stockMonitoringService.ts`

**Método:** `getCarteiraResumo()` (linha 614)

O "Total Investido" já estava sendo calculado corretamente como a soma dos valores investidos de cada ação:

```typescript
async getCarteiraResumo() {
  const stocks = await prisma.stockMonitoring.findMany({
    include: {
      asset: true,
    },
  });

  const totalInvestido = stocks.reduce((sum, s) => sum + (s.valorInvestido || 0), 0);
  // ...
  
  return {
    totalAcoes: stocks.length,
    totalInvestido,  // ✅ Soma de todos os valorInvestido
    valorAtual,
    resultadoTotal,
    dividendosAnuais,
    yieldCarteira: totalInvestido > 0 ? (dividendosAnuais / totalInvestido) * 100 : 0,
  };
}
```

### 4. Exibição do "Total Investido" no Resumo

**Arquivo:** `src/components/PortfolioSummary.tsx`

O "Total Investido" já estava sendo exibido corretamente (linha 70):

```typescript
<div className="cyber-card bg-cyber-dark/50 border border-cyber-border rounded-lg p-4 hud-corner">
  <h3 className="text-xs font-bold font-orbitron text-cyber-cyan uppercase tracking-wider mb-2">
    Total Investido
  </h3>
  <p className="text-2xl font-bold font-orbitron text-white neon-text-cyan">
    {formatCurrency(summary.totalInvestido)}
  </p>
</div>
```

## 📊 Como Funciona

### Fluxo de Dados:

1. **Usuário preenche o formulário:**
   - Campo "Valor Investido" (obrigatório) - quanto o usuário gastou para comprar as ações
   - Campo "Quantidade Adquirida" (opcional) - quantidade de ações que o usuário tem
   - Campo "Preço Médio de Compra" (calculado automaticamente) - Valor Investido / Quantidade

2. **Cálculo automático do Preço Médio:**
   ```typescript
   // stockMonitoringService.ts - linha 68
   calcularPrecoMedioCompra(valorInvestido: number, quantidade: number): number {
     if (!quantidade || quantidade === 0) return 0;
     return valorInvestido / quantidade;  // ✅ Calcula automaticamente
   }
   ```

3. **Cálculo do Total Investido da Carteira:**
   ```typescript
   // stockMonitoringService.ts - linha 614
   const totalInvestido = stocks.reduce((sum, s) => sum + (s.valorInvestido || 0), 0);
   ```
   
   **Exemplo:**
   - VALE3: R$ 5.000,00
   - PETR4: R$ 3.000,00
   - ITUB4: R$ 2.000,00
   - **Total Investido = R$ 10.000,00** ✅

## 🎯 Exemplo Prático

### Cenário: Usuário compra ações VALE3

**Dados no Formulário:**
```
Código: VALE3
Tipo: ON
Valor Investido: R$ 5.000,00 ← Usuário preenche
Quantidade Adquirida: 100 ← Usuário preenche
```

**Cálculo Automático (Backend):**
```
Preço Médio de Compra = 5.000,00 / 100 = R$ 50,00 ✅
```

**Outras Ações na Carteira:**
```
VALE3: R$ 5.000,00
PETR4: R$ 3.000,00
ITUB4: R$ 2.000,00
BBAS3: R$ 4.000,00
```

**Total Investido:**
```
Total = 5.000 + 3.000 + 2.000 + 4.000 = R$ 14.000,00 ✅
```

**Exibição no PortfolioSummary:**
```
Total Investido: R$ 14.000,00
```

## 🔄 Atualização de Valores

Quando o usuário atualiza o "Valor Investido":

1. **Frontend envia dados:** `PUT /api/stock-monitoring/:id`
2. **Backend atualiza:** `prisma.stockMonitoring.update()`
3. **Recalcula métricas:**
   - Preço Médio de Compra = Valor Investido / Quantidade
   - Yield on Cost = Dividendo Anual / Valor Investido
   - Resultado = (Preço Atual × Quantidade) - Valor Investido
4. **Atualiza resumo:** Recalcula o Total Investido somando todos os valores

## 📝 Diferença Entre Campos

| Campo | Origem | Cálculo/Entrada |
|-------|--------|-----------------|
| **Valor Investido** | Usuário preenche | Entrada manual do usuário |
| **Preço Médio de Compra** | Calculado automaticamente | Valor Investido / Quantidade |
| **Total Investido** | Calculado automaticamente | Soma de todos os Valor Investido |

## ✅ Validação

### Teste Rápido:

1. **Criar 3 monitoramentos:**
   - VALE3: Valor Investido = R$ 5.000,00
   - PETR4: Valor Investido = R$ 3.000,00
   - ITUB4: Valor Investido = R$ 2.000,00

2. **Verificar na tabela:**
   - VALE3 deve mostrar R$ 5.000,00
   - PETR4 deve mostrar R$ 3.000,00
   - ITUB4 deve mostrar R$ 2.000,00

3. **Verificar no PortfolioSummary:**
   - Total Investido deve ser **R$ 10.000,00** ✅

4. **Verificar cálculo do Preço Médio:**
   - Se VALE3 tem 100 ações e R$ 5.000,00 investidos
   - Preço Médio deve ser **R$ 50,00** ✅

## 🎨 Interface Visual

### Formulário:
- **Campo "Valor Investido"** está na seção "Dados Financeiros"
- É um campo **obrigatório** (marcado com *)
- Formato monetário com 2 casas decimais
- Placeholder: "0.00"

### Tabela:
- Coluna "Valor Investido" está exibida
- Formato monetário (R$ 0.000,00)
- Alinhado à direita

### PortfolioSummary:
- Card "Total Investido" exibe a soma
- Destaque visual com cor ciano neon
- Formato monetário (R$ 0.000,00)

## 📚 Documentação Relacionada

- `CORRECAO_PRECO_TETO_REAJUSTADO_FINAL.md` - Correção do Preço Teto Reajustado
- `INDICADORES_FUNDAMENTALISTAS.md` - Indicadores Fundamentalistas
- `CALCULOS_MONITORAMENTO_ATUALIZADOS.md` - Cálculos do Monitoramento
- `STOCK_MONITORING_FINALIZACAO.md` - Finalização do Sistema de Monitoramento

## 🎉 Conclusão

✅ **Campo "Valor Investido" foi adicionado ao formulário** - Usuário pode preencher manualmente
✅ **Cálculo do Preço Médio é automático** - Usa Valor Investido / Quantidade
✅ **Total Investido já estava calculando corretamente** - Soma de todos os Valor Investido
✅ **Tudo integrado e funcionando** - Fluxo completo do formulário ao resumo da carteira

O sistema agora permite que o usuário:
1. Informe quanto gastou em cada ação (Valor Investido)
2. Veja o cálculo automático do preço médio
3. Acompanhe o total investido na carteira (soma de todos os valores)

---

**Última Atualização:** 12/01/2026  
**Arquivos Modificados:** `src/components/StockMonitoringForm.tsx`  
**Status:** ✅ Implementado e Testado
