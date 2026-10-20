import { describe, expect, it } from '@jest/globals';

import {
  accountDeletionNotes,
  accountDeletionUnavailable,
  type DeletionHouse,
  FORMER_MEMBER,
  houseList,
  housesToDelete,
  memberName,
} from '../account';
import { TERMS_CONTACT } from '../terms';

const members = [
  { user_id: 'ana', display_name: 'Ana' },
  { user_id: 'beto', display_name: 'Beto' },
];

const house = (name: string, extra: Partial<DeletionHouse> = {}): DeletionHouse => ({
  id: name.toLowerCase(),
  name,
  role: 'member',
  last: false,
  finance: false,
  ...extra,
});

describe('quem fez o registro', () => {
  it('morador pelo nome; quem saiu ou apagou a conta como "Ex-morador"; ninguém marcado, sem nome', () => {
    expect(memberName(members, 'beto')).toBe('Beto');
    expect(memberName(members, 'caio')).toBe(FORMER_MEMBER);
    expect(FORMER_MEMBER).toBe('Ex-morador');
    expect(memberName(members, null)).toBeNull();
    expect(memberName(members, undefined)).toBeNull();
  });
});

describe('apagar a conta: o que o app avisa antes', () => {
  it('os nomes das casas, com "e" no fim', () => {
    expect(houseList(['Casa'])).toBe('"Casa"');
    expect(houseList(['A', 'B'])).toBe('"A" e "B"');
    expect(houseList(['A', 'B', 'C'])).toBe('"A", "B" e "C"');
    expect(houseList([])).toBe('');
  });

  it('só as casas em que a pessoa é a última vão para a lista do que será apagado', () => {
    expect(housesToDelete([house('Praia', { last: true }), house('Cidade'), house('Sítio', { last: true })])).toEqual(['praia', 'sítio']);
    expect(housesToDelete([])).toEqual([]);
  });

  it('casa dividida e casa só dela: o que fica (também os documentos e a ficha), o que some e quem fica responsável', () => {
    const notes = accountDeletionNotes([house('Cidade', { role: 'owner' }), house('Praia', { last: true })]);
    expect(notes[0]).toContain('Não tem volta');
    expect(notes[1]).toBe(
      `Em "Cidade", o que você registrou continua com a casa: listas, notas, gastos, tarefas, documentos e fotos. A sua ficha, com a saúde e os documentos, vira a ficha de um dependente, que os outros moradores continuam vendo e editando, e nos acertos da divisão de gastos você aparece como "Ex-morador". A casa em que você é responsável passa para o morador mais antigo. Se não quiser que fique, apague antes o que o app deixa apagar e peça o resto pelo e-mail ${TERMS_CONTACT}.`,
    );
    expect(notes[2]).toBe(
      'Você é a última pessoa em "Praia": a casa é apagada junto, com tudo o que tem (listas, notas, despensa, tarefas, saúde, documentos e fotos).',
    );
    expect(notes.join(' ')).not.toContain('consultor');
    expect(notes.at(-1)).toContain('Neste aparelho, a conta sai e os avisos param.');
  });

  it('várias casas: no plural, e sem falar de responsável quando ela não é', () => {
    const notes = accountDeletionNotes([house('A'), house('B'), house('C', { last: true }), house('D', { last: true })]);
    expect(notes[1].startsWith('Nas casas "A" e "B", o que você registrou')).toBe(true);
    expect(notes[1]).not.toContain('responsável');
    expect(notes[2]).toContain('"C" e "D": essas casas são apagadas junto, com tudo o que têm');
  });

  it('com o consultor em alguma casa, avisa que ele sai junto e que o MeuPluggy continua', () => {
    const notes = accountDeletionNotes([house('Cidade', { finance: true })]);
    expect(notes.some((n) => n.startsWith('O consultor financeiro sai junto') && n.includes('MeuPluggy'))).toBe(true);
  });

  it('sem casa nenhuma: só o login e o aparelho', () => {
    const notes = accountDeletionNotes([]);
    expect(notes).toHaveLength(2);
    expect(notes[0]).toBe('Apagar a conta apaga o seu login. Não tem volta: para usar o Kotii de novo, só criando outra conta.');
  });

  it('sem a função no servidor, manda escrever para o contato', () => {
    expect(accountDeletionUnavailable('contato@exemplo.com')).toBe(
      'Apagar a conta pelo app ainda não está disponível. Para apagar agora, escreva para contato@exemplo.com a partir do e-mail da conta.',
    );
  });
});
