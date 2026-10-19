// Quando o que a busca leu vale como leitura do servidor (receipt_reads, que
// alimenta os preços de outras casas). A busca aceita qualquer .gov.br
// (parse.ts, isSefazUrl) para o rascunho da casa; mas uma página .gov.br com
// HTML de terceiros (um arquivo enviado a um portal, um subdomínio abandonado)
// não pode virar preço na base de todos. Então a leitura só é gravada quando a
// página dos itens veio por https de um endereço de consulta da NFC-e das 27
// Sefaz, e todo endereço buscado no caminho (o do QR, os redirecionamentos e
// os saltos de página) também é um deles. Fora disso, a nota é lida do mesmo
// jeito, só sem leitura (e não compartilha). Sem rede: testado em official.test.ts.
//
// Os hosts são os de consulta pelo QR code e de consulta pública em produção
// (a tabela do Portal da NFC-e, como a reproduzem os emissores, p. ex. o
// wsnfe_4.00_mod65.xml e o uri_consulta_nfce.json do sped-nfe), mais os que a
// busca já percorre (PB: www4 e receita; RN: sefaz e app). Ambiente de
// homologação não entra. Uma Sefaz que mudar de endereço só deixa de
// compartilhar até entrar aqui.

const HOSTS_BY_STATE: Record<string, readonly string[]> = {
  AC: ['www.sefaznet.ac.gov.br'],
  AL: ['nfce.sefaz.al.gov.br', 'www.sefaz.al.gov.br'],
  AM: ['sistemas.sefaz.am.gov.br', 'www.sefaz.am.gov.br'],
  AP: ['www.sefaz.ap.gov.br'],
  BA: ['nfe.sefaz.ba.gov.br', 'www.sefaz.ba.gov.br'],
  CE: ['nfce.sefaz.ce.gov.br', 'www.sefaz.ce.gov.br'],
  DF: ['www.fazenda.df.gov.br'],
  ES: ['app.sefaz.es.gov.br', 'www.sefaz.es.gov.br'],
  GO: ['nfeweb.sefaz.go.gov.br', 'nfe.sefaz.go.gov.br', 'www.sefaz.go.gov.br'],
  MA: ['www.nfce.sefaz.ma.gov.br', 'www.sefaz.ma.gov.br'],
  MG: ['portalsped.fazenda.mg.gov.br'],
  MS: ['www.dfe.ms.gov.br'],
  MT: ['www.sefaz.mt.gov.br'],
  PA: ['appnfc.sefa.pa.gov.br', 'www.sefa.pa.gov.br'],
  PB: ['www.sefaz.pb.gov.br', 'www4.sefaz.pb.gov.br', 'www.receita.pb.gov.br', 'www4.receita.pb.gov.br'],
  PE: ['nfce.sefaz.pe.gov.br'],
  PI: ['www.sefaz.pi.gov.br'],
  PR: ['www.fazenda.pr.gov.br'],
  RJ: ['consultadfe.fazenda.rj.gov.br', 'www4.fazenda.rj.gov.br', 'www.fazenda.rj.gov.br'],
  RN: ['nfce.set.rn.gov.br', 'www.set.rn.gov.br', 'nfce.sefaz.rn.gov.br', 'www.sefaz.rn.gov.br', 'app.sefaz.rn.gov.br'],
  RO: ['www.nfce.sefin.ro.gov.br', 'www.sefin.ro.gov.br'],
  RR: ['www.sefaz.rr.gov.br'],
  RS: ['www.sefaz.rs.gov.br', 'dfe-portal.svrs.rs.gov.br'],
  SC: ['sat.sef.sc.gov.br'],
  SE: ['www.nfce.se.gov.br'],
  SP: ['www.nfce.fazenda.sp.gov.br'],
  TO: ['www.sefaz.to.gov.br'],
};

/** Os estados da lista: os 27. */
export const OFFICIAL_STATES: readonly string[] = Object.keys(HOSTS_BY_STATE);

const HOSTS = new Set(Object.values(HOSTS_BY_STATE).flat());

function parsed(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

/** Endereço de consulta da NFC-e de uma Sefaz (http ou https, sem usuário nem porta). */
export function isOfficialNfceUrl(value: string): boolean {
  const url = parsed(value);
  return !!url && (url.protocol === 'https:' || url.protocol === 'http:') && !url.username && !url.password && !url.port &&
    HOSTS.has(url.hostname.toLowerCase());
}

/**
 * A busca pode ir para receipt_reads: a página de onde saíram os itens veio por
 * https de um endereço oficial, e todo endereço buscado também é oficial.
 */
export function isOfficialRead(fetched: readonly string[], pageUrl: string): boolean {
  return parsed(pageUrl)?.protocol === 'https:' && isOfficialNfceUrl(pageUrl) && fetched.length > 0 && fetched.every(isOfficialNfceUrl);
}
