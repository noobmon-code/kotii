// Onde fica a casa (o bairro do clima): os textos de Configurações → Clima da casa e da parte opcional "Onde fica a
// casa" de quem cria uma casa (bem-vindo e Suas casas), e a regra do que fazer com o lugar no toque de criar.

import { normalizeCep } from './weather';

/** O nome da tela do clima (/clima) e da linha que a abre em Configurações. */
export const HOUSE_PLACE_TITLE = 'Clima da casa';

/** Onde se define o bairro depois: as telas que falam disso apontam para cá. */
export const HOUSE_PLACE_WHERE = 'Configurações → Clima da casa';

/** A linha de Configurações quando a casa não tem bairro. */
export const HOUSE_PLACE_ROW_HINT = 'Diga o bairro para receber as dicas e os avisos do clima';

/** A linha de Configurações antes de saber se a casa tem bairro (lendo, ou a leitura falhou sem nada guardado). */
export const HOUSE_PLACE_ROW_UNKNOWN = 'Onde fica a casa, para as dicas do tempo';

/** O botão (e a pergunta, na tela do clima) que tira o lugar da casa: o lugar pode ser só a cidade. */
export const HOUSE_PLACE_REMOVE = 'Tirar o local';

/** O que fica guardado: o mesmo texto na tela do clima e ao criar a casa. */
export const HOUSE_PLACE_PRIVACY =
  'Fica guardado só o bairro (um ponto com cerca de 1 km de precisão), não o endereço. Vale para toda a casa.';

/** O convite da parte "Onde fica a casa" ao criar uma casa. */
export const HOUSE_PLACE_CREATE_INTRO = 'Com o bairro, o Kotii dá dicas do tempo: dia de lavar roupa, chuva chegando, calor, frio.';

export const HOUSE_PLACE_OPTIONAL = `É opcional: dá para deixar em branco e definir depois em ${HOUSE_PLACE_WHERE}.`;

export const CEP_INCOMPLETE_TITLE = 'CEP incompleto';
export const CEP_INCOMPLETE = 'Digite os 8 números do CEP.';

/**
 * O que apagar o CEP digitado faz no toque de criar: sem lugar achado, cria sem o bairro; com um achado antes, a
 * casa fica com ele (para criar sem, é "Tirar o local").
 */
function withoutCep(foundLabel: string | null | undefined, verb: string): string {
  return foundLabel ? `${verb} para ficar com ${foundLabel}` : `${verb} para criar a casa sem o bairro`;
}

/** No toque de criar a casa, o CEP com números faltando: também pode sair. */
export function cepIncompleteOnCreate(foundLabel?: string | null): string {
  return `${CEP_INCOMPLETE} Ou ${withoutCep(foundLabel, 'apague o CEP')}.`;
}

export const PLACE_SEARCH_FAILED_TITLE = 'Não foi possível definir o bairro';

export const CEP_LOOKUP_FAILED_TITLE = 'Não deu para achar o CEP';

/** O CEP digitado e não buscado não foi achado no toque de criar: a casa não foi criada. */
export function cepLookupFailedMessage(reason: string, foundLabel?: string | null): string {
  return `${reason} A casa ainda não foi criada: confira o CEP ou ${withoutCep(foundLabel, 'apague-o')}.`;
}

/** O que o leitor de tela diz quando o lugar da casa nova é achado (a troca do texto não avisa sozinha). */
export function placeFoundAnnouncement(label: string): string {
  return `Local da casa: ${label}`;
}

export const PLACE_NOT_SAVED_TITLE = 'A casa foi criada, sem o bairro';

/**
 * O motivo quando o pedido do lugar não chegou ao servidor: a frase comum ("Sem internet agora. Tente de novo…") não
 * serve aqui, porque o formulário já fechou e não há o que tentar de novo nele.
 */
export const PLACE_NOT_SAVED_OFFLINE = 'Sem internet agora.';

/** A casa foi criada, mas o lugar dela não foi salvo (`reason`, uma frase inteira). */
export function placeNotSavedMessage(reason: string): string {
  return `Não deu para salvar onde fica a casa. ${reason} Defina depois em ${HOUSE_PLACE_WHERE}.`;
}

/** Como o lugar foi achado, embaixo do nome dele. */
export function placeSourceLabel(source: 'cep' | 'gps'): string {
  return source === 'gps' ? 'Pela localização do celular' : 'Pelo CEP';
}

/**
 * O nome da casa aberta, só para quem tem mais de uma: o lugar vale para a casa aberta, e Configurações e a tela do
 * clima dizem qual é (com uma casa só, não há o que confundir).
 */
export function openHouseName(state: { household: { name: string }; households: readonly unknown[] } | null | undefined): string | null {
  return state && state.households.length > 1 ? state.household.name : null;
}

/** Na tela do clima, de quem tem mais de uma casa: de qual casa é o lugar, e onde trocar. */
export function housePlaceHouseLine(houseName: string): string {
  return `Da casa “${houseName}”. Para outra casa, troque de casa no topo da tela Hoje.`;
}

/**
 * A linha "Clima da casa" de Configurações: o lugar da casa; sem ele (`null`, a leitura respondeu), o convite; antes
 * de saber (`undefined`: lendo, ou a leitura falhou sem nada guardado), uma frase neutra, para não convidar a definir
 * um bairro que a casa talvez já tenha. Com `houseName` (quem tem mais de uma casa, `openHouseName`), o nome da casa
 * aberta vem antes.
 */
export function housePlaceRowSubtitle(location: { label: string } | null | undefined, houseName?: string | null): string {
  const text = location === undefined ? HOUSE_PLACE_ROW_UNKNOWN : (location?.label ?? HOUSE_PLACE_ROW_HINT);
  return houseName ? `${houseName} · ${text}` : text;
}

/**
 * O que fazer com o lugar no toque de criar a casa: um CEP no campo ainda não foi buscado (depois de achar, o campo
 * fica vazio), então vale ele, buscado antes de criar (`lookup`), ou a pessoa é avisada se faltam números
 * (`incomplete`, e nada é criado); com o campo vazio, vale o lugar já achado (`use`), ou nenhum (`none`: pulou).
 */
export type PlaceOnCreate<P> = { kind: 'none' } | { kind: 'use'; place: P } | { kind: 'lookup'; cep: string } | { kind: 'incomplete' };

export function placeOnCreate<P>(cepText: string, found: P | null): PlaceOnCreate<P> {
  if (cepText.trim()) {
    const cep = normalizeCep(cepText);
    return cep ? { kind: 'lookup', cep } : { kind: 'incomplete' };
  }
  return found ? { kind: 'use', place: found } : { kind: 'none' };
}
