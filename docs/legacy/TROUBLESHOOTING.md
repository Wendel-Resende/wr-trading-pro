# Troubleshooting - WR Trading Pro

## Problema: Não conecta ao MT5 (parece senha errada)

### Sintomas:
- Ao clicar em "Conectar", o status fica em "Conectando..." mas nunca muda para "Conectado"
- Não aparece nenhuma mensagem de erro
- O console do navegador não mostra erros óbvios

### Causas possíveis:

1. **Login sendo enviado como string em vez de número**
   - O localStorage salva o login como string
   - O MT5 espera um número inteiro
   - Solução: O código já foi corrigido para converter para número

2. **Credenciais incorretas**
   - Verifique se o login, senha e servidor estão corretos
   - Tente fazer login diretamente no terminal MT5

3. **MT5 não está inicializado**
   - O terminal MT5 deve estar aberto
   - A conta deve estar ativa

4. **Bridge não está rodando**
   - Verifique se o servidor bridge está rodando
   - Deve mostrar "Servidor WebSocket iniciado com sucesso"

### Soluções:

#### Solução 1: Verificar logs do navegador

1. Abra o console do navegador (F12)
2. Vá para a aba "Console"
3. Procure por mensagens de erro ou avisos
4. Você deve ver logs como:
   ```
   Valores de conexão: {login: "MT5_LOGIN_EXAMPLE", password: "***", server: "MT5_SERVER_EXAMPLE"}
   Tentando conectar ao MT5: {login: MT5_LOGIN_EXAMPLE, server: "MT5_SERVER_EXAMPLE"}
   ```

#### Solução 2: Verificar logs do bridge

No terminal onde o bridge está rodando, você deve ver:
```
Recebido: LOGIN
Login MT5 bem-sucedido: MT5_LOGIN_EXAMPLE
```

Se você não ver "Login MT5 bem-sucedido", então o login falhou.

#### Solução 3: Testar credenciais diretamente

Execute o script de teste:
```bash
python test_mt5_connection.py
```

Isso testará a conexão direta com o MT5 sem o bridge.

#### Solução 4: Limpar localStorage

1. Abra o console do navegador (F12)
2. Execute:
   ```javascript
   localStorage.removeItem('mt5-config')
   ```
3. Recarregue a página (F5)
4. Insira as credenciais novamente

#### Solução 5: Verificar tipo de dados

No console do navegador, verifique:
```javascript
localStorage.getItem('mt5-config')
```

Deve retornar algo como:
```json
{"login":"MT5_LOGIN_EXAMPLE","password":"MT5_PASSWORD_EXAMPLE","server":"MT5_SERVER_EXAMPLE"}
```

Se o login estiver como string, o código já foi corrigido para converter para número.

## Problema: Porta já em uso ao iniciar o MT5 Bridge

### Erro:
```
[Errno 10048] error while attempting to bind on address ('::1', 8766, 0, 0): 
[winerror 10048] normalmente é permitida apenas uma utilização de cada endereço de soquete (protocolo/endereço de rede/porta)
```

### Causa:
A porta 8766 já está sendo usada por outra instância do `mt5_bridge.py` ou por outro aplicativo.

### Soluções:

#### Solução 1: Fechar outras instâncias (Recomendado)

1. **Verifique se há outras instâncias rodando:**
   - Abra o Gerenciador de Tarefas (Ctrl+Shift+Esc)
   - Procure por processos `python.exe`
   - Se houver múltiplos processos python, encerre os que não estão em uso

2. **Verifique os terminais abertos:**
   - Feche todos os terminais que estão rodando `python mt5_bridge.py`
   - Certifique-se de que não há nenhum processo python rodando o bridge

3. **Reinicie o bridge:**
   ```bash
   python mt5_bridge.py
   ```

#### Solução 2: O bridge tentará automaticamente outras portas

O código foi atualizado para tentar automaticamente as portas 8766, 8767 e 8768 se a porta 8766 estiver em uso.

Se a porta 8766 estiver ocupada, você verá:
```
2026-01-03 07:39:44,418 - __main__ - WARNING - Porta 8766 já está em uso. Tentando porta 8767...
2026-01-03 07:39:44,431 - __main__ - INFO - server listening on 127.0.0.1:8767
```

#### Solução 3: Usar uma porta diferente manualmente

Se você precisar usar uma porta específica, edite o arquivo [`mt5_bridge.py`](mt5_bridge.py):

```python
# Na função main(), altere a porta inicial:
port = 8766  # Mude para 8767, 8768, etc.
```

E atualize o arquivo [`src/services/mt5Service.ts`](src/services/mt5Service.ts):

```typescript
// No construtor, altere a URL:
private pythonServerUrl: string = 'ws://localhost:8767';  // Mude para a porta desejada
```

#### Solução 4: Encontrar o processo usando a porta

No Windows, use o PowerShell para encontrar o processo:

```powershell
netstat -ano | findstr :8766
```

Isso mostrará o PID do processo usando a porta. Você pode então encerrar o processo:

```powershell
taskkill /PID <PID> /F
```

## Problema: DeprecationWarning do websockets

### Erro:
```
DeprecationWarning: websockets.server.WebSocketServerProtocol is deprecated
```

### Causa:
A versão mais recente da biblioteca `websockets` depreciou o tipo `WebSocketServerProtocol`.

### Solução:
O código já foi atualizado para usar `Any` em vez de `WebSocketServerProtocol`. Se você ainda ver este aviso, atualize a biblioteca:

```bash
pip install --upgrade websockets
```

## Problema: Conexão recusada pelo MT5 Bridge

### Erro:
```
❌ Erro: Não foi possível conectar ao MT5 Bridge
```

### Soluções:

1. **Verifique se o bridge está rodando:**
   ```bash
   python mt5_bridge.py
   ```
   Você deve ver:
   ```
   2026-01-03 07:39:44,418 - __main__ - INFO - Iniciando servidor MT5 Bridge na porta 8766...
   2026-01-03 07:39:44,431 - websockets.server - INFO - server listening on 127.0.0.1:8766
   ```

2. **Verifique a porta:**
   - Se o bridge está rodando na porta 8767, atualize o serviço MT5 para usar essa porta
   - Edite [`src/services/mt5Service.ts`](src/services/mt5Service.ts) e altere `pythonServerUrl`

3. **Verifique o firewall:**
   - Certifique-se de que o firewall não está bloqueando a conexão
   - Adicione uma exceção para Python ou para a porta 8766-8768

## Problema: Falha no login MT5

### Erro:
```
❌ Erro: Falha no login: [error code]
```

### Soluções:

1. **Verifique as credenciais:**
   - Confirme que o login, senha e servidor estão corretos no arquivo [`.env`](.env)
   - Tente fazer login diretamente no terminal MT5 para verificar as credenciais

2. **Verifique se o MT5 está instalado:**
   ```bash
   python -c "import MetaTrader5 as mt5; print(mt5.initialize())"
   ```
   Deve retornar `True`

3. **Verifique se o terminal MT5 está rodando:**
   - O terminal MT5 deve estar aberto e conectado
   - A conta deve estar ativa

4. **Verifique o servidor:**
   - O nome do servidor deve estar exatamente como aparece no MT5
   - Exemplo: `MT5_SERVER_EXAMPLE` (case-sensitive)

## Problema: Posições não aparecendo

### Causas possíveis:

1. **Não está conectado ao MT5:**
   - Verifique se o componente MT5Connection mostra "Conectado"
   - Se não, clique em "Conectar"

2. **Não há posições abertas:**
   - Verifique no terminal MT5 se há posições abertas
   - Se não houver posições, o componente mostrará "Nenhuma posição aberta"

3. **Dados não foram carregados:**
   - Aguarde alguns segundos após conectar
   - Os dados são carregados automaticamente após a conexão

## Problema: Ordens não sendo enviadas

### Soluções:

1. **Verifique se está conectado:**
   - O componente MT5Connection deve mostrar "Conectado"

2. **Verifique o símbolo:**
   - O símbolo deve estar disponível no MT5
   - Use símbolos que aparecem no terminal MT5

3. **Verifique a margem:**
   - Certifique-se de que há margem suficiente para a ordem
   - Verifique "Margem Livre" no componente MT5Connection

4. **Verifique os logs do bridge:**
   - Olhe o terminal onde o bridge está rodando
   - Procure por mensagens de erro ou avisos

## Problema: TypeScript/ESLint Errors

### Erro:
```
src\services\mt5Service.ts (352:13) @ error
```

### Solução:
O código já foi corrigido com o comentário `eslint-disable-next-line`. Se você ainda ver erros:

1. **Reinicie o servidor de desenvolvimento:**
   ```bash
   # Pare o servidor (Ctrl+C)
   npm run dev
   ```

2. **Limpe o cache:**
   ```bash
   rm -rf .next
   npm run dev
   ```

## Dicas Gerais

### 1. Sempre verifique os logs
- **Bridge MT5**: Terminal onde `python mt5_bridge.py` está rodando
- **Next.js**: Terminal onde `npm run dev` está rodando
- **Browser**: Console do navegador (F12)

### 2. Use contas de demonstração para testes
- Nunca teste com conta real primeiro
- Use contas demo para verificar tudo está funcionando
- Depois de testar, você pode usar conta real

### 3. Mantenha o ambiente conda ativo
- Certifique-se de que está no ambiente `IA_Day_Trading`
- Ative com: `conda activate IA_Day_Trading`

### 4. Verifique as dependências
```bash
# Python
pip install MetaTrader5 websockets

# Node.js
npm install
```

## Comandos Úteis

### Verificar processos Python no Windows:
```powershell
Get-Process python | Select-Object Id, ProcessName, StartTime
```

### Matar processo Python específico:
```powershell
taskkill /PID <PID> /F
```

### Verificar portas em uso:
```powershell
netstat -ano | findstr :8766
```

### Reiniciar tudo:
```bash
# 1. Pare todos os processos python
taskkill /F /IM python.exe

# 2. Pare o servidor Next.js (Ctrl+C no terminal)

# 3. Reinicie o bridge
python mt5_bridge.py

# 4. Reinicie o Next.js
npm run dev
```

## Suporte

Se você ainda tiver problemas após tentar estas soluções:

1. **Verifique os logs** - Os logs do bridge e do Next.js geralmente mostram o problema
2. **Consulte a documentação** - Revise os arquivos README e guias de integração
3. **Teste isoladamente** - Use os scripts de teste (`test_mt5_connection.py`, `test_mt5_bridge.py`)
4. **Verifique o ambiente** - Certifique-se de que está no ambiente conda correto

## Arquivos Relacionados

- [`mt5_bridge.py`](mt5_bridge.py) - Servidor WebSocket Python
- [`src/services/mt5Service.ts`](src/services/mt5Service.ts) - Serviço TypeScript
- [`.env`](.env) - Configurações de ambiente
- [`test_mt5_connection.py`](test_mt5_connection.py) - Teste de conexão MT5
- [`test_mt5_bridge.py`](test_mt5_bridge.py) - Teste do bridge WebSocket
