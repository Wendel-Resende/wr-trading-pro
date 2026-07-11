# Correção do Erro de Chave Estrangeira no AssetId

## Problema

O erro ocorria ao tentar criar um novo monitoramento de ação:

```
Error [PrismaClientKnownRequestError]: 
Foreign key constraint violated on the foreign key
    at async StockMonitoringService.create (src\services\stockMonitoringService.ts:55:18)
```

### Causa

O campo `assetId` no modelo `StockMonitoring` é uma chave estrangeira que referencia a tabela `Asset`. O formulário estava usando um campo de texto livre onde o usuário digitava o código da ação (ex: "PETR4"), mas esse valor não correspondia a um ID válido existente na tabela `Asset`.

## Solução Implementada

### 1. Criar Serviço de Asset (`src/services/assetService.ts`)

Novo serviço para gerenciar ativos com os seguintes métodos:

- `getAll()`: Listar todos os ativos
- `getById(id)`: Buscar ativo por ID
- `getBySymbol(symbol)`: Buscar ativo por símbolo (código)
- `getOrCreate(symbol, name?, type?, exchange?)`: Buscar ou criar ativo automaticamente
- `create(input)`: Criar novo ativo
- `update(id, data)`: Atualizar ativo
- `delete(id)`: Remover ativo
- `getStocks()`: Buscar apenas ações (STOCK)
- `getB3Stocks()`: Buscar ações da B3

**Método chave: `getOrCreate`**
```typescript
async getOrCreate(symbol: string, name?: string, type = 'STOCK', exchange = 'B3') {
  // Tenta buscar pelo símbolo
  const existing = await this.getBySymbol(symbol);
  
  if (existing) {
    return existing;
  }

  // Cria novo ativo se não existir
  return this.create({
    symbol,
    name: name || symbol,
    type,
    exchange,
  });
}
```

### 2. Criar API de Asset (`src/app/api/assets/route.ts`)

Endpoints RESTful para gerenciar ativos:

- `GET /api/assets`: Listar todos os ativos
  - Query params: `type` (STOCK, ETF, CRYPTO, FOREX), `exchange`
- `POST /api/assets`: Criar novo ativo
  - Body: `{ symbol, name, type, exchange }`

### 3. Modificar API de Stock Monitoring (`src/app/api/stock-monitoring/route.ts`)

**Antes:**
```typescript
const stock = await stockMonitoringService.create(body);
```

**Depois:**
```typescript
// Buscar ou criar o ativo baseado no código digitado
const asset = await assetService.getOrCreate(
  body.assetId.toUpperCase(), // código da ação (ex: PETR4, VALE3)
  body.assetId.toUpperCase(), // nome (usar o código como nome inicial)
  'STOCK', // tipo
  'B3' // exchange
);

// Substituir assetId pelo ID real do ativo
const stockInput = {
  ...body,
  assetId: asset.id,
};

const stock = await stockMonitoringService.create(stockInput);
```

### 4. Atualizar Formulário (`src/components/StockMonitoringForm.tsx`)

**Mudanças:**

1. **Label atualizado:**
   - De: "ID do Ativo *"
   - Para: "Código da Ação * (ex: PETR4, VALE3)"

2. **Placeholder adicionado:**
   - "Digite o código da ação..."

3. **CSS adicionado:**
   - Classe `uppercase` para mostrar o código em maiúsculas

4. **Auto-conversão para maiúsculas:**
```typescript
const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
  const { name, value } = e.target;
  
  let processedValue = value;
  
  // Converte código da ação para maiúsculas automaticamente
  if (name === 'assetId' && value) {
    processedValue = value.toUpperCase();
  }
  
  setFormData(prev => ({
    ...prev,
    [name]: processedValue === '' ? undefined : 
            ['assetId', 'stockType', 'observacoes'].includes(name) ? processedValue :
            name === 'stockType' ? processedValue :
            parseFloat(processedValue),
  }));
};
```

## Fluxo de Funcionamento

### Ao criar um novo monitoramento:

1. **Usuário digita:** "petr4" no campo "Código da Ação"
2. **Frontend converte:** "PETR4" (automaticamente para maiúsculas)
3. **API recebe:** `{ assetId: "PETR4", ... }`
4. **API busca/cria asset:**
   - Se existe: Retorna o asset existente com ID real
   - Se não existe: Cria novo asset `{ symbol: "PETR4", name: "PETR4", type: "STOCK", exchange: "B3" }`
5. **API substitui assetId:** Pega o ID real do asset e substitui no input
6. **Cria monitoramento:** Com o ID válido da chave estrangeira

### Exemplo Prático:

```
Cenário 1: Asset já existe
- Usuário digita: "VALE3"
- Sistema busca: Asset encontrado com ID "clxabc123..."
- Sistema usa: assetId = "clxabc123..."
- ✅ Monitoramento criado com sucesso

Cenário 2: Asset não existe
- Usuário digita: "ITUB4"
- Sistema busca: Asset não encontrado
- Sistema cria: Novo Asset { symbol: "ITUB4", name: "ITUB4", type: "STOCK", exchange: "B3" }
- Sistema usa: assetId = ID do novo asset criado
- ✅ Monitoramento criado com sucesso
```

## Vantagens da Solução

1. **Usabilidade:** Usuário apenas digita o código da ação (PETR4, VALE3, etc.)
2. **Automação:** Sistema cria asset automaticamente se não existir
3. **Consistência:** Código sempre em maiúsculas (padrão B3)
4. **Flexibilidade:** Pode criar monitoramentos para qualquer ação B3
5. **Manutenção:** Assets ficam salvos para reutilização

## Testando a Solução

1. Acesse a página principal da plataforma
2. Clique em "Nova Ação" no monitoramento de ações
3. Digite um código de ação (ex: "PETR4")
4. Preencha os demais campos conforme necessário
5. Clique em "Criar"
6. ✅ O monitoramento deve ser criado com sucesso

## Próximos Melhorias Sugeridas

1. **Autocomplete:** Mostrar sugestões de ações enquanto digita
2. **Busca de dados:** Integrar com API para buscar dados fundamentais automaticamente
3. **Validação:** Verificar se o código segue o padrão B3 (4 letras + número)
4. **Edição do asset:** Permitir atualizar nome e tipo do asset depois de criado
5. **Importação em massa:** Importar lista de ações da planilha Excel

## Arquivos Modificados

1. **Novos:**
   - `src/services/assetService.ts` - Serviço de gestão de ativos
   - `src/app/api/assets/route.ts` - API de ativos
   - `FIX_ASSETID_FOREIGN_KEY.md` - Este documento

2. **Modificados:**
   - `src/app/api/stock-monitoring/route.ts` - Adicionada lógica getOrCreate
   - `src/components/StockMonitoringForm.tsx` - Atualizado label e tratamento de input

## Solução Adicional: Serialização de BigInt

### Problema

Após corrigir o erro de chave estrangeira, surgiu outro erro:

```
TypeError: Do not know how to serialize a BigInt
    at JSON.stringify (<anonymous>)
    at json (src\app\api\stock-monitoring\route.ts:75:24)
```

### Causa

O Prisma retorna alguns campos (como `id`, `acoesEmitidas`, etc.) como `BigInt`, mas o método `JSON.stringify()` nativo não consegue serializar valores do tipo BigInt.

### Solução Implementada

#### 1. Criar Helper de Serialização (`src/lib/bigint-serializer.ts`)

Novo helper com duas funções principais:

```typescript
/**
 * Converte todos os BigInt em uma string recursivamente
 */
export function stringifyBigInt(data: any): any {
  // Implementação recursiva que converte BigInt para string
  // Suporta objetos, arrays e valores primitivos
}

/**
 * JSON.stringify customizado que suporta BigInt
 */
export function safeStringify(obj: any, space?: number): string {
  // Usando replacer do JSON.stringify para converter BigInt
  return JSON.stringify(obj, (_, value) => {
    return typeof value === 'bigint' ? value.toString() : value;
  }, space);
}
```

#### 2. Atualizar APIs para Usar o Helper

**API de Stock Monitoring (`src/app/api/stock-monitoring/route.ts`):**
```typescript
import { stringifyBigInt } from '@/lib/bigint-serializer';

// GET
return NextResponse.json({ 
  success: true, 
  data: stringifyBigInt(stocks) 
});

// POST
return NextResponse.json(
  { success: true, data: stringifyBigInt(stock) },
  { status: 201 }
);
```

**API de Assets (`src/app/api/assets/route.ts`):**
```typescript
import { stringifyBigInt } from '@/lib/bigint-serializer';

// GET
return NextResponse.json({ 
  success: true, 
  data: stringifyBigInt(assets) 
});

// POST
return NextResponse.json(
  { success: true, data: stringifyBigInt(asset) },
  { status: 201 }
);
```

### Como Funciona

1. **Conversão Recursiva:** A função `stringifyBigInt()` percorre todos os campos de um objeto
2. **Detecção de BigInt:** Quando encontra um valor do tipo `BigInt`, converte para `string`
3. **Preserva Estrutura:** Mantém a estrutura original do objeto, apenas convertendo os BigInts
4. **Transparente para o Frontend:** O frontend recebe strings que podem ser usadas normalmente

### Exemplo de Conversão

**Antes (Erro):**
```typescript
{
  id: 1234567890123456789n,  // BigInt - ❌ JSON.stringify falha
  acoesEmitidas: 9876543210n  // BigInt - ❌ JSON.stringify falha
}
```

**Depois (Correto):**
```typescript
{
  id: "1234567890123456789",  // String - ✅ JSON funciona
  acoesEmitidas: "9876543210"  // String - ✅ JSON funciona
}
```

## Resumo

O problema de chave estrangeira foi completamente resolvido com a implementação de um sistema que:

✅ Busca ou cria assets automaticamente
✅ Converte código para maiúsculas automaticamente
✅ Usa ID válido de chave estrangeira
✅ Mantém usabilidade simples para o usuário
✅ Permite monitoramento de qualquer ação B3
✅ Serializa BigInt corretamente para JSON
✅ Evita erros de serialização em todas as APIs

O usuário agora pode simplesmente digitar o código da ação e o sistema gerencia tudo automaticamente, incluindo a correta serialização de BigInts para JSON.

## Arquivos Modificados Adicionais

### Novos:
- `src/lib/bigint-serializer.ts` - Helper para serialização de BigInt

### Modificados:
- `src/app/api/stock-monitoring/route.ts` - Adicionado stringifyBigInt em GET e POST
- `src/app/api/assets/route.ts` - Adicionado stringifyBigInt em GET e POST
