import { describe, expect, it } from '@jest/globals';

import {
  cepFieldLabel,
  cepIncompleteOnCreate,
  cepLookupFailedMessage,
  cepUnreachableMessage,
  HOUSE_PLACE_OPTIONAL,
  HOUSE_PLACE_ROW_HINT,
  HOUSE_PLACE_ROW_UNKNOWN,
  HOUSE_PLACE_WHERE,
  housePlaceHouseLine,
  housePlaceRowSubtitle,
  openHouseName,
  placeFoundAnnouncement,
  PLACE_NOT_SAVED_OFFLINE,
  placeNotSavedMessage,
  placeOnCreate,
  placeSourceLabel,
} from '../housePlace';

const PLACE = { label: 'Pinheiros, São Paulo' };

describe('placeOnCreate', () => {
  it('sem CEP no campo e sem lugar achado: a pessoa pulou, a casa é criada sem o bairro', () => {
    expect(placeOnCreate('', null)).toEqual({ kind: 'none' });
    expect(placeOnCreate('   ', null)).toEqual({ kind: 'none' });
  });

  it('com o lugar achado e o campo vazio: vale o achado', () => {
    expect(placeOnCreate('', PLACE)).toEqual({ kind: 'use', place: PLACE });
  });

  it('um CEP completo no campo ainda não foi buscado: busca antes de criar, mesmo com outro lugar achado', () => {
    expect(placeOnCreate('05422-030', null)).toEqual({ kind: 'lookup', cep: '05422030' });
    expect(placeOnCreate('05422030', PLACE)).toEqual({ kind: 'lookup', cep: '05422030' });
  });

  it('um CEP com números faltando não deixa criar (nem com um lugar achado antes)', () => {
    expect(placeOnCreate('0542', null)).toEqual({ kind: 'incomplete' });
    expect(placeOnCreate('05422-03', PLACE)).toEqual({ kind: 'incomplete' });
  });
});

describe('os textos do lugar da casa', () => {
  it('a linha de Configurações diz o lugar; sem ele, convida; antes de saber, não convida', () => {
    expect(housePlaceRowSubtitle(PLACE)).toBe('Pinheiros, São Paulo');
    expect(housePlaceRowSubtitle(null)).toBe(HOUSE_PLACE_ROW_HINT);
    expect(housePlaceRowSubtitle(undefined)).toBe(HOUSE_PLACE_ROW_UNKNOWN);
    expect(HOUSE_PLACE_ROW_UNKNOWN).not.toBe(HOUSE_PLACE_ROW_HINT);
  });

  it('com mais de uma casa, a linha e a tela do clima dizem de qual casa é o lugar (a aberta)', () => {
    const one = { household: { name: 'Casa da Ana' }, households: [{ id: 'h1' }] };
    const two = { household: { name: 'Casa da praia' }, households: [{ id: 'h1' }, { id: 'h2' }] };
    expect(openHouseName(one)).toBeNull();
    expect(openHouseName(null)).toBeNull();
    expect(openHouseName(undefined)).toBeNull();
    expect(openHouseName(two)).toBe('Casa da praia');
    expect(housePlaceRowSubtitle(PLACE, 'Casa da praia')).toBe('Casa da praia · Pinheiros, São Paulo');
    expect(housePlaceRowSubtitle(null, 'Casa da praia')).toBe(`Casa da praia · ${HOUSE_PLACE_ROW_HINT}`);
    expect(housePlaceRowSubtitle(undefined, 'Casa da praia')).toBe(`Casa da praia · ${HOUSE_PLACE_ROW_UNKNOWN}`);
    expect(housePlaceRowSubtitle(PLACE, null)).toBe('Pinheiros, São Paulo');
    expect(housePlaceHouseLine('Casa da praia')).toBe('Da casa “Casa da praia”. Para outra casa, troque de casa no topo da tela Hoje.');
  });

  it('o que é opcional e o que falhou apontam para Configurações → Clima da casa', () => {
    expect(HOUSE_PLACE_WHERE).toBe('Configurações → Clima da casa');
    expect(HOUSE_PLACE_OPTIONAL).toContain(HOUSE_PLACE_WHERE);
    // O título da parte já diz "(opcional)", e o fim diz onde ficam as dicas, com ou sem um lugar achado.
    expect(HOUSE_PLACE_OPTIONAL).toBe('As dicas ficam em Configurações → Clima da casa, onde dá para definir ou mudar o bairro depois.');
    expect(HOUSE_PLACE_OPTIONAL).not.toMatch(/opcional|em branco/i);
    const notSaved = placeNotSavedMessage('Sem permissão.');
    expect(notSaved).toBe('Não deu para salvar onde fica a casa. Sem permissão. Defina depois em Configurações → Clima da casa.');
  });

  it('sem internet, o aviso do lugar não salvo não manda tentar de novo (o formulário já fechou)', () => {
    expect(placeNotSavedMessage(PLACE_NOT_SAVED_OFFLINE)).toBe(
      'Não deu para salvar onde fica a casa. Sem internet agora. Defina depois em Configurações → Clima da casa.',
    );
    expect(placeNotSavedMessage(PLACE_NOT_SAVED_OFFLINE)).not.toContain('Tente de novo');
  });

  it('o CEP não achado diz que a casa não foi criada', () => {
    expect(cepLookupFailedMessage('CEP não encontrado. Confira os números.')).toBe(
      'CEP não encontrado. Confira os números. A casa ainda não foi criada. Se preferir, apague o CEP para criar a casa sem o bairro.',
    );
    // O motivo já manda conferir o CEP: a frase não pede de novo.
    expect(cepLookupFailedMessage('CEP não encontrado. Confira os números.').match(/confira/gi)).toHaveLength(1);
  });

  it('o CEP sem resposta (com cara de sem internet): ainda diz que a casa não foi criada e como seguir sem o CEP', () => {
    expect(cepUnreachableMessage('Sem internet agora. Tente de novo quando a conexão voltar.')).toBe(
      'Sem internet agora. Tente de novo quando a conexão voltar. A casa ainda não foi criada. Se a internet estiver funcionando, apague o CEP para criar a casa sem o bairro.',
    );
    expect(cepUnreachableMessage('Sem internet agora.', 'Pinheiros, São Paulo')).toBe(
      'Sem internet agora. A casa ainda não foi criada. Se a internet estiver funcionando, apague o CEP para ficar com Pinheiros, São Paulo.',
    );
  });

  it('com um lugar achado antes, apagar o CEP fica com ele (não cria sem o bairro)', () => {
    expect(cepLookupFailedMessage('CEP não encontrado. Confira os números.', 'Pinheiros, São Paulo')).toBe(
      'CEP não encontrado. Confira os números. A casa ainda não foi criada. Se preferir, apague o CEP para ficar com Pinheiros, São Paulo.',
    );
    expect(cepIncompleteOnCreate('Pinheiros, São Paulo')).toBe(
      'Digite os 8 números do CEP. Ou apague o CEP para ficar com Pinheiros, São Paulo.',
    );
  });

  it('o CEP com números faltando, sem lugar achado: apagar cria sem o bairro', () => {
    expect(cepIncompleteOnCreate(null)).toBe('Digite os 8 números do CEP. Ou apague o CEP para criar a casa sem o bairro.');
    expect(cepIncompleteOnCreate()).toBe(cepIncompleteOnCreate(null));
  });

  it('o campo do CEP diz que muda o lugar quando já há um, na tela do clima e ao criar', () => {
    expect(cepFieldLabel(false)).toBe('CEP');
    expect(cepFieldLabel(true)).toBe('Mudar pelo CEP');
  });

  it('o leitor de tela ouve o lugar achado', () => {
    expect(placeFoundAnnouncement('Pinheiros, São Paulo')).toBe('Local da casa: Pinheiros, São Paulo');
  });

  it('como o lugar foi achado', () => {
    expect(placeSourceLabel('cep')).toBe('Pelo CEP');
    expect(placeSourceLabel('gps')).toBe('Pela localização do celular');
  });
});
