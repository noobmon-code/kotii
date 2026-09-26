# Nooky

App da casa para a família toda: listas de compras, notas fiscais com comparativo de preços entre mercados, despensa com validade automática, tarefas domésticas e lembretes de remédio.

iOS e Android com Expo (React Native); a versão web sai do mesmo código depois. Backend no Supabase (login, banco com isolamento por família, fotos das notas e a função de leitura de nota por IA).

## O que já funciona

| Módulo | O que faz |
|---|---|
| **Família** | Conta por e-mail/senha. Quem cria a casa recebe um código de convite de 6 letras; quem entra com o código vê e edita tudo da casa. |
| **Notas fiscais** | Foto do cupom → a IA (Claude) lê mercado, CNPJ, data, chave de acesso e itens → tela de revisão → confirmar. Também dá para digitar à mão. Nota repetida (mesma chave NFC-e) é detectada. |
| **Produtos e matching** | Cada item da nota é ligado a um produto da família ("Arroz Tio João 5kg"). A IA sugere o produto; a descrição da nota vira um apelido, então a mesma descrição é reconhecida sozinha nas próximas notas. |
| **Onde comprar** | Para a lista de compras: melhor mercado único, ou dividir entre até 2 ou 3 mercados (você escolhe). Itens sem preço num mercado são estimados pelo nível de preço daquele mercado; itens sem preço nenhum ficam fora do total. |
| **Listas de compras** | Compartilhadas em tempo real (duas pessoas no mercado veem as marcações uma da outra). Autocompleta com produtos que já têm preço. |
| **Despensa** | Alimentada pelas notas confirmadas. Validade estimada sem digitar: aprendida do produto ou padrão da categoria. Corrigiu a validade? O produto aprende para a próxima compra. "Acabou" manda o item para a lista de mercado. |
| **Tarefas da casa** | Recorrência diária/semanal/mensal, responsável, próxima data calculada a partir de quando foi feita. |
| **Remédios** | Horários por pessoa (inclusive quem não tem conta, como filhos), checklist de doses do dia, lembrete por notificação escolhido em cada celular. |
| **Hoje** | Home que só mostra o que pede atenção: doses pendentes, tarefas atrasadas/de hoje, itens vencendo, notas para revisar. |

Ainda não entrou (ver roadmap): treino, dieta, exames, documentos, manutenção de equipamentos, scraper de NFC-e.

## Rodando pela primeira vez

Pré-requisitos: Node 20+, conta no [Supabase](https://supabase.com), chave da [API da Anthropic](https://console.anthropic.com) e o app **Expo Go** no celular.

1. **Crie um projeto no Supabase.**

2. **Crie o banco** (tabelas, regras de acesso por família, bucket das fotos):

   ```bash
   npx supabase login
   npx supabase link --project-ref SEU_PROJECT_REF
   npx supabase db push
   ```

3. **Publique a função de leitura de nota** e cadastre a chave da Anthropic:

   ```bash
   npx supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
   npx supabase functions deploy parse-receipt
   ```

4. **Login sem confirmação de e-mail (opcional, para testar rápido):** Authentication → Sign In / Providers → Email → desligue "Confirm email".

5. **Configure e rode o app:**

   ```bash
   cp .env.example .env   # preencha URL e anon key (Project Settings → API)
   npm install
   npx expo start         # escaneie o QR code com o Expo Go
   ```

## Custos e limites que você precisa saber

- **Leitura de nota por IA:** usa `claude-opus-5` por padrão. Estimativa por nota: US$ 0,05 a 0,20 (foto + lista de produtos da família + itens lidos; cresce com o tamanho da nota e do catálogo). Dá para trocar o modelo sem mexer no código: `npx supabase secrets set RECEIPT_MODEL=...`.
- **Uma foto por nota:** cupom muito comprido perde nitidez numa foto só. Várias fotos por nota está no roadmap.
- **Tempo de leitura:** 10–60 s dependendo do tamanho da nota; o app mostra uma tela de espera.
- **Unidades:** preço é comparado na unidade da nota. Se a lista pede "3 un" de banana e as notas têm preço por kg, o comparativo usa 1 kg e avisa que a quantidade é aproximada.
- **Lembretes de remédio:** notificações locais. No Expo Go podem ter limitações; num development build (`npx expo run:android` / EAS) funcionam completos. Na web não existem.

## Testes

```bash
npm test          # regras de negócio: recomendação de mercado, validade, datas, revisão de nota…
npm run test:db   # sobe um Postgres temporário e testa migrations + isolamento entre famílias (RLS)
npm run typecheck
npm run lint
```

A Edge Function é Deno: `cd supabase/functions/parse-receipt && deno test && deno check index.ts`.

## Estrutura

```
src/app/            telas (Expo Router): (tabs)/ Hoje, Casa, Notas, Saúde, Família; lista/, nota/, produto/…
src/domain/         regras de negócio puras e testadas (sem React, sem Supabase)
src/data/           consultas e mutações (React Query + Supabase)
src/features/       blocos de tela maiores (painéis da Casa, leitor de nota)
src/ui/             componentes visuais e tema claro/escuro
src/lib/            cliente Supabase, sessão/família, lembretes
supabase/migrations banco de dados e políticas de acesso
supabase/functions  parse-receipt: foto da nota → itens estruturados (Claude)
scripts/db/         teste local do banco
```

## Publicação nas lojas

Ainda falta definir: identificador do app (ex.: `com.suaempresa.nooky`) em `app.json`, ícone e splash definitivos, e contas de desenvolvedor Apple/Google. O build e o envio são feitos com EAS (`npx eas-cli build`, `npx eas-cli submit`).
