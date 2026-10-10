import { describe, expect, it } from '@jest/globals';
import { AuthApiError, AuthRetryableFetchError } from '@supabase/supabase-js';

import { resendWaitSeconds, translateAuthError } from '../authErrors';

// As mensagens e os códigos como o servidor do Supabase Auth manda.
const api = (message: string, status: number, code: string) => new AuthApiError(message, status, code);

describe('translateAuthError', () => {
  it('entrar e criar conta', () => {
    expect(translateAuthError(api('Invalid login credentials', 400, 'invalid_credentials'))).toBe('E-mail ou senha incorretos.');
    expect(translateAuthError(api('User already registered', 422, 'user_already_exists'))).toBe(
      'Este e-mail já tem conta. Use "Entrar".',
    );
    expect(translateAuthError(api('Email not confirmed', 400, 'email_not_confirmed'))).toBe(
      'Confirme seu e-mail pelo link que enviamos.',
    );
    // Só a mensagem (o texto já tirado do erro) também serve.
    expect(translateAuthError('Invalid login credentials')).toBe('E-mail ou senha incorretos.');
  });

  it('pedir o código de novo cedo demais, e-mails demais ou tentativas demais', () => {
    const early = api('For security purposes, you can only request this after 47 seconds.', 429, 'over_email_send_rate_limit');
    expect(translateAuthError(early)).toBe('Espere 47 segundos para pedir outro código.');
    expect(resendWaitSeconds(early)).toBe(47);
    expect(translateAuthError(api('Email rate limit exceeded', 429, 'over_email_send_rate_limit'))).toBe(
      'Muitos e-mails pedidos agora. Tente de novo daqui a pouco.',
    );
    expect(translateAuthError(api('Request rate limit reached', 429, 'over_request_rate_limit'))).toBe(
      'Muitas tentativas agora. Espere um pouco e tente de novo.',
    );
    expect(resendWaitSeconds(api('Request rate limit reached', 429, 'over_request_rate_limit'))).toBeNull();
  });

  it('e-mail que o servidor de e-mail padrão do Supabase não atende', () => {
    const blocked = api('Email address "fulano@exemplo.com" cannot be used as it is not authorized', 400, 'email_address_not_authorized');
    expect(translateAuthError(blocked)).toMatch(/ainda não consegue mandar e-mail/);
  });

  it('código e senha nova', () => {
    expect(translateAuthError(api('Token has expired or is invalid', 403, 'otp_expired'))).toBe(
      'Código inválido ou vencido. Confira os números ou peça outro.',
    );
    expect(translateAuthError(api('New password should be different from the old password.', 422, 'same_password'))).toBe(
      'A senha nova precisa ser diferente da antiga.',
    );
    expect(translateAuthError(api('Password should be at least 8 characters.', 422, 'weak_password'))).toBe(
      'Use uma senha com pelo menos 8 caracteres.',
    );
    expect(
      translateAuthError(api('Password is known to be weak and easy to guess, please choose a different one.', 422, 'weak_password')),
    ).toBe('Essa senha é fácil de adivinhar. Escolha outra.');
    expect(translateAuthError(api('Unable to validate email address: invalid format', 400, 'validation_failed'))).toBe(
      'Confira o e-mail digitado.',
    );
  });

  it('sem internet', () => {
    expect(translateAuthError(new AuthRetryableFetchError('Failed to fetch', 0))).toBe(
      'Sem internet agora. Confira a conexão e tente de novo.',
    );
    expect(translateAuthError('Network request failed')).toBe('Sem internet agora. Confira a conexão e tente de novo.');
  });

  it('o resto volta como veio', () => {
    expect(translateAuthError('Algo deu errado. Tente novamente.')).toBe('Algo deu errado. Tente novamente.');
    expect(translateAuthError(null)).toBe('Algo deu errado. Tente novamente.');
  });
});
