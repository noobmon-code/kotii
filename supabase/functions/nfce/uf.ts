// Estado da nota pela chave de acesso: os dois primeiros dígitos da chave são
// o código IBGE da UF (cUF). Serve para dizer de qual Sefaz é o aviso. Sem
// rede: testado em uf.test.ts.

export interface BrState {
  /** Código IBGE (cUF), dois dígitos. */
  code: string;
  uf: string;
  name: string;
  /** Nome com a preposição de costume: "da Paraíba", "do Ceará", "de São Paulo". */
  of: string;
}

const STATES: Record<string, [uf: string, name: string, preposition: 'da' | 'do' | 'de']> = {
  '11': ['RO', 'Rondônia', 'de'],
  '12': ['AC', 'Acre', 'do'],
  '13': ['AM', 'Amazonas', 'do'],
  '14': ['RR', 'Roraima', 'de'],
  '15': ['PA', 'Pará', 'do'],
  '16': ['AP', 'Amapá', 'do'],
  '17': ['TO', 'Tocantins', 'do'],
  '21': ['MA', 'Maranhão', 'do'],
  '22': ['PI', 'Piauí', 'do'],
  '23': ['CE', 'Ceará', 'do'],
  '24': ['RN', 'Rio Grande do Norte', 'do'],
  '25': ['PB', 'Paraíba', 'da'],
  '26': ['PE', 'Pernambuco', 'de'],
  '27': ['AL', 'Alagoas', 'de'],
  '28': ['SE', 'Sergipe', 'de'],
  '29': ['BA', 'Bahia', 'da'],
  '31': ['MG', 'Minas Gerais', 'de'],
  '32': ['ES', 'Espírito Santo', 'do'],
  '33': ['RJ', 'Rio de Janeiro', 'do'],
  '35': ['SP', 'São Paulo', 'de'],
  '41': ['PR', 'Paraná', 'do'],
  '42': ['SC', 'Santa Catarina', 'de'],
  '43': ['RS', 'Rio Grande do Sul', 'do'],
  '50': ['MS', 'Mato Grosso do Sul', 'de'],
  '51': ['MT', 'Mato Grosso', 'de'],
  '52': ['GO', 'Goiás', 'de'],
  '53': ['DF', 'Distrito Federal', 'do'],
};

/** Códigos IBGE das 27 UFs, em ordem. */
export const STATE_CODES: readonly string[] = Object.keys(STATES);

/** UF pelo código IBGE ("25" -> Paraíba), ou null se o código não for de uma UF. */
export function stateFromCode(code: string): BrState | null {
  if (!Object.hasOwn(STATES, code)) return null;
  const [uf, name, preposition] = STATES[code];
  return { code, uf, name, of: `${preposition} ${name}` };
}

/** Chave de acesso do link do QR (`p=chave|...` ou `chNFe=chave`), ou null. */
export function accessKeyFromQr(qrUrl: string): string | null {
  let url: URL;
  try {
    url = new URL(qrUrl);
  } catch {
    return null;
  }
  const raw = url.searchParams.get('p') ?? url.searchParams.get('chNFe') ?? '';
  const key = raw.split('|')[0].replace(/\D/g, '');
  return /^\d{44}$/.test(key) ? key : null;
}

/** UF da nota pelo link do QR, ou null se não houver chave ou o código não for de uma UF. */
export function stateOfQr(qrUrl: string): BrState | null {
  const key = accessKeyFromQr(qrUrl);
  return key ? stateFromCode(key.slice(0, 2)) : null;
}
