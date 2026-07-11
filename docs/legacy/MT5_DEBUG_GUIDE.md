# Guia de Debug - Problema de Conexão MT5

## Problema Atual
- Status fica em "Conectando..." e nunca muda
- Campo de senha não permite digitar
- Credenciais estão corretas

## Passo 1: Limpar Credenciais Salvas

1. Abra o navegador em http://localhost:3000
2. Pressione F12 para abrir o console
3. No console, execute:
   ```javascript
   localStorage.removeItem('mt5-config')
   ```
4. Recarregue a página (F5)

## Passo 2: Verificar se o MT5 Bridge está Rodando

1. Abra um terminal
2. Execute:
   ```bash
   python mt5_bridge.py
   ```
3. Você deve ver:
   ```
   [INFO] Inicializando MT5 Bridge...
   [INFO] Servidor WebSocket iniciado com sucesso na porta 8766
   ```

Se não estiver rodando, inicie o bridge.

## Passo 3: Testar Conexão Direta

1. Abra outro terminal
2. Execute:
   ```bash
   python test_mt5_connection.py
   ```
3. Você deve ver:
   ```
   [INFO] Conectando ao MT5...
   [INFO] Login MT5 bem-sucedido: MT5_LOGIN_EXAMPLE
   [INFO] Conta: MT5_LOGIN_EXAMPLE
   [INFO] Saldo: XXXX.XX
   [INFO] Lucro: XXXX.XX
   ```

Se isso funcionar, suas credenciais estão corretas.

## Passo 4: Testar Conexão via Bridge

1. Abra outro terminal
2. Execute:
   ```bash
   python test_mt5_bridge.py
   ```
3. Você deve ver:
   ```
   [INFO] Conectando ao MT5 Bridge...
   [INFO] Conectado ao MT5 Bridge
   [INFO] Enviando mensagem de login...
   [INFO] Login bem-sucedido!
   [INFO] Posição: 0
   ```

Se isso funcionar, o bridge está funcionando corretamente.

## Passo 5: Testar Conexão via UI

1. Abra o navegador em http://localhost:3000
2. Pressione F12 para abrir o console
3. Vá para a aba "Console"
4. Clique no botão "Config" no componente MT5
5. Preencha os campos:
   - Login: MT5_LOGIN_EXAMPLE
   - Senha: MT5_PASSWORD_EXAMPLE
   - Servidor: MT5_SERVER_EXAMPLE
6. Clique em "Salvar e Conectar"
7. Observe os logs no console

### Logs Esperados no Console do Navegador:

```
Valores de conexão: {login: "MT5_LOGIN_EXAMPLE", password: "***", server: "MT5_SERVER_EXAMPLE"}
Login convertido para número: MT5_LOGIN_EXAMPLE
Tentando conectar ao MT5: {login: MT5_LOGIN_EXAMPLE, server: "MT5_SERVER_EXAMPLE"}
Tentando conectar ao MT5 Bridge: ws://localhost:8766
Configuração: {login: MT5_LOGIN_EXAMPLE, password: "MT5_PASSWORD_EXAMPLE", server: "MT5_SERVER_EXAMPLE"}
MT5 WebSocket connected
Enviando login: {login: MT5_LOGIN_EXAMPLE, server: "MT5_SERVER_EXAMPLE"}
Enviando mensagem LOGIN: {type: "LOGIN", login: MT5_LOGIN_EXAMPLE, server: "MT5_SERVER_EXAMPLE", hasPassword: true}
Enviando mensagem: {"type":"LOGIN","data":{"login":MT5_LOGIN_EXAMPLE,"password":"MT5_PASSWORD_EXAMPLE","server":"MT5_SERVER_EXAMPLE"}}
```

### Logs Esperados no Terminal do Bridge:

```
Recebido: LOGIN
Login MT5 bem-sucedido: MT5_LOGIN_EXAMPLE
```

## Passo 6: Verificar Logs do Bridge

Enquanto você tenta conectar pela UI, observe o terminal onde o bridge está rodando.

Você deve ver:
```
Recebido: LOGIN
Login MT5 bem-sucedido: MT5_LOGIN_EXAMPLE
```

Se você não ver "Login MT5 bem-sucedido", então o login falhou.

## Passo 7: Verificar Mensagens de Erro

Se houver erro, você deve ver no console do navegador:

```
MT5 error recebido: {message: "Erro de login", error: "..."}
```

Ou no terminal do bridge:

```
Erro no login MT5: (...)
```

## Soluções para Problemas Comuns

### Problema 1: Campo de Senha Não Permite Digitar

**Solução:**
1. Limpe o localStorage (Passo 1)
2. Recarregue a página
3. Tente digitar a senha novamente
4. Se ainda não funcionar, tente usar outro navegador (Chrome, Firefox, Edge)

### Problema 2: Status Fica em "Conectando..."

**Possíveis causas:**
1. Bridge não está rodando
2. Porta incorreta
3. WebSocket não está conectando

**Solução:**
1. Verifique se o bridge está rodando (Passo 2)
2. Verifique os logs do console do navegador
3. Verifique se há erro de conexão WebSocket

### Problema 3: Erro de Login

**Possíveis causas:**
1. Credenciais incorretas
2. MT5 não está inicializado
3. Servidor incorreto

**Solução:**
1. Teste a conexão direta (Passo 3)
2. Verifique se o terminal MT5 está aberto
3. Verifique se a conta está ativa no MT5

### Problema 4: WebSocket Connection Error

**Possíveis causas:**
1. Bridge não está rodando
2. Porta incorreta
3. Firewall bloqueando

**Solução:**
1. Verifique se o bridge está rodando (Passo 2)
2. Verifique a porta (deve ser 8766, 8767 ou 8768)
3. Desabilite o firewall temporariamente

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

1. **Resultado do Passo 1:** Sucesso/Falha
2. **Resultado do Passo 2:** Sucesso/Falha
3. **Resultado do Passo 3:** Sucesso/Falha (inclua logs)
4. **Resultado do Passo 4:** Sucesso/Falha (inclua logs)
5. **Resultado do Passo 5:** Sucesso/Falha (inclua logs do console)
6. **Resultado do Passo 6:** Sucesso/Falha (inclua logs do bridge)
7. **Resultado do Passo 7:** Sucesso/Falha (inclua mensagens de erro)

Com essas informações, será possível identificar o problema exato.

## Dicas Adicionais

1. **Use o botão "Limpar":** Se as credenciais não estiverem funcionando, clique no botão "Limpar" para remover as credenciais salvas e tente novamente.

2. **Verifique o tipo de dados:** O login deve ser um número, não uma string. O código já foi corrigido para converter automaticamente.

3. **Verifique o formato da senha:** A senha pode conter caracteres especiais. Certifique-se de digitar corretamente.

4. **Use o console do navegador:** O console do navegador é sua melhor ferramenta para debugar. Pressione F12 e observe os logs.

5. **Verifique os logs do bridge:** O terminal onde o bridge está rodando mostra informações importantes sobre a conexão.

6. **Tente outro navegador:** Se o problema persistir, tente usar outro navegador para descartar problemas específicos do navegador.
