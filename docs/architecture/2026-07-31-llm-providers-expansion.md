# Expansão de provedores LLM — LM Studio, OpenRouter, Anthropic e OpenAI

Status: especificação aditiva para implementação pelo Claude Code.

## Problema

A WR já possui o proxy server-side de LLM, com Ollama local e DeepSeek em uso. O tipo de provedor, a configuração, o catálogo da UI e o caminho legado `/api/agents` ainda não oferecem uma experiência completa para:

- LM Studio com modelos locais via API compatível com OpenAI;
- OpenRouter, incluindo o roteador/modelos gratuitos;
- Anthropic Claude via API nativa Messages;
- OpenAI com configuração e seleção de modelo consistentes.

## Objetivo

Adicionar os quatro provedores à mesma arquitetura governada, sem expor credenciais ao browser, permitindo seleção do provedor/modelo no Assistente IA e no painel legado de Agentes, com fallback server-side, descoberta de modelos locais e testes reais de contrato.

## Princípios fixos

1. Chaves e endpoints privados somente em variáveis server-side; nunca `NEXT_PUBLIC_*`, localStorage ou payload do browser.
2. O cliente só envia provider/model/temperature/maxTokens e mensagens validadas pelo schema estrito.
3. LM Studio e Ollama são locais: endpoints configuráveis apenas em loopback (`localhost`, `127.0.0.1`, `::1`) para impedir SSRF. Default LM Studio: `http://127.0.0.1:1234/v1`.
4. O servidor nunca devolve chaves, headers, URL privada ou erro bruto com segredo.
5. A expansão é somente de provedores LLM para análise/assistentes. Nenhum provedor pode executar ordem, criar `OrderIntent` ou contornar `WR_TRADING_ENABLED`/aprovação humana.
6. Falha do provedor preferido pode usar fallback server-side; a resposta deve informar o provedor/modelo efetivamente usados.
7. Modelos e endpoints são configuráveis no `.env`; não congelar um modelo pago ou um modelo gratuito volátil como única opção.
8. O código atual de DeepSeek/Ollama deve continuar funcionando.

## Contrato de provedores

Adicionar ao `LLMProvider`:

- `LM_STUDIO`
- `OPENROUTER`
- `ANTHROPIC`

`OPENAI` já existe, mas deve ser exposto de forma consistente no catálogo, configuração e UI.

Variáveis server-side documentadas no `.env.example`:

```env
OPENAI_API_KEY=""
OPENAI_DEFAULT_MODEL="gpt-4.1-mini"
DEEPSEEK_API_KEY=""
OPENROUTER_API_KEY=""
OPENROUTER_DEFAULT_MODEL="openrouter/free"
ANTHROPIC_API_KEY=""
ANTHROPIC_DEFAULT_MODEL="claude-3-5-haiku-latest"
LM_STUDIO_ENDPOINT="http://127.0.0.1:1234/v1"
LM_STUDIO_DEFAULT_MODEL=""
LM_STUDIO_API_KEY=""
```

`LM_STUDIO_API_KEY` é opcional: se vazio, não enviar Authorization; se preenchido, enviar Bearer server-side. O endpoint deve passar a mesma allowlist local usada para Ollama, sem aceitar URL do cliente.

OpenRouter deve usar `https://openrouter.ai/api/v1/chat/completions` e aceitar `OPENROUTER_DEFAULT_MODEL`. `openrouter/free` pode ser o default, mas o usuário deve poder escolher outro model id permitido pelo schema. Não requisitar nem persistir catálogo remoto no browser sem necessidade; a seleção manual do model id é suficiente, e um catálogo remoto opcional deve ser limitado/sanitizado.

OpenAI deve manter endpoint oficial e default configurável. DeepSeek/Ollama/Qwen/Groq/Manus não devem regredir.

## Adaptadores

### OpenAI-compatible

Reutilizar `OpenAICompatibleProvider` para OpenAI, DeepSeek, LM Studio e OpenRouter, com:

- endpoint e API key vindos exclusivamente da configuração server-side;
- headers adicionais opcionais apenas server-side (`HTTP-Referer`/`X-Title` para OpenRouter, sem segredos);
- timeout/clamp existentes;
- resposta defensiva quando `choices[0].message.content` ou usage não existir;
- identificação correta do provider/modelo efetivo.

### Anthropic

Criar adaptador separado para a API nativa `POST https://api.anthropic.com/v1/messages`:

- header `x-api-key` server-side;
- header `anthropic-version: 2023-06-01`;
- `system` separado do array `messages`;
- `max_tokens` obrigatório e validado;
- converter resposta `content[].text` para `LLMResponse.content`;
- mapear usage para o formato atual;
- rejeitar mensagens/estruturas não suportadas de forma sanitizada;
- aplicar o mesmo timeout e nunca vazar chave no erro.

## Configuração pela plataforma

A tela de Configurações de IA deve ter campos para o usuário informar:

- API key da OpenAI;
- API key da DeepSeek;
- API key da OpenRouter;
- API key da Anthropic;
- API key opcional do LM Studio;
- endpoint/modelo padrão do LM Studio;
- modelo padrão do OpenRouter;
- modelo padrão da Anthropic;
- modelo padrão da OpenAI.

Os campos devem ser do tipo password, com botão explícito para salvar e indicador somente de estado (`configurada`/`não configurada`), nunca exibindo o valor depois do salvamento.

O formulário não pode gravar segredo em `localStorage`, cookie, URL, log ou resposta JSON. Criar uma rota server-side autenticada para salvar/limpar a configuração. A persistência deve ser protegida em repouso: usar o mecanismo seguro já existente no projeto; se não houver um, adicionar uma camada pequena de criptografia autenticada no SQLite usando uma chave server-side `WR_LLM_CONFIG_ENCRYPTION_KEY` (mínimo 32 caracteres), com nonce/tag por registro. Nunca persistir plaintext. Sem a chave de proteção, a rota deve falhar fechado e explicar que a configuração server-side/env continua disponível.

A configuração salva pela UI deve ser usada pelo serviço server-side após atualização sem exigir vazamento para o cliente; se o processo não puder recarregar dinamicamente, a UI deve informar que é necessário reiniciar o servidor. A precedência deve ser explícita: configuração segura persistida da UI, quando existente, sobrepõe o default do `.env` sem retornar o segredo; o `.env` continua como bootstrap/fallback para instalação.

A rota de leitura retorna apenas provider, enabled, displayName, modelo e endpoint local sanitizado; nunca chave, ciphertext, nonce, Authorization ou payload de upstream. Testar também limpeza e rotação da chave.

## API e segurança

Atualizar:

- `src/types/llm.ts`;
- `src/lib/server/llm-config.ts`;
- `src/lib/server/llm-providers.ts`;
- `src/app/api/llm/chat/route.ts`;
- `src/app/api/llm/providers/route.ts`;
- `src/adapters/llm/server-llm-agent.ts`;
- `.env.example` e documentação de configuração.

O schema de provider deve ser uma enum fechada. O regex de model deve continuar limitado a ids seguros, sem URL, whitespace, path arbitrário ou controle de headers. O endpoint nunca pode ser aceito no request.

`GET /api/llm/providers` deve retornar somente:

- providers configurados;
- display name/status sanitizado;
- modelos descobertos do LM Studio quando o endpoint local responder `/v1/models`;
- modelos Ollama já existentes;
- defaults não secretos.

Não retornar API keys, endpoint privado completo, resposta upstream ou stack trace.

## UI

Atualizar as duas superfícies existentes:

1. `src/components/AIChat.tsx`: catálogo/display names e seleção de provider/modelo, sem quebrar o carregamento dinâmico atual.
2. `src/app/settings/page.tsx`: cards/status e instruções para as novas variáveis.
3. `src/components/AgentPanel.tsx` e `/api/agents`: manter o fluxo legado funcional, adicionando LM Studio, OpenRouter e Anthropic sem guardar segredo no localStorage. O modelo local deve permitir escolher entre modelos descobertos do Ollama/LM Studio; para remoto, usar default configurado e, se houver campo de modelo, validar no servidor.

A UI deve mostrar claramente quando o provedor está configurado, indisponível ou usando fallback. Não mostrar valores de segredo.

## Testes obrigatórios

Adicionar/atualizar testes para:

- enum de todos os providers e schema estrito;
- configuração server-side sem aceitar `NEXT_PUBLIC_*`;
- allowlist local do LM Studio/Ollama e rejeição de URL remota;
- descoberta `/v1/models` sanitizada;
- payload OpenAI-compatible para OpenAI, LM Studio e OpenRouter;
- headers específicos do OpenRouter sem segredo no retorno;
- payload Anthropic com system separado, `max_tokens` e conversão de resposta;
- timeout, HTTP error e resposta malformada para cada adapter;
- fallback determinístico quando o provider preferido falha;
- teste adversarial no handler HTTP real provando que apiKey/endpoint extras são rejeitados antes de qualquer upstream;
- regressões do AgentRun e do chat existente.

Rodar, no mínimo:

```text
prisma generate
prisma validate
npx tsc --noEmit
npm run test:agent-run
npm run test:llm (ou o harness equivalente criado pelo item)
npm run build
```

## Fora de escopo

- Não implementar billing, quotas ou gestão de contas do OpenRouter.
- Não baixar automaticamente modelos no LM Studio/Ollama.
- Não alterar o motor Kronos, ML ou sinais direcionais.
- Não adicionar execução de ordens via LLM.
- Não commitar `.env`, chaves, tokens ou dados locais.

## Critério de aceite

A WR lista e permite selecionar OpenAI, DeepSeek, Ollama, LM Studio, OpenRouter e Anthropic quando configurados; chamadas reais passam exclusivamente pelo backend; LM Studio funciona com um servidor local OpenAI-compatible; OpenRouter aceita um modelo `openrouter/free` configurado; Anthropic funciona pelo endpoint Messages; o painel legado continua operacional; todos os testes e build passam; nenhum segredo aparece no browser, logs sanitizados ou respostas HTTP.

Codificação a cargo do Claude Code no Windows. O Claude não deve alterar esta spec nem `docs/CODEX_HANDOFF.md`.
