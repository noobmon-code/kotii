# Kotii

App da casa para a família toda: listas de compras, notas fiscais com comparativo de preços entre mercados, despensa com validade automática, tarefas domésticas, saúde (remédios, consultas, vacinas, exames, treino e dieta) e finanças (gastos do mês e contas a pagar).

iOS e Android com Expo (React Native); a versão web sai do mesmo código depois. Backend no Supabase (login, banco com isolamento por família, fotos e as funções de leitura por IA).

## O que já funciona

| Módulo | O que faz |
|---|---|
| **Família** | Conta por e-mail/senha. Quem cria a casa recebe um código de convite de 6 letras; quem entra com o código vê e edita tudo da casa. |
| **Várias casas** | Uma conta pode estar em até 5 casas (a sua, a da praia, a dos pais…), cada uma com os próprios moradores, listas, contas e tarefas. O celular mostra uma por vez: com mais de uma, o nome da casa aberta fica no topo da tela Hoje e troca com um toque (Família → Suas casas, onde também dá para criar ou entrar em outra). Cada aparelho lembra a sua; um aparelho novo abre na mais recente. Os avisos (remédios, contas, tarefas, clima) chegam de todas, com o nome da casa no aviso. |
| **Avisos no navegador** | A versão web também recebe os avisos (remédios, contas, documentos, tarefas, consultas, vacinas e clima), mesmo fechada: Família → "Avisos neste navegador". O navegador guarda a agenda no servidor e a função `send-push` entrega cada aviso na hora (Web Push). No iPhone, com o app na tela de início (iOS 16.4 ou mais novo). Sair da conta tira os avisos daquele aparelho. |
| **Notas fiscais** | Pelo QR code da NFC-e: o app lê o QR (ou o link colado) e busca na consulta pública da Sefaz mercado, data, total e itens exatos, sem IA. Sefaz que pedem CAPTCHA (como a da Paraíba) não dão para ler pelo QR code: o app manda a pessoa para a leitura pela foto e guarda a chave de acesso para não duplicar a nota. Pela foto do cupom: a IA lê mercado, CNPJ, data, chave de acesso e itens; nota comprida vai em até 4 fotos (pela câmera, uma parte de cada vez, ou várias da galeria), lidas juntas sem repetir o que aparece em duas. Nos dois casos, tela de revisão → confirmar. Também dá para digitar à mão. Nota repetida (mesma chave NFC-e) é detectada. Alerta de preço: na revisão (e depois, na nota salva), cada item ligado a um produto é comparado com o que a casa pagou nos últimos meses — avisa quando outro mercado vendia pelo menos 10% mais barato há até 60 dias, ou quando o preço ficou 15% acima do costume, e soma quanto daria para economizar. |
| **Produtos e matching** | Cada item da nota é ligado a um produto da família ("Arroz Tio João 5kg"). A IA sugere o produto; a descrição da nota vira um apelido, então a mesma descrição é reconhecida sozinha nas próximas notas. Ao confirmar a nota, os itens das listas abertas que a compra cumpriu saem da lista (estando no carrinho ou não): mesmo produto e ligações já confirmadas vêm marcados, nome parecido ("Cebola" e "Cebola Granel 600g") vem como sugestão, e dá para ligar qualquer item à mão. Cada ligação fica guardada (nome da lista → produto, como "Refrigerante" → Coca-Cola Zero), e a próxima nota já vem marcada; o carrinho usa as mesmas ligações para não repetir na despensa o que a nota já guardou. |
| **Onde comprar** | Para a lista de compras: melhor mercado único, ou dividir entre até 2 ou 3 mercados (você escolhe). Itens sem preço num mercado são estimados pelo nível de preço daquele mercado; itens sem preço nenhum ficam fora do total. |
| **Listas de compras** | Grade com o desenho de cada item (ou a foto do produto); um toque põe no carrinho. Segurar o item abre os detalhes: foto do produto certo, descrição e prioridade (normal, urgente, só em promoção ou se der, com as quatro opções à vista); os urgentes sobem para o topo e os outros ganham um selo. Detalhes mudados sem internet vão pela mesma fila das marcações; a foto fica guardada no aparelho e sobe quando a conexão volta, e a foto trocada ou de item que saiu da lista é apagada do storage. Compartilhadas em tempo real (duas pessoas no mercado veem as marcações uma da outra) e funcionam sem internet: a lista fica guardada no aparelho e as marcações feitas offline vão quando a conexão volta, mesmo se o app for fechado no meio. "Comprados recentemente" mostra o que a casa mais compra (carrinhos limpos, itens no carrinho e notas confirmadas dos últimos 90 dias), com a quantidade de sempre: um toque põe na lista. "Acho que acabou" (na lista e na tela Hoje) avisa o que já passou do intervalo em que a casa costuma comprar — mediana entre as idas ao mercado nos últimos 6 meses, a partir de 3 compras. Catálogo com mais de 200 itens comuns da casa por categoria, para montar a lista sem digitar: um toque põe o item na lista, outro tira (item com descrição, foto ou prioridade pergunta antes); ao digitar, sugere primeiro produtos que já têm preço e depois itens do catálogo. |
| **Cardápio da semana** | Almoço e jantar de segunda a domingo (Casa → Compras → "Cardápio da semana"; no domingo já abre a semana seguinte). "Montar com o Nuke" sugere a semana usando primeiro a despensa e o que vence logo, respeitando as preferências digitadas, e diz o que falta comprar: a pessoa confere, usa o cardápio e põe os ingredientes na lista com um toque. Cada prato pode ser trocado à mão. O cardápio de hoje aparece na tela Hoje, e o Nuke sabe o que tem para comer. |
| **Despensa** | Alimentada pelas notas confirmadas e pelo carrinho: a geladeira de cada item no carrinho guarda aquele item, e "Limpar" guarda o carrinho todo, sempre conferindo a quantidade comprada. Nota que chega depois pergunta antes de repetir o que já foi para a despensa numa compra de até 3 dias de diferença. Validade estimada sem digitar: aprendida do produto ou padrão da categoria. Corrigiu a validade? O produto aprende para a próxima compra. "Acabou" manda o item para a lista de mercado. Cada produto aparece uma vez, com as compras dentro: quantidade somada, validade mais próxima e o nome do catálogo; "Acabou" tira todas, "Usei 1" desconta da compra mais antiga. Ao limpar o carrinho, "Só limpar, sem guardar" esvazia sem levar nada para a despensa. |
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
| **Consultor financeiro (beta)** | Só para quem foi liberado, numa casa: Finanças → Consultor lê os extratos dos seus bancos (pelo MeuPluggy), mostra o mês pela data da compra e conversa sobre orçamento, gastos e dívidas, sem mudar nada no resto das Finanças. Veja [Consultor financeiro (beta)](#consultor-financeiro-beta). |
| **Nuke** | O assistente da casa: uma bolha de vidro com cores pastel por dentro, no canto das abas. Flutua, pisca, olha em volta; pensando, as cores giram e a luz pulsa; fala mexendo a boca, pula de alegria quando uma ação dá certo e fica preocupado quando algo falha. Responde sobre o que está no app (o que vence, o que falta comprar, quanto foi gasto, o que dá para cozinhar com a despensa) e sugere ações — pôr itens na lista, criar tarefa, registrar gasto, abrir uma tela — que só acontecem quando você toca em "Fazer". A conversa fica no celular. |
| **Agenda** | Calendário do mês (aberto pela tela Hoje) com consultas, vacinas, contas, tarefas, manutenções, documentos e garantias; contas e tarefas que se repetem aparecem apagadas nas próximas datas, como previsão. Tocar num compromisso abre o item. |
| **Hoje** | Home que só mostra o que pede atenção: doses pendentes, treino do dia, consultas de hoje/amanhã, vacinas atrasadas, tarefas e manutenções, contas vencendo, itens vencendo, documentos a renovar, garantias acabando, notas e planos para revisar. |
| **Dicas do clima** | Com o bairro da casa (pelo CEP ou pela localização do celular), a tela Hoje mostra a dica do dia (depois das 18h, a de amanhã): dia de lavar roupa, recolher a roupa antes da chuva, jardim regado pela chuva (quando a casa tem tarefa de regar), guarda-chuva, temporal, vento forte, calor (com água e sombra para os pets), noite fria (cobertor extra para as crianças), ar seco, água parada depois da chuva (dengue), sol forte, tempo úmido e dia bom para lavar o carro (quando a casa tem um). Regras fixas sobre a previsão hora a hora, sem IA. No app instalado, o aviso "Dicas do clima" manda a mais importante às 7h. |
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
   npx supabase functions deploy send-push   # avisos no navegador (Web Push)
   npx supabase functions deploy finance        # opcional: consultor financeiro (beta), veja a seção dele
   npx supabase functions deploy nuke-finance   # idem (só Anthropic)
   ```

   Com a chave da OpenRouter, ela é usada em tudo (leitura de notas, de saúde e o Nuke), com o `deepseek/deepseek-v4.1-flash`; a Anthropic só entra com a chave dela sozinha ou com `RECEIPT_PROVIDER=anthropic`. O modelo pode ser trocado com `RECEIPT_MODEL` (na OpenRouter, precisa ser um modelo que aceita imagem). A leitura de saúde (`parse-health`) usa as mesmas configurações, ou `HEALTH_PROVIDER` e `HEALTH_MODEL` se quiser um modelo diferente para ela. O Nuke (`nuke`) também, ou `NUKE_PROVIDER` e `NUKE_MODEL`.

   As funções falam com o banco pelas chaves novas do Supabase (`SUPABASE_PUBLISHABLE_KEYS` e `SUPABASE_SECRET_KEYS`, que o Supabase já entrega a elas; vale a chave `default`, ver `supabase/functions/_shared/apiKeys.ts`). As antigas (`SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`) só entram se o projeto ainda não tiver as novas.

   **Limpeza das fotos.** Quando a última pessoa sai e apaga a casa, `leave-household` apaga as fotos dela na hora; se o Storage falhar, a casa fica numa fila que o `pg_cron` reprocessa de hora em hora. Para isso, o banco precisa da URL do projeto no Vault (o segredo que autoriza essa chamada, `cleanup_cron_secret`, o `db push` cria sozinho; a chamada não leva chave do Supabase). Rode uma vez no SQL Editor:

   ```sql
   select vault.create_secret('https://SEU_PROJECT_REF.supabase.co', 'project_url');
   ```

   Sem esse segredo, o job registra o erro em `cron.job_run_details`. O `anon_key` que versões antigas pediam no Vault não é mais usado e pode ser apagado.

   **Avisos no navegador.** O `pg_cron` olha a agenda dos navegadores a cada minuto e, quando há aviso vencido, chama a `send-push`, que assina o envio com as chaves VAPID. Além da URL do projeto acima, gere as chaves e o segredo do agendamento (precisa do [Deno](https://deno.com)):

   ```bash
   deno run supabase/functions/send-push/vapid-keys.ts https://SEU_PROJECT_REF.supabase.co
   ```

   e rode no SQL Editor as duas linhas que ele imprime (`push_vapid` e `push_cron_secret`). Sem elas, a tela de avisos do navegador diz que os avisos não foram configurados.

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

1. O projeto da Expo fica na conta `Noobmon`, e o Project ID dele fica em `extra.eas.projectId` no `app.json`, gravado pelo `npx eas-cli@latest init`. No computador, com o repositório clonado e atualizado:

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

**iPhone.** Instalar o app nativo exige conta Apple Developer (US$ 99/ano): com ela, o app vai para os celulares pelo TestFlight e, depois, para a App Store. Sem a conta, instale a versão web: no Safari, *Compartilhar → Adicionar à Tela de Início* (a tela Hoje mostra esse passo a passo). Ela abre em tela cheia, com o ícone do Kotii, e abre mesmo sem internet. Os avisos por notificação funcionam por ela (iOS 16.4 ou mais novo): Família → "Avisos neste navegador". No Safari sem instalar, não.

**Versão web (Vercel).** O `vercel.json` já diz como gerar o site (`expo export`). No projeto da Vercel, em *Settings → Environment Variables*, cadastre as mesmas duas variáveis `EXPO_PUBLIC_*` como texto normal (não secretas) e publique de novo. O site é instalável (PWA): `public/index.html` é o modelo da página, com o manifesto (`public/manifest.webmanifest`), os ícones (`public/icons/`) e o service worker (`public/sw.js`, registrado por `public/sw-register.js`), que guarda o app no aparelho; no Android, o Chrome oferece "Instalar" e a tela Hoje tem o botão. O `vercel.json` também manda os cabeçalhos de segurança do site (CSP com a lista dos serviços que o app chama: Supabase, Open-Meteo, Nominatim, ViaCEP, BrasilAPI e as fontes do Google; um serviço novo precisa entrar lá).

Identificador do app: `com.noobmon.kotii` (iOS e Android). Dá para trocar até o primeiro envio para as lojas; depois fica fixo.

**Renomeação para Kotii.** O app trocou de nome e, junto, de slug e esquema (`kotii`), de identificador (`com.noobmon.kotii`) e das chaves que guarda no aparelho (`kotii:*`). Ninguém tinha o APK instalado e a versão web muda de endereço, então nada é migrado.

**Antes do merge**, cada pessoa abre o app uma vez com internet, para que os itens marcados e as fotos tiradas sem internet sejam enviados. Assim que a Vercel publica o merge, o app passa a ler só as chaves `kotii:*`, mesmo no endereço de hoje, e o que ficou na fila antiga não é mais enviado.

**Depois do merge:**

1. **EAS:** o projeto que existia na Expo é ligado ao slug antigo, por isso o `app.json` está sem `extra.eas.projectId`. Rode `npx eas-cli@latest init` (logado com a conta Noobmon) para criar o projeto com o slug `kotii`, faça commit do `projectId` que ele grava no `app.json` e cadastre de novo, no projeto novo, as duas variáveis `EXPO_PUBLIC_*` (passo 2 do APK, acima).
2. **Funções do Supabase:** o merge não publica as funções, e o nome do app mudou nas instruções do Nuke e no cabeçalho que vai para a OpenRouter. Até publicar de novo, o Nuke ainda se apresenta com o nome antigo e pode usá-lo nas respostas:

   ```bash
   npx supabase functions deploy nuke
   npx supabase functions deploy parse-receipt
   npx supabase functions deploy parse-health
   npx supabase functions deploy nuke-finance   # se o consultor financeiro estiver em uso
   ```

   As outras não mudaram (na `finance`, só um comentário).
3. **Vercel:** renomeie o projeto para `kotii`. Trocar o nome do projeto não basta para trocar o endereço: em *Settings → Domains*, confira que o subdomínio novo está lá (por exemplo `kotii.vercel.app`, se estiver livre; adicione, se não estiver). Não mexa ainda no endereço antigo: ele continua abrindo o app até o passo 5. As variáveis `EXPO_PUBLIC_*` continuam no projeto.
4. **Supabase Auth:** em *Authentication → URL Configuration*, troque o *Site URL* pelo endereço novo, ponha o endereço novo nas *Redirect URLs* e tire o antigo de lá. Isso é obrigatório: um endereço `*.vercel.app` que sai da Vercel fica livre, e se outra conta o pegar, ela recebe os links de login.
5. **Endereço antigo:** o app instalado por ele continua abrindo sem internet (o service worker guarda uma cópia), e uma janela que já estava aberta continua rodando, mesmo depois que o endereço deixa de servir o app. Se essa cópia ainda tiver a conta, ela inscreve o navegador de novo e os avisos chegam em dobro.
   1. Enquanto o endereço antigo ainda abre o app, cada pessoa anota quais remédios estão com "Lembrar neste navegador" ligado (Saúde → cada remédio), abre o app antigo com internet e toca em Família → "Sair da conta". Isso tira os avisos daquele navegador e a conta dele, e a cópia guardada não consegue mais se inscrever.
   2. Depois que todos saírem, em *Settings → Domains* da Vercel, deixe o endereço antigo só redirecionando para o novo, e não o tire nunca. Se ele sair da Vercel, outra conta pode pegá-lo e ler o login guardado nos navegadores que ainda o abrem. O redirecionamento não custa nada.
   3. Antes de a família entrar no endereço novo, rode no SQL Editor `delete from public.push_subscriptions;` (a agenda de cada inscrição vai junto) e `delete from auth.sessions;`. O segundo comando encerra os logins que sobraram, inclusive de quem esqueceu de sair. Todo mundo entra de novo no passo 6.
   4. Se ainda assim os avisos de alguém chegarem em dobro, essa pessoa apaga o atalho antigo (no Android ou no computador, também os dados do endereço antigo no Chrome). Depois, apague só as inscrições dela: `delete from public.push_subscriptions where user_id = (select id from auth.users where email = '...');`. Por fim, ela liga os avisos de novo no endereço novo.
6. **Família:** cada pessoa abre o endereço novo, instala de novo o app na tela de início, apaga o atalho antigo (e não abre mais o endereço antigo) e entra de novo na conta. Depois, liga de novo os avisos: os da casa em Família → "Avisos neste navegador"; os de remédio, um por um, em Saúde → cada remédio anotado no passo 5 → "Lembrar neste navegador" → Salvar. O que o navegador guardava no endereço antigo não vem junto.
7. **Opcional, para o nome antigo sumir de vez:** renomeie o repositório no GitHub para `kotii` (o GitHub redireciona o endereço antigo; confira em Vercel → *Settings → Git* que o repositório continua ligado e, nos clones, rode `git remote set-url origin https://github.com/noobmon-code/kotii`); apague o projeto antigo da Expo depois do `eas init`; troque o nome do projeto no Supabase (*Project Settings → General*); e, se os e-mails da conta forem personalizados, confira os modelos e o remetente em *Authentication → Emails*: são eles que chegam para as pessoas.

## Custos e limites que você precisa saber

- **Leitura de nota por IA (Anthropic):** `claude-opus-5` por padrão. Estimativa por nota: US$ 0,05 a 0,20 (foto + lista de produtos da família + itens lidos; cresce com o tamanho da nota e do catálogo). Dá para trocar o modelo sem mexer no código: `npx supabase secrets set RECEIPT_MODEL=...`.
- **Leitura de nota por IA (OpenRouter):** `deepseek/deepseek-v4.1-flash` por padrão (US$ 0,035 por milhão de tokens de entrada e US$ 0,29 de saída): frações de centavo por nota. A tela de revisão existe para corrigir; se a precisão incomodar, troque o `RECEIPT_MODEL`. Evite modelos `:free`: têm limite de chamadas e podem registrar o conteúdo enviado.
- **Documentos de saúde:** fichas, dietas e exames são dados de saúde. Na OpenRouter, a política de dados depende do provedor que atende o modelo; nas configurações de privacidade da conta dá para bloquear provedores que guardam ou treinam com o conteúdo. Para isolar saúde, use `HEALTH_MODEL` ou a Anthropic (`HEALTH_PROVIDER=anthropic`). Até 6 fotos por leitura.
- **Nota comprida:** até 4 fotos por nota, lidas juntas numa nota só (pela câmera, uma parte de cada vez; pela galeria, várias de uma vez). Vale deixar um pedaço repetido entre as fotos.
- **Nuke:** cada mensagem manda para a IA um retrato compacto da casa (poucos milhares de tokens) e as últimas falas, com esforço baixo para responder rápido. Com a OpenRouter (`deepseek/deepseek-v4.1-flash`), frações de centavo por mensagem; com a Anthropic (claude-opus-5), algo como US$ 0,02 a 0,05. Dá para trocar o modelo com `NUKE_MODEL`.
- **Várias casas:** o app manda a casa aberta no cabeçalho `x-household-id` e o banco (`current_household_id()`) só aceita uma casa de que a pessoa é membro; sem o cabeçalho, vale a casa que a sessão abriu por último (`household_sessions`, pelo `session_id` do token: é o caso da lista ao vivo, cujo tempo real não leva cabeçalhos) e, sem isso (versões antigas do app), a primeira casa em que ela entrou. Trocar de casa pede internet, e as marcações da lista feitas sem internet precisam subir antes. Os avisos das outras casas são refeitos em segundo plano ao abrir o app.
- **Limite de IA por casa:** por mês (fuso de Brasília), 300 mensagens com o Nuke, 100 leituras de foto (notas e saúde) e 20 cardápios (e, só para quem tem o consultor financeiro, 100 mensagens com ele). As funções conferem no banco (`use_ai`) antes de chamar a IA e devolvem o uso se a IA falhar; no limite, a pessoa vê o aviso e o QR code da nota continua funcionando. A aba Família mostra o uso do mês. Para mudar os números, uma migração nova troca `ai_limit`.
- **Tempo de leitura:** 10–60 s dependendo do tamanho da nota; o app mostra uma tela de espera.
- **Unidades:** preço é comparado na unidade da nota. Se a lista pede "3 un" de banana e as notas têm preço por kg, o comparativo usa 1 kg e avisa que a quantidade é aproximada.
- **Avisos por notificação:** remédios, contas, documentos, tarefas e manutenções, consultas, vacinas e dicas do clima.
- **Clima:** previsão do [Open-Meteo](https://open-meteo.com) (grátis e sem chave para uso não comercial, até 10 mil consultas por dia; uso comercial pede plano pago), CEP pelo ViaCEP (BrasilAPI de reserva) e bairro pelo OpenStreetMap (Nominatim, no máximo uma busca por segundo). Fica guardado só o bairro, com as coordenadas em duas casas decimais (cerca de 1 km). A grade dos modelos de previsão tem alguns quilômetros: bairros vizinhos costumam ter a mesma previsão, com a temperatura ajustada pela altitude. O aviso das 7h sai da última previsão que o celular viu; ele é refeito sempre que o app abre, e sem abrir por dias fica sem aviso depois do fim da previsão (3 dias). A localização pelo celular exige um build novo do app instalado (`expo-location`).
- **Gastos:** o resumo conta o que foi registrado no app (notas confirmadas, contas pagas, gastos avulsos). Nota em rascunho não entra até ser confirmada.
- **Lembretes de remédio:** notificações locais. No Expo Go podem ter limitações; num development build (`npx expo run:android` / EAS) funcionam completos.
- **Sessão no aparelho:** no celular, os tokens da conta ficam cifrados com AES-256-GCM (`expo-crypto`; chave no Keychain/Keystore via `expo-secure-store`, conteúdo no AsyncStorage; ver `src/lib/sessionStorage.ts`). No navegador ficam no localStorage, como o Supabase faz por padrão.
- **Avisos no navegador (Web Push):** chegam com até 1 minuto de atraso e precisam de internet (no celular, o aviso é local e sai na hora, mesmo offline). Como no celular, a agenda é refeita quando o app abre. Se o serviço de push falhar por um instante, o aviso tenta de novo no minuto seguinte; vencido há mais de 1 hora (o envio ficou parado) não sai, e o serviço de push descarta o que não chegou em 1 hora (aparelho desligado). Quando o navegador troca de inscrição (chave nova ou inscrição vencida), o app refaz a agenda na nova ao abrir. Sair da conta (ou a sessão acabar) tira os avisos daquele navegador. Até 200 avisos agendados por navegador. As chaves VAPID e o segredo do agendamento ficam no Vault (`push_vapid`, `push_cron_secret`); o envio só vai para os serviços de push dos navegadores (Google, Mozilla, Apple, Microsoft).

## Consultor financeiro (beta)

Um Nuke só de finanças que lê os extratos dos seus bancos (conta e cartão) e conversa sobre orçamento, gastos, fluxo de caixa e dívidas. Não recomenda investimentos nem produtos financeiros.

**Para quem.** Só para quem foi liberado em `beta_access`, e só na casa liberada: nas outras casas da pessoa o consultor não aparece. Os dados do banco são da pessoa, não da casa: os outros moradores (inclusive o cônjuge) não veem nada, nem pelo app nem consultando o banco (a regra de acesso exige `user_id` da pessoa, a casa aberta e a liberação).

**Modo sombra.** Os extratos ficam em tabelas próprias (`fin_connections`, `fin_accounts`, `fin_transactions`), que só a função `finance` grava. O resto das Finanças não muda: Resumo, orçamento, divisão da casa e o Nuke da casa continuam contando só o que foi registrado no app. A conciliação (o que do banco já está no Kotii como nota, conta paga ou gasto, e o que só está no banco, com sugestões de par) é só para ler: no MVP nada é lançado, ligado ou alterado sozinho.

**O que mostra** (Finanças → Resumo → cartão "Consultor financeiro"): saídas, entradas e previsto (lançamento ainda pendente no banco) do mês, pela data da compra; compra parcelada conta inteira no dia da compra e as próximas parcelas aparecem como comprometido. Gasto por categoria contra o orçamento, cartões (limite usado, que já inclui as parcelas a vencer, e o vencimento informado pelo banco, se ainda não passou), parcelas futuras, saldos, a conciliação e avisos de banco parado. Transferência entre as suas contas, dinheiro guardado (cofrinho, caixinha, poupança, aplicação), pagamento de fatura e financiamento não contam como gasto; estorno desconta da compra que ele desfaz (mesma conta, mesma loja ou mesmo valor), no mês e na categoria dela, e estorno sem a compra nestes meses aparece à parte, sem descontar nada. Como os bancos quase nunca mandam o seu CPF, transferência entre as suas contas também é reconhecida pelo par (saiu de uma conta e entrou o mesmo valor em outra em até 2 dias, sem nome ou documento diferente dos dois lados; para a poupança conta como dinheiro guardado), e a fatura paga sem a palavra "fatura", pelo "Pagamento recebido" de mesmo valor no cartão. Para juntar parcelas e pares da virada, os lançamentos vêm desde um ciclo de fatura antes dos três meses mostrados. Dali se abre a conversa com o Nuke consultor.

**Privacidade.**

- Os bancos chegam pela Pluggy, pelo conector **MeuPluggy**: gratuito para a pessoa ler os próprios dados (uso comercial não é permitido). O consentimento do Open Finance é dado e revogado no MeuPluggy (meu.pluggy.ai).
- Guardado no Supabase: CPF nunca em claro. Do documento de quem recebeu ou pagou fica só um hash por pessoa (HMAC com o segredo `FIN_DOC_HASH_KEY`, que só a função tem: sem ele não dá para descobrir o CPF testando todos), para reconhecer transferência entre as próprias contas; CPF escrito na descrição do lançamento ou no nome (razão social de MEI antigo) é apagado antes de gravar. Da conta, só os 4 últimos dígitos do número. Nome de quem recebeu ou pagou, CNPJ e linha do boleto ficam na tabela privada, para a conciliação.
- A conversa vai **só para a API da Anthropic**, nunca para a OpenRouter (mesmo com a chave dela cadastrada): modelo `claude-haiku-5-5` por padrão, trocável com `FINANCE_MODEL`. Sem `ANTHROPIC_API_KEY`, a função recusa em vez de cair em outro provedor. Pela política da API, a Anthropic não treina modelos com esse conteúdo.
- O retrato que vai para a IA é montado no celular com os números já calculados (a IA não faz conta: só cita o que está no retrato). Ele nunca leva CPF, número de conta ou agência, linha digitável de boleto nem nome de pessoa (Pix para alguém vira "PIX para pessoa física"); saúde, doações, igreja e afins entram só como total da categoria, sem o nome do lugar. Nome só vai quando é de loja (reconhecida pela Pluggy, empresa que não é MEI ou compra com cartão) e, se tem jeito de nome de pessoa (firma individual), só com uma categoria de loja; boleto, depósito e outros textos da conta vão com um nome genérico ("Boleto pago", "Entrada").
- A conversa fica só na memória do celular: fechar o app apaga. Os extratos também não ficam guardados no aparelho para uso sem internet.

**Configurar** (uma vez):

1. **Conecte os bancos no MeuPluggy** ([meu.pluggy.ai](https://meu.pluggy.ai)), cada um pela autorização do Open Finance.
2. **Crie a aplicação na Pluggy.** Crie uma conta no [Dashboard](https://dashboard.pluggy.ai); ela começa com um teste grátis de cerca de 15 dias. Faça os passos 2 e 3 para todos os bancos dentro do teste: depois dele, a lista de conectores não pode mais ser editada (e há relatos de que não dá para autorizar bancos novos). Em *Customization → Connectors*, inclua o **MeuPluggy** (categoria *Personal*); crie uma aplicação e copie o Client ID e o Client Secret.
3. **Autorize cada banco e copie o Item ID.** No Dashboard, abra a aplicação → "Ir para Demo" → conectar conta → procure **MeuPluggy** (não o nome do banco) e autorize um banco. Repita uma vez por banco (banco, não conta: um item traz a conta e o cartão daquele banco). Em *Items*, no card de cada banco: ⋮ → "Copiar Item ID".
4. **Cadastre os segredos e publique:**

   ```bash
   npx supabase secrets set PLUGGY_CLIENT_ID=... PLUGGY_CLIENT_SECRET=...
   npx supabase secrets set FIN_DOC_HASH_KEY=$(openssl rand -hex 32)   # segredo dos hashes de CPF; não troque depois
   npx supabase secrets set ANTHROPIC_API_KEY=sk-ant-...   # se ainda não tiver
   npx supabase secrets set FINANCE_MODEL=...              # opcional (padrão: claude-haiku-5-5)

   npx supabase db push
   npx supabase functions deploy finance
   npx supabase functions deploy nuke-finance
   ```

   Com as duas chaves de IA cadastradas, as outras funções continuam na OpenRouter: a `ANTHROPIC_API_KEY` só entra nelas com `RECEIPT_PROVIDER`, `HEALTH_PROVIDER` ou `NUKE_PROVIDER=anthropic`. Sem os segredos da Pluggy, a função `finance` responde "Pluggy não configurada"; sem o `FIN_DOC_HASH_KEY` (32 caracteres ou mais), também recusa. Trocar o `FIN_DOC_HASH_KEY` depois faz os lançamentos antigos perderem o reconhecimento de transferência entre as suas contas pelo documento.
5. **Libere a pessoa** no SQL Editor (troque o e-mail e o nome da casa). Ela precisa ser moradora da casa; ninguém se libera pelo app. Libere só você, a dona da aplicação na Pluggy: todos os Item IDs são da sua aplicação, e quem tem a liberação consegue conectar qualquer Item ID dela que ainda não esteja conectado. Confira antes que a busca volta uma linha só:

   ```sql
   select u.email, h.name, m.user_id, m.household_id
   from public.household_members m
   join auth.users u on u.id = m.user_id
   join public.households h on h.id = m.household_id
   where u.email = 'voce@exemplo.com' and h.name = 'Nome da casa';

   insert into public.beta_access (user_id, household_id, feature)
   select m.user_id, m.household_id, 'finance'
   from public.household_members m
   join auth.users u on u.id = m.user_id
   join public.households h on h.id = m.household_id
   where u.email = 'voce@exemplo.com' and h.name = 'Nome da casa'
   on conflict do nothing;
   ```

   Para tirar: `delete from public.beta_access where feature = 'finance' and user_id = (select id from auth.users where email = 'voce@exemplo.com');`. Isso apaga junto os bancos conectados pela pessoa naquela casa, com contas e lançamentos (liberar de novo pede colar os Item IDs outra vez). Sair da casa também tira a liberação e apaga os bancos conectados nela.
6. **Conecte os bancos no app:** Finanças → Resumo → Consultor financeiro → Bancos conectados → Nome (ex.: "Nubank") e o Item ID copiado no Dashboard (passo 3) → "Conectar banco". O servidor confere o item na Pluggy ("Não achei esse Item ID na Pluggy." quando não existe; item que já é de outra pessoa ou casa é recusado) e já faz a primeira sincronização. Colar de novo o mesmo Item ID só troca o nome (e atualiza, se a última vez passou de 2 minutos). Desconectar apaga do Kotii as contas e os lançamentos daquele banco; o consentimento continua no MeuPluggy (revogue lá, se quiser). Se o consentimento vencer e você reautorizar, o Item ID pode mudar: desconecte o antigo e cole o novo.

**Atualização.** Sem webhooks. Ao abrir o consultor, sincroniza se a última vez passou de 6 horas; "Atualizar" força (no máximo uma vez a cada 2 minutos por banco). Enquanto a Pluggy ainda não tem os dados do banco (MeuPluggy recém-autorizado), cada sincronização puxa 365 dias; depois, uma janela que começa uma semana antes do que já veio (no mínimo 60 dias, então ficar meses sem abrir o consultor não deixa buraco; a marca do que já veio só anda quando a sincronização termina inteira), que também tira o que sumiu da Pluggy (lançamento desfeito, previsto que virou outro; depois de 30 dias ele sai de vez da tabela). Conta que a Pluggy deixa de devolver (cartão trocado) sai de saldos e cartões; as compras dela continuam. Isso traz o que a Pluggy já tem: o MeuPluggy atualiza com o banco uma vez por dia e não dá para forçar, então o extrato do dia pode só aparecer no dia seguinte.

**Custos e limite.** Cada mensagem manda para o Haiku 5.5 o retrato (até uns 8 mil caracteres) e as últimas falas: cerca de US$ 0,001 por mensagem (US$ 0,10 por milhão de tokens de entrada e US$ 0,50 de saída). Limite próprio de 100 mensagens por mês (tipo `finance` no `use_ai`), separado das 300 do Nuke da casa e que só funciona com a liberação; no uso do mês da aba Família, a linha dele só aparece para quem tem o consultor. Mudar o número é como nos outros limites: migração nova trocando `ai_limit`. A Pluggy não cobra pelo MeuPluggy.

**Problemas conhecidos do MeuPluggy.**

- **Inter:** a conexão pode parar de atualizar sem erro nenhum (fica "verde", dias sem lançamento novo).
- **Santander:** os lançamentos do cartão já ficaram parados por mais de 10 dias enquanto a conta corrente seguia atualizando. O aviso olha o banco inteiro, então confira a data do último lançamento do cartão.
- **Nubank:** há relatos de a data da fatura vir no lugar da data da compra e de parcelas sem número; nesses casos a compra fica na data que o banco mandou e as parcelas sem número aparecem como compras separadas.
- **Santander (cartão):** a "data da compra" vem carimbada parcela por parcela (a 3/10 traz a data em que a 3ª caiu). O consultor percebe isso pela conta (parcelas da mesma loja a um mês uma da outra) e volta cada parcela para o mês da compra; a anuidade em 12x conta uma vez, no mês em que começou.
- **Mercado Pago:** os cofrinhos não vêm pela integração; o dinheiro guardado neles fica fora dos saldos. O que entra e sai deles aparece na conta como dinheiro guardado, não como gasto.
- **Banco parado:** o consultor avisa quando a Pluggy não atualiza um banco há mais de 2 dias ("Inter sem atualizar há 5 dias. Reautorize no MeuPluggy."), quando o item está com erro (login, consentimento vencido, esperando ação no banco) ou quando nunca sincronizou. Reautorize no MeuPluggy; se o Item ID mudar, troque no app.

## Testes

```bash
npm test          # regras de negócio: recomendação de mercado, validade, datas, revisão de nota…
npm run test:db   # sobe um Postgres temporário e testa migrations + isolamento entre famílias (RLS)
npm run typecheck
npm run lint
```

As Edge Functions são Deno: em `supabase/functions/_shared`, `parse-receipt`, `parse-health`, `leave-household`, `nfce`, `finance` e `nuke-finance`, rode `deno test && deno check index.ts` (em `_shared`, `deno check *.ts`).

## Identidade visual

Na linha do Headspace, com um toque de vidro: fundo creme de dia e azul profundo à noite, com manchas pastel suaves (as cores do Nuke) atrás de cartões translúcidos de borda clara e sombra suave; cartões bem arredondados, botões em pílula, fonte Nunito e personagens redondos com rosto simples. Cores (inclusive as de vidro), tons dos cartões, sombras, fontes e raios ficam em `src/ui/theme.ts`; o fundo em `src/ui/Backdrop.tsx`; as ilustrações (personagens, sol e lua da tela Hoje, logo) em `src/ui/art.tsx`; o Nuke em `src/ui/NukeArt.tsx` (partes e versão parada) e `src/ui/NukeLive.tsx` (animado). Ícone, ícone adaptativo do Android e splash usam o mesmo personagem laranja.

As categorias de produto (lista de compras, despensa, notas, preços) têm ilustrações próprias em `assets/categories/` (WebP 144px, fundo transparente), ligadas em `src/ui/categoryArt.ts` com a cor do círculo de fundo. Categoria nova precisa de imagem nova: um teste falha se faltar.

Os itens mais comprados (81, de banana a saco de lixo) têm desenho próprio em `assets/items/`, escolhido pelo nome do item com as regras de `src/domain/itemArt.ts` ("Leite Italac 1L" vira o leite, "Suco de laranja" o suco). Sem regra que case, fica o desenho da categoria.

## Estrutura

```
src/app/            telas (Expo Router): (tabs)/ Hoje, Casa, Finanças, Saúde, Família; lista/, nota/, conta/, gasto/, treino/, consultor/…
src/domain/         regras de negócio puras e testadas (sem React, sem Supabase)
src/data/           consultas e mutações (React Query + Supabase)
src/features/       blocos de tela maiores (painéis da Casa, da Saúde e das Finanças, leitor de nota, importação de planos)
src/ui/             componentes visuais, tema claro/escuro e ilustrações
src/lib/            cliente Supabase, sessão/família, lembretes
supabase/migrations banco de dados e políticas de acesso
supabase/functions  parse-receipt (nota → itens), parse-health (ficha, dieta, exame → dados), nuke (assistente), leave-household (sair da casa; apaga as fotos de casas apagadas, também de hora em hora pelo pg_cron), nfce (nota pelo QR code, lida na Sefaz), finance (extratos dos bancos pela Pluggy, beta) e nuke-finance (consultor financeiro, beta, só Anthropic); _shared/vision.ts e _shared/chat.ts falam com a IA, _shared/pluggy.ts com a Pluggy
scripts/db/         teste local do banco
```

## Publicação nas lojas

Ainda falta definir: ícone e splash definitivos, e contas de desenvolvedor Apple (US$ 99/ano) e Google (US$ 25, uma vez). O build e o envio são feitos com EAS (`npx eas-cli@latest build`, `npx eas-cli@latest submit`).
