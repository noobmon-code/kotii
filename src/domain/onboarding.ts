// O começo de quem chega (o onboarding): as boas-vindas, criar a conta, o nome, a casa (criar ou entrar com o
// convite), a primeira lista, chamar a casa e pôr o Kotii na tela de início. Aqui ficam os textos e as regras
// puras; as telas ficam em src/features/onboarding. Entrar com o código é direto, como sempre foi (sem aceite de
// ninguém: a pessoa ficaria parada esperando), e antes de entrar nada da casa aparece (nem o nome, nem quem mora
// nela): decisões do dono.

import { cleanName, PROFILE_MESSAGES, PROFILE_NAME_MAX } from './profile';

/** As boas-vindas, para quem nunca entrou neste aparelho. */
export const WELCOME_TITLE = 'A casa em ordem, sem esforço.';

/** A arte de vidro de cada linha das boas-vindas: as mesmas dos atalhos da Hoje (src/ui/iconArt). */
export type WelcomeArt = 'carrinho' | 'camera' | 'tarefa';

/** As três linhas do que o Kotii faz. As contas são de Finanças: sem ela, a linha não as promete. */
export function welcomeLines(finance: boolean): { art: WelcomeArt; text: string }[] {
  return [
    { art: 'carrinho', text: 'Uma lista de mercado que a casa toda vê e marca na hora.' },
    { art: 'camera', text: 'Escaneie a nota: o Kotii guarda os preços e o que entrou na despensa.' },
    {
      art: 'tarefa',
      text: finance
        ? 'Tarefas, contas e saúde da família, com aviso no celular.'
        : 'Tarefas, agenda e saúde da família, com aviso no celular.',
    },
  ];
}

export const WELCOME_CREATE = 'Criar conta';
export const WELCOME_SIGN_IN = 'Já tenho conta';

/** As boas-vindas de quem chegou pelo link de um convite. */
export const INVITED_TITLE = 'Você recebeu um convite para uma casa no Kotii.';
export const INVITED_TEXT = 'Crie sua conta, ou entre, e o código do convite já vem preenchido.';

export const SIGN_UP_TITLE = 'Criar conta';
export const SIGN_IN_TITLE = 'Entrar';
/** O tamanho mínimo da senha, à vista antes do erro (o Supabase recusa menos de 6). */
export const PASSWORD_MIN = 6;
export const PASSWORD_HINT = `Pelo menos ${PASSWORD_MIN} caracteres.`;
export const SHOW_PASSWORD = 'Mostrar a senha';
export const HIDE_PASSWORD = 'Esconder a senha';
export const SWITCH_TO_SIGN_UP = 'Ainda não tenho conta';

/** Criou a conta e o Supabase pede a confirmação do e-mail (por link: o e-mail ainda não traz código). */
export const CONFIRM_EMAIL_TITLE = 'Confirme seu e-mail';
export function confirmEmailText(email: string): string {
  return `Mandamos um link para ${email}. Abra o link e depois volte aqui para entrar com o e-mail e a senha. Se não chegar em alguns minutos, olhe o spam.`;
}
export const CONFIRM_EMAIL_DONE = 'Já confirmei, entrar';
export const CONFIRM_EMAIL_RESEND = 'Reenviar o e-mail';
export const CONFIRM_EMAIL_CHANGE = 'Usar outro e-mail';
export const CONFIRM_EMAIL_RESENT = 'Mandamos de novo. Use o link do e-mail mais recente.';
/** O Supabase só manda outro e-mail para o mesmo endereço depois disso. */
export const RESEND_SECONDS = 60;
export function resendLabel(waitSeconds: number): string {
  return waitSeconds > 0 ? `${CONFIRM_EMAIL_RESEND} em ${waitSeconds} s` : CONFIRM_EMAIL_RESEND;
}

export const NAME_TITLE = 'Como a casa vai te chamar?';
export const NAME_HINT = 'É o nome que os outros moradores veem nas listas e tarefas.';

export const CHOICE_TITLE = 'Alguém da sua casa já usa o Kotii?';
export const CHOICE_NEW = { title: 'Não, vou começar a casa', subtitle: 'Você cria a casa e depois chama quem mora com você.' } as const;
export const CHOICE_INVITE = { title: 'Sim, tenho um convite', subtitle: 'Use o link ou o código de 6 letras que te mandaram.' } as const;

export const HOUSE_TITLE = 'Dê um nome para a casa';
export const HOUSE_PLACEHOLDER = 'Casa da família Silva';
/** A linha que abre a parte "Onde fica a casa": fechada de começo, porque é opcional. */
export const HOUSE_PLACE_ROW = { title: 'Onde fica a casa (opcional)', subtitle: 'Para o céu da tela Hoje seguir o tempo daí.' } as const;
export const HOUSE_CREATE = 'Criar casa';

export const CODE_TITLE = 'Digite o código do convite';
export const CODE_HINT = 'Está na mensagem que te mandaram. Quem te convidou também acha em Ajustes → Convidar.';
export const CODE_PASTE = 'Colar';
export const CODE_JOIN = 'Entrar na casa';
export const CODE_NOTHING_TO_PASTE = 'Copie a mensagem do convite (ou só o código) e toque em "Colar" de novo.';

/** Depois de entrar na casa pelo código: agora a pessoa é moradora, e o nome da casa já pode aparecer. */
export const JOINED_TITLE = 'Você entrou na casa!';
export function joinedText(houseName: string): string {
  return `"${houseName}" já aparece aqui: listas, tarefas, saúde e o que mais a casa tiver.`;
}
export const JOINED_WRONG = 'Entrou na casa errada? Em Ajustes → Conta, toque em "Sair desta casa".';
export const JOINED_OK = 'Começar';

/** A faixa da lista de mercado logo depois de criar a casa. */
export const FIRST_LIST_TEXT = 'Toque no que está faltando em casa. Quem você chamar vai ver e marcar na hora.';
export const FIRST_LIST_DONE = 'Pronto';
export const FIRST_LIST_SKIP = 'Agora não';
export const FIRST_LIST_CATALOG = 'Itens comuns';

/** Chamar a casa: o convite pelo WhatsApp, por outro app ou copiado. */
export const INVITE_TITLE = 'Quem faz compras com você?';
export const INVITE_TEXT = 'Mande o convite: quem entrar vê a lista na hora e marca o que pegou.';
export const INVITE_WHATSAPP = 'Mandar pelo WhatsApp';
export const INVITE_OTHER = 'Outras opções';
export const INVITE_COPY = 'Copiar o convite';
export const INVITE_SKIP = 'Agora não';
export const INVITE_COPIED_TITLE = 'Convite copiado';
export const INVITE_COPIED = 'É só colar na conversa.';
export const INVITE_COPY_FAILED = 'Não deu para copiar. O código da casa está em Ajustes → Convidar.';

/** Pôr o Kotii na tela de início (só no navegador, quando ainda não está). */
export const INSTALL_TITLE = 'Ponha o Kotii na tela de início';
export const INSTALL_PROMPT_TEXT = 'Abre em tela cheia, como um app, e a lista de compras abre mesmo com a internet fraca.';
export const INSTALL_ACTION = 'Instalar';
export const INSTALL_IOS_STEPS = 'No Safari, toque em Compartilhar (o quadrado com a seta) e depois em "Adicionar à Tela de Início".';
/** No iPhone o app da tela de início não vê o que foi feito no Safari: a conta aberta lá fica lá. */
export const INSTALL_IOS_SIGN_IN = 'Depois, abra o Kotii pelo ícone e entre com o mesmo e-mail e senha. É só desta vez.';
export const INSTALL_IOS_WHY = 'No iPhone, os avisos do Kotii só chegam com ele na tela de início.';
export const INSTALL_IOS_OK = 'Entendi';
export const INSTALL_SKIP = 'Agora não';

/** A prévia do começo, para quem mantém o app ver como uma conta nova veria. */
export const PREVIEW_TITLE = 'Ver o começo como conta nova';
export const PREVIEW_SUBTITLE = 'Das boas-vindas à primeira lista, como uma pessoa nova vê';
export const PREVIEW_NOTICE =
  'Prévia: as telas de conta não criam nada. A casa criada aqui é de verdade e fica em Suas casas; para apagar, abra ela e use Ajustes → Conta → Sair desta casa.';
export const PREVIEW_ONLY_ADMINS = 'Esta prévia é só para quem mantém o app.';

/** Quanto tempo o código de um link de convite fica guardado no aparelho, esperando a conta. */
export const PENDING_INVITE_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

/** O código guardado ainda vale (foi guardado há menos de PENDING_INVITE_DAYS). */
export function pendingInviteValid(savedAt: number, now: number): boolean {
  return Number.isFinite(savedAt) && now >= savedAt && now - savedAt < PENDING_INVITE_DAYS * DAY_MS;
}

/** As letras do código de convite: sem 0/O e 1/I (generate_invite_code, no banco). */
export const INVITE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const INVITE_CODE_LENGTH = 6;
const CODE = new RegExp(`^[${INVITE_ALPHABET}]{${INVITE_CODE_LENGTH}}$`);

/** O código como a pessoa digitou: em maiúsculas, sem espaços nem traços, no máximo 6 letras. */
export function typedInviteCode(text: string): string {
  return text
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, INVITE_CODE_LENGTH);
}

/** Um código com as 6 letras do convite. */
export function isInviteCode(text: string): boolean {
  return CODE.test(text);
}

/**
 * O código dentro de um texto colado: o link do convite (…/convite/ABC234), a mensagem ("… com o código ABC234.")
 * ou só o código. null quando não há um código que sirva.
 */
export function inviteCodeFrom(text: string): string | null {
  const link = /\/convite\/([A-Za-z0-9]{6})(?![A-Za-z0-9])/.exec(text);
  if (link && isInviteCode(link[1].toUpperCase())) return link[1].toUpperCase();
  const said = /c[oó]digo:?\s+([A-Za-z0-9]{6})(?![A-Za-z0-9])/i.exec(text);
  if (said && isInviteCode(said[1].toUpperCase())) return said[1].toUpperCase();
  const alone = typedInviteCode(text.trim());
  return text.trim().length <= INVITE_CODE_LENGTH + 2 && isInviteCode(alone) ? alone : null;
}

/** O link do convite, no site do Kotii (origin: o endereço do site, sem barra no fim). */
export function inviteLink(origin: string, code: string): string {
  return `${origin.replace(/\/+$/, '')}/convite/${code}`;
}

/** A mensagem do convite: com o link quando há o endereço do site (no navegador), e sempre com o código. */
export function inviteMessage(houseName: string, code: string, origin: string | null): string {
  return origin
    ? `Entra na nossa casa "${houseName}" no Kotii: ${inviteLink(origin, code)} (ou use o código ${code}).`
    : `Entre na nossa casa "${houseName}" no Kotii com o código ${code}.`;
}

type Check<T> = { ok: true; value: T } | { ok: false; title: string; message: string };

/** O nome da pessoa: o mesmo limite do perfil (1 a 60 letras, sem os espaços das pontas). */
export function readDisplayName(text: string): Check<string> {
  const name = cleanName(text);
  if (!name) return { ok: false, title: NAME_TITLE, message: 'Escreva o seu nome: é como os moradores da casa veem você.' };
  if ([...name].length > PROFILE_NAME_MAX) return { ok: false, title: 'Nome comprido', message: PROFILE_MESSAGES.nameLong };
  return { ok: true, value: name };
}

/** O nome da casa: só não pode ficar vazio. */
export function readHouseName(text: string): Check<string> {
  const name = cleanName(text);
  return name ? { ok: true, value: name } : { ok: false, title: HOUSE_TITLE, message: 'Ex.: "Casa da Ana e do Beto".' };
}

/** O código digitado: as 6 letras do convite. */
export function readInviteCode(text: string): Check<string> {
  const code = typedInviteCode(text);
  if (code.length < INVITE_CODE_LENGTH) return { ok: false, title: 'Código incompleto', message: 'O código de convite tem 6 letras e números.' };
  if (!isInviteCode(code)) {
    return { ok: false, title: 'Confira o código', message: 'O código não usa 0, O, 1 nem I. Confira com quem te convidou.' };
  }
  return { ok: true, value: code };
}

/** O que vem depois de a casa nascer, na tela Hoje: abrir a primeira lista (quem criou) ou dizer que entrou. */
export type OnboardingNext = 'lista' | 'entrou';
