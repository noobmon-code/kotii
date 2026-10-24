import { describe, expect, it } from '@jest/globals';

import {
  accessKeyUf,
  CAPTCHA_STATE_DAYS,
  captchaStateNote,
  captchaStateStep,
  parseCaptchaStates,
  withCaptchaState,
} from '../captchaStates';
import { accessKeyCheckDigit } from '../nfce';

const keyOf = (body: string) => body + accessKeyCheckDigit(body);
// PB (25) e SP (35), out/2026, modelo 65.
const PB_KEY = keyOf('25' + '2610' + '12345678000199' + '65' + '001' + '000012345' + '1' + '12345678');
const SP_KEY = keyOf('35' + '2610' + '12345678000199' + '65' + '001' + '000012345' + '1' + '12345678');
const NOW = new Date('2026-10-24T12:00:00.000Z');
const DAY = 24 * 60 * 60 * 1000;
const ago = (days: number) => new Date(NOW.getTime() - days * DAY).toISOString();

describe('UF da chave', () => {
  it('são os dois primeiros dígitos, quando são de um estado', () => {
    expect(accessKeyUf(PB_KEY)).toBe('25');
    expect(accessKeyUf(SP_KEY)).toBe('35');
    expect(accessKeyUf('99' + PB_KEY.slice(2))).toBeNull();
    expect(accessKeyUf('')).toBeNull();
  });
});

describe('o que fazer com uma nota nova', () => {
  it('vai direto para a pendente enquanto o CAPTCHA da UF tem menos de 7 dias', () => {
    expect(CAPTCHA_STATE_DAYS).toBe(7);
    expect(captchaStateStep({ '25': ago(0) }, PB_KEY, NOW)).toBe('photo');
    expect(captchaStateStep({ '25': ago(6.9) }, PB_KEY, NOW)).toBe('photo');
  });

  it('passados os 7 dias, tenta a Sefaz de novo', () => {
    expect(captchaStateStep({ '25': ago(7) }, PB_KEY, NOW)).toBe('fetch');
    expect(captchaStateStep({ '25': ago(30) }, PB_KEY, NOW)).toBe('fetch');
  });

  it('outra UF, nada guardado ou uma data no futuro (o relógio mudou): vai à Sefaz', () => {
    expect(captchaStateStep({ '25': ago(1) }, SP_KEY, NOW)).toBe('fetch');
    expect(captchaStateStep({}, PB_KEY, NOW)).toBe('fetch');
    expect(captchaStateStep({ '25': ago(-1) }, PB_KEY, NOW)).toBe('fetch');
  });
});

describe('o que fica guardado', () => {
  it('guarda a UF com a hora e tira as que venceram', () => {
    expect(withCaptchaState({ '35': ago(8), '26': ago(2) }, '25', NOW)).toEqual({ '26': ago(2), '25': NOW.toISOString() });
  });

  it('o mesmo estado de novo recomeça o prazo; código que não é de estado não entra', () => {
    expect(withCaptchaState({ '25': ago(5) }, '25', NOW)).toEqual({ '25': NOW.toISOString() });
    expect(withCaptchaState({}, '99', NOW)).toEqual({});
  });

  it('lê só UF com data; texto corrompido não guarda nada', () => {
    expect(parseCaptchaStates(JSON.stringify({ '25': ago(1), '99': ago(1), '35': 'ontem', '26': 3 }))).toEqual({ '25': ago(1) });
    expect(parseCaptchaStates('{')).toEqual({});
    expect(parseCaptchaStates('[]')).toEqual({});
    expect(parseCaptchaStates(null)).toEqual({});
  });
});

describe('a frase da pendente', () => {
  it('diz o estado e que o app tenta de novo', () => {
    expect(captchaStateNote(PB_KEY)).toBe(
      'A Sefaz-PB pediu essa confirmação numa nota recente, então as notas de lá entram direto pelos prints. Daqui a uma semana, o app tenta a Sefaz de novo.',
    );
  });
});
