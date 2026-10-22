import { describe, expect, it } from '@jest/globals';

import { advanceOf, fitSize, greeting, greetingName, textWidth } from '../greeting';

// A largura que o título tem ao lado do desenho do clima (skyTextWidth em features/SkyHeader, conferida no teste do
// título): a janela (no máximo a coluna de 720) menos 44 de recuo, 20 de margem e 141 do desenho.
const PHONE_360 = 155;
const PHONE_393 = 188;
const PHONE_412 = 207;
const WEB_720 = 515;

const at = (h: number, m = 0) => new Date(2026, 9, 21, h, m);

describe('greeting', () => {
  it('diz bom dia das 5 às 11, boa tarde das 12 às 17 e boa noite no resto', () => {
    expect(greeting(at(4, 59))).toBe('Boa noite');
    expect(greeting(at(5))).toBe('Bom dia');
    expect(greeting(at(11, 59))).toBe('Bom dia');
    expect(greeting(at(12))).toBe('Boa tarde');
    expect(greeting(at(17, 59))).toBe('Boa tarde');
    expect(greeting(at(18))).toBe('Boa noite');
    expect(greeting(at(0))).toBe('Boa noite');
  });
});

describe('textWidth', () => {
  it('soma as larguras da tabela da Nunito ExtraBold', () => {
    // A 753 + n 595 + d 610 + r 412 + é 549 = 2919 milésimos.
    expect(textWidth('André', 30)).toBeCloseTo(87.57, 5);
    // O espaçamento entra uma vez por letra.
    expect(textWidth('André', 30, -0.3)).toBeCloseTo(86.07, 5);
    expect(textWidth('', 30)).toBe(0);
  });

  it('dá às letras com acento e cedilha a largura da letra de base', () => {
    expect(advanceOf('É')).toBe(advanceOf('E'));
    expect(advanceOf('ç')).toBe(478);
    expect(advanceOf('Ã')).toBe(753);
    expect(advanceOf('ü')).toBe(590);
    expect(advanceOf('ß')).toBe(676);
    expect(advanceOf('7')).toBe(600);
    expect(advanceOf(' ')).toBe(279);
  });

  it('conta o que não está na tabela como a maior maiúscula', () => {
    expect(advanceOf('W')).toBe(1120);
    expect(advanceOf('✓')).toBe(1120);
    expect(advanceOf('李')).toBe(1120);
  });
});

describe('greetingName', () => {
  it('André Barbusci: o nome inteiro onde couber até 26, senão o primeiro nome', () => {
    // O nome inteiro pede (7,3 × tamanho − 4,2) × 1,05: 225,5 a 30, 202,5 a 27, 194,9 a 26.
    expect(greetingName('André Barbusci', PHONE_360)).toEqual({ text: 'André', fontSize: 30 });
    expect(greetingName('André Barbusci', PHONE_393)).toEqual({ text: 'André', fontSize: 30 });
    expect(greetingName('André Barbusci', PHONE_412)).toEqual({ text: 'André Barbusci', fontSize: 27 });
    expect(greetingName('André Barbusci', WEB_720)).toEqual({ text: 'André Barbusci', fontSize: 30 });
  });

  it('dá a "Boa tarde," o maior tamanho que cabe numa linha', () => {
    // "Boa tarde," a 30 pede 151,6 com a folga; com a largura de 135 (letra do sistema a 1,15 no de 360), 26.
    expect(fitSize('Boa tarde,', PHONE_360, 30, 22)).toBe(30);
    expect(fitSize('Boa tarde,', PHONE_360 / 1.15, 30, 22)).toBe(26);
    expect(fitSize('Boa tarde,', 50, 30, 22)).toBeNull();
  });

  it('mede o acento solto como a letra acentuada, e o emoji como largo', () => {
    const decomposed = `Andre${String.fromCharCode(0x301)}`;
    expect(textWidth(decomposed, 30, -0.3)).toBeCloseTo(textWidth('André', 30, -0.3), 5);
    expect(advanceOf(String.fromCharCode(0x200d))).toBe(0);
    expect(advanceOf(String.fromCharCode(0xfe0f))).toBe(0);
    expect(advanceOf(String.fromCodePoint(0x1f389))).toBe(1400);
  });

  it('encolhe o primeiro nome que não cabe a 30', () => {
    // "Bartolomeu" a 30 pede 173,5 com a folga; a 26, 150,3.
    expect(greetingName('Bartolomeu Silva', PHONE_360)).toEqual({ text: 'Bartolomeu', fontSize: 26 });
    expect(greetingName('Bartolomeu Silva', PHONE_412)).toEqual({ text: 'Bartolomeu', fontSize: 30 });
  });

  it('para em 22 quando nem assim cabe (a linha corta com reticências)', () => {
    const name = 'Hermenegildo-Constantino';
    expect(textWidth(name, 22, -0.3) * 1.05).toBeGreaterThan(PHONE_360);
    expect(greetingName(`${name} Souza`, PHONE_360)).toEqual({ text: name, fontSize: 22 });
    expect(greetingName(name, 0)).toEqual({ text: name, fontSize: 22 });
  });

  it('respeita outro tamanho e outro mínimo', () => {
    expect(greetingName('Bartolomeu', PHONE_360, { size: 24, min: 20 })).toEqual({ text: 'Bartolomeu', fontSize: 24 });
    expect(greetingName('Hermenegildo-Constantino', PHONE_360, { size: 24, min: 20 })).toEqual({
      text: 'Hermenegildo-Constantino',
      fontSize: 20,
    });
  });

  it('tira os espaços das pontas e junta os do meio; nome vazio, texto vazio', () => {
    expect(greetingName('  André    Barbusci  ', WEB_720)).toEqual({ text: 'André Barbusci', fontSize: 30 });
    expect(greetingName('  André    Barbusci  ', PHONE_360)).toEqual({ text: 'André', fontSize: 30 });
    expect(greetingName('', PHONE_360)).toEqual({ text: '', fontSize: 30 });
    expect(greetingName('   ', PHONE_360)).toEqual({ text: '', fontSize: 30 });
  });
});
