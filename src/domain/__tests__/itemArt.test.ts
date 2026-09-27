import { describe, expect, it } from '@jest/globals';

import { COMMON_ITEMS } from '../commonItems';
import { ITEM_ART_KEYS, matchItemArt } from '../itemArt';

describe('matchItemArt', () => {
  it('reconhece o item pelo nome, com marca, acento e plural', () => {
    expect(matchItemArt('Leite Italac Integral 1L')).toBe('leite');
    expect(matchItemArt('Arroz Tio João 5kg')).toBe('arroz');
    expect(matchItemArt('Maçãs')).toBe('maca');
    expect(matchItemArt('LEITE UHT ITALAC INT 1L')).toBe('leite');
    expect(matchItemArt('Ovos (dúzia)')).toBe('ovos');
    expect(matchItemArt('Batata-doce')).toBe('batata');
    expect(matchItemArt('Coca-Cola 2L')).toBe('refrigerante');
  });

  it('usa a palavra inteira e a regra mais específica primeiro', () => {
    expect(matchItemArt('Macarrão espaguete')).toBe('macarrao');
    expect(matchItemArt('Salsicha')).toBe('linguica');
    expect(matchItemArt('Suco de laranja')).toBe('suco');
    expect(matchItemArt('Molho de tomate')).toBe('molho_tomate');
    expect(matchItemArt('Peito de frango')).toBe('peito_frango');
    expect(matchItemArt('Pão de hambúrguer')).toBe('pao_frances');
    expect(matchItemArt('Água sanitária')).toBe('agua_sanitaria');
    expect(matchItemArt('Requeijão')).toBe('requeijao');
    expect(matchItemArt('Couve-flor')).toBe('brocolis');
    expect(matchItemArt('Farinha de mandioca')).toBe('farinha');
    expect(matchItemArt('Melão')).toBe('melao');
    expect(matchItemArt('Chá (sachê)')).toBe('cha');
  });

  it('dá o desenho do produto, não do sabor ou do ingrediente', () => {
    expect(matchItemArt('Iogurte de morango')).toBe('iogurte');
    expect(matchItemArt('Bolo de banana')).toBe('bolo');
    expect(matchItemArt('Chocolate ao leite')).toBe('chocolate');
    expect(matchItemArt('Biscoito de chocolate')).toBe('biscoito');
    expect(matchItemArt('Nuggets de frango')).toBe('nuggets');
    expect(matchItemArt('Linguiça de frango')).toBe('linguica');
    expect(matchItemArt('Picolé de limão')).toBe('sorvete');
    expect(matchItemArt('Café com leite')).toBe('cafe');
    expect(matchItemArt('Sorvete de doce de leite')).toBe('sorvete');
    expect(matchItemArt('Bolo de leite condensado')).toBe('bolo');
  });

  it('produto sem desenho não pega o desenho do sabor', () => {
    expect(matchItemArt('Gelatina de morango')).toBeNull();
    expect(matchItemArt('Salgadinho sabor queijo')).toBeNull();
    expect(matchItemArt('Ração sabor frango')).toBeNull();
    expect(matchItemArt('Mini pizza')).toBe('pizza');
    expect(matchItemArt('Nescau achocolatado')).toBe('chocolate');
    expect(matchItemArt('Filé de tilápia')).toBe('peixe');
    expect(matchItemArt('Lata de atum')).toBe('atum');
    expect(matchItemArt('Barra de cereal')).toBe('cereal');
  });

  it('reconhece plurais irregulares', () => {
    expect(matchItemArt('Mamões')).toBe('mamao');
    expect(matchItemArt('Melões')).toBe('melao');
    expect(matchItemArt('Pimentões')).toBe('pimentao');
    expect(matchItemArt('Pães franceses')).toBe('pao_frances');
    expect(matchItemArt('Hambúrgueres')).toBe('hamburguer');
    expect(matchItemArt('Atuns em lata')).toBe('atum');
    expect(matchItemArt('Bombons sortidos')).toBe('chocolate');
    expect(matchItemArt('Talharins')).toBe('macarrao');
    expect(matchItemArt('Nuggets')).toBe('nuggets');
  });

  it('reconhece o plural na primeira palavra de nomes compostos', () => {
    expect(matchItemArt('Pães de forma')).toBe('pao_forma');
    expect(matchItemArt('Molhos de tomate')).toBe('molho_tomate');
    expect(matchItemArt('Sacos de lixo')).toBe('saco_lixo');
    expect(matchItemArt('Papéis higiênicos')).toBe('papel_higienico');
    expect(matchItemArt('Pastas de dente')).toBe('pasta_dente');
    expect(matchItemArt('Escovas  de dente')).toBe('escova_dente');
  });

  it('deixa a ilustração da categoria quando a palavra engana ou não há desenho', () => {
    expect(matchItemArt('Caldo de carne')).toBeNull();
    expect(matchItemArt('Pão de queijo congelado')).toBeNull();
    expect(matchItemArt('Leite condensado')).toBeNull();
    expect(matchItemArt('Papel toalha')).toBeNull();
    expect(matchItemArt('Filtro de café')).toBeNull();
    expect(matchItemArt('')).toBeNull();
  });

  it('cobre boa parte do catálogo de itens comuns', () => {
    const matched = COMMON_ITEMS.filter((item) => matchItemArt(item.name) !== null).length;
    expect(matched / COMMON_ITEMS.length).toBeGreaterThan(0.5);
  });

  it('não repete chaves', () => {
    expect(new Set(ITEM_ART_KEYS).size).toBe(ITEM_ART_KEYS.length);
  });
});
