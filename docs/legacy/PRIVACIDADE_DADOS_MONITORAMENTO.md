# Privacidade de Dados - Monitoramento de Ações

## 📋 Resumo

Este documento descreve as políticas de privacidade e segurança implementadas no módulo de monitoramento de ações da plataforma WR Trading Pro.

## 🔒 Políticas de Segurança

### Proteção de Dados Privados

Todos os dados de monitoramento de ações são considerados **privados e sensíveis**. A plataforma implementa as seguintes medidas de segurança:

1. **Ocultação automática**: Todos os dados são ocultados quando o MT5 não está conectado
2. **Aviso visual**: Mensagem clara informando que são dados privados
3. **Exigência de autenticação**: Dados só são exibidos com conexão autenticada ao MT5

## 🛡️ Comportamento de Proteção

### Quando o MT5 NÃO está conectado:

**PortfolioSummary:**
- Exibe mensagem: "Dados Privados"
- Mostra ícone de alerta
- Instruções para conexão
- **NENHUM dado financeiro é exibido**

**StockMonitoringTable:**
- Exibe mensagem: "Dados Privados"
- Mostra ícone de alerta
- Instruções para conexão
- **NENHUMA ação monitorada é listada**
- **NENHUM preço ou quantidade é mostrado**

### Quando o MT5 ESTÁ conectado:

**PortfolioSummary:**
- Total investido
- Valor atual da carteira
- Resultado total (ganho/perda)
- Dividendos recebidos e projetados
- Yield on Cost médio
- Meta mensal de dividendos

**StockMonitoringTable:**
- Lista completa de ações monitoradas
- Preços atuais (sincronizados com MT5)
- Status de compra/venda
- Resultado por ação
- Yield on Cost por ação

## 📊 Dados Protegidos

### Informações Financeiras:

- **Valor total investido**
- **Valor atual da carteira**
- **Resultado (lucro/prejuízo)**
- **Quantidade de ações**
- **Preços de compra**
- **Preços atuais**
- **Preço teto**
- **VPA (Valor Patrimonial por Ação)**
- **Yield on Cost**

### Informações de Ativos:

- **Símbolo da ação**
- **Nome da empresa**
- **Data de compra**
- **Data de pagamento de dividendos**
- **Valor de dividendos**

## 🔐 Recursos de Segurança

### 1. Verificação de Conexão

```typescript
// Exemplo de implementação
if (!mt5Connected) {
  return (
    <div className="data-locked">
      <AlertCircle />
      <p>Dados Privados</p>
      <p>Conecte-se ao MT5 para visualizar</p>
    </div>
  );
}
```

### 2. Carregamento Condicional

```typescript
// Só carrega dados se conectado
useEffect(() => {
  if (mt5Connected) {
    fetchSummary();
  }
}, [mt5Connected]);
```

### 3. Propagação do Estado de Conexão

- O estado `mt5Connected` é passado como prop para todos os componentes
- Componentes filhos verificam esse estado antes de renderizar dados
- Atualizações em tempo real quando a conexão muda

## ⚠️ Responsabilidades do Usuário

### O usuário DEVE:

1. **Manter suas credenciais MT5 seguras**
2. **Não compartilhar sua conta**
3. **Desconectar após o uso** (em ambientes compartilhados)
4. **Proteger seu dispositivo com senha/biometria**

### O usuário NÃO deve:

1. Deixar a plataforma aberta em dispositivos não seguros
2. Compartilhar prints de dados sensíveis
3. Acessar em redes Wi-Fi públicas sem VPN
4. Usar em computadores compartilhados sem logout

## 🔧 Recursos Disponíveis

### Botão Conectar/Desconectar

- **Localização**: Topo da página principal
- **Status visível**: Indica se está conectado ou desconectado
- **Ação rápida**: Permite conectar/desconectar com um clique

### Estado Visual

- **Verde**: Conectado ao MT5
- **Vermelho**: Desconectado do MT5
- **Amarelo**: Atenção/Erro de conexão

## 📱 Notificações de Segurança

### Alertas Implementados:

1. **Ao tentar acessar dados sem conexão:**
   - "⚠️ Você precisa estar conectado ao MT5 para visualizar estas informações."

2. **Ao tentar importar posições sem conexão:**
   - "⚠️ Você precisa estar conectado ao MT5 para importar posições."

3. **Ao tentar sincronizar preços sem conexão:**
   - "⚠️ Você precisa estar conectado ao MT5 para sincronizar preços."

## 🔒 Medidas Adicionais

### Em Desenvolvimento (Futuro):

1. **Autenticação de dois fatores (2FA)**
2. **Log de acesso e atividades**
3. **Alertas de atividade suspeita**
4. **Criptografia de dados em repouso**
5. **Timeout automático de sessão**
6. **Notificações de login em novo dispositivo**

## 📞 Suporte

Caso tenha alguma dúvida sobre segurança e privacidade:

- **Documentação**: Consulte os arquivos `.md` no repositório
- **Logs**: Verifique o console do navegador para detalhes técnicos
- **Configurações**: Revise suas configurações de conexão MT5

## 🔄 Atualizações Recentes

### Versão Atual (1.0.0)

- ✅ Implementada ocultação de dados sem conexão MT5
- ✅ Adicionados avisos visuais de privacidade
- ✅ Passagem do estado `mt5Connected` para componentes
- ✅ API de resumo da carteira
- ✅ Carregamento condicional de dados

### Próximas Melhorias Planejadas:

- 🔄 Timeout automático após período de inatividade
- 🔄 Histórico de visualizações de dados
- 🔄 Exportação criptografada de relatórios
- 🔄 Configurações personalizáveis de privacidade

## ⚖️ Conformidade

Esta implementação segue as melhores práticas de:

- **LGPD** (Lei Geral de Proteção de Dados - Brasil)
- **GDPR** (General Data Protection Regulation - Europa)
- **Princípios de Segurança da Informação** (ISO 27001)

## 📝 Notas Importais

1. **Dados persistentes**: Os dados são armazenados no banco de dados local
2. **Dados temporários**: Preços em tempo real são obtidos do MT5 e não são persistidos
3. **Sincronização**: A sincronização é manual ou automática conforme configuração
4. **Backup**: Recomenda-se fazer backup regular do banco de dados

---

**Última atualização**: 01/11/2026  
**Versão**: 1.0.0  
**Status**: ✅ Produção
