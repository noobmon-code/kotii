# Nooky

App da casa para a família toda: listas de compras, notas fiscais com comparativo de preços entre mercados, despensa com validade automática, tarefas domésticas, saúde (remédios, consultas, vacinas, exames, treino e dieta) e finanças (gastos do mês e contas a pagar).

iOS e Android com Expo (React Native); a versão web sai do mesmo código depois. Backend no Supabase (login, banco com isolamento por família, fotos e as funções de leitura por IA).

## O que já funciona

| Módulo | O que faz |
|---|---|
| **Família** | Conta por e-mail/senha. Quem cria a casa recebe um código de convite de 6 letras; quem entra com o código vê e edita tudo da casa. |
| **Notas fiscais** | Foto do cupom → a IA (Claude) lê mercado, CNPJ, data, chave de acesso e itens → tela de revisão → confirmar. Também dá para digitar à mão. Nota repetida (mesma chave NFC-e) é detectada. |
| **Produtos e matching** | Cada item da nota é ligado a um produto da família ("Arroz Tio João 5kg"). A IA sugere o produto; a descrição da nota vira um apelido, então a mesma descrição é reconhecida sozinha nas próximas notas. |
| **Onde comprar** | Para a lista de compras: melhor mercado único, ou dividir entre até 2 ou 3 mercados (você escolhe). Itens sem preço num mercado são estimados pelo nível de preço daquele mercado; itens sem preço nenhum ficam fora do total. |
| **Listas de compras** | Compartilhadas em tempo real (duas pessoas no mercado veem as marcações uma da outra). Catálogo com mais de 200 itens comuns da casa por categoria, para montar a lista sem digitar; ao digitar, sugere primeiro produtos que já têm preço e depois itens do catálogo. |
| **Despensa** | Alimentada pelas notas confirmadas. Validade estimada sem digitar: aprendida do produto ou padrão da categoria. Corrigiu a validade? O produto aprende para a próxima compra. "Acabou" manda o item para a lista de mercado. |
| **Tarefas da casa** | Recorrência diária/semanal/mensal, responsável, próxima data calculada a partir de quando foi feita. |
| **Aparelhos** | Ar-condicionado, geladeira, carro, caixa d'água…: marca, modelo, onde fica, fotos da nota/garantia/manual e garantia com aviso quando está acabando. Manutenções são tarefas recorrentes ligadas ao aparelho, com sugestões prontas (limpar filtro, trocar refil, revisão) e histórico. |
| **Documentos** | RG, CNH, passaporte, seguro, contrato, IPTU… por pessoa ou da casa, com fotos, número e validade. Avisa na tela Hoje com a antecedência escolhida (passaporte começa 6 meses antes). Fotos ficam num bucket privado da família e não passam por IA. |
| **Pessoas e pets** | Cada morador ganha sua ficha automaticamente; filhos, dependentes e pets são cadastrados à parte. Ficha com nascimento, tipo sanguíneo, alergias, condições e plano de saúde. Quem entra na família com o mesmo nome de um dependente assume a ficha dele. |
| **Remédios** | Horários por pessoa, checklist de doses do dia, lembrete por notificação escolhido em cada celular. |
| **Consultas e vacinas** | Agenda de consultas (pergunta se a consulta passada foi realizada), carteira de vacinas com próxima dose e aviso de dose atrasada ou chegando. |
| **Exames** | Fotos do pedido ou do laudo; a IA transcreve data, laboratório e resultados como impressos (valor, unidade, referência, marcação do laudo). Não interpreta nada. |
| **Treino** | Foto da ficha do profissional → a IA organiza treinos e exercícios (séries, repetições, carga, descanso) → rascunho para revisar → ativar. Treino do dia por dia da semana ou na sequência A/B/C, marcação de feito e histórico. |
| **Dieta** | Foto do plano da nutricionista → refeições, opções e orientações → lista de compras da dieta, que vai para a lista de mercado sem repetir o que já está nela. |
| **Gastos do mês** | Aba Finanças → Resumo: total do mês, comparação com o mês anterior (no mês corrente, só até o mesmo dia), últimos 6 meses, gasto por categoria e onde mais gastou. Junta notas confirmadas (cada item vai para a sua categoria: o arroz em Mercado, o detergente em Limpeza), contas pagas e gastos avulsos sem nota. Tocar numa categoria filtra os lançamentos. |
| **Contas a pagar** | Aluguel, condomínio, luz, internet, escola, assinaturas: valor fixo ou variável, mensal, anual ou única, débito automático. O check registra o pagamento (valor e data) e passa para o próximo vencimento; dia 31 vira o último dia nos meses curtos. Se outra pessoa da casa já pagou, não paga de novo. Histórico com desfazer do último pagamento. Atrasadas e as que vencem em até 3 dias aparecem na tela Hoje. |
| **Hoje** | Home que só mostra o que pede atenção: doses pendentes, treino do dia, consultas de hoje/amanhã, vacinas atrasadas, tarefas e manutenções, contas vencendo, itens vencendo, documentos a renovar, garantias acabando, notas e planos para revisar. |

Ainda não entrou (ver roadmap): scraper de NFC-e, lembretes por notificação para contas, documentos e manutenções, orçamento por categoria.

## Rodando pela primeira vez

Pré-requisitos: Node 20+, conta no [Supabase](https://supabase.com), chave da [API da Anthropic](https://console.anthropic.com) e o app **Expo Go** no celular.

1. **Crie um projeto no Supabase.**

2. **Crie o banco** (tabelas, regras de acesso por família, bucket das fotos):

   ```bash
   npx supabase login
   npx supabase link --project-ref SEU_PROJECT_REF
   npx supabase db push
   ```

3. **Publique as funções de leitura por IA** e cadastre a chave de **um** dos provedores:

   ```bash
   # Anthropic (modelo padrão: claude-opus-5)
   npx supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
   # ou OpenRouter (modelo padrão: google/gemma-4-31b-it:free)
   npx supabase secrets set OPENROUTER_API_KEY=sk-or-...

   npx supabase functions deploy parse-receipt
   npx supabase functions deploy parse-health
   ```

   Com só a chave da OpenRouter, ela é usada automaticamente. Com as duas, vale a Anthropic, a menos que `RECEIPT_PROVIDER=openrouter`. O modelo pode ser trocado com `RECEIPT_MODEL` (na OpenRouter, precisa ser um modelo que aceita imagem). A leitura de saúde (`parse-health`) usa as mesmas configurações, ou `HEALTH_PROVIDER` e `HEALTH_MODEL` se quiser um modelo diferente para ela.

4. **Login sem confirmação de e-mail (opcional, para testar rápido):** Authentication → Sign In / Providers → Email → desligue "Confirm email".

5. **Configure e rode o app:**

   ```bash
   cp .env.example .env   # preencha URL e anon key (Project Settings → API)
   npm install
   npx expo start         # escaneie o QR code com o Expo Go
   ```

## Usar sem o computador ligado

O backend já roda na nuvem (Supabase). O `npx expo start` só serve o código do app durante o desenvolvimento; para usar no dia a dia, o app precisa estar instalado com o código dentro dele.

**Android: APK instalável (grátis).** O build é feito na nuvem pelo EAS, da Expo.

1. Crie uma conta em [expo.dev](https://expo.dev) e um projeto com o slug `nooky`. Coloque o *Project ID* em `app.json` (`expo.extra.eas.projectId`).
2. No projeto da Expo, em *Environment variables*, cadastre `EXPO_PUBLIC_SUPABASE_URL` e `EXPO_PUBLIC_SUPABASE_ANON_KEY` (os mesmos valores do `.env`) para os ambientes *preview* e *production*. O `.env` não vai para o build na nuvem.
3. No computador:

   ```bash
   npx eas-cli login
   npx eas-cli build --platform android --profile preview
   ```

   No fim sai um link do APK: abra no celular, instale e mande o link para a família. O perfil `production` gera o pacote da Play Store.

**iPhone.** Instalar o app nativo exige conta Apple Developer (US$ 99/ano): com ela, o app vai para os celulares pelo TestFlight e, depois, para a App Store. Sem a conta, use a versão web (abaixo) e, no Safari, *Compartilhar → Adicionar à Tela de Início*. Na web não há lembrete por notificação; o resto funciona.

**Versão web (Vercel).** O `vercel.json` já diz como gerar o site (`expo export`). No projeto da Vercel, em *Settings → Environment Variables*, cadastre as mesmas duas variáveis `EXPO_PUBLIC_*` e publique de novo.

Identificador do app: `com.noobmon.nooky` (iOS e Android). Dá para trocar até o primeiro envio para as lojas; depois fica fixo.

## Custos e limites que você precisa saber

- **Leitura de nota por IA (Anthropic):** `claude-opus-5` por padrão. Estimativa por nota: US$ 0,05 a 0,20 (foto + lista de produtos da família + itens lidos; cresce com o tamanho da nota e do catálogo). Dá para trocar o modelo sem mexer no código: `npx supabase secrets set RECEIPT_MODEL=...`.
- **Leitura de nota por IA (OpenRouter):** `google/gemma-4-31b-it:free` por padrão. Modelos `:free` não custam, mas têm limite de chamadas por minuto/dia, podem registrar o conteúdo enviado (as fotos das notas) e tendem a errar mais em cupons longos. A tela de revisão existe para corrigir; se a precisão incomodar, troque o `RECEIPT_MODEL`.
- **Documentos de saúde e modelos gratuitos:** fichas, dietas e exames são dados de saúde. Modelos `:free` da OpenRouter podem guardar o que recebem; para saúde, prefira um modelo pago sem retenção (`HEALTH_MODEL`) ou a Anthropic (`HEALTH_PROVIDER=anthropic`). Até 6 fotos por leitura.
- **Uma foto por nota:** cupom muito comprido perde nitidez numa foto só. Várias fotos por nota está no roadmap.
- **Tempo de leitura:** 10–60 s dependendo do tamanho da nota; o app mostra uma tela de espera.
- **Unidades:** preço é comparado na unidade da nota. Se a lista pede "3 un" de banana e as notas têm preço por kg, o comparativo usa 1 kg e avisa que a quantidade é aproximada.
- **Lembretes de consulta, vacina e conta:** por enquanto aparecem na tela Hoje; notificação só existe para remédio.
- **Gastos:** o resumo conta o que foi registrado no app (notas confirmadas, contas pagas, gastos avulsos). Nota em rascunho não entra até ser confirmada.
- **Lembretes de remédio:** notificações locais. No Expo Go podem ter limitações; num development build (`npx expo run:android` / EAS) funcionam completos. Na web não existem.

## Testes

```bash
npm test          # regras de negócio: recomendação de mercado, validade, datas, revisão de nota…
npm run test:db   # sobe um Postgres temporário e testa migrations + isolamento entre famílias (RLS)
npm run typecheck
npm run lint
```

As Edge Functions são Deno: em `supabase/functions/_shared`, `parse-receipt` e `parse-health`, rode `deno test && deno check index.ts` (em `_shared`, `deno check vision.ts`).

## Estrutura

```
src/app/            telas (Expo Router): (tabs)/ Hoje, Casa, Finanças, Saúde, Família; lista/, nota/, conta/, gasto/, treino/…
src/domain/         regras de negócio puras e testadas (sem React, sem Supabase)
src/data/           consultas e mutações (React Query + Supabase)
src/features/       blocos de tela maiores (painéis da Casa, da Saúde e das Finanças, leitor de nota, importação de planos)
src/ui/             componentes visuais e tema claro/escuro
src/lib/            cliente Supabase, sessão/família, lembretes
supabase/migrations banco de dados e políticas de acesso
supabase/functions  parse-receipt (nota → itens), parse-health (ficha, dieta, exame → dados); _shared/vision.ts fala com a IA
scripts/db/         teste local do banco
```

## Publicação nas lojas

Ainda falta definir: ícone e splash definitivos, e contas de desenvolvedor Apple (US$ 99/ano) e Google (US$ 25, uma vez). O build e o envio são feitos com EAS (`npx eas-cli build`, `npx eas-cli submit`).
