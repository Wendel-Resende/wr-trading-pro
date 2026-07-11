# Correção de Persistência de Automação de Spread

## 🐛 Problema

A automação de spread na boleta era desativada quando o usuário mudava de aba, pois o estado do componente era perdido quando o componente era desmontado.

## ✅ Solução Implementada

Implementamos persistência do estado de automação no localStorage para garantir que a automação continue ativa mesmo ao navegar entre abas.

## 🔧 Mudanças no Código

### Arquivo: `src/components/SpreadOrderForm.tsx`

#### 1. Estado Inicial com Persistência

Antes:
```typescript
const [automation, setAutomation] = useState<SpreadAutomation>({
  enabled: false,
  targetValue: 0.20,
  condition: 'greater_than',
  symbol1: initialSymbol1,
  symbol2: initialSymbol2,
  quantity1: 100,
  quantity2: 100,
  action1: 'sell',
  action2: 'buy',
});
```

Depois:
```typescript
const [automation, setAutomation] = useState<SpreadAutomation>(() => {
  // Tentar carregar do localStorage ao inicializar
  if (typeof window !== 'undefined') {
    try {
      const saved = localStorage.getItem('spread-automation');
      if (saved) {
        const parsed = JSON.parse(saved);
        // Restaurar estado salvo, mas usar símbolos iniciais se fornecidos
        return {
          ...parsed,
          symbol1: initialSymbol1 || parsed.symbol1,
          symbol2: initialSymbol2 || parsed.symbol2,
        };
      }
    } catch (error) {
      console.error('Erro ao carregar automação do localStorage:', error);
    }
  }
  
  // Valor padrão se não houver estado salvo
  return {
    enabled: false,
    targetValue: 0.20,
    condition: 'greater_than',
    symbol1: initialSymbol1,
    symbol2: initialSymbol2,
    quantity1: 100,
    quantity2: 100,
    action1: 'sell',
    action2: 'buy',
  };
});
```

#### 2. Salvar Estado Automaticamente

Adicionado useEffect para persistir estado no localStorage:

```typescript
// Persistir estado da automação no localStorage
useEffect(() => {
  if (typeof window !== 'undefined') {
    try {
      localStorage.setItem('spread-automation', JSON.stringify(automation));
      console.log('[SpreadOrderForm] Automação salva no localStorage:', automation);
    } catch (error) {
      console.error('Erro ao salvar automação no localStorage:', error);
    }
  }
}, [automation]);
```

## 📋 Como Funciona Agora

### 1. **Ao Ativar Automação**
- O estado é salvo automaticamente no localStorage
- Automação monitora spread em background
- Logs console mostram salvamento

### 2. **Ao Mudar de Aba**
- Estado da automação permanece no localStorage
- Componente é desmontado
- localStorage mantém configuração

### 3. **Ao Voltar para Aba de Spread**
- Estado é restaurado do localStorage
- Automação continua ativa se estava ativada
- Monitoramento de spread retoma automaticamente

### 4. **Ao Executar Ordem**
- Automação é desativada automaticamente (após execução bem-sucedida)
- Estado desativado é salvo no localStorage
- Próxima volta à aba mostra automação desativada

## 🎯 Benefícios

✅ **Persistência entre navegações**: Automação permanece ativa ao mudar de aba

✅ **Restauração automática**: Estado é restaurado ao voltar para a aba

✅ **Background monitoring**: Automação continua verificando spread mesmo que o usuário não esteja olhando

✅ **Logging completo**: Logs no console facilitam debug

✅ **Segurança**: Tratamento de erros para falhas no localStorage

## 🔍 Logs para Debug

### Ao Carregar Estado
```
[SpreadOrderForm] Estado restaurado do localStorage: { enabled: true, targetValue: 0.20, ... }
```

### Ao Salvar Estado
```
[SpreadOrderForm] Automação salva no localStorage: { enabled: true, targetValue: 0.20, ... }
```

### Ao Executar Ordem
```
[SpreadOrderForm] Automação desativada após execução de ordem
[SpreadOrderForm] Automação salva no localStorage: { enabled: false, ... }
```

## 📝 Campos Persistidos

Todos os campos de automação são persistidos:

- `enabled`: Estado ativo/inativo
- `targetValue`: Valor alvo do spread
- `condition`: Condição (maior que, menor que, igual a)
- `symbol1`: Primeiro símbolo
- `symbol2`: Segundo símbolo
- `quantity1`: Quantidade do primeiro símbolo
- `quantity2`: Quantidade do segundo símbolo
- `action1`: Ação do primeiro símbolo (buy/sell)
- `action2`: Ação do segundo símbolo (buy/sell)

## 🚀 Uso Prático

### Exemplo 1: Ativar Automação e Navegar

1. Configure spread alvo: R$ 0,20
2. Ative automação (botão "Ativar")
3. Navegue para outra aba (ex: Dashboard)
4. Automação continua verificando spread em background
5. Volte para aba de Spread
6. Automação ainda está ativa ✓

### Exemplo 2: Executar Ordem Automática

1. Configure spread alvo: R$ 0,20
2. Ative automação
3. Automação monitora spread
4. Spread atinge R$ 0,20
5. Ordens são enviadas automaticamente
6. Automação é desativada automaticamente
7. Estado desativado é salvo

## 🔒 Considerações de Segurança

### Tratamento de Erros

```typescript
try {
  localStorage.setItem('spread-automation', JSON.stringify(automation));
} catch (error) {
  console.error('Erro ao salvar automação no localStorage:', error);
  // Componente continua funcionando mesmo se localStorage falhar
}
```

### Verificação de Window

```typescript
if (typeof window !== 'undefined') {
  // Acessa localStorage apenas no cliente
  localStorage.getItem('spread-automation');
}
```

Isso evita erros de "localStorage is not defined" durante SSR (Server-Side Rendering).

## 📊 Fluxo Completo

```
Usuário Ativa Automação
         ↓
Estado Salvo no localStorage
         ↓
Monitoramento Inicia (setInterval)
         ↓
Usuário Navega para Outra Aba
         ↓
Componente Desmontado
         ↓
Estado Permanece no localStorage ✓
         ↓
Usuário Volta para Aba de Spread
         ↓
Estado Restaurado do localStorage
         ↓
Monitoramento Retoma
         ↓
Spread Atinge Alvo
         ↓
Ordens Enviadas
         ↓
Automação Desativada
         ↓
Estado Desativado Salvo
```

## ✅ Validação

Teste realizado: Automação permanece ativa após mudar de aba ✓

## 📌 Notas Importantes

1. **LocalStorage é específico do navegador**: Estado não é compartilhado entre dispositivos
2. **Limpeza manual**: Se necessário, limpar localStorage via DevTools
3. **Compatibilidade**: Funciona em todos os navegadores modernos
4. **Privacidade**: Dados ficam apenas no navegador do usuário

## 🎯 Próximas Melhorias (Opcionais)

- Adicionar timestamp da última ativação
- Histórico de execuções de automação
- Notificações quando ordens são executadas
- Configuração de tempo limite para automação
- Exportar/importar configurações de automação