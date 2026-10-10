// Erros do Supabase Auth (em inglês) em português, para a tela de entrar e a
// recuperação de senha: pelo código do erro (AuthApiError.code), senão pelo
// texto. Puro.

const NOT_AUTHORIZED = 'O Kotii ainda não consegue mandar e-mail para esse endereço. Peça ajuda a quem cuida do app.';
const OFFLINE = 'Sem internet agora. Confira a conexão e tente de novo.';

function fieldOf(error: unknown, field: 'code' | 'message' | 'name'): string {
  if (error && typeof error === 'object' && field in error) {
    const value = (error as Record<string, unknown>)[field];
    return typeof value === 'string' ? value : '';
  }
  return '';
}

/** Espera pedida pelo Supabase antes de outro e-mail para o mesmo endereço, em segundos (ou null). */
export function resendWaitSeconds(error: unknown): number | null {
  const message = typeof error === 'string' ? error : fieldOf(error, 'message');
  const match = message.match(/only request this after (\d+) seconds?/i);
  return match ? Number(match[1]) : null;
}

/** Erro do Supabase Auth (ou só a mensagem dele) -> texto para a pessoa; o que não reconhece volta como veio. */
export function translateAuthError(error: unknown): string {
  const message = typeof error === 'string' ? error : fieldOf(error, 'message');
  const code = fieldOf(error, 'code');
  const wait = resendWaitSeconds(message);
  if (fieldOf(error, 'name') === 'AuthRetryableFetchError' || /failed to fetch|network request failed|load failed|networkerror/i.test(message)) {
    return OFFLINE;
  }
  if (code === 'invalid_credentials' || /invalid login credentials/i.test(message)) return 'E-mail ou senha incorretos.';
  if (code === 'user_already_exists' || code === 'email_exists' || /already registered/i.test(message)) {
    return 'Este e-mail já tem conta. Use "Entrar".';
  }
  if (code === 'email_not_confirmed' || /email not confirmed/i.test(message)) return 'Confirme seu e-mail pelo link que enviamos.';
  if (wait !== null) return `Espere ${wait} segundos para pedir outro código.`;
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
  if (code === 'weak_password' || /password is known to be weak|weak password/i.test(message)) {
    return 'Essa senha é fácil de adivinhar. Escolha outra.';
  }
  if (/unable to validate email address|invalid email/i.test(message)) return 'Confira o e-mail digitado.';
  return message || 'Algo deu errado. Tente novamente.';
}
