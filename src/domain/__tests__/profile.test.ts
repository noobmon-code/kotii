import { describe, expect, it } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';

import {
  BIRTH_DATE_MIN,
  cleanName,
  formatPhone,
  isValidPhone,
  maskPhone,
  PROFILE_MESSAGES,
  PROFILE_NAME_MAX,
  profileChanged,
  profileErrorMessage,
  phoneFieldText,
  readBirthDate,
  validateProfile,
} from '../profile';

const TODAY = '2026-10-22';
const form = (over: Partial<{ name: string; birthDate: string; phone: string }> = {}) => ({
  name: 'Ana',
  birthDate: '',
  phone: '',
  ...over,
});

describe('telefone', () => {
  it('a máscara: fixo com 4 + 4, celular com 5 + 4, sempre com o DDD entre parênteses', () => {
    expect(formatPhone('8333334444')).toBe('(83) 3333-4444');
    expect(formatPhone('83999999999')).toBe('(83) 99999-9999');
  });

  it('aparece aos poucos, enquanto digita', () => {
    const steps = ['8', '83', '839', '8399', '83999', '839999', '8399999', '83999999', '839999999', '8399999999', '83999999999'];
    expect(steps.map(formatPhone)).toEqual([
      '(8',
      '(83',
      '(83) 9',
      '(83) 99',
      '(83) 999',
      '(83) 9999',
      '(83) 9999-9',
      '(83) 9999-99',
      '(83) 9999-999',
      '(83) 9999-9999',
      '(83) 99999-9999',
    ]);
    // Digitando um por um, a máscara leva de um ao outro.
    let text = '';
    for (const digit of '83999999999') text = maskPhone(text + digit, text);
    expect(text).toBe('(83) 99999-9999');
  });

  it('apagar o hífen, o espaço ou o parêntese apaga o dígito antes dele', () => {
    expect(maskPhone('(83) 9999', '(83) 9999-')).toBe('(83) 999');
    expect(maskPhone('(83) 3333-444', '(83) 3333-4444')).toBe('(83) 3333-444');
    expect(maskPhone('(83)', '(83) ')).toBe('(8');
    expect(maskPhone('(83', '(83)')).toBe('(8');
    expect(maskPhone('', '(')).toBe('');
  });

  it('no meio do número também: apagar o hífen, o espaço ou o parêntese apaga o dígito antes dele', () => {
    expect(maskPhone('(83) 999999999', '(83) 99999-9999')).toBe('(83) 9999-9999');
    expect(maskPhone('(83)99999-9999', '(83) 99999-9999')).toBe('(89) 9999-9999');
    // Nos dois sai um 3 e sobram 9 dígitos, que a máscara redistribui: 83 | 3334 | 444.
    expect(maskPhone('(83 3333-4444', '(83) 3333-4444')).toBe('(83) 3334-444');
    expect(maskPhone('(83) 33334444', '(83) 3333-4444')).toBe('(83) 3334-444');
    // O "(" do começo: não há dígito antes, fica como estava.
    expect(maskPhone('83) 3333-4444', '(83) 3333-4444')).toBe('(83) 3333-4444');
  });

  it('colar com outros sinais vale; o +55 do Brasil sai; com mais de 11 dígitos ficam só os dígitos', () => {
    expect(maskPhone('83 9.9999-9999')).toBe('(83) 99999-9999');
    expect(maskPhone('+55 83 99999-9999')).toBe('(83) 99999-9999');
    expect(maskPhone('+55 (83) 3333-4444')).toBe('(83) 3333-4444');
    // DDD 55 (RS) com 10 ou 11 dígitos não é o código do país.
    expect(maskPhone('55 99999-9999')).toBe('(55) 99999-9999');
    expect(maskPhone('83 99999-9999 83 3333-4444')).toBe('839999999998333334444');
  });

  it('válido com 10 ou 11 dígitos, nem mais nem menos', () => {
    expect(isValidPhone('8333334444')).toBe(true);
    expect(isValidPhone('83999999999')).toBe(true);
    expect(isValidPhone('999999999')).toBe(false);
    expect(isValidPhone('5583999999999')).toBe(false);
    expect(isValidPhone('')).toBe(false);
  });

  it('o guardado volta para o campo com a máscara', () => {
    expect(phoneFieldText('83999999999')).toBe('(83) 99999-9999');
    expect(phoneFieldText(null)).toBe('');
  });
});

describe('data de nascimento', () => {
  it('vazia é sem data; dd/mm/aaaa vira AAAA-MM-DD', () => {
    expect(readBirthDate('', TODAY)).toEqual({ ok: true, value: null });
    expect(readBirthDate('  ', TODAY)).toEqual({ ok: true, value: null });
    expect(readBirthDate('05/03/1985', TODAY)).toEqual({ ok: true, value: '1985-03-05' });
  });

  it('não pode ser depois de hoje; hoje pode', () => {
    expect(readBirthDate('22/10/2026', TODAY)).toEqual({ ok: true, value: TODAY });
    expect(readBirthDate('23/10/2026', TODAY)).toMatchObject({ ok: false, message: PROFILE_MESSAGES.birthFuture });
  });

  it('a partir de 1900', () => {
    expect(BIRTH_DATE_MIN).toBe('1900-01-01');
    expect(readBirthDate('01/01/1900', TODAY)).toEqual({ ok: true, value: '1900-01-01' });
    expect(readBirthDate('31/12/1899', TODAY)).toMatchObject({ ok: false, message: PROFILE_MESSAGES.birthOld });
  });

  it('o ano com dois números pede o ano inteiro (não vira 2085); data que não existe pede para conferir', () => {
    expect(readBirthDate('10/05/85', TODAY)).toMatchObject({ ok: false, message: PROFILE_MESSAGES.birthYear });
    expect(readBirthDate('31/02/1990', TODAY)).toMatchObject({ ok: false, message: PROFILE_MESSAGES.birthDate });
    expect(readBirthDate('1990', TODAY)).toMatchObject({ ok: false, message: PROFILE_MESSAGES.birthDate });
  });
});

describe('nome', () => {
  it('sem os espaços das pontas; vazio não vale', () => {
    expect(cleanName('  Ana Maria \n')).toBe('Ana Maria');
    expect(validateProfile(form({ name: '   ' }), TODAY)).toMatchObject({ ok: false, message: PROFILE_MESSAGES.nameEmpty });
  });

  it('até 60 letras, contadas como o banco conta (um emoji é uma)', () => {
    expect(PROFILE_NAME_MAX).toBe(60);
    expect(validateProfile(form({ name: 'a'.repeat(60) }), TODAY).ok).toBe(true);
    expect(validateProfile(form({ name: 'a'.repeat(61) }), TODAY)).toMatchObject({ ok: false, message: PROFILE_MESSAGES.nameLong });
    // 30 emojis são 60 unidades no JavaScript, mas 30 letras no Postgres.
    expect(validateProfile(form({ name: '😀'.repeat(30) }), TODAY).ok).toBe(true);
    expect(validateProfile(form({ name: '😀'.repeat(61) }), TODAY).ok).toBe(false);
  });
});

describe('o formulário inteiro', () => {
  it('devolve o que gravar: nome limpo, data ISO, telefone só com dígitos (vazio é null)', () => {
    expect(validateProfile(form({ name: ' Ana ', birthDate: '05/03/1985', phone: '(83) 99999-9999' }), TODAY)).toEqual({
      ok: true,
      values: { name: 'Ana', birthDate: '1985-03-05', phone: '83999999999' },
    });
    expect(validateProfile(form(), TODAY)).toEqual({ ok: true, values: { name: 'Ana', birthDate: null, phone: null } });
  });

  it('o +55 colado vale como o número sem ele', () => {
    expect(validateProfile(form({ phone: '+55 83 99999-9999' }), TODAY)).toMatchObject({
      ok: true,
      values: { phone: '83999999999' },
    });
  });

  it('recusa o telefone incompleto ou com dígitos demais', () => {
    for (const phone of ['(83) 9999', '83 99999-9999 83 3333-4444']) {
      expect(validateProfile(form({ phone }), TODAY)).toMatchObject({ ok: false, message: PROFILE_MESSAGES.phone });
    }
  });

  it('mudou: compara o que seria gravado com o que está guardado', () => {
    const saved = { name: 'Ana', birthDate: '1985-03-05', phone: '83999999999' };
    expect(profileChanged(form({ name: 'Ana ', birthDate: '05/03/1985', phone: '83 99999 9999' }), saved, TODAY)).toBe(false);
    expect(profileChanged(form({ name: 'Ana Maria', birthDate: '05/03/1985', phone: '83999999999' }), saved, TODAY)).toBe(true);
    expect(profileChanged(form({ birthDate: '', phone: '83999999999' }), saved, TODAY)).toBe(true);
    // Um formulário que não passa conta como mudado: o toque em "Salvar" mostra o que corrigir.
    expect(profileChanged(form({ name: '' }), saved, TODAY)).toBe(true);
  });
});

describe('as recusas do banco', () => {
  it('cada código da save_my_profile tem a frase dele; outro erro não', () => {
    expect(profileErrorMessage('NK012')).toContain(PROFILE_MESSAGES.nameEmpty);
    expect(profileErrorMessage('NK013')).toContain('1900');
    expect(profileErrorMessage('NK014')).toBe(PROFILE_MESSAGES.phone);
    expect(profileErrorMessage('NK010')).toBeNull();
    expect(profileErrorMessage(undefined)).toBeNull();
  });

  it('a migração recusa o mesmo que a tela: os limites e os códigos são os daqui', () => {
    const sql = readFileSync(join(__dirname, '../../../supabase/migrations/20261022120000_profiles.sql'), 'utf8');
    expect(sql).toContain(`between 1 and ${PROFILE_NAME_MAX}`);
    expect(sql).toContain(`date '${BIRTH_DATE_MIN}'`);
    expect(sql).toContain("in (10, 11)");
    expect(sql).toContain("'^[0-9]{10,11}$'");
    // Os espaços tirados das pontas do nome: os mesmos do cleanName.
    expect(sql).toContain("'^[[:space:]]+|[[:space:]]+$'");
    for (const code of ['NK012', 'NK013', 'NK014']) expect(sql).toContain(`errcode = '${code}'`);
  });
});
