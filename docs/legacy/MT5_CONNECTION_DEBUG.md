# Guia de Diagnóstico - Problema de Conexão MT5

## Problema
Ao tentar conectar ao MT5 através da interface, a conexão falha como se a senha estivesse errada, mas os testes diretos funcionam.

## Passo a Passo para Diagnóstico

### 1. Verificar se o MT5 Bridge está rodando

Execute em um terminal:
```bash
python mt5_bridge.py
```

Você deve ver:
```
[INFO] Inicializando MT5 Bridge...
[INFO] Servidor WebSocket iniciado com sucesso na porta 8766
```

Se não estiver rodando, inicie o bridge.

### 2. Testar conexão direta com MT5

Execute em outro terminal:
```bash
python test_mt5_connection.py
```

Você deve ver:
```
[INFO] Conectando ao MT5...
[INFO] Login MT5 bem-sucedido: MT5_LOGIN_EXAMPLE
[INFO] Conta: MT5_LOGIN_EXAMPLE
[INFO] Saldo: XXXX.XX
[INFO] Lucro: XXXX.XX
```

Se isso funcionar, suas credenciais estão corretas.

### 3. Testar conexão via Bridge

Execute em outro terminal:
```bash
python test_mt5_bridge.py
```

Você deve ver:
```
[INFO] Conectando ao MT5 Bridge...
[INFO] Conectado ao MT5 Bridge
[INFO] Enviando mensagem de login...
[INFO] Login bem-sucedido!
[INFO] Posição: 0
```

Se isso funcionar, o bridge está funcionando corretamente.

### 4. Verificar logs do navegador

1. Abra o navegador e vá para http://localhost:3000
2. Pressione F12 para abrir as ferramentas de desenvolvedor
3. Vá para a aba "Console"
4. Insira as credenciais no formulário MT5
5. Clique em "Conectar"
6. Observe os logs no console

Você deve ver algo como:
```
Valores de conexão: {login: "MT5_LOGIN_EXAMPLE", password: "***", server: "MT5_SERVER_EXAMPLE"}
Login convertido para número: MT5_LOGIN_EXAMPLE
Tentando conectar ao MT5: {login: MT5_LOGIN_EXAMPLE, server: "MT5_SERVER_EXAMPLE"}
```

Se você não ver esses logs, há um problema no componente React.

### 5. Verificar logs do Bridge

Enquanto você tenta conectar pela UI, observe o terminal onde o bridge está rodando.

Você deve ver:
```
Recebido: LOGIN
Login MT5 bem-sucedido: MT5_LOGIN_EXAMPLE
```

Se você não ver "Login MT5 bem-sucedido", então o login falhou.

### 6. Verificar localStorage

No console do navegador, execute:
```javascript
localStorage.getItem('mt5-config')
```

Deve retornar algo como:
```json
{"login":"MT5_LOGIN_EXAMPLE","password":"MT5_PASSWORD_EXAMPLE","server":"MT5_SERVER_EXAMPLE"}
```

### 7. Limpar localStorage e tentar novamente

No console do navegador, execute:
```javascript
localStorage.removeItem('mt5-config')
```

Recarregue a página (F5) e tente conectar novamente.

## Possíveis Causas e Soluções

### Causa 1: Login sendo enviado como string

**Sintoma:** O bridge recebe o login como string em vez de número.

**Solução:** O código já foi corrigido para converter o login para número. Verifique se você está usando a versão mais recente do código.

### Causa 2: Credenciais incorretas

**Sintoma:** O bridge mostra erro de login.

**Solução:** Verifique suas credenciais no terminal MT5. Tente fazer login diretamente no terminal MT5 para confirmar.

### Causa 3: MT5 não está inicializado

**Sintoma:** O bridge mostra erro de inicialização.

**Solução:** Abra o terminal MT5 e faça login na conta.

### Causa 4: Bridge não está rodando

**Sintoma:** O navegador mostra erro de conexão WebSocket.

**Solução:** Inicie o bridge com `python mt5_bridge.py`.

### Causa 5: Porta incorreta

**Sintoma:** O navegador mostra erro de conexão WebSocket.

**Solução:** Verifique em qual porta o bridge está rodando. O padrão é 8766, mas pode ser 8767 ou 8768 se a porta 8766 estiver em uso.

## Comandos Úteis

### Verificar processos usando a porta 8766
```bash
netstat -ano | findstr :8766
```

### Matar processo usando a porta 8766
```bash
taskkill /PID <PID> /F
```

### Verificar logs do Next.js
No terminal onde `npm run dev` está rodando, observe os logs.

## Relatório de Diagnóstico

Após seguir os passos acima, crie um relatório com:

1. Resultado do teste direto (passo 2)
2. Resultado do teste via bridge (passo 3)
3. Logs do navegador (passo 4)
4. Logs do bridge (passo 5)
5. Conteúdo do localStorage (passo 6)

Com essas informações, será possível identificar o problema exato.
