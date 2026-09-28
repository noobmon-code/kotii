// Lê a página de consulta pública da NFC-e (o link do QR code). A maioria dos
// estados usa o mesmo leiaute do Portal da NFC-e: nome do mercado em
// .txtTopo, CNPJ e endereço em .text, cada item com .txtTit (descrição),
// .RCod, .Rqtd, .RUN, .RvlUnit e .valor, total em "Valor a pagar R$" e a
// data em "Emissão:". Sem rede: testado em parse.test.ts.

export interface NfcePage {
  store: { name: string | null; cnpj: string | null; address: string | null };
  /**
   * Hora da emissão como a nota mostra, na hora local de onde a compra foi
   * feita e sem fuso ("AAAA-MM-DDTHH:MM:SS"): o app lê no fuso do celular.
   * Pelo estado não dá para saber o fuso (o oeste do AM e Noronha diferem do
   * resto). null se a página não trouxer.
   */
  issuedAtLocal: string | null;
  total: number | null;
  items: { description: string; code: string | null; quantity: number; unit: string; unitPrice: number; totalPrice: number }[];
}

const NAMED: Record<string, string> = {
  nbsp: ' ',
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  aacute: 'á', eacute: 'é', iacute: 'í', oacute: 'ó', uacute: 'ú',
  Aacute: 'Á', Eacute: 'É', Iacute: 'Í', Oacute: 'Ó', Uacute: 'Ú',
  atilde: 'ã', otilde: 'õ', Atilde: 'Ã', Otilde: 'Õ',
  acirc: 'â', ecirc: 'ê', ocirc: 'ô', Acirc: 'Â', Ecirc: 'Ê', Ocirc: 'Ô',
  agrave: 'à', Agrave: 'À', ccedil: 'ç', Ccedil: 'Ç', uuml: 'ü', Uuml: 'Ü', ordm: 'º', ordf: 'ª',
};

export function decodeEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&([a-z]+);/gi, (entity, name) => NAMED[name] ?? entity);
}

/** Texto limpo: sem tags, entidades decodificadas, espaços juntados. */
export function textOf(html: string): string {
  return decodeEntities(html.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

/** "1.234,56" -> 1234.56; "0,325" -> 0.325; null se não houver número. */
export function parseBRNumber(text: string): number | null {
  const match = text.match(/-?\d[\d.]*(?:,\d+)?/);
  if (!match) return null;
  const value = Number(match[0].replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(value) ? value : null;
}

function field(chunk: string, className: string): string | null {
  const match = chunk.match(new RegExp(`class="${className}"[^>]*>([\\s\\S]*?)</span>`, 'i'));
  return match ? textOf(match[1]) : null;
}

/** Tira o rótulo ("Qtde.:", "UN:", "Vl. Unit.:") e devolve o valor. */
function afterLabel(text: string | null): string {
  return (text ?? '').replace(/^[^:]*:\s*/, '').trim();
}

export function parseNfceHtml(html: string): NfcePage {
  // Cada item começa numa descrição (<span class="txtTit">); o resto do item
  // vem até a próxima.
  const starts = [...html.matchAll(/<span[^>]*class="txtTit\d?"[^>]*>/gi)].map((m) => m.index!);
  const items: NfcePage['items'] = [];
  for (let i = 0; i < starts.length; i++) {
    const chunk = html.slice(starts[i], starts[i + 1] ?? html.length);
    const description = textOf(chunk.match(/^<span[^>]*>([\s\S]*?)<\/span>/i)?.[1] ?? '');
    const totalPrice = parseBRNumber(field(chunk, 'valor') ?? '');
    if (!description || totalPrice === null) continue;
    const quantity = parseBRNumber(afterLabel(field(chunk, 'Rqtd'))) ?? 1;
    const unitPrice = parseBRNumber(afterLabel(field(chunk, 'RvlUnit'))) ?? 0;
    const code = (field(chunk, 'RCod') ?? '').replace(/\D/g, '') || null;
    items.push({ description, code, quantity, unit: afterLabel(field(chunk, 'RUN')) || 'UN', unitPrice, totalPrice });
  }

  const name = html.match(/class="txtTopo"[^>]*>([\s\S]*?)<\/div>/i);
  const texts = [...html.matchAll(/<div[^>]*class="text"[^>]*>([\s\S]*?)<\/div>/gi)].map((m) => textOf(m[1]));
  const cnpjText = texts.find((t) => /CNPJ/i.test(t));
  const cnpj = cnpjText?.replace(/\D/g, '').slice(0, 14) || null;
  const address = texts.find((t) => t !== cnpjText && t.length > 5) ?? null;

  const plain = textOf(html);
  const totalMatch = plain.match(/Valor a pagar R\$:?\s*([\d.]+,\d{2})/i) ?? plain.match(/Valor total R\$:?\s*([\d.]+,\d{2})/i);
  const when = plain.match(/Emiss[ãa]o:?\s*(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})(?::(\d{2}))?/i);

  return {
    store: { name: name ? textOf(name[1]) || null : null, cnpj: cnpj && cnpj.length === 14 ? cnpj : null, address },
    issuedAtLocal: when ? `${when[3]}-${when[2]}-${when[1]}T${when[4]}:${when[5]}:${when[6] ?? '00'}` : null,
    total: totalMatch ? parseBRNumber(totalMatch[1]) : null,
    items,
  };
}

/** Só links de Sefaz (domínios .gov.br), em http ou https. */
export function isSefazUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (url.protocol === 'https:' || url.protocol === 'http:') && url.hostname.endsWith('.gov.br') && !url.username && !url.port;
  } catch {
    return false;
  }
}
