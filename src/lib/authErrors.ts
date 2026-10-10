// Erros do Supabase Auth (em inglês) em português, para a tela de entrar e a
// recuperação de senha: pelo tipo e pelo código do erro (AuthApiError.code),
// senão pelo texto. Puro.

const NOT_AUTHORIZED = 'O Kotii ainda não consegue mandar e-mail para esse endereço. Peça ajuda a quem cuida do app.';
const OFFLINE = 'Sem internet agora. Confira a conexão e tente de novo.';
const SESSION_GONE = 'A sessão de recuperação terminou. Peça um código novo em "Esqueci minha senha".';

function fieldOf(error: unknown, field: string): unknown {
  return error && typeof error === 'object' && field in error ? (error as Record<string, unknown>)[field] : undefined;
}

const textOf = (error: unknown, field: string): string => {
  const value = fieldOf(error, field);
  return typeof value === 'string' ? value : '';
};

/** Espera pedida pelo Supabase antes de outro e-mail para o mesmo endereço, em segundos (ou null). */
export function resendWaitSeconds(error: unknown): number | null {
  const message = typeof error === 'string' ? error : textOf(error, 'message');
  const match = message.match(/only request this after (\d+) seconds?/i);
  return match ? Number(match[1]) : null;
}

/** A sessão (de recuperação) já não existe no servidor ou no aparelho. */
export function isSessionGone(error: unknown): boolean {
  return textOf(error, 'name') === 'AuthSessionMissingError' || textOf(error, 'code') === 'session_not_found';
}

/** "Password should contain at least one character of each: abc..., ABC..., 012..." em português. */
function characterRule(message: string): string | null {
  const list = message.match(/at least one character of each:\s*(.+)$/i)?.[1];
  if (!list) return null;
  const kinds = list.split(/,\s*/).map((set) => {
    if (/^[a-z]+$/.test(set)) return 'letras minúsculas';
    if (/^[A-Z]+$/.test(set)) return 'letras maiúsculas';
    if (/^\d+$/.test(set)) return 'números';
    return 'símbolos';
  });
  const unique = [...new Set(kinds)];
  const joined = unique.length > 1 ? `${unique.slice(0, -1).join(', ')} e ${unique[unique.length - 1]}` : unique[0];
  return `A senha precisa ter ${joined}.`;
}

/** Erro do Supabase Auth (ou só a mensagem dele) -> texto para a pessoa; o que não reconhece volta como veio. */
export function translateAuthError(error: unknown): string {
  const message = typeof error === 'string' ? error : textOf(error, 'message');
  const code = textOf(error, 'code');
  const status = fieldOf(error, 'status');
  // O Supabase junta "sem resposta" (status 0) e erro do servidor (5xx) no mesmo tipo de erro.
  if (textOf(error, 'name') === 'AuthRetryableFetchError' && typeof status === 'number' && status >= 500) {
    return /error sending .*e-?mail/i.test(message)
      ? 'Não deu para mandar o e-mail agora. Tente mais tarde ou peça ajuda a quem cuida do app.'
      : 'O servidor não respondeu agora. Tente de novo daqui a pouco.';
  }
  if (textOf(error, 'name') === 'AuthRetryableFetchError' || /failed to fetch|network request failed|load failed|networkerror/i.test(message)) {
    return OFFLINE;
  }
  if (isSessionGone(error)) return SESSION_GONE;
  if (code === 'invalid_credentials' || /invalid login credentials/i.test(message)) return 'E-mail ou senha incorretos.';
  if (code === 'user_already_exists' || code === 'email_exists' || /already registered/i.test(message)) {
    return 'Este e-mail já tem conta. Use "Entrar".';
  }
  if (code === 'email_not_confirmed' || /email not confirmed/i.test(message)) return 'Confirme seu e-mail pelo link que enviamos.';
  const wait = resendWaitSeconds(message);
  if (wait !== null) return `Espere ${wait} segundos para pedir outro e-mail.`;
  if (code === 'over_email_send_rate_limit' || /email rate limit/i.test(message)) {
    return 'Muitos e-mails pedidos agora. Tente de novo daqui a pouco.';
  }
  if (code === 'over_request_rate_limit' || /rate limit/i.test(message)) return 'Muitas tentativas agora. Espere um pouco e tente de novo.';
  // Sem um servidor de e-mail próprio, o Supabase só manda para quem é da equipe do projeto.
  if (code === 'email_address_not_authorized' || /not authorized/i.test(message)) return NOT_AUTHORIZED;
  if (code === 'otp_expired' || /token has expired or is invalid|otp.*(expired|invalid)/i.test(message)) {
    return 'Código inválido ou vencido. Confira os números ou peça outro.';
  }
  if (code === 'same_password' || /should be different from the old password/i.test(message)) {
    return 'A senha nova precisa ser diferente da antiga.';
  }
  const short = message.match(/password should be at least (\d+) characters?/i);
  if (short) return `Use uma senha com pelo menos ${short[1]} caracteres.`;
  const characters = characterRule(message);
  if (characters) return characters;
  if (code === 'weak_password' || /password is known to be weak|weak password/i.test(message)) {
    return 'Essa senha é fácil de adivinhar. Escolha outra.';
  }
  if (code === 'email_address_invalid' || /unable to validate email address|invalid email|email address .* is invalid/i.test(message)) {
    return 'Confira o e-mail digitado.';
  }
  return message || 'Algo deu errado. Tente novamente.';
}
