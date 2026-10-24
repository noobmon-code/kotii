import { describe, expect, it } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';

import { APP_DASHBOARD_FORBIDDEN } from '../appDashboard';
import {
  applyFeedbackUpdate,
  cleanFeedbackText,
  defaultFeedbackStatus,
  FEEDBACK_DAILY_LIMIT,
  FEEDBACK_GONE,
  FEEDBACK_INVALID,
  FEEDBACK_KIND_LABELS,
  FEEDBACK_KINDS,
  FEEDBACK_LIMIT,
  FEEDBACK_LIST_LIMIT,
  FEEDBACK_MAX_LENGTH,
  FEEDBACK_NO_EMAIL,
  FEEDBACK_NOTE_TOO_LONG,
  FEEDBACK_PLATFORMS,
  FEEDBACK_STATUS_LABELS,
  FEEDBACK_STATUSES,
  FEEDBACK_TITLE_MAX,
  feedbackDateTime,
  feedbackDetail,
  feedbackDevice,
  feedbackInboxView,
  feedbackKeyStep,
  feedbackLength,
  feedbackNoteChanged,
  feedbackNoteError,
  feedbackNoteToSave,
  feedbackPlatform,
  feedbackRow,
  feedbackStatusActions,
  feedbackStatusParam,
  feedbackTabLabel,
  feedbackTitle,
  feedbackWhen,
  filterFeedback,
  newFeedbackLine,
  newestFeedbackFirst,
  nextFeedbackSelection,
  parseFeedbackItem,
  parseFeedbackList,
  REPLY_URL_MAX,
  replyMailto,
  withOpenedFeedback,
  type FeedbackItem,
  type FeedbackList,
} from '../appFeedback';

const root = join(__dirname, '../../..');
const read = (path: string) => readFileSync(join(root, path), 'utf8');
const sqlList = (values: readonly string[]) => values.map((value) => `'${value}'`).join(', ');

/** Um instante no fuso do aparelho (o teste passa em qualquer TZ): mês de 1 a 12. */
const at = (year: number, month: number, day: number, hour = 0, minute = 0) => new Date(year, month - 1, day, hour, minute).toISOString();

const NOW = new Date(2026, 9, 24, 18, 0);

const rawItem = (over: Record<string, unknown> = {}) => ({
  id: 'a1',
  created_at: at(2026, 10, 24, 14, 5),
  updated_at: at(2026, 10, 24, 14, 5),
  kind: 'problema',
  message: 'A lista não atualiza quando abro no computador.',
  platform: 'web',
  app_version: '1.4.0',
  status: 'novo',
  note: null,
  email: 'ana@exemplo.com',
  ...over,
});

const rawList = (items: unknown[], over: Record<string, unknown> = {}) => ({
  counts: { novo: 2, lido: 1, resolvido: 0, arquivado: 3 },
  total: items.length,
  items,
  ...over,
});

const item = (over: Partial<FeedbackItem> = {}): FeedbackItem => ({
  id: 'a1',
  createdAt: at(2026, 10, 24, 14, 5),
  updatedAt: at(2026, 10, 24, 14, 5),
  kind: 'problema',
  message: 'A lista não atualiza quando abro no computador.',
  platform: 'web',
  appVersion: '1.4.0',
  status: 'novo',
  note: null,
  email: 'ana@exemplo.com',
  ...over,
});

const list = (items: FeedbackItem[], over: Partial<FeedbackList> = {}): FeedbackList => ({
  counts: { novo: 2, lido: 1, resolvido: 0, arquivado: 3 },
  total: items.length,
  items,
  ...over,
});

describe('o vocabulário é o mesmo da migração e da função nuke', () => {
  const sql = read('supabase/migrations/20261024150000_app_feedback.sql');

  it('tipos, situações, aparelhos e tamanhos', () => {
    expect(FEEDBACK_KINDS).toEqual(['problema', 'sugestao', 'elogio', 'outro']);
    expect(FEEDBACK_STATUSES).toEqual(['novo', 'lido', 'resolvido', 'arquivado']);
    expect(sql).toContain(`kind in (${sqlList(FEEDBACK_KINDS)})`);
    expect(sql).toContain(`p_kind not in (${sqlList(FEEDBACK_KINDS)})`);
    expect(sql).toContain(`status in (${sqlList(FEEDBACK_STATUSES)})`);
    expect(sql).toContain(`p_status not in (${sqlList(FEEDBACK_STATUSES)})`);
    expect(sql).toContain(`platform in (${sqlList(FEEDBACK_PLATFORMS)})`);
    expect(sql).toContain(`char_length(message) between 1 and ${FEEDBACK_MAX_LENGTH}`);
    expect(sql).toContain(`char_length(note) between 1 and ${FEEDBACK_MAX_LENGTH}`);
    expect(sql).toContain(`coalesce(p_limit, ${FEEDBACK_LIST_LIMIT})`);
    expect(sql).toContain(`p_limit integer default ${FEEDBACK_LIST_LIMIT}`);
  });

  it('o limite de 24 horas e as frases que a tela mostra como vêm', () => {
    expect(sql).toContain(`>= ${FEEDBACK_DAILY_LIMIT} then`);
    expect(sql).toContain(`raise exception '${FEEDBACK_LIMIT}' using errcode = 'NK015'`);
    expect(FEEDBACK_LIMIT).toBe('Você já mandou 10 recados nas últimas 24 horas. Tente de novo amanhã.');
    expect(sql).toContain(`raise exception '${FEEDBACK_GONE}' using errcode = 'P0002'`);
    expect(sql).toContain(`raise exception '${FEEDBACK_NOTE_TOO_LONG}' using errcode = '22023'`);
    // A porta é a do painel: a mesma recusa.
    expect(sql).toContain(`raise exception '${APP_DASHBOARD_FORBIDDEN}' using errcode = '42501'`);
  });

  it('a função nuke propõe os mesmos tipos, no mesmo tamanho', () => {
    const nuke = read('supabase/functions/nuke/nuke.ts');
    expect(nuke).toContain(`FEEDBACK_KINDS = [${sqlList(FEEDBACK_KINDS)}] as const`);
    expect(nuke).toContain(`FEEDBACK_MAX_LENGTH = ${FEEDBACK_MAX_LENGTH};`);
  });

  it('cada tipo e cada situação têm o seu nome na tela', () => {
    expect(Object.keys(FEEDBACK_KIND_LABELS)).toEqual([...FEEDBACK_KINDS]);
    expect(Object.values(FEEDBACK_KIND_LABELS)).toEqual(['Problema', 'Sugestão', 'Elogio', 'Outro']);
    expect(Object.keys(FEEDBACK_STATUS_LABELS)).toEqual([...FEEDBACK_STATUSES]);
    expect(Object.values(FEEDBACK_STATUS_LABELS)).toEqual(['Novo', 'Lido', 'Resolvido', 'Arquivado']);
  });
});

describe('o texto do recado', () => {
  it('conta como o banco: um emoji é um caractere', () => {
    expect(feedbackLength('Adorei 👍')).toBe(8);
    expect('Adorei 👍'.length).toBe(9);
  });

  it('aparado e cortado no tamanho da coluna, sem partir um emoji', () => {
    expect(cleanFeedbackText('  O app travou.\n')).toBe('O app travou.');
    expect(cleanFeedbackText('   ')).toBe('');
    expect(cleanFeedbackText(null)).toBe('');
    expect(cleanFeedbackText(42)).toBe('');
    const long = '👍'.repeat(FEEDBACK_MAX_LENGTH + 5);
    expect(feedbackLength(cleanFeedbackText(long))).toBe(FEEDBACK_MAX_LENGTH);
    expect(cleanFeedbackText(long)).toBe('👍'.repeat(FEEDBACK_MAX_LENGTH));
    // O corte não deixa espaço no fim.
    expect(cleanFeedbackText(`${'a'.repeat(FEEDBACK_MAX_LENGTH - 1)} bcd`)).toBe('a'.repeat(FEEDBACK_MAX_LENGTH - 1));
  });

  it('o aparelho: web, ios e android; outro sistema vai sem aparelho', () => {
    expect(feedbackPlatform('web')).toBe('web');
    expect(feedbackPlatform('ios')).toBe('ios');
    expect(feedbackPlatform('android')).toBe('android');
    expect(feedbackPlatform('windows')).toBeNull();
    expect(feedbackPlatform('macos')).toBeNull();
    expect(feedbackPlatform('')).toBeNull();
  });
});

describe('a resposta das rpc', () => {
  it('lê a lista em camelCase, com as contagens e o total', () => {
    const parsed = parseFeedbackList(rawList([rawItem(), rawItem({ id: 'b2', kind: 'elogio', status: 'lido', note: 'Respondido', platform: null, app_version: null })], { total: 5 }));
    expect(parsed.counts).toEqual({ novo: 2, lido: 1, resolvido: 0, arquivado: 3 });
    expect(parsed.total).toBe(5);
    expect(parsed.items).toEqual([
      item(),
      item({ id: 'b2', kind: 'elogio', status: 'lido', note: 'Respondido', platform: null, appVersion: null }),
    ]);
  });

  it('um tipo novo vira "outro" e o recado fica; uma situação nova deixa o recado de fora', () => {
    const parsed = parseFeedbackList(rawList([rawItem({ kind: 'duvida' }), rawItem({ id: 'b2', status: 'spam' })]));
    expect(parsed.items.map((entry) => [entry.id, entry.kind])).toEqual([['a1', 'outro']]);
    // Uma situação nova nas contagens tem de ser contagem também, e não muda as quatro.
    expect(parseFeedbackList(rawList([], { counts: { novo: 0, lido: 0, resolvido: 0, arquivado: 0, spam: 4 } })).counts).toEqual({
      novo: 0,
      lido: 0,
      resolvido: 0,
      arquivado: 0,
    });
  });

  it('aparelho desconhecido, e-mail, versão e nota em branco viram null', () => {
    const [parsed] = parseFeedbackList(rawList([rawItem({ platform: 'windows', email: ' ', app_version: '', note: '' })])).items;
    expect(parsed).toMatchObject({ platform: null, email: null, appVersion: null, note: null });
    const [missing] = parseFeedbackList(rawList([{ ...rawItem(), email: undefined, note: undefined }])).items;
    expect(missing).toMatchObject({ email: null, note: null });
  });

  it('formato quebrado: a frase de atualizar o app', () => {
    const broken: unknown[] = [
      null,
      [],
      rawList([], { items: null }),
      rawList([], { counts: undefined }),
      rawList([], { counts: { novo: 1, lido: 0, resolvido: 0 } }),
      rawList([], { counts: { novo: -1, lido: 0, resolvido: 0, arquivado: 0 } }),
      rawList([], { counts: { novo: 1.5, lido: 0, resolvido: 0, arquivado: 0 } }),
      rawList([], { counts: { novo: 0, lido: 0, resolvido: 0, arquivado: 0, spam: '2' } }),
      rawList([], { total: '3' }),
      rawList([rawItem(), rawItem()]),
      rawList([rawItem({ id: '' })]),
      rawList([rawItem({ message: '   ' })]),
      rawList([rawItem({ created_at: 'ontem' })]),
      rawList([rawItem({ updated_at: null })]),
      rawList([rawItem({ kind: null })]),
      rawList([rawItem({ status: 3 })]),
      rawList([rawItem({ email: 7 })]),
      rawList(['recado']),
    ];
    for (const raw of broken) expect(() => parseFeedbackList(raw)).toThrow(FEEDBACK_INVALID);
  });

  it('um recado só (set_app_feedback): uma situação desconhecida é resposta quebrada', () => {
    expect(parseFeedbackItem(rawItem({ status: 'resolvido', note: 'Feito' }))).toEqual(item({ status: 'resolvido', note: 'Feito' }));
    expect(() => parseFeedbackItem(rawItem({ status: 'spam' }))).toThrow(FEEDBACK_INVALID);
    expect(() => parseFeedbackItem(null)).toThrow(FEEDBACK_INVALID);
  });

  it('o recado mudado entra na lista guardada, e as contagens acompanham a situação', () => {
    const before = list([item(), item({ id: 'b2', status: 'lido' })], { total: 2 });
    const after = applyFeedbackUpdate(before, item({ status: 'lido', updatedAt: at(2026, 10, 24, 15) }));
    expect(after.counts).toEqual({ novo: 1, lido: 2, resolvido: 0, arquivado: 3 });
    expect(after.total).toBe(2);
    expect(after.items.map((entry) => [entry.id, entry.status])).toEqual([
      ['a1', 'lido'],
      ['b2', 'lido'],
    ]);
    // Só a nota mudou: as contagens ficam.
    expect(applyFeedbackUpdate(before, item({ note: 'Ver depois' })).counts).toEqual(before.counts);
    // Um recado que não está nesta lista: nada muda (as contagens esperam a próxima busca).
    expect(applyFeedbackUpdate(before, item({ id: 'zz', status: 'arquivado' }))).toBe(before);
    // A lista antiga não é mexida.
    expect(before.items[0].status).toBe('novo');
  });
});

describe('filtros e busca', () => {
  const items = [
    item({ id: '1', kind: 'problema', message: 'A notificação não toca no Android.' }),
    item({ id: '2', kind: 'sugestao', message: 'Poderia ter um modo escuro mais forte.', email: 'bia@exemplo.com' }),
    item({ id: '3', kind: 'elogio', message: 'Adorei a lista!', email: null, note: 'Mandar agradecimento' }),
  ];

  it('o filtro com que a caixa abre, e o que vai para o servidor', () => {
    expect(defaultFeedbackStatus({ novo: 2, lido: 0, resolvido: 0, arquivado: 0 })).toBe('novo');
    expect(defaultFeedbackStatus({ novo: 0, lido: 5, resolvido: 1, arquivado: 0 })).toBe('todos');
    expect(feedbackStatusParam('todos')).toBeNull();
    expect(feedbackStatusParam('resolvido')).toBe('resolvido');
  });

  it('pelo tipo', () => {
    expect(filterFeedback(items, { kind: 'sugestao' }).map((entry) => entry.id)).toEqual(['2']);
    expect(filterFeedback(items, { kind: 'outro' })).toEqual([]);
    expect(filterFeedback(items, { kind: 'todos' })).toEqual(items);
    expect(filterFeedback(items)).toEqual(items);
  });

  it('a busca olha o texto, o e-mail e a nota, sem maiúsculas nem acentos', () => {
    const ids = (query: string, kind?: 'problema') => filterFeedback(items, { query, kind }).map((entry) => entry.id);
    expect(ids('NOTIFICACAO')).toEqual(['1']);
    expect(ids('bia@')).toEqual(['2']);
    expect(ids('agradecimento')).toEqual(['3']);
    expect(ids('exemplo.com')).toEqual(['1', '2']);
    // Todas as palavras, em qualquer campo.
    expect(ids('lista agradecimento')).toEqual(['3']);
    expect(ids('lista android')).toEqual([]);
    expect(ids('   ')).toEqual(['1', '2', '3']);
    expect(ids('exemplo', 'problema')).toEqual(['1']);
  });
});

describe('o que a caixa de entrada mostra', () => {
  it('a data e a hora no fuso do aparelho; de outro ano, com o ano', () => {
    expect(feedbackWhen(at(2026, 10, 24, 14, 5), NOW)).toBe('24/10 14:05');
    expect(feedbackWhen(at(2026, 1, 3, 9, 0), NOW)).toBe('03/01 09:00');
    expect(feedbackWhen(at(2025, 12, 31, 23, 59), NOW)).toBe('31/12/2025 23:59');
    expect(feedbackDateTime(at(2026, 10, 24, 14, 5))).toBe('24/10/2026 às 14:05');
  });

  it('o aparelho e a versão', () => {
    expect(feedbackDevice({ platform: 'web', appVersion: '1.4.0' })).toBe('Navegador · versão 1.4.0');
    expect(feedbackDevice({ platform: 'ios', appVersion: null })).toBe('iPhone/iPad');
    expect(feedbackDevice({ platform: 'android', appVersion: '2.0' })).toBe('Android · versão 2.0');
    expect(feedbackDevice({ platform: null, appVersion: '2.0' })).toBe('versão 2.0');
    expect(feedbackDevice({ platform: null, appVersion: null })).toBeNull();
  });

  it('o título da linha: a primeira linha, cortada perto de 90 caracteres numa palavra', () => {
    expect(feedbackTitle('O app fecha.\nAcontece toda vez que abro a lista.')).toBe('O app fecha.');
    expect(feedbackTitle('Muito   bom,\tparabéns')).toBe('Muito bom, parabéns');
    const words = 'Quando eu abro a lista de compras no computador e marco um item ela volta para o começo sempre';
    const title = feedbackTitle(words);
    expect(title).toBe('Quando eu abro a lista de compras no computador e marco um item ela volta para o começo…');
    expect(Array.from(title).length).toBeLessThanOrEqual(FEEDBACK_TITLE_MAX);
    // Uma palavra só, comprida: corta no meio dela.
    const one = 'a'.repeat(200);
    expect(feedbackTitle(one)).toBe(`${'a'.repeat(FEEDBACK_TITLE_MAX - 1)}…`);
    // Sem vírgula solta antes do "…".
    expect(feedbackTitle(`${'palavra '.repeat(8)}fim, ${'b'.repeat(40)}`)).toBe(`${'palavra '.repeat(8)}fim…`);
    expect(feedbackTitle('Curto')).toBe('Curto');
  });

  it('a linha da lista, e o que o leitor de tela diz', () => {
    expect(feedbackRow(item({ note: 'Ver' }), NOW)).toEqual({
      id: 'a1',
      kind: 'problema',
      status: 'novo',
      title: 'A lista não atualiza quando abro no computador.',
      kindLabel: 'Problema',
      statusLabel: 'Novo',
      when: '24/10 14:05',
      email: 'ana@exemplo.com',
      device: 'Navegador · versão 1.4.0',
      isNew: true,
      hasNote: true,
      accessibilityLabel: 'Problema, novo. 24/10 às 14:05. De ana@exemplo.com. A lista não atualiza quando abro no computador. Tem nota.',
    });
    const read = feedbackRow(item({ status: 'lido', email: null, message: 'Adorei' }), NOW);
    expect(read.isNew).toBe(false);
    expect(read.accessibilityLabel).toBe('Problema, lido. 24/10 às 14:05. Sem e-mail. Adorei.');
  });

  it('os filtros de situação com as contagens, e os de tipo', () => {
    const view = feedbackInboxView(list([item()]), { status: 'novo', now: NOW });
    expect(view.statusChips.map((chip) => [chip.key, chip.label])).toEqual([
      ['novo', 'Novos (2)'],
      ['lido', 'Lidos (1)'],
      ['resolvido', 'Resolvidos (0)'],
      ['arquivado', 'Arquivados (3)'],
      ['todos', 'Todos (6)'],
    ]);
    expect(view.statusChips[0].accessibilityLabel).toBe('Novos: 2 recados');
    expect(view.statusChips[1].accessibilityLabel).toBe('Lidos: 1 recado');
    expect(view.kindChips.map((chip) => [chip.key, chip.label])).toEqual([
      ['todos', 'Todos os tipos'],
      ['problema', 'Problema'],
      ['sugestao', 'Sugestão'],
      ['elogio', 'Elogio'],
      ['outro', 'Outro'],
    ]);
    expect(view.newCount).toBe(2);
  });

  it('as linhas do tipo e da busca, e quantas são', () => {
    const items = [item({ id: '1' }), item({ id: '2', kind: 'elogio', message: 'Adorei' }), item({ id: '3', kind: 'elogio', message: 'Ótimo app' })];
    const all = feedbackInboxView(list(items), { status: 'todos', now: NOW });
    expect(all.rows.map((row) => row.id)).toEqual(['1', '2', '3']);
    expect(all.countLabel).toBe('3 recados');
    expect(all.empty).toBeNull();
    const praise = feedbackInboxView(list(items), { status: 'todos', kind: 'elogio', now: NOW });
    expect(praise.rows.map((row) => row.id)).toEqual(['2', '3']);
    expect(praise.countLabel).toBe('2 de 3 recados');
    const search = feedbackInboxView(list(items), { status: 'todos', query: 'otimo', now: NOW });
    expect(search.countLabel).toBe('1 de 3 recados');
    expect(feedbackInboxView(list([item()]), { status: 'novo', now: NOW }).countLabel).toBe('1 recado');
  });

  it('a lista cortada no limite diz quantos mostra de quantos', () => {
    const items = [item({ id: '1' }), item({ id: '2' })];
    expect(feedbackInboxView(list(items, { total: 340 }), { status: 'todos', now: NOW }).cutNote).toBe('Mostrando 2 de 340 recados.');
    expect(feedbackInboxView(list(items, { total: 1340 }), { status: 'todos', query: 'lista', now: NOW }).cutNote).toBe(
      'Mostrando 2 de 1.340 recados. O tipo e a busca olham só esses.',
    );
    expect(feedbackInboxView(list(items, { total: 2 }), { status: 'todos', now: NOW }).cutNote).toBeNull();
  });

  it('a lista vazia, conforme o filtro', () => {
    const empty = (status: 'novo' | 'lido' | 'resolvido' | 'arquivado' | 'todos') => feedbackInboxView(list([], { total: 0 }), { status, now: NOW }).empty;
    expect(empty('novo')).toBe('Nenhum recado novo.');
    expect(empty('lido')).toBe('Nenhum recado lido.');
    expect(empty('resolvido')).toBe('Nenhum recado resolvido.');
    expect(empty('arquivado')).toBe('Nenhum recado arquivado.');
    expect(empty('todos')).toBe('Ainda não chegou nenhum recado.');
    const some = list([item()]);
    expect(feedbackInboxView(some, { status: 'novo', kind: 'sugestao', now: NOW }).empty).toBe('Nenhum recado do tipo Sugestão entre os novos.');
    expect(feedbackInboxView(some, { status: 'todos', query: ' modo escuro ', now: NOW }).empty).toBe('Nenhum recado com “modo escuro”.');
    expect(feedbackInboxView(some, { status: 'arquivado', kind: 'elogio', query: 'tema', now: NOW }).empty).toBe(
      'Nenhum recado do tipo Elogio com “tema” entre os arquivados.',
    );
  });
});

describe('o detalhe de um recado', () => {
  it('tudo o que o detalhe mostra', () => {
    const detail = feedbackDetail(item({ note: 'Ver no próximo ciclo' }));
    expect(detail).toMatchObject({
      id: 'a1',
      kindLabel: 'Problema',
      statusLabel: 'Novo',
      sentAt: '24/10/2026 às 14:05',
      changed: null,
      device: 'Navegador · versão 1.4.0',
      email: 'ana@exemplo.com',
      noEmail: null,
      message: 'A lista não atualiza quando abro no computador.',
      note: 'Ver no próximo ciclo',
      accessibilityLabel: 'Recado: problema, novo. Mandado em 24/10/2026 às 14:05. Navegador, versão 1.4.0. De ana@exemplo.com.',
    });
    expect(detail.replyUrl).toBe(replyMailto(item()));
  });

  it('a última mudança, só quando mudou depois de chegar', () => {
    expect(feedbackDetail(item({ updatedAt: at(2026, 10, 25, 9, 12) })).changed).toBe('Última mudança em 25/10/2026 às 09:12');
    // No mesmo minuto não diz nada (seria a mesma hora escrita duas vezes).
    expect(feedbackDetail(item({ updatedAt: new Date(Date.parse(at(2026, 10, 24, 14, 5)) + 30_000).toISOString() })).changed).toBeNull();
  });

  it('sem e-mail: sem link, e a frase no lugar do botão', () => {
    const detail = feedbackDetail(item({ email: null }));
    expect(detail.replyUrl).toBeNull();
    expect(detail.noEmail).toBe(FEEDBACK_NO_EMAIL);
    expect(detail.accessibilityLabel).toContain('Sem e-mail.');
  });

  it('os botões de situação: nunca a situação em que o recado já está', () => {
    const labels = (status: 'novo' | 'lido' | 'resolvido' | 'arquivado') => feedbackStatusActions(status).map((action) => `${action.status}: ${action.label}`);
    expect(labels('novo')).toEqual(['resolvido: Marcar como resolvido', 'arquivado: Arquivar', 'lido: Marcar como lido']);
    expect(labels('lido')).toEqual(['resolvido: Marcar como resolvido', 'arquivado: Arquivar', 'novo: Marcar como novo']);
    expect(labels('resolvido')).toEqual(['arquivado: Arquivar', 'lido: Voltar para lidos']);
    expect(labels('arquivado')).toEqual(['lido: Voltar para lidos', 'resolvido: Marcar como resolvido']);
    for (const status of FEEDBACK_STATUSES) expect(feedbackStatusActions(status).map((action) => action.status)).not.toContain(status);
    expect(feedbackDetail(item({ status: 'resolvido' })).actions).toEqual(feedbackStatusActions('resolvido'));
  });

  it('a nota: aparada, vazia apaga, e só muda quando o texto muda', () => {
    expect(feedbackNoteToSave('  corrigido \n')).toBe('corrigido');
    expect(feedbackNoteToSave('   ')).toBe('');
    expect(feedbackNoteChanged(null, '')).toBe(false);
    expect(feedbackNoteChanged(null, '  ')).toBe(false);
    expect(feedbackNoteChanged(null, 'nova')).toBe(true);
    expect(feedbackNoteChanged('feito', 'feito ')).toBe(false);
    expect(feedbackNoteChanged('feito', '')).toBe(true);
    expect(feedbackNoteError('ok')).toBeNull();
    expect(feedbackNoteError(` ${'👍'.repeat(FEEDBACK_MAX_LENGTH)} `)).toBeNull();
    expect(feedbackNoteError('a'.repeat(FEEDBACK_MAX_LENGTH + 1))).toBe(FEEDBACK_NOTE_TOO_LONG);
  });
});

describe('a resposta por e-mail', () => {
  it('o assunto e o recado citado, linha por linha', () => {
    const url = replyMailto(item({ message: 'O app fecha.\n\nSempre na lista & no mercado?' }))!;
    expect(url.startsWith('mailto:ana@exemplo.com?subject=')).toBe(true);
    const params = new URLSearchParams(url.slice(url.indexOf('?') + 1));
    expect(params.get('subject')).toBe('Sobre o seu recado no Kotii');
    expect(params.get('body')).toBe('Oi!\n\n\n\nO seu recado de 24/10/2026 às 14:05:\n> O app fecha.\n>\n> Sempre na lista & no mercado?\n');
    // Nada sem codificar depois do "?" além dos separadores.
    expect(url.slice(url.indexOf('?') + 1)).toMatch(/^subject=[^&?# ]+&body=[^&?# ]+$/);
  });

  it('o endereço vai codificado, menos a arroba', () => {
    expect(replyMailto(item({ email: 'ana+kotii@exemplo.com' }))!.startsWith('mailto:ana%2Bkotii@exemplo.com?')).toBe(true);
  });

  it('sem e-mail, sem link', () => {
    expect(replyMailto(item({ email: null }))).toBeNull();
    expect(replyMailto(item({ email: '  ' }))).toBeNull();
  });

  it('um recado longo vai citado só no começo, com "…": o link cabe no limite, contado codificado', () => {
    const bodyOf = (url: string) => new URLSearchParams(url.slice(url.indexOf('?') + 1)).get('body')!;
    // 2000 caracteres de acentos e emojis: uns 6 mil caracteres só para citar o recado inteiro no link.
    const message = Array.from({ length: FEEDBACK_MAX_LENGTH }, (_, index) => ['ã', 'é', '🙂', 'ç', '👍🏽', '\n'][index % 6]).join('');
    const url = replyMailto(item({ message }))!;
    expect(url.length).toBeLessThanOrEqual(REPLY_URL_MAX);
    const body = bodyOf(url);
    expect(body.endsWith('…\n')).toBe(true);
    // O começo do recado, citado como sempre, e nenhum emoji partido ao meio (o link decodifica).
    expect(body).toContain('O seu recado de 24/10/2026 às 14:05:\n> ãé🙂ç👍🏽\n> ãé🙂ç');
    expect(body).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
    // Um pedaço de verdade do recado, não um corte à toa.
    const quoted = body.slice(body.indexOf(':\n') + 2);
    expect(quoted.length).toBeGreaterThan(100);

    // Só letras: o corte também fica no limite, e bem mais longo.
    const plain = replyMailto(item({ message: 'a'.repeat(FEEDBACK_MAX_LENGTH) }))!;
    expect(plain.length).toBeLessThanOrEqual(REPLY_URL_MAX);
    expect(plain.length).toBeGreaterThan(REPLY_URL_MAX - 5);
    expect(bodyOf(plain).endsWith('a…\n')).toBe(true);
  });

  it('o recado curto vai citado inteiro, sem "…"', () => {
    const message = 'Adorei o modo escuro! 🌙\nSó falta o widget.';
    const url = replyMailto(item({ message }))!;
    const body = new URLSearchParams(url.slice(url.indexOf('?') + 1)).get('body')!;
    expect(body).toBe('Oi!\n\n\n\nO seu recado de 24/10/2026 às 14:05:\n> Adorei o modo escuro! 🌙\n> Só falta o widget.\n');
    // Também um recado de uns 700 caracteres, que já passa de mil no link.
    const medium = 'Quando abro a lista no navegador, ela demora. '.repeat(15).trim();
    const mediumUrl = replyMailto(item({ message: medium }))!;
    expect(mediumUrl.length).toBeGreaterThan(1000);
    expect(new URLSearchParams(mediumUrl.slice(mediumUrl.indexOf('?') + 1)).get('body')).toContain(`> ${medium}\n`);
  });
});

describe('a ordem da caixa de entrada', () => {
  const at1 = (id: string, createdAt: string, over: Partial<FeedbackItem> = {}) => item({ id, createdAt, updatedAt: createdAt, ...over });
  const ids = (items: FeedbackItem[]) => items.map((entry) => entry.id);

  it('do mais novo para o mais antigo; no mesmo segundo, o id maior primeiro', () => {
    const items = [
      at1('b', '2026-10-24T10:00:00Z'),
      at1('a', '2026-10-24T12:00:00Z'),
      at1('c', '2026-10-24T10:00:00Z'),
      at1('d', '2026-10-23T10:00:00Z'),
    ];
    expect(ids([...items].sort(newestFeedbackFirst))).toEqual(['a', 'c', 'b', 'd']);
    expect(newestFeedbackFirst(items[0], items[0])).toBe(0);
  });

  it('o recado aberto que saiu da lista volta no lugar dele', () => {
    const listed = [at1('n1', '2026-10-24T12:00:00Z'), at1('n3', '2026-10-24T10:00:00Z')];
    // Entre os dois.
    const between = at1('n2', '2026-10-24T11:00:00Z', { status: 'lido' });
    expect(ids(withOpenedFeedback(listed, new Map([[between.id, between]])))).toEqual(['n1', 'n2', 'n3']);
    // Mais novo que todos vai primeiro; mais antigo que todos, por último.
    const newer = at1('n0', '2026-10-24T13:00:00Z');
    const older = at1('n4', '2026-10-24T09:00:00Z');
    const kept = new Map([
      [older.id, older],
      [newer.id, newer],
    ]);
    expect(ids(withOpenedFeedback(listed, kept))).toEqual(['n0', 'n1', 'n3', 'n4']);
    // No mesmo segundo de um da lista, a ordem do id, como o servidor.
    const tieLow = at1('n2', '2026-10-24T10:00:00Z');
    const tieHigh = at1('n9', '2026-10-24T10:00:00Z');
    expect(ids(withOpenedFeedback(listed, new Map([[tieLow.id, tieLow]])))).toEqual(['n1', 'n3', 'n2']);
    expect(ids(withOpenedFeedback(listed, new Map([[tieHigh.id, tieHigh]])))).toEqual(['n1', 'n9', 'n3']);
  });

  it('um recado que está na lista e guardado fica uma vez só, como o servidor mandou', () => {
    const fromServer = at1('n1', '2026-10-24T12:00:00Z', { status: 'resolvido', note: 'Feito' });
    const listed = [fromServer, at1('n3', '2026-10-24T10:00:00Z')];
    const old = at1('n1', '2026-10-24T12:00:00Z', { status: 'novo' });
    const out = withOpenedFeedback(listed, new Map([[old.id, old]]));
    expect(ids(out)).toEqual(['n1', 'n3']);
    expect(out[0]).toBe(fromServer);
  });

  it('sem nenhum guardado de fora, a própria lista', () => {
    const listed = [at1('n1', '2026-10-24T12:00:00Z')];
    expect(withOpenedFeedback(listed, new Map())).toBe(listed);
    expect(withOpenedFeedback(listed, new Map([[listed[0].id, listed[0]]]))).toBe(listed);
    expect(withOpenedFeedback([], new Map())).toEqual([]);
  });
});

describe('o painel e o teclado', () => {
  it('a aba e a linha da aba Números', () => {
    expect(feedbackTabLabel(0)).toBe('Recados');
    expect(feedbackTabLabel(3)).toBe('Recados (3)');
    expect(feedbackTabLabel(1200)).toBe('Recados (1.200)');
    expect(newFeedbackLine(0)).toBeNull();
    expect(newFeedbackLine(1)).toBe('1 recado novo');
    expect(newFeedbackLine(4)).toBe('4 recados novos');
  });

  it('as teclas: ↓ e j para o próximo, ↑ e k para o anterior', () => {
    expect(feedbackKeyStep('ArrowDown')).toBe(1);
    expect(feedbackKeyStep('j')).toBe(1);
    expect(feedbackKeyStep('ArrowUp')).toBe(-1);
    expect(feedbackKeyStep('k')).toBe(-1);
    expect(feedbackKeyStep('J')).toBeNull();
    expect(feedbackKeyStep('Enter')).toBeNull();
  });

  it('o passo na lista para nas pontas; sem nenhum aberto, abre o primeiro', () => {
    const ids = ['a', 'b', 'c'];
    expect(nextFeedbackSelection(ids, 'a', 1)).toBe('b');
    expect(nextFeedbackSelection(ids, 'c', 1)).toBe('c');
    expect(nextFeedbackSelection(ids, 'b', -1)).toBe('a');
    expect(nextFeedbackSelection(ids, 'a', -1)).toBe('a');
    expect(nextFeedbackSelection(ids, null, -1)).toBe('a');
    expect(nextFeedbackSelection(ids, 'saiu', 1)).toBe('a');
    expect(nextFeedbackSelection([], 'a', 1)).toBeNull();
  });
});
