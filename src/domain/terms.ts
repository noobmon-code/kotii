// Termos de uso e privacidade: o texto que a tela app/termos mostra e a versão dele. O texto descreve o que o
// app faz de verdade (quem vê o quê, o que vai para a IA, o que entra na base de preços comum); mudou o app,
// muda o texto e a versão. O aceite ainda não fica registrado no banco: vale o aviso na tela de entrar.

import { formatBRDate } from './dates';

/** Data da versão do texto (AAAA-MM-DD). Muda a cada mudança no texto. */
export const TERMS_VERSION = '2026-10-18';

export const TERMS_TITLE = 'Termos de uso e privacidade';

/** Marcador do contato: o dono troca pelo e-mail de verdade antes de o texto valer. */
export const TERMS_CONTACT = '[e-mail de contato]';

/** "Versão de 18/10/2026". */
export function termsVersionLabel(version: string = TERMS_VERSION): string {
  return `Versão de ${formatBRDate(version)}`;
}

/** O aviso da tela de entrar e criar conta, antes do link para os termos. */
export const TERMS_CONSENT = 'Ao continuar, você concorda com os';

export interface TermsSection {
  title: string;
  paragraphs: string[];
}

export const TERMS_SECTIONS: TermsSection[] = [
  {
    title: 'O que é o Kotii',
    paragraphs: [
      'O Kotii é um app para organizar a casa em família: listas de compras, notas fiscais e preços, despensa, tarefas, aparelhos, documentos, saúde e finanças. Ao criar uma conta ou continuar usando o app, você concorda com estes termos.',
      'O app está em desenvolvimento e é oferecido como está. As contas e previsões (preços, estimativas da lista, validade, gás, remédios acabando, resumo de gastos) ajudam a decidir, mas podem errar: confira o que for importante. O Kotii não dá orientação médica nem consultoria financeira profissional.',
    ],
  },
  {
    title: 'Sua conta e sua casa',
    paragraphs: [
      'A conta é feita com e-mail e senha. Guarde a senha só com você; se esquecer, o app manda uma mensagem para o seu e-mail para criar uma senha nova.',
      'Os dados ficam numa casa. Quem entra com o código de convite vê e edita tudo o que é da casa: listas, notas, despensa, tarefas, saúde, documentos e finanças. Só convide quem pode ver isso. Uma conta pode estar em até 5 casas, e cada casa só vê os próprios dados.',
      'Quem cria a casa é o responsável por ela: pode trocar o código de convite e tirar moradores. O que um morador registrou continua com a casa depois que ele sai.',
    ],
  },
  {
    title: 'O que o app guarda e para quê',
    paragraphs: [
      'O app guarda o que você e a sua casa registram, para mostrar de volta e fazer as contas dele: notas fiscais (mercado, CNPJ, data, itens e preços), listas de compras, despensa, cardápio, tarefas e pontos, aparelhos e prestadores, documentos (número, validade e fotos), saúde (fichas das pessoas e dos pets, remédios, consultas, vacinas, exames, treino e dieta) e finanças (gastos, contas, orçamento e quem pagou o quê).',
      'Tudo fica no Supabase, o serviço de banco de dados e de login que o Kotii usa, com regras que deixam cada casa ler só o que é dela. As fotos ficam num armazenamento privado da casa. O aparelho guarda uma cópia do que você abriu, para o app abrir sem internet.',
      'Dados de saúde são sensíveis: só entram se você registrar, e servem só às funções de saúde do app (e ao Nuke, como explicado abaixo).',
      'Para ler uma nota pelo QR code, o app consulta a página pública da Sefaz daquela nota. Para a previsão do tempo, a casa pode informar o CEP ou usar a localização do aparelho: o app consulta serviços públicos de CEP e de mapa (ViaCEP, BrasilAPI e OpenStreetMap) e de previsão do tempo (Open-Meteo), mandando só o CEP ou as coordenadas.',
      'O Kotii não vende os seus dados e não mostra anúncios.',
    ],
  },
  {
    title: 'Inteligência artificial',
    paragraphs: [
      'Algumas funções usam IA: ler a foto de uma nota fiscal, de um exame, de uma ficha de treino ou de um plano de dieta, sugerir o produto de cada item da nota e conversar com o Nuke (que também monta o cardápio da semana). Nesses casos a foto, ou a sua mensagem junto com um resumo da casa (listas, despensa, cardápio, tarefas, contas, gastos do mês, remédios do dia, consultas, compromissos, documentos e garantias), é enviada a um provedor de IA para ser lida: a Anthropic (Claude) ou a OpenRouter, que repassa ao modelo configurado.',
      'A IA pode errar. O que ela lê de uma foto passa por uma tela de revisão antes de ser salvo, e o Nuke só põe algo na lista, cria uma tarefa ou lança um gasto quando você toca para confirmar. A conversa com o Nuke fica guardada só no seu aparelho. As fotos de documentos não passam por IA.',
      'O uso de IA tem limite por mês; a aba Família mostra quanto já foi usado.',
    ],
  },
  {
    title: 'Consultor financeiro (beta)',
    paragraphs: [
      'O consultor só existe para quem foi convidado para o beta. Os extratos chegam pela Pluggy, pelo app MeuPluggy, onde você mesmo conecta os seus bancos; o Kotii só lê, não faz pagamentos nem transferências. Esses dados só você vê: o resto da casa, não.',
      'Os CPFs que aparecem nos lançamentos não são guardados: o app guarda um código embaralhado que não volta a ser o CPF e tira o CPF das descrições.',
      'A conversa do consultor usa só a Anthropic (Claude) e recebe números já calculados, sem CPF, número de conta ou agência, linha de boleto ou nome de pessoas; gastos de saúde vão só como total. Essa conversa não é gravada: fica na memória do app enquanto ele está aberto.',
      'Desconectar um banco no consultor apaga do Kotii os lançamentos dele. No MeuPluggy a conexão continua: para encerrá-la, é lá.',
    ],
  },
  {
    title: 'Preços compartilhados',
    paragraphs: [
      'Por padrão, toda casa contribui e toda casa vê. Quando você confirma uma nota lida pelo app (pelo QR code ou pela foto), os preços dela entram numa base de preços comum a todas as casas do Kotii: o mercado (pelo CNPJ, com o nome impresso na nota e o estado), a descrição de cada item como está na nota, a unidade, o preço e o dia da compra.',
      'Não entra nada que identifique você ou a sua casa: nem quem comprou, nem de qual casa, nem a nota, a quantidade, o total ou a hora. A mesma coisa comprada no mesmo mercado no mesmo dia por duas casas vira uma linha só: não dá para saber quem são as casas que viram um preço, nem quantas são.',
      'Ficam de fora as notas digitadas à mão, os remédios (e a nota inteira que tenha remédio), as compras em farmácia, os suplementos, os primeiros socorros, os itens de higiene pessoal e o que o app não reconheceu.',
      'Os preços de outras casas não são em tempo real: cada um aparece com o dia em que foi visto, e só a partir do dia seguinte ao da confirmação da nota. Eles vêm das notas de outras pessoas e podem não valer mais.',
      'O compartilhamento faz parte do app e não tem como desligar; a nota digitada à mão não entra na base. Excluir uma nota não retira os preços que ela já deu, porque nada liga uma coisa à outra.',
    ],
  },
  {
    title: 'Avisos',
    paragraphs: [
      'No celular, os avisos (remédios, contas, tarefas, consultas, clima e outros) são agendados no próprio aparelho. No navegador, se você ligar os avisos, a agenda deles, com o texto de cada um, fica guardada no servidor para ser entregue na hora pelo serviço de notificações do navegador. Sair da conta tira os avisos daquele aparelho.',
    ],
  },
  {
    title: 'Apagar dados e sair',
    paragraphs: [
      'Você pode excluir o que registrou nas telas do app.',
      'Sair da casa (aba Família) tira o seu acesso a ela; o que você registrou continua com a casa. Se você é a última pessoa, sair apaga a casa e tudo o que ela tem, para sempre: listas, notas, despensa, tarefas, saúde, documentos e fotos.',
      `Sair da conta só desconecta este aparelho; não apaga nada. O app ainda não tem um botão para apagar a conta: para isso, escreva para ${TERMS_CONTACT} a partir do e-mail da conta.`,
      'Os preços que já entraram na base compartilhada não saem, porque não estão ligados a você nem à casa.',
    ],
  },
  {
    title: 'Seus direitos (LGPD)',
    paragraphs: [
      `Pela Lei Geral de Proteção de Dados (Lei 13.709/2018), você pode pedir a confirmação de que tratamos os seus dados, o acesso a eles, a correção, a cópia em formato portátil, a informação de com quem são compartilhados, a exclusão e a revogação do consentimento. Peça pelo ${TERMS_CONTACT}.`,
    ],
  },
  {
    title: 'Mudanças e contato',
    paragraphs: [
      'Quando estes termos mudarem, a data da versão abaixo muda junto.',
      `Dúvidas, pedidos ou problemas: ${TERMS_CONTACT}.`,
    ],
  },
];
