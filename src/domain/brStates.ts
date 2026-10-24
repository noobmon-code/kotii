// O nome de cada estado com a preposição de costume, pelo código do IBGE (os
// dois primeiros dígitos da chave de acesso). Espelho da tabela da função nfce
// (supabase/functions/nfce/uf.ts), que escreve o aviso de CAPTCHA do mesmo
// jeito: um teste confere que as duas não se separam.

const STATES: Record<string, [name: string, preposition: 'da' | 'do' | 'de']> = {
  '11': ['Rondônia', 'de'],
  '12': ['Acre', 'do'],
  '13': ['Amazonas', 'do'],
  '14': ['Roraima', 'de'],
  '15': ['Pará', 'do'],
  '16': ['Amapá', 'do'],
  '17': ['Tocantins', 'do'],
  '21': ['Maranhão', 'do'],
  '22': ['Piauí', 'do'],
  '23': ['Ceará', 'do'],
  '24': ['Rio Grande do Norte', 'do'],
  '25': ['Paraíba', 'da'],
  '26': ['Pernambuco', 'de'],
  '27': ['Alagoas', 'de'],
  '28': ['Sergipe', 'de'],
  '29': ['Bahia', 'da'],
  '31': ['Minas Gerais', 'de'],
  '32': ['Espírito Santo', 'do'],
  '33': ['Rio de Janeiro', 'do'],
  '35': ['São Paulo', 'de'],
  '41': ['Paraná', 'do'],
  '42': ['Santa Catarina', 'de'],
  '43': ['Rio Grande do Sul', 'do'],
  '50': ['Mato Grosso do Sul', 'de'],
  '51': ['Mato Grosso', 'de'],
  '52': ['Goiás', 'de'],
  '53': ['Distrito Federal', 'do'],
};

/** O nome e a preposição de cada código, para o teste que compara com a função. */
export const STATE_NAMES: Readonly<Record<string, readonly [string, string]>> = STATES;

/** "da Paraíba" para o código 25; null para código que não é de estado nenhum. */
export function stateOf(code: string): string | null {
  if (!Object.prototype.hasOwnProperty.call(STATES, code)) return null;
  const [name, preposition] = STATES[code];
  return `${preposition} ${name}`;
}
