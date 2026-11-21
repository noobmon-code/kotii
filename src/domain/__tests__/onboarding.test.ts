import { describe, expect, it } from '@jest/globals';

import * as onboarding from '../onboarding';
import {
  CODE_HINT,
  INVITE_COPY_FAILED,
  inviteCodeFrom,
  inviteLink,
  inviteMessage,
  isInviteCode,
  JOINED_WRONG,
  PENDING_INVITE_DAYS,
  pendingInviteValid,
  readDisplayName,
  readHouseName,
  readInviteCode,
  resendLabel,
  typedInviteCode,
  welcomeLines,
} from '../onboarding';
import { PROFILE_NAME_MAX } from '../profile';

/** Todos os textos fixos do começo (as constantes e os campos dos objetos de texto). */
function fixedTexts(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (value && typeof value === 'object') return Object.values(value).flatMap(fixedTexts);
  return [];
}

describe('as boas-vindas', () => {
  it('três linhas, com as artes dos atalhos da Hoje', () => {
    expect(welcomeLines(true).map((line) => line.art)).toEqual(['carrinho', 'camera', 'tarefa']);
  });

  it('as contas só entram com Finanças', () => {
    expect(welcomeLines(true)[2].text).toContain('contas');
    expect(welcomeLines(false)[2].text).not.toContain('contas');
    expect(welcomeLines(false)[2].text).toContain('agenda');
  });
});

describe('onde as coisas ficam', () => {
  it('a área chama "Configurações", como no resto do app e na barra lateral do computador ("Ajustes" é só a pílula do celular)', () => {
    const texts = Object.values(onboarding).flatMap(fixedTexts);
    expect(texts.filter((text) => text.includes('Ajustes'))).toEqual([]);
    expect(CODE_HINT).toContain('Configurações → Convidar');
    expect(INVITE_COPY_FAILED).toContain('Configurações → Convidar');
    expect(JOINED_WRONG).toContain('Configurações → Conta');
  });
});

describe('o código do convite', () => {
  it('digitado: maiúsculas, sem espaço nem traço, até 6', () => {
    expect(typedInviteCode('abc 234')).toBe('ABC234');
    expect(typedInviteCode('abc-234-xyz')).toBe('ABC234');
  });

  it('só as letras do banco (sem 0, O, 1, I)', () => {
    expect(isInviteCode('ABC234')).toBe(true);
    expect(isInviteCode('ABC204')).toBe(false);
    expect(isInviteCode('ABCI34')).toBe(false);
    expect(isInviteCode('ABC23')).toBe(false);
  });

  it('readInviteCode diz o que falta ou o que está errado', () => {
    expect(readInviteCode('abc234')).toEqual({ ok: true, value: 'ABC234' });
    expect(readInviteCode('abc')).toMatchObject({ ok: false, title: 'Código incompleto' });
    expect(readInviteCode('ab0234')).toMatchObject({ ok: false, title: 'Confira o código' });
  });

  it('acha o código no link, na mensagem ou sozinho', () => {
    expect(inviteCodeFrom('Entra na nossa casa: https://kotii.app/convite/abc234 (ou use o código ABC234).')).toBe('ABC234');
    expect(inviteCodeFrom('Entre na nossa casa "Casa" no Kotii com o código XYZ789.')).toBe('XYZ789');
    expect(inviteCodeFrom('  xyz 789 ')).toBe('XYZ789');
    expect(inviteCodeFrom('Código: KM2P9Q')).toBe('KM2P9Q');
  });

  it('não inventa código de um texto qualquer', () => {
    expect(inviteCodeFrom('Compra pão e leite, por favor')).toBeNull();
    expect(inviteCodeFrom('')).toBeNull();
    // Seis letras que o banco nunca gera.
    expect(inviteCodeFrom('código OI0101')).toBeNull();
    expect(inviteCodeFrom('https://kotii.app/convite/ABC2345')).toBeNull();
  });
});

describe('a mensagem do convite', () => {
  it('no navegador, com o link do site e o código', () => {
    expect(inviteLink('https://kotii.app/', 'ABC234')).toBe('https://kotii.app/convite/ABC234');
    const message = inviteMessage('Casa da Ana', 'ABC234', 'https://kotii.app');
    expect(message).toContain('https://kotii.app/convite/ABC234');
    expect(message).toContain('código ABC234');
    expect(message).toContain('"Casa da Ana"');
  });

  it('sem o endereço do site, só o código (como antes)', () => {
    expect(inviteMessage('Casa da Ana', 'ABC234', null)).toBe('Entre na nossa casa "Casa da Ana" no Kotii com o código ABC234.');
  });

  it('o código da mensagem é o que inviteCodeFrom acha nela', () => {
    expect(inviteCodeFrom(inviteMessage('Casa', 'KM2P9Q', 'https://kotii.app'))).toBe('KM2P9Q');
    expect(inviteCodeFrom(inviteMessage('Casa', 'KM2P9Q', null))).toBe('KM2P9Q');
  });
});

describe('o código guardado de um link', () => {
  const now = Date.parse('2026-11-15T12:00:00Z');
  const day = 24 * 60 * 60 * 1000;

  it(`vale por ${PENDING_INVITE_DAYS} dias`, () => {
    expect(pendingInviteValid(now - day, now)).toBe(true);
    expect(pendingInviteValid(now - PENDING_INVITE_DAYS * day + 1, now)).toBe(true);
    expect(pendingInviteValid(now - PENDING_INVITE_DAYS * day, now)).toBe(false);
  });

  it('uma data no futuro (relógio mexido) ou estragada não vale', () => {
    expect(pendingInviteValid(now + day, now)).toBe(false);
    expect(pendingInviteValid(Number.NaN, now)).toBe(false);
  });
});

describe('os campos', () => {
  it('o nome: sem os espaços das pontas, de 1 a 60 letras', () => {
    expect(readDisplayName('  Ana  ')).toEqual({ ok: true, value: 'Ana' });
    expect(readDisplayName('   ').ok).toBe(false);
    expect(readDisplayName('a'.repeat(PROFILE_NAME_MAX)).ok).toBe(true);
    expect(readDisplayName('a'.repeat(PROFILE_NAME_MAX + 1)).ok).toBe(false);
  });

  it('o nome da casa não fica vazio', () => {
    expect(readHouseName(' Casa da Ana ')).toEqual({ ok: true, value: 'Casa da Ana' });
    expect(readHouseName('  ').ok).toBe(false);
  });

  it('reenviar mostra a espera', () => {
    expect(resendLabel(0)).toBe('Reenviar o e-mail');
    expect(resendLabel(12)).toBe('Reenviar o e-mail em 12 s');
  });
});
