# Ranking de Saúde Financeira

Data: 2026-08-12
Status: aprovado pelo usuário (decisões registradas abaixo)
Autor: Claude Code (Opus 5), a pedido do usuário

## Motivação

A aba **Ranking Fundamentalista** (reposicionada em 2026-08-11) responde a uma
pergunta preditiva: *"quais empresas tendem a render acima das pares no próximo
trimestre"*. Ela precisa de walk-forward, IC, t-stat e gate porque faz uma
promessa sobre o futuro, e essa promessa tem de ser provada.

Esta aba responde a outra pergunta, **descritiva**: *"quais empresas mantiveram
as contas em ordem ao longo do tempo"*. Nas palavras do usuário: *"isso mostra
que a empresa é organizada e se preocupa em não ficar negativada"*.

A diferença não é cosmética. Consistência financeira é um **fato observável no
balanço**, não uma estimativa. Não há nada a prever, só a contar. Consequências
diretas:

- **não precisa de gate** — não há hipótese estatística a rejeitar;
- **não precisa do motor Python nem do ML Engine** — é agregação sobre dado já
  ingerido;
- **não pode falhar por reprovação de modelo** — o pior caso é dado ausente,
  que tem tratamento explícito;
- **qualquer linha é conferível à mão**, abrindo o balanço da empresa.

**Decisão do usuário:** as duas abas convivem, cada uma na sua, sem competir.

## Decisões (respondidas pelo usuário em 2026-08-12)

| # | Questão | Decisão |
|---|---|---|
| 1 | Substitui ou convive com o escore de fator | **Convivem**, cada um em sua aba |
| 2 | Como medir saúde ao longo do tempo | **Critérios absolutos por trimestre**, contando consistência |
| 3 | Quais pilares | **Cinco**: alavancagem, liquidez, cobertura de juros, lucro e geração de caixa |
| 4 | Empresas do setor financeiro | **Excluídas**, com a razão na tela; bloco próprio fica para depois |
| 5 | Como um trimestre conta | **Nota parcial** (pilares aprovados ÷ pilares medidos), sem pesos |

## O risco central desta aba

**Empresa saudável não é sinônimo de bom investimento.** Que a WEG é bem gerida
já está no preço. Este ranking mede *organização financeira*, não retorno
esperado. Se ele for lido como "compre as do topo", reintroduz pela porta dos
fundos a promessa falsa que o reposicionamento de 2026-08-11 removeu.

Por isso a legenda abaixo é **obrigatória e fixa na tela**, espelhando a da aba
irmã:

> **Consistência financeira histórica. Não é previsão de retorno nem
> recomendação de compra.**

## Universo

Fonte: `data/cvm/cvm_fundamentos.db` — 138 empresas, `2011-06-30` a
`2026-03-31`, quase 60 trimestres.

### Exclusão 1: setor financeiro (18 empresas)

Os critérios de liquidez e alavancagem escritos para indústria **mentem** sobre
bancos e seguradoras: num banco o passivo circulante *é* o depósito do cliente,
alavancagem alta é o modelo de negócio, e `icj` mede a cobertura de juros de
quem toma emprestado para operar, não de quem empresta. Aplicar a mesma régua
faria ITUB4 e BBDC4 aparecerem como empresas doentes — o oposto do que o
ranking afirma.

A exclusão usa `empresas.setor_cvm` (classificação oficial da CVM, buckets
limpos), **nunca** o campo `setor` de texto livre:

```
Bancos                                      (10)
Seguradoras e Corretoras                     (4)
Emp. Adm. Part. - Seguradoras e Corretoras   (2)
Emp. Adm. Part. - Intermediação Financeira   (1)
Bolsas de Valores/Mercadorias e Futuros      (1)
                                        total 18
```

Conferido: bate exatamente com as 18 encontradas por varredura no texto livre
(ITUB4, BBDC4, BBAS3, SANB11, ABCB4, BMGB4, PINE4, BRSR6, BEES3, BPAC11, WIZC3,
ITSA4, B3SA3, IRBR3, BBSE3, PSSA3, CXSE3, CASH3).

**Cinco desses papéis estão na watchlist do usuário** — a exclusão tem custo
real e por isso aparece na tela com a razão, nunca como omissão silenciosa.

### Exclusão 2: história insuficiente (piso de 20 trimestres)

Distribuição real de trimestres por empresa: **94 das 138 têm os 60 completos**;
o restante vai de 11 a 55. "Saudável em 100% dos trimestres" numa amostra de 11
é barato. O piso de 20 trimestres (5 anos) corta **3 empresas não-financeiras**,
contadas no dado real: JALL3 (11), CAML3 (17) e SRNA3 (19).

SRNA3 é uma das quatro empresas que apareciam indevidamente nos extremos do
ranking de fator por falta de série de preços — aqui o piso de história a retira
por conta própria, sem regra especial.

As excluídas por história curta são **listadas à parte, com a contagem de
trimestres** — some quem não pode ser avaliada, não quem foi mal.

### Resultado

**117 empresas ranqueadas**: 138 − 18 do setor financeiro − 3 sem história
suficiente.

## Os cinco pilares

Cada campo foi escolhido pela **cobertura no dado real**, não pela elegância do
indicador.

| Pilar | Campo | Tabela | Critério | Cobertura |
|---|---|---|---|---|
| Alavancagem | `divida_bruta_pl` | `fundamental_indicators` | ≤ 1,0 | 99% |
| Liquidez | `liquidez_corrente` | `indicadores` | ≥ 1,0 | 97% |
| Cobertura de juros | `icj` | `fundamental_indicators` | ≥ 2,0 | 90% |
| Lucro | `lucro_liquido` | `dre_trimestral` | > 0 | 100% |
| Geração de caixa | `fco` | `dfc_trimestral` | > 0 | 99% |

### Duas escolhas que contrariam o óbvio

**Dívida bruta/PL em vez de dívida líquida/EBITDA.** O indicador clássico tem
83% de cobertura, mediana 3,3, e explode quando o EBITDA é pequeno — o limiar
passaria a depender de um denominador instável. `divida_bruta_pl` tem 99% e
mediana 0,44.

**Lucro e caixa vêm da demonstração crua, não das margens.** `margem_liquida`
tem apenas 69% de cobertura; `lucro_liquido` tem 100% e `fco` 99%. Como o pilar
avalia só o **sinal** (positivo ou não), a margem não acrescenta informação e
custaria um terço da amostra.

### Calibração dos limiares contra a distribuição real

| Campo | p05 | p25 | mediana | p75 | p95 | Aprovação |
|---|---|---|---|---|---|---|
| `liquidez_corrente` | 0,49 | 1,06 | 1,61 | 2,55 | 9,03 | ~78% |
| `divida_bruta_pl` | 0,00 | 0,04 | 0,44 | 1,14 | 3,54 | ~72% |
| `icj` | −0,74 | 0,88 | 2,09 | 4,79 | 34,18 | ~50% |

Nenhum limiar é frouxo a ponto de aprovar todo mundo, nem duro a ponto de
reprovar todo mundo. `icj ≥ 2` cai praticamente sobre a mediana, o que faz dele
o pilar mais discriminante — deliberado: cobertura de juros é o que separa
empresa endividada de empresa em apuros.

### Escala: atenção ao bug já cometido

`fundamental_indicators` é **decimal, base 12 meses**; `indicadores` é
**percentual, base trimestral**. Misturar as duas fontes no mesmo indicador foi
um bug real da ficha fundamentalista v1. Aqui cada pilar lê de **uma fonte só**,
e nenhum dos limiares depende de conversão de escala: `liquidez_corrente` e
`divida_bruta_pl` são razões puras nas suas respectivas tabelas, e `endividamento`
(percentual, 0–100) **não é usado** justamente para não abrir essa porta.

### Dado ausente nunca reprova

Pilar sem dado no trimestre **não conta como aprovação nem como reprovação**. O
trimestre é avaliado sobre os pilares efetivamente medidos. Fingir reprovação
por dado ausente inventaria doença — mesma disciplina do princípio nº 1.

## Formação do escore

**Escore = média, sobre os trimestres publicados, de (pilares aprovados ÷
pilares medidos).** Um trimestre com 4 de 5 pilares medidos aprovados vale 0,8.
O escore final fica em [0, 1].

Sem pesos. Pesos são exatamente o tipo de opinião arbitrária que o número
passaria a carregar sem mostrar — foi o motivo de a alternativa ponderada ser
recusada.

### Os cinco pilares aparecem abertos

Cada linha exibe a taxa de aprovação de cada pilar (exemplo ILUSTRATIVO — os
números abaixo não foram medidos, só a forma da linha está fixada):

> **WEGE3 — 0,94** · 58 trimestres
> Alavancagem 100% · Liquidez 98% · Juros 100% · Lucro 100% · Caixa 72%

É o que torna o ranking auditável: o usuário vê *qual* pilar é o ponto fraco,
não apenas um número agregado.

### Desempate

Por **mais trimestres medidos** (mais evidência ganha), depois por ticker. A
ordenação precisa ser determinística para que duas cargas da mesma aba não
produzam listas diferentes.

### Point-in-time

Só entram trimestres cujo **carimbo de conhecimento já passou**: `data_ref` +
45 dias (ITR) ou + 90 dias (DFP, 4º trimestre). Reaproveita `knowledgeDateFor` e
`LEGAL_LAG_RULE` de `src/lib/server/cvm-fundamentals-derive.ts`, os mesmos que a
comparação setorial já usa. Sem isso o ranking usaria balanço que o mercado
ainda não viu.

### Coluna "recente" — o defeito que a média esconde

Uma empresa impecável de 2011 a 2018 e quebrada desde 2022 sai com escore
histórico alto: a média não sabe **quando** ela falhou. Para o que esta aba
afirma, isso é grave.

Correção **sem inventar pesos**: uma coluna separada com a taxa dos **últimos 8
trimestres publicados**, exibida ao lado do escore histórico e **jamais
misturada a ele**.

> **AAAA3 — histórico 0,91 · recente 0,40** ⚠

São duas afirmações verdadeiras e distintas; a divergência entre elas *é* a
informação. Dobrá-las num peso único destruiria justamente o que interessa.

Empresa com menos de 8 trimestres publicados exibe a coluna recente sobre os
que tiver, com a contagem visível — nunca extrapolada.

## Arquitetura

Segue o padrão já estabelecido por `src/lib/server/cvm-sector-ranking.ts`:
leitura direta do `cvm_fundamentos.db` com `node:sqlite` em modo somente
leitura, cálculo em TypeScript. **Sem Prisma, sem Python, sem ML Engine.**

```
src/lib/server/
  cvm-financial-health-rules.ts   PURO: avalia pilares, agrega escore. Zero I/O
  cvm-financial-health.ts         query + point-in-time + exclusões

src/app/api/cvm/financial-health/route.ts    GET -> ranking completo

src/components/saude/
  SaudeFinanceiraView.tsx    ÚNICO componente que faz fetch
  SaudeTable.tsx             linhas, pilares abertos, coluna recente
  ExclusoesPanel.tsx         18 financeiras + história curta, com razão

src/components/tabs/SaudeFinanceiraTab.tsx
src/app/page.tsx             nova TabId "saude"
```

### Por que `rules` separado do acesso a dados

Os limiares e a agregação são a única parte que pode estar **errada de forma
silenciosa** — um sinal invertido produz um ranking plausível e falso. Num
arquivo puro, os cinco pilares são testáveis com linhas fabricadas, sem banco e
sem servidor. É o que torna a seção de pilares verificável em vez de apenas
declarada.

O mesmo desenho de fronteira usado em `src/components/ranking/`: só a View
conhece rede; os filhos recebem dados por props e são testáveis isoladamente.

### Fora de escopo, por decisão

**Nenhuma tool MCP para o agente de IA nesta versão.** A aba de ranking de fator
já alimenta o trilho `trade.propose`; entregar ao agente um segundo ranking
agora convida as duas listas a se fundirem numa recomendação — precisamente o
risco descrito acima. Fica para depois, como decisão própria e não de arrasto.

Também fora: bloco separado para financeiras (ver seção seguinte), alteração de
qualquer tabela, migration ou modelo Prisma, e qualquer mudança na aba Ranking
Fundamentalista.

## Trabalho futuro: bloco das financeiras

O usuário informou que **coleta os dados diretamente da CVM**, onde as empresas
entregam os relatórios trimestrais — então índice de Basileia e inadimplência
existem na fonte; o que falta é extração, não modelagem.

Enquanto esses campos não estiverem no `fundamental_indicators`, um ranking de
saúde bancária só teria lucro e ROE — dois pilares contra cinco, apresentados
como se fossem a mesma coisa. Fachada. **Só depois da coleta.**

## Erros e estados honestos

| Situação | Comportamento |
|---|---|
| `cvm_fundamentos.db` ausente | Erro acionável com o caminho esperado (padrão de `cvm-legacy-db.ts`) |
| Empresa com < 20 trimestres | Fora do ranking, listada em "sem histórico suficiente para avaliar" |
| Empresa de setor financeiro | Fora do ranking, listada com a razão do setor |
| Trimestre sem nenhum pilar medido | Não conta; não vira zero |
| Nenhuma empresa qualificada | Estado honesto e explicado, nunca tabela vazia sem razão |

Zero nunca é fabricado como dado — o mesmo defeito que condenou a aba Opções.

## Testes

`npm run test:financial-health`, no padrão dos runners já existentes.

**Sobre `cvm-financial-health-rules.ts`, com dados fabricados:**

- cada limiar na fronteira: `liquidez_corrente` 0,99 reprova e 1,00 aprova;
  `divida_bruta_pl` 1,00 aprova e 1,01 reprova; `icj` 2,00 aprova e 1,99 reprova;
  `lucro_liquido` 0 reprova e 0,01 aprova; mesmo para `fco`
- pilar ausente não reprova e não aprova: trimestre com 4 medidos e 4 aprovados
  vale 1,0, não 0,8
- trimestre sem nenhum pilar medido é descartado, não conta como 0
- desempate: mesmo escore, mais trimestres primeiro; empate total, por ticker
- coluna recente com menos de 8 trimestres usa os disponíveis e reporta quantos

**Sobre o banco real (prova de fumaça):**

- nenhum ticker de bucket financeiro no resultado
- soma de ranqueadas + excluídas por setor + excluídas por história = universo
- todo escore dentro de [0, 1]
- nenhum trimestre usado tem carimbo de conhecimento no futuro

**Transversal:** `npx tsc --noEmit` e `npm run build` limpos.

## Verificação runtime

Receita de `.claude/skills/verify/SKILL.md`, com a adaptação usada nas
auditorias anteriores: servidor sobre **cópia** do `dev.db` (nunca o original),
`.env.local` temporário removido ao final, porta dedicada.

O `cvm_fundamentos.db` é aberto em modo somente leitura e pode ser o real.

Conferir na resposta: 117 empresas ranqueadas, ausência dos 18
tickers financeiros, pilares abertos por empresa, e a coluna recente presente e
distinta do escore histórico.
