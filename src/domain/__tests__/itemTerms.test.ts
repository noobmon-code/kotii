import { describe, expect, it } from '@jest/globals';

import { termRegex, wordForms } from '../itemTerms';

// As formas de uma palavra (singular e plural) que a busca na base aberta de preços procura: as mesmas que o termo
// do item aceita (termRegex), pelas mesmas regras.

const matches = (term: string, text: string) => new RegExp(termRegex(term).source).test(text);

describe('wordForms', () => {
  it('cada regra de plural, como inflect', () => {
    expect(wordForms('feijao')).toEqual(['feijao', 'feijoes', 'feijaes', 'feijaos']);
    expect(wordForms('hamburguer')).toEqual(['hamburguer', 'hamburgueres', 'hamburguers']);
    expect(wordForms('arroz')).toEqual(['arroz', 'arrozes', 'arrozs']);
    expect(wordForms('frances')).toEqual(['frances', 'franceses']);
    expect(wordForms('papel')).toEqual(['papel', 'papeis']);
    expect(wordForms('atum')).toEqual(['atum', 'atuns']);
    expect(wordForms('ovo')).toEqual(['ovo', 'ovos']);
    expect(wordForms('de')).toEqual(['de']);
  });

  it('toda forma casa com o termo da palavra', () => {
    for (const word of ['feijao', 'pao', 'hamburguer', 'arroz', 'frances', 'papel', 'atum', 'ovo', 'leite', 'abacaxi', 'noz', 'mel', 'de', 'com']) {
      for (const form of wordForms(word)) expect([word, form, matches(word, form)]).toEqual([word, form, true]);
    }
  });
});
