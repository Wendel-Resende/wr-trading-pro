# Guia de Solução de Problemas - Conexão MT5

## Problema Identificado e Corrigido

### Problema Principal
O componente `MT5Connection.tsx` estava tentando conectar automaticamente ao MT5 quando a página carregava, mas **sem passar as credenciais corretamente** para o serviço MT5.

### Correção Aplicada
Removida a conexão automática no carregamento da página. Agora o usuário deve clicar no botão **"Conectar"** manualmente, garantindo que as credenciais sejam passadas corretamente.

## Passos para Testar a Conexão

### 1. Verificar se o MT5 Bridge está rodando

```bash
# Verificar se o processo está rodando
netstat -ano | findstr :8766
```

Se não estiver rodando, inicie:
```bash
python mt5_bridge.py
```

### 2. Verificar o Console do Navegador

Abra o DevTools (F12) e vá na aba Console. Você deve ver:
```
Valores de conexão: {login: "MT5_LOGIN_EXAMPLE", password: "***", server: "MT5_SERVER_EXAMPLE"}
Tentando conectar ao MT5: {login: MT5_LOGIN_EXAMPLE, server: "MT5_SERVER_EXAMPLE"}
```

### 3. Verificar o Terminal do Python

No terminal onde o `mt5_bridge.py` está rodando, você deve ver:
```
Dados de login recebidos:
  Login: MT5_LOGIN_EXAMPLE (tipo: int)
  Password: ***
  Server: MT5_SERVER_EXAMPLE
Inicializando MT5...
Tentando fazer login: login=MT5_LOGIN_EXAMPLE, server=MT5_SERVER_EXAMPLE
```

## Possíveis Causas de Erro de Autenticação

### Erro: `(-6, 'Terminal: Authorization failed')`

Este erro indica que o MT5 não conseguiu autenticar com as credenciais fornecidas.

#### Causas Possíveis:

1. **Credenciais Incorretas**
   - Verifique se o login, senha e servidor estão corretos
   - Teste fazendo login manualmente no MT5

2. **MetaTrader 5 Não Está Aberto**
   - O MT5 deve estar instalado e rodando
   - Abra o MetaTrader 5 e faça login manualmente primeiro

3. **Servidor Incorreto**
   - O nome do servidor deve ser exatamente o mesmo que aparece no MT5
   - Verifique no MT5: File → Login → e copie o nome exato do servidor

4. **Conta Expirada ou Desativada**
   - Contas de teste podem expirar
   - Entre em contato com o broker para verificar o status da conta

5. **Conexão de Rede**
   - Verifique se você tem conexão com a internet
   - Verifique se o firewall não está bloqueando o MT5

## Como Diagnosticar

### 1. Teste Manual no MT5

1. Abra o MetaTrader 5
2. Clique em File → Login
3. Insira as credenciais:
   - Login: MT5_LOGIN_EXAMPLE
   - Password: MT5_PASSWORD_EXAMPLE
   - Server: MT5_SERVER_EXAMPLE
4. Se funcionar manualmente, as credenciais estão corretas

### 2. Verificar Logs Detalhados

No terminal Python, os logs agora mostram:
- Tipo de dado do login (deve ser `int`)
- Se a senha foi fornecida
- Servidor configurado
- Passo a passo do processo de conexão

### 3. Verificar Erros Específicos

**Se ver:**
- `Credenciais incompletas` → Os campos estão vazios
- `Login inválido` → O login não é um número válido
- `Falha ao inicializar MT5` → MT5 não está instalado
- `Falha no login` → Credenciais incorretas ou MT5 não está aberto

## Soluções

### Solução 1: Verificar Credenciais no MT5

1. Abra o MT5
2. Faça login manualmente
3. Verifique o nome exato do servidor em "Accounts"
4. Use exatamente os mesmos dados no dashboard

### Solução 2: Limpar e Reconfigurar

1. No dashboard, clique em "Config"
2. Clique em "Limpar"
3. Preencha novamente:
   - Login: MT5_LOGIN_EXAMPLE
   - Password: MT5_PASSWORD_EXAMPLE
   - Server: MT5_SERVER_EXAMPLE
4. Clique em "Salvar e Conectar"

### Solução 3: Reiniciar Serviços

```bash
# Parar o bridge (Ctrl+C no terminal)

# Reiniciar
python mt5_bridge.py
```

Depois recarregue a página do dashboard e tente conectar novamente.

### Solução 4: Verificar Instalação do MT5

```bash
# Verificar se MetaTrader5 está instalado
python -c "import MetaTrader5 as mt5; print(mt5.initialize())"
```

Se retornar `False`, o MT5 não está instalado corretamente.

## Resumo das Alterações

### Arquivo: `src/components/MT5Connection.tsx`
- **Removido**: Conexão automática ao carregar a página
- **Adicionado**: Comentário explicando que o usuário deve conectar manualmente
- **Resultado**: Credenciais são passadas corretamente quando o usuário clica em "Conectar"

### Arquivo: `mt5_bridge.py`
- **Melhorado**: Logging detalhado dos dados recebidos
- **Adicionado**: Validação de credenciais antes de tentar conectar
- **Melhorado**: Mensagens de erro mais informativas

## Próximos Passos

1. Certifique-se de que o MetaTrader 5 está aberto e você consegue fazer login manualmente
2. Inicie o bridge Python: `python mt5_bridge.py`
3. Abra o dashboard no navegador
4. Clique em "Config" e verifique as credenciais
5. Clique em "Conectar"
6. Monitore os logs no console do navegador e no terminal Python

## Contato

Se o problema persistir após seguir estes passos:
1. Verifique os logs detalhados no terminal Python
2. Verifique o console do navegador (F12)
3. Verifique se o MT5 funciona manualmente
4. Verifique se o firewall não está bloqueando a conexão

