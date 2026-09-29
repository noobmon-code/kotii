# Nooky

App da casa para a família toda: listas de compras, notas fiscais com comparativo de preços entre mercados, despensa com validade automática, tarefas domésticas, saúde (remédios, consultas, vacinas, exames, treino e dieta) e finanças (gastos do mês e contas a pagar).

iOS e Android com Expo (React Native); a versão web sai do mesmo código depois. Backend no Supabase (login, banco com isolamento por família, fotos e as funções de leitura por IA).

## O que já funciona

| Módulo | O que faz |
|---|---|
| **Família** | Conta por e-mail/senha. Quem cria a casa recebe um código de convite de 6 letras; quem entra com o código vê e edita tudo da casa. |
| **Notas fiscais** | Pelo QR code da NFC-e: o app lê o QR (ou o link colado) e busca na consulta pública da Sefaz mercado, data, total e itens exatos, sem IA. Pela foto do cupom: a IA lê mercado, CNPJ, data, chave de acesso e itens; nota comprida vai em até 4 fotos (pela câmera, uma parte de cada vez, ou várias da galeria), lidas juntas sem repetir o que aparece em duas. Nos dois casos, tela de revisão → confirmar. Também dá para digitar à mão. Nota repetida (mesma chave NFC-e) é detectada. Alerta de preço: na revisão (e depois, na nota salva), cada item ligado a um produto é comparado com o que a casa pagou nos últimos meses — avisa quando outro mercado vendia pelo menos 10% mais barato há até 60 dias, ou quando o preço ficou 15% acima do costume, e soma quanto daria para economizar. |
| **Produtos e matching** | Cada item da nota é ligado a um produto da família ("Arroz Tio João 5kg"). A IA sugere o produto; a descrição da nota vira um apelido, então a mesma descrição é reconhecida sozinha nas próximas notas. |
| **Onde comprar** | Para a lista de compras: melhor mercado único, ou dividir entre até 2 ou 3 mercados (você escolhe). Itens sem preço num mercado são estimados pelo nível de preço daquele mercado; itens sem preço nenhum ficam fora do total. |
| **Listas de compras** | Grade com o desenho de cada item (ou a foto do produto); um toque põe no carrinho. Segurar o item abre os detalhes: foto do produto certo, descrição e prioridade (normal, urgente, só em promoção ou se der, com as quatro opções à vista); os urgentes sobem para o topo e os outros ganham um selo. Detalhes mudados sem internet vão pela mesma fila das marcações; a foto fica guardada no aparelho e sobe quando a conexão volta, e a foto trocada ou de item que saiu da lista é apagada do storage. Compartilhadas em tempo real (duas pessoas no mercado veem as marcações uma da outra) e funcionam sem internet: a lista fica guardada no aparelho e as marcações feitas offline vão quando a conexão volta, mesmo se o app for fechado no meio. "Comprados recentemente" mostra o que a casa mais compra (carrinhos limpos, itens no carrinho e notas confirmadas dos últimos 90 dias), com a quantidade de sempre: um toque põe na lista. "Acho que acabou" (na lista e na tela Hoje) avisa o que já passou do intervalo em que a casa costuma comprar — mediana entre as idas ao mercado nos últimos 6 meses, a partir de 3 compras. Catálogo com mais de 200 itens comuns da casa por categoria, para montar a lista sem digitar: um toque põe o item na lista, outro tira (item com descrição, foto ou prioridade pergunta antes); ao digitar, sugere primeiro produtos que já têm preço e depois itens do catálogo. |
| **Cardápio da semana** | Almoço e jantar de segunda a domingo (Casa → Compras → "Cardápio da semana"; no domingo já abre a semana seguinte). "Montar com o Nuke" sugere a semana usando primeiro a despensa e o que vence logo, respeitando as preferências digitadas, e diz o que falta comprar: a pessoa confere, usa o cardápio e põe os ingredientes na lista com um toque. Cada prato pode ser trocado à mão. O cardápio de hoje aparece na tela Hoje, e o Nuke sabe o que tem para comer. |
| **Despensa** | Alimentada pelas notas confirmadas e pelo carrinho: a geladeira de cada item no carrinho guarda aquele item, e "Limpar" guarda o carrinho todo, sempre conferindo a quantidade comprada. Nota que chega depois pergunta antes de repetir o que já foi para a despensa numa compra de até 3 dias de diferença. Validade estimada sem digitar: aprendida do produto ou padrão da categoria. Corrigiu a validade? O produto aprende para a próxima compra. "Acabou" manda o item para a lista de mercado. |
| **Tarefas da casa** | Recorrência diária/semanal/mensal, responsável, próxima data calculada a partir de quando foi feita. |
| **Pontos das crianças** | A tarefa pode ser de uma criança (ficha sem conta no app) e valer pontos: quem marcar como feita credita a criança, com um "+10 pontos para a Lia!". Casa → Tarefas → "Pontos das crianças" mostra o saldo, o que ganhou na semana, as tarefas que valem pontos e o histórico; "Trocar pontos por prêmio" registra o sorvete ou o passeio combinado. O saldo também aparece na aba Família. |
| **Aparelhos** | Ar-condicionado, geladeira, carro, caixa d'água…: marca, modelo, onde fica, fotos da nota/garantia/manual e garantia com aviso quando está acabando. Manutenções são tarefas recorrentes ligadas ao aparelho, com sugestões prontas (limpar filtro, trocar refil, revisão) e histórico. |
| **Documentos** | RG, CNH, passaporte, seguro, contrato, IPTU… por pessoa ou da casa, com fotos, número e validade. Avisa na tela Hoje com a antecedência escolhida (passaporte começa 6 meses antes). Fotos ficam num bucket privado da família e não passam por IA. |
| **Pessoas e pets** | Cada morador ganha sua ficha automaticamente; quem não usa o app (filhos, idosos, dependentes) e os pets entram pela aba Família, em "Sem celular". Ficha com nascimento, tipo sanguíneo, alergias, condições e plano de saúde. Quem entra na família com o mesmo nome de um dependente assume a ficha dele. |
| **Remédios** | Por pessoa: quantas vezes por dia (horários espaçados sozinhos, ajustáveis), regularidade (todo dia, dias da semana, a cada X dias ou uma vez por mês) e duração (uso contínuo, por X dias ou por número de doses, que acaba quando a última é tomada). Checklist de doses do dia e lembrete por notificação escolhido em cada celular (semanal repete sozinho; a cada X dias e mensal ficam agendados dose a dose, até 2 meses à frente). |
| **Consultas e vacinas** | Agenda de consultas (pergunta se a consulta passada foi realizada), carteira de vacinas com próxima dose e aviso de dose atrasada ou chegando. |
| **Exames** | Fotos do pedido ou do laudo; a IA transcreve data, laboratório e resultados como impressos (valor, unidade, referência, marcação do laudo). Não interpreta nada. |
| **Treino** | Foto da ficha do profissional → a IA organiza treinos e exercícios (séries, repetições, carga, descanso) → rascunho para revisar → ativar. Treino do dia por dia da semana ou na sequência A/B/C, marcação de feito e histórico. |
| **Dieta** | Foto do plano da nutricionista → refeições, opções e orientações → lista de compras da dieta, que vai para a lista de mercado sem repetir o que já está nela. |
| **Gastos do mês** | Aba Finanças → Resumo: total do mês, comparação com o mês anterior (no mês corrente, só até o mesmo dia), últimos 6 meses, gasto por categoria e onde mais gastou. Junta notas confirmadas (cada item vai para a sua categoria: o arroz em Mercado, o detergente em Limpeza), contas pagas e gastos avulsos sem nota. Tocar numa categoria filtra os lançamentos. |
| **Orçamento** | Limite do mês por categoria de gasto (Finanças → Resumo → Orçamento), com o gasto do mês passado como referência. Barras de quanto já foi, aviso na tela Hoje quando passa de 80% ou estoura, e o Nuke sabe dos limites. |
| **Divisão da casa** | Com dois moradores ou mais, gasto, conta paga e nota guardam quem pagou ("Quem pagou" nos formulários; padrão: quem registrou). Finanças → Resumo mostra, no mês, quanto cada um pagou, a parte de cada um (igual ou por peso, em "Como dividir") e quem passa quanto para quem, com o menor número de transferências. "Acertei" registra o Pix entre os moradores (dá para desfazer). |
| **Despesas médicas (IR)** | Gastos de saúde e contas (como o plano de saúde) podem ser marcados como dedutíveis, com quem atendeu, o CPF ou CNPJ (dígitos conferidos) e, nos gastos, o paciente. Finanças → Resumo → "Despesas médicas para o IR" mostra o ano por prestador, com total, pacientes e lançamentos, avisa quem está sem CPF/CNPJ e copia um resumo para a declaração. |
| **Contas a pagar** | Aluguel, condomínio, luz, internet, escola, assinaturas: valor fixo ou variável, mensal, anual ou única, débito automático. O check registra o pagamento (valor e data) e passa para o próximo vencimento; dia 31 vira o último dia nos meses curtos. Se outra pessoa da casa já pagou, não paga de novo. Histórico com desfazer do último pagamento. Atrasadas e as que vencem em até 3 dias aparecem na tela Hoje. Boleto pela câmera (código de barras) ou colando a linha digitável: os dígitos verificadores são conferidos (bancário e concessionárias/tributos) e o app preenche valor, vencimento, banco ou tipo de conta; o código fica guardado para copiar no app do banco e sai quando a conta é paga. |
| **Nuke** | O assistente da casa: uma bolha de vidro com cores pastel por dentro, no canto das abas. Flutua, pisca, olha em volta; pensando, as cores giram e a luz pulsa; fala mexendo a boca, pula de alegria quando uma ação dá certo e fica preocupado quando algo falha. Responde sobre o que está no app (o que vence, o que falta comprar, quanto foi gasto, o que dá para cozinhar com a despensa) e sugere ações — pôr itens na lista, criar tarefa, registrar gasto, abrir uma tela — que só acontecem quando você toca em "Fazer". A conversa fica no celular. |
| **Agenda** | Calendário do mês (aberto pela tela Hoje) com consultas, vacinas, contas, tarefas, manutenções, documentos e garantias; contas e tarefas que se repetem aparecem apagadas nas próximas datas, como previsão. Tocar num compromisso abre o item. |
| **Hoje** | Home que só mostra o que pede atenção: doses pendentes, treino do dia, consultas de hoje/amanhã, vacinas atrasadas, tarefas e manutenções, contas vencendo, itens vencendo, documentos a renovar, garantias acabando, notas e planos para revisar. |
| **Avisos da casa** | No app instalado, cada pessoa escolhe na aba Família que avisos quer receber no próprio celular (às 9h, fora as consultas): contas (véspera e dia do vencimento; em aberto, um aviso só), documentos (quando começa o prazo de renovar, uma semana antes e no dia em que vence), tarefas e manutenções (no dia), consultas (na véspera às 19h e 2 horas antes, nunca antes das 7h) e vacinas (uma semana antes da próxima dose e no dia; atrasada, um aviso só). Ficam com o espaço que os lembretes de remédio deixam no limite de avisos agendados do iPhone. Refeitos ao abrir o app, para os próximos 30 dias. |

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
   # OpenRouter (modelo padrão: deepseek/deepseek-v4.1-flash, lê texto e imagem)
   npx supabase secrets set OPENROUTER_API_KEY=sk-or-...
   # ou Anthropic (modelo padrão: claude-opus-5)
   npx supabase secrets set ANTHROPIC_API_KEY=sk-ant-...

   npx supabase functions deploy parse-receipt
   npx supabase functions deploy parse-health
   npx supabase functions deploy nuke
   npx supabase functions deploy leave-household
   npx supabase functions deploy nfce   # nota pelo QR code (sem IA)
   ```

   Com a chave da OpenRouter, ela é usada em tudo (leitura de notas, de saúde e o Nuke), com o `deepseek/deepseek-v4.1-flash`; a Anthropic só entra com a chave dela sozinha ou com `RECEIPT_PROVIDER=anthropic`. O modelo pode ser trocado com `RECEIPT_MODEL` (na OpenRouter, precisa ser um modelo que aceita imagem). A leitura de saúde (`parse-health`) usa as mesmas configurações, ou `HEALTH_PROVIDER` e `HEALTH_MODEL` se quiser um modelo diferente para ela. O Nuke (`nuke`) também, ou `NUKE_PROVIDER` e `NUKE_MODEL`.

   **Limpeza das fotos.** Quando a última pessoa sai e apaga a casa, `leave-household` apaga as fotos dela na hora; se o Storage falhar, a casa fica numa fila que o `pg_cron` reprocessa de hora em hora. Para isso, o banco precisa da URL do projeto e da chave anon no Vault. Rode uma vez no SQL Editor:

   ```sql
   select vault.create_secret('https://SEU_PROJECT_REF.supabase.co', 'project_url');
   select vault.create_secret('SUA_ANON_KEY', 'anon_key');
   ```

   Sem esses segredos, o `db push` avisa e o job registra o erro em `cron.job_run_details`.

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

1. O projeto já existe na Expo (conta `Noobmon`; o Project ID está em `extra.eas.projectId` no `app.json`). No computador, com o repositório clonado e atualizado:

   ```bash
   npm install
   npx eas-cli@latest login   # com a conta Noobmon
   ```
2. No projeto da Expo, em *Environment variables*, cadastre `EXPO_PUBLIC_SUPABASE_URL` e `EXPO_PUBLIC_SUPABASE_ANON_KEY` (os mesmos valores do `.env`) para os ambientes *preview* e *production*, como texto normal: variável secreta não entra no build, e esses dois valores vão de qualquer jeito dentro do app. O `.env` não vai para o build na nuvem.
3. Gere o APK:

   ```bash
   npx eas-cli@latest build --platform android --profile preview
   ```

   No fim sai um link do APK: abra no celular, instale e mande o link para a família. O perfil `production` gera o pacote da Play Store.

**iPhone.** Instalar o app nativo exige conta Apple Developer (US$ 99/ano): com ela, o app vai para os celulares pelo TestFlight e, depois, para a App Store. Sem a conta, instale a versão web: no Safari, *Compartilhar → Adicionar à Tela de Início* (a tela Hoje mostra esse passo a passo). Ela abre em tela cheia, com o ícone do Nooky, e abre mesmo sem internet. Na web não há lembrete por notificação; o resto funciona.

**Versão web (Vercel).** O `vercel.json` já diz como gerar o site (`expo export`). No projeto da Vercel, em *Settings → Environment Variables*, cadastre as mesmas duas variáveis `EXPO_PUBLIC_*` como texto normal (não secretas) e publique de novo. O site é instalável (PWA): `public/index.html` é o modelo da página, com o manifesto (`public/manifest.webmanifest`), os ícones (`public/icons/`) e o service worker (`public/sw.js`), que guarda o app no aparelho; no Android, o Chrome oferece "Instalar" e a tela Hoje tem o botão.

Identificador do app: `com.noobmon.nooky` (iOS e Android). Dá para trocar até o primeiro envio para as lojas; depois fica fixo.

## Custos e limites que você precisa saber

- **Leitura de nota por IA (Anthropic):** `claude-opus-5` por padrão. Estimativa por nota: US$ 0,05 a 0,20 (foto + lista de produtos da família + itens lidos; cresce com o tamanho da nota e do catálogo). Dá para trocar o modelo sem mexer no código: `npx supabase secrets set RECEIPT_MODEL=...`.
- **Leitura de nota por IA (OpenRouter):** `deepseek/deepseek-v4.1-flash` por padrão (US$ 0,035 por milhão de tokens de entrada e US$ 0,29 de saída): frações de centavo por nota. A tela de revisão existe para corrigir; se a precisão incomodar, troque o `RECEIPT_MODEL`. Evite modelos `:free`: têm limite de chamadas e podem registrar o conteúdo enviado.
- **Documentos de saúde:** fichas, dietas e exames são dados de saúde. Na OpenRouter, a política de dados depende do provedor que atende o modelo; nas configurações de privacidade da conta dá para bloquear provedores que guardam ou treinam com o conteúdo. Para isolar saúde, use `HEALTH_MODEL` ou a Anthropic (`HEALTH_PROVIDER=anthropic`). Até 6 fotos por leitura.
- **Nota comprida:** até 4 fotos por nota, lidas juntas numa nota só (pela câmera, uma parte de cada vez; pela galeria, várias de uma vez). Vale deixar um pedaço repetido entre as fotos.
- **Nuke:** cada mensagem manda para a IA um retrato compacto da casa (poucos milhares de tokens) e as últimas falas, com esforço baixo para responder rápido. Com a OpenRouter (`deepseek/deepseek-v4.1-flash`), frações de centavo por mensagem; com a Anthropic (claude-opus-5), algo como US$ 0,02 a 0,05. Dá para trocar o modelo com `NUKE_MODEL`.
- **Limite de IA por casa:** por mês (fuso de Brasília), 300 mensagens com o Nuke, 100 leituras de foto (notas e saúde) e 20 cardápios. As funções conferem no banco (`use_ai`) antes de chamar a IA e devolvem o uso se a IA falhar; no limite, a pessoa vê o aviso e o QR code da nota continua funcionando. A aba Família mostra o uso do mês. Para mudar os números, uma migração nova troca `ai_limit`.
- **Tempo de leitura:** 10–60 s dependendo do tamanho da nota; o app mostra uma tela de espera.
- **Unidades:** preço é comparado na unidade da nota. Se a lista pede "3 un" de banana e as notas têm preço por kg, o comparativo usa 1 kg e avisa que a quantidade é aproximada.
- **Avisos por notificação:** remédios, contas, documentos, tarefas e manutenções, consultas e vacinas.
- **Gastos:** o resumo conta o que foi registrado no app (notas confirmadas, contas pagas, gastos avulsos). Nota em rascunho não entra até ser confirmada.
- **Lembretes de remédio:** notificações locais. No Expo Go podem ter limitações; num development build (`npx expo run:android` / EAS) funcionam completos. Na web não existem.

## Testes

```bash
npm test          # regras de negócio: recomendação de mercado, validade, datas, revisão de nota…
npm run test:db   # sobe um Postgres temporário e testa migrations + isolamento entre famílias (RLS)
npm run typecheck
npm run lint
```

As Edge Functions são Deno: em `supabase/functions/_shared`, `parse-receipt`, `parse-health`, `leave-household` e `nfce`, rode `deno test && deno check index.ts` (em `_shared`, `deno check vision.ts`).

## Identidade visual

Na linha do Headspace, com um toque de vidro: fundo creme de dia e azul profundo à noite, com manchas pastel suaves (as cores do Nuke) atrás de cartões translúcidos de borda clara e sombra suave; cartões bem arredondados, botões em pílula, fonte Nunito e personagens redondos com rosto simples. Cores (inclusive as de vidro), tons dos cartões, sombras, fontes e raios ficam em `src/ui/theme.ts`; o fundo em `src/ui/Backdrop.tsx`; as ilustrações (personagens, sol e lua da tela Hoje, logo) em `src/ui/art.tsx`; o Nuke em `src/ui/NukeArt.tsx` (partes e versão parada) e `src/ui/NukeLive.tsx` (animado). Ícone, ícone adaptativo do Android e splash usam o mesmo personagem laranja.

As categorias de produto (lista de compras, despensa, notas, preços) têm ilustrações próprias em `assets/categories/` (WebP 144px, fundo transparente), ligadas em `src/ui/categoryArt.ts` com a cor do círculo de fundo. Categoria nova precisa de imagem nova: um teste falha se faltar.

Os itens mais comprados (81, de banana a saco de lixo) têm desenho próprio em `assets/items/`, escolhido pelo nome do item com as regras de `src/domain/itemArt.ts` ("Leite Italac 1L" vira o leite, "Suco de laranja" o suco). Sem regra que case, fica o desenho da categoria.

## Estrutura

```
src/app/            telas (Expo Router): (tabs)/ Hoje, Casa, Finanças, Saúde, Família; lista/, nota/, conta/, gasto/, treino/…
src/domain/         regras de negócio puras e testadas (sem React, sem Supabase)
src/data/           consultas e mutações (React Query + Supabase)
src/features/       blocos de tela maiores (painéis da Casa, da Saúde e das Finanças, leitor de nota, importação de planos)
src/ui/             componentes visuais, tema claro/escuro e ilustrações
src/lib/            cliente Supabase, sessão/família, lembretes
supabase/migrations banco de dados e políticas de acesso
supabase/functions  parse-receipt (nota → itens), parse-health (ficha, dieta, exame → dados), nuke (assistente), leave-household (sair da casa; apaga as fotos de casas apagadas, também de hora em hora pelo pg_cron), nfce (nota pelo QR code, lida na Sefaz); _shared/vision.ts e _shared/chat.ts falam com a IA
scripts/db/         teste local do banco
```

## Publicação nas lojas

Ainda falta definir: ícone e splash definitivos, e contas de desenvolvedor Apple (US$ 99/ano) e Google (US$ 25, uma vez). O build e o envio são feitos com EAS (`npx eas-cli@latest build`, `npx eas-cli@latest submit`).
