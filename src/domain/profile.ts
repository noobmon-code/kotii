// O perfil da pessoa (Configurações → Perfil): o nome, que os moradores veem em todas as casas dela, e a data
// de nascimento e o telefone, opcionais, que só ela vê (tabela profiles, gravada pela save_my_profile). As
// regras daqui são as mesmas da função no banco (supabase/migrations/20261022120000_profiles.sql): a tela
// recusa o que o banco recusaria, com as mesmas palavras. Puro.

import { parseBRDate } from './dates';

/** O nome tem de 1 a 60 letras, depois de tirar os espaços das pontas. */
export const PROFILE_NAME_MAX = 60;
/** A data de nascimento mais antiga que o app aceita (antes disso é erro de digitação no ano). */
export const BIRTH_DATE_MIN = '1900-01-01';

// Os espaços que o banco tira das pontas ([[:space:]] do Postgres): os mesmos aqui, para o nome ter o
// mesmo tamanho dos dois lados.
const EDGE_SPACES = /^[ \t\n\r\f\v]+|[ \t\n\r\f\v]+$/g;

/** O nome como ele é gravado: sem os espaços das pontas. */
export function cleanName(text: string): string {
  return text.replace(EDGE_SPACES, '');
}

/** Letras do nome como o banco conta (char_length conta cada emoji como um). */
const nameLength = (name: string) => [...name].length;

/** Só os dígitos do telefone. */
export function phoneDigits(text: string): string {
  return text.replace(/\D/g, '');
}

/** Com o DDD, um telefone tem 10 dígitos (fixo) ou 11 (celular). */
export function isValidPhone(digits: string): boolean {
  return /^\d{10,11}$/.test(digits);
}

/** "83999999999" → "(83) 99999-9999"; "8333334444" → "(83) 3333-4444"; aos poucos, enquanto digita. */
export function formatPhone(digits: string): string {
  if (!digits) return '';
  if (digits.length > 11) return digits;
  const ddd = digits.slice(0, 2);
  if (digits.length <= 2) return `(${ddd}`;
  if (digits.length <= 6) return `(${ddd}) ${digits.slice(2)}`;
  // O hífen fica antes dos 4 últimos: 4 + 4 no fixo, 5 + 4 no celular.
  const split = digits.length === 11 ? 7 : 6;
  return `(${ddd}) ${digits.slice(2, split)}-${digits.slice(split)}`;
}

/**
 * Máscara do telefone enquanto digita. `previous` é o valor anterior: apagar um parêntese, o espaço ou o
 * hífen apaga também o dígito antes dele (senão a máscara o poria de volta e o campo pareceria travado).
 * Com mais de 11 dígitos (um +55 colado, dois números), fica só com os dígitos, e o aviso diz o que corrigir.
 */
export function maskPhone(next: string, previous = ''): string {
  let digits = phoneDigits(next);
  const deleting = next.length < previous.length && previous.startsWith(next);
  if (deleting && digits === phoneDigits(previous)) digits = digits.slice(0, -1);
  return formatPhone(digits);
}

/** O telefone guardado, para mostrar no campo. */
export function phoneFieldText(stored: string | null): string {
  return stored ? formatPhone(stored) : '';
}

type Invalid = { ok: false; title: string; message: string };
const invalid = (title: string, message: string): Invalid => ({ ok: false, title, message });

/** As frases de cada recusa: as mesmas para a tela e para os códigos do banco (NK012, NK013, NK014). */
export const PROFILE_MESSAGES = {
  nameEmpty: 'Escreva o seu nome: é como os moradores das suas casas veem você.',
  nameLong: `O nome pode ter até ${PROFILE_NAME_MAX} letras.`,
  birthDate: 'Confira a data de nascimento: o dia, o mês e o ano (dd/mm/aaaa).',
  birthYear: 'Escreva o ano de nascimento com quatro números (por exemplo, 1985).',
  birthFuture: 'A data de nascimento não pode ser depois de hoje.',
  birthOld: 'A data de nascimento precisa ser de 1900 em diante.',
  phone: 'Confira o telefone: com o DDD, são 10 ou 11 números, como (83) 99999-9999.',
} as const;

/** O formulário como a pessoa digitou. */
export interface ProfileForm {
  name: string;
  /** dd/mm/aaaa, ou vazio. */
  birthDate: string;
  /** Como está no campo, com ou sem a máscara. */
  phone: string;
}

/** O que vai para a save_my_profile. */
export interface ProfileValues {
  name: string;
  /** AAAA-MM-DD, ou null. */
  birthDate: string | null;
  /** Só os dígitos, ou null. */
  phone: string | null;
}

/** A data de nascimento digitada: null quando vazia, ou o motivo da recusa. */
export function readBirthDate(text: string, today: string): { ok: true; value: string | null } | Invalid {
  const value = text.trim();
  if (!value) return { ok: true, value: null };
  // "10/05/85" seria 2085 para o parseBRDate (feito para vencimentos): aqui, pede o ano inteiro.
  if (/^\d{1,2}\/\d{1,2}\/\d{2}$/.test(value)) return invalid('Confira a data', PROFILE_MESSAGES.birthYear);
  const iso = parseBRDate(value);
  if (!iso) return invalid('Confira a data', PROFILE_MESSAGES.birthDate);
  if (iso > today) return invalid('Confira a data', PROFILE_MESSAGES.birthFuture);
  if (iso < BIRTH_DATE_MIN) return invalid('Confira a data', PROFILE_MESSAGES.birthOld);
  return { ok: true, value: iso };
}

/** Confere o formulário (`today` em AAAA-MM-DD, o dia do aparelho) e devolve o que gravar, ou o aviso. */
export function validateProfile(form: ProfileForm, today: string): { ok: true; values: ProfileValues } | Invalid {
  const name = cleanName(form.name);
  if (!name) return invalid('Confira o nome', PROFILE_MESSAGES.nameEmpty);
  if (nameLength(name) > PROFILE_NAME_MAX) return invalid('Nome comprido demais', PROFILE_MESSAGES.nameLong);
  const birth = readBirthDate(form.birthDate, today);
  if (!birth.ok) return birth;
  const digits = phoneDigits(form.phone);
  if (digits && !isValidPhone(digits)) return invalid('Confira o telefone', PROFILE_MESSAGES.phone);
  return { ok: true, values: { name, birthDate: birth.value, phone: digits || null } };
}

/** Os códigos de recusa da save_my_profile, com a frase de cada um. */
const SERVER_ERRORS: Record<string, string> = {
  NK012: `${PROFILE_MESSAGES.nameEmpty} O nome pode ter até ${PROFILE_NAME_MAX} letras.`,
  NK013: 'Confira a data de nascimento: ela precisa ser de 1900 em diante e não pode ser depois de hoje.',
  NK014: PROFILE_MESSAGES.phone,
};

/** A frase para uma recusa do banco ao salvar; null para outro erro. */
export function profileErrorMessage(code: unknown): string | null {
  return typeof code === 'string' ? (SERVER_ERRORS[code] ?? null) : null;
}

/** O app chegou antes da migração: sem a tabela ou a função, o perfil ainda não salva. */
export const PROFILE_NOT_READY = 'O perfil ainda está sendo ativado. Por enquanto, o nome fica como está em cada casa.';

/** Embaixo dos campos opcionais: quem vê o quê. */
export const PROFILE_PRIVACY =
  'A data de nascimento e o telefone são opcionais e ficam só na sua conta: os outros moradores não veem, e eles não vão para a IA nem para a base de preços.';

/** Embaixo do nome: ele vale em todas as casas da pessoa. */
export const PROFILE_NAME_HINT = 'É como os moradores veem você, em todas as suas casas.';

/** O formulário ainda diz o que está guardado? (para o "Salvar" só aparecer ligado quando há o que salvar) */
export function profileChanged(form: ProfileForm, saved: ProfileValues, today: string): boolean {
  const read = validateProfile(form, today);
  if (!read.ok) return true;
  const v = read.values;
  return v.name !== saved.name || v.birthDate !== saved.birthDate || v.phone !== saved.phone;
}
