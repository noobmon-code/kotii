import { describe, expect, it } from '@jest/globals';

import { TERMS_CONTACT, TERMS_SECTIONS, TERMS_VERSION, termsVersionLabel } from '../terms';

const all = TERMS_SECTIONS.flatMap((section) => [section.title, ...section.paragraphs]).join('\n');
const section = (title: string) => TERMS_SECTIONS.find((s) => s.title === title)?.paragraphs.join('\n') ?? '';

describe('termos de uso', () => {
  it('a versão é uma data e aparece como dia/mês/ano', () => {
    expect(TERMS_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(termsVersionLabel('2026-10-18')).toBe('Versão de 18/10/2026');
  });

  it('cada seção tem título único e texto', () => {
    expect(new Set(TERMS_SECTIONS.map((s) => s.title)).size).toBe(TERMS_SECTIONS.length);
    for (const s of TERMS_SECTIONS) expect(s.paragraphs.every((p) => p.trim().length > 0)).toBe(true);
  });

  it('o contato fica marcado para o dono preencher, nos pedidos da LGPD e no fim', () => {
    expect(TERMS_CONTACT).toBe('[e-mail de contato]');
    expect(section('Seus direitos (LGPD)')).toContain(TERMS_CONTACT);
    expect(section('Mudanças e contato')).toContain(TERMS_CONTACT);
  });

  it('os preços compartilhados: sempre ligados, sem identificar a casa e com o dia em que foram vistos', () => {
    const prices = section('Preços compartilhados');
    expect(prices).toContain('Toda casa contribui e toda casa vê');
    // Não há escolha: "por padrão" daria a entender que dá para desligar.
    expect(prices.toLowerCase()).not.toContain('por padrão');
    expect(prices).toContain('CNPJ');
    expect(prices).toContain('não são em tempo real');
    expect(prices).toContain('não tem como desligar');
    expect(prices).toContain('nem quantas são');
  });

  it('diz para quem vão as fotos e as conversas lidas por IA, e o Pluggy do consultor', () => {
    expect(all).toContain('Anthropic');
    expect(all).toContain('OpenRouter');
    expect(section('Consultor financeiro (beta)')).toContain('MeuPluggy');
    expect(section('Inteligência artificial')).toContain('fora do Brasil');
  });

  it('o resumo que vai ao Nuke diz que leva nomes, remédios e consultas de cada pessoa', () => {
    const ai = section('Inteligência artificial');
    for (const part of ['o seu nome e os dos moradores', 'quem toma cada um', 'de quem é cada uma', 'aniversários', 'orçamento']) {
      expect(ai).toContain(part);
    }
  });

  it('apagar: diz o que não sai pelo app e manda o resto para o contato', () => {
    const erase = section('Apagar dados e sair');
    expect(erase).toContain('os remédios só são arquivados');
    expect(erase).toContain(`Para apagar tudo o que é seu, escreva para ${TERMS_CONTACT}.`);
    // Quem sai deixa a ficha de saúde como dependente.
    expect(section('Sua conta e sua casa')).toContain('vira a ficha de um dependente');
  });
});
