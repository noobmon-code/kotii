import { describe, expect, it } from '@jest/globals';
import { readdirSync, readFileSync } from 'fs';
import path from 'path';

import { FINANCE_CATEGORIES } from '../finance';
import {
  canCopyToExpenses,
  deleteProviderWarning,
  expenseCopyNote,
  expenseDescription,
  getProviderTrade,
  groupProviders,
  jobDetails,
  jobLine,
  lastServiceMention,
  normalizePhone,
  parsePhone,
  phoneHint,
  PROVIDER_LIMITS,
  PROVIDER_TRADES,
  searchProviders,
  SERVICE_WARRANTY_PRESETS,
  serviceExpenseCategory,
  serviceWarrantyText,
  telLink,
  validateJob,
  validateProvider,
  whatsappLink,
  type JobForm,
  type ProviderForm,
} from '../providers';

const provider = (id: string, name: string, trade = 'eletricista') => ({ id, name, trade });
const job = (
  id: string,
  providerId: string,
  doneOn: string,
  description: string,
  extra: { amount?: number | null; equipment_id?: string | null; created_at?: string; warranty_until?: string | null } = {},
) => ({
  id,
  provider_id: providerId,
  done_on: doneOn,
  description,
  amount: null,
  equipment_id: null,
  warranty_until: null,
  created_at: `${doneOn}T12:00:00Z`,
  ...extra,
});

describe('o que a pessoa faz', () => {
  it('tem a lista fechada, com "outros" no fim, e cai em "outros" quando não conhece', () => {
    expect(PROVIDER_TRADES.map((t) => t.key)).toEqual([
      'diarista',
      'eletricista',
      'encanador',
      'tecnico',
      'ar_condicionado',
      'pintor',
      'pedreiro',
      'marceneiro',
      'jardineiro',
      'chaveiro',
      'dedetizacao',
      'mecanico',
      'vidraceiro',
      'montador',
      'outros',
    ]);
    expect(new Set(PROVIDER_TRADES.map((t) => t.label)).size).toBe(PROVIDER_TRADES.length);
    expect(getProviderTrade('tecnico').label).toBe('Técnico de aparelhos');
    expect(getProviderTrade('astronauta').key).toBe('outros');
  });

  it('é a mesma lista do check do banco', () => {
    const dir = path.resolve(__dirname, '../../../supabase/migrations');
    const file = readdirSync(dir).find((name) => name.endsWith('_service_providers.sql'));
    const sql = readFileSync(path.join(dir, file!), 'utf8');
    const list = sql.match(/check \(trade in \(([^)]*)\)\)/)?.[1] ?? '';
    expect([...list.matchAll(/'([a-z_]+)'/g)].map((m) => m[1])).toEqual(PROVIDER_TRADES.map((t) => t.key));
  });
});

describe('telefone: o que fica em phone_digits', () => {
  it('celular com DDD, digitado de qualquer jeito', () => {
    for (const typed of [
      '(11) 98765-4321',
      '11 98765 4321',
      '11987654321',
      '11-98765-4321',
      ' (11)98765.4321 ',
      '+55 11 98765-4321',
      '+5511987654321',
      '55 11 98765-4321',
      '011 98765-4321',
      '0xx11 98765-4321',
      '015 11 98765-4321',
      '(011) 98765-4321',
      '+55 (0xx11) 98765-4321',
      '+55 (011) 98765-4321',
      '+55 0 11 98765 4321',
      '55 011 98765-4321',
    ]) {
      expect({ typed, parsed: parsePhone(typed) }).toEqual({ typed, parsed: { kind: 'celular', digits: '5511987654321' } });
    }
  });

  it('celular digitado sem o nono dígito ganha o 9', () => {
    expect(parsePhone('(11) 8765-4321')).toEqual({ kind: 'celular', digits: '5511987654321' });
    expect(parsePhone('+55 (31) 7654-3210')).toEqual({ kind: 'celular', digits: '5531976543210' });
    expect(parsePhone('0xx21 6543-2109')).toEqual({ kind: 'celular', digits: '5521965432109' });
  });

  it('fixo com DDD', () => {
    for (const typed of [
      '(11) 3456-7890',
      '11 3456 7890',
      '1134567890',
      '+55 11 3456-7890',
      '011 3456-7890',
      '0xx11 3456-7890',
      '0 xx 11 3456 7890',
      '0 21 11 3456-7890',
      '+55 011 3456-7890',
      '+55 (0xx11) 3456-7890',
    ]) {
      expect({ typed, parsed: parsePhone(typed) }).toEqual({ typed, parsed: { kind: 'fixo', digits: '551134567890' } });
    }
  });

  it('com o 55 do país e o zero do interurbano juntos, como vem em cartão de visita', () => {
    expect(parsePhone('+55 (0xx11) 91234-5678')).toEqual({ kind: 'celular', digits: '5511912345678' });
    expect(parsePhone('+55 (011) 91234-5678')).toEqual({ kind: 'celular', digits: '5511912345678' });
    expect(parsePhone('55 011 91234-5678')).toEqual({ kind: 'celular', digits: '5511912345678' });
    expect(parsePhone('+55 011 3456-7890')).toEqual({ kind: 'fixo', digits: '551134567890' });
    // O zero não salva um número que continua errado depois dele.
    expect(parsePhone('+55 010 91234-5678')).toBeNull();
    expect(parsePhone('+55 0 91234-5678')).toBeNull();
  });

  it('o DDD 55 não se confunde com o 55 do país', () => {
    expect(parsePhone('(55) 3221-1234')).toEqual({ kind: 'fixo', digits: '555532211234' });
    expect(parsePhone('55 99123-4567')).toEqual({ kind: 'celular', digits: '5555991234567' });
    expect(parsePhone('+55 55 99123-4567')).toEqual({ kind: 'celular', digits: '5555991234567' });
  });

  it('sem DDD: guarda o número como é discado', () => {
    expect(parsePhone('98765-4321')).toEqual({ kind: 'sem_ddd', digits: '987654321' });
    expect(parsePhone('3456-7890')).toEqual({ kind: 'sem_ddd', digits: '34567890' });
    // Oito dígitos de celular antigo: hoje só completa a ligação com o 9.
    expect(parsePhone('8765-4321')).toEqual({ kind: 'sem_ddd', digits: '987654321' });
    expect(parsePhone('4003-1234')).toEqual({ kind: 'sem_ddd', digits: '40031234' });
  });

  it('0800 e número de fora do país', () => {
    expect(parsePhone('0800 701 0102')).toEqual({ kind: 'gratuito', digits: '08007010102' });
    expect(parsePhone('0300-123-4567')).toEqual({ kind: 'gratuito', digits: '03001234567' });
    expect(parsePhone('+1 (415) 555-2671')).toEqual({ kind: 'exterior', digits: '14155552671' });
    expect(parsePhone('+351 912 345 678')).toEqual({ kind: 'exterior', digits: '351912345678' });
  });

  it('ramal ou segundo número: nada, em vez de um número que é de outra pessoa', () => {
    for (const typed of [
      // Sem DDD, os dígitos do ramal completavam um número de outro lugar.
      '3456-7890 ramal 22',
      '3456-7890 r 22',
      '3456-7890/91',
      '91234-5678 r 2',
      '(55) 3221-1234 ramal 22',
      '(11) 3456-7890 ramal 22',
      '3456-7890 ap 12',
      '3456-7890 (falar com João, casa 12)',
      // Número no nome do contato, antes do telefone.
      'Zap 1: 98765-4321',
      '(11) 98765-4321 / (11) 3456-7890',
      '11 98765-4321 ou 11 91234-5678',
      // O "xx" só guarda o lugar da operadora logo depois do zero do interurbano: aqui não cola o ramal no número.
      '3456-7890 xx 22',
      '3456-7890 XX22',
    ]) {
      const digits = normalizePhone(typed);
      expect({ typed, digits, whatsapp: whatsappLink(digits), tel: telLink(digits) }).toEqual({ typed, digits: null, whatsapp: null, tel: null });
    }
  });

  it('um número só, com palavras em volta, continua valendo', () => {
    expect(normalizePhone('zap (11) 98765-4321 falar com a Ana')).toBe('5511987654321');
    expect(normalizePhone('tel: +55 11 98765-4321')).toBe('5511987654321');
    expect(normalizePhone('(11) 98765-4321 (WhatsApp)')).toBe('5511987654321');
    expect(normalizePhone('0xx21 6543-2109')).toBe('5521965432109');
    expect(normalizePhone('0 xx 11 3456 7890')).toBe('551134567890');
    expect(normalizePhone('015 11 98765-4321')).toBe('5511987654321');
    expect(normalizePhone('+1 (415) 555-2671')).toBe('14155552671');
    expect(normalizePhone('11.98765.4321')).toBe('5511987654321');
    // Depois da palavra vem um número inteiro, com DDD: é o mesmo que "cel 21 3456-7890".
    expect(normalizePhone('casa 21 3456-7890')).toBe('552134567890');
  });

  it('número colado de outro app: traço tipográfico e marcas invisíveis não partem o número', () => {
    expect(normalizePhone('\u202a+55 11 98765\u20114321\u202c')).toBe('5511987654321');
    expect(normalizePhone('(11) 3456\u20137890')).toBe('551134567890');
    expect(normalizePhone('(11) 3456\u20147890')).toBe('551134567890');
    expect(normalizePhone('\u200e(11) 98765-4321\ufeff')).toBe('5511987654321');
    expect(normalizePhone('11\u00a098765-4321')).toBe('5511987654321');
  });

  it('letras em volta não atrapalham; sem número, nada', () => {
    expect(normalizePhone('zap (11) 98765-4321 falar com a Ana')).toBe('5511987654321');
    expect(normalizePhone('não tem')).toBeNull();
    expect(normalizePhone('ligar na loja')).toBeNull();
    expect(normalizePhone('')).toBeNull();
    expect(normalizePhone('   ')).toBeNull();
    expect(normalizePhone(null)).toBeNull();
    expect(normalizePhone(undefined)).toBeNull();
  });

  it('curto demais, comprido demais ou que não existe: nada', () => {
    for (const typed of [
      '1234', // curto
      '9876-543', // sete dígitos
      '190',
      '(11) 98765-4321 / (11) 3456-7890', // dois números
      '(11) 3456-7890 ramal 22',
      '1234567890123456', // 16 dígitos
      '(10) 98765-4321', // DDD que não existe
      '(20) 3456-7890',
      '(11) 1234-5678', // nem fixo nem celular
      '12345678',
      '(11) 38765-4321', // nove dígitos sem começar com 9
      '+55 98765-4321', // com o país mas sem DDD
      '+55 11 1234',
      '0800 123', // 0800 incompleto
      '+1 555 2671', // exterior curto
    ]) {
      expect({ typed, digits: normalizePhone(typed) }).toEqual({ typed, digits: null });
    }
  });

  it('tudo o que normaliza passa no check do banco', () => {
    for (const typed of ['(11) 98765-4321', '3456-7890', '98765-4321', '0800 701 0102', '+1 (415) 555-2671', '+351 912 345 678', '(55) 3221-1234']) {
      expect(normalizePhone(typed)).toMatch(/^[0-9]{8,15}$/);
    }
  });

  it('avisa embaixo do campo só quando falta alguma coisa', () => {
    expect(phoneHint('')).toBeNull();
    expect(phoneHint('(11) 98765-4321')).toBeNull();
    expect(phoneHint('0800 701 0102')).toBeNull();
    expect(phoneHint('98765-4321')).toMatch(/Sem o DDD/);
    expect(phoneHint('1234')).toMatch(/Não parece um telefone completo/);
    expect(phoneHint('(10) 98765-4321')).toBe('Não parece um telefone completo. Ele fica guardado assim, mas sem os atalhos de WhatsApp e de ligar.');
  });

  it('com mais de um número ou com ramal, o aviso diz o que fazer', () => {
    const onlyOne = 'Para os atalhos de WhatsApp e de ligar, deixe aqui um número só, com DDD. Outro número ou o ramal cabem nas observações.';
    for (const typed of [
      '(11) 98765-4321 / (11) 3456-7890',
      '11 98765-4321 ou 11 91234-5678',
      '(11) 98765-4321 ramal 12',
      '3456-7890 ramal 22',
      '3456-7890/91',
      'Zap 1: 98765-4321',
      // Dois números separados só por espaço ou traço: dígitos demais para um número só.
      '(11) 98765-4321 (11) 3456-7890',
      '11 98765-4321 - 11 3456-7890',
    ]) {
      expect({ typed, hint: phoneHint(typed) }).toEqual({ typed, hint: onlyOne });
    }
    // Palavras em volta de um número só não são um segundo número.
    expect(phoneHint('zap (11) 98765-4321 falar com a Ana')).toBeNull();
    expect(phoneHint('ligar na loja')).toMatch(/Não parece um telefone completo/);
  });
});

describe('links de WhatsApp e de ligação', () => {
  it('WhatsApp: só número brasileiro completo, fixo ou celular', () => {
    expect(whatsappLink(normalizePhone('(11) 98765-4321'))).toBe('https://wa.me/5511987654321');
    expect(whatsappLink(normalizePhone('+55 11 98765-4321'))).toBe('https://wa.me/5511987654321');
    expect(whatsappLink(normalizePhone('(11) 8765-4321'))).toBe('https://wa.me/5511987654321');
    expect(whatsappLink(normalizePhone('(11) 3456-7890'))).toBe('https://wa.me/551134567890');
    expect(whatsappLink(normalizePhone('(55) 3221-1234'))).toBe('https://wa.me/555532211234');
  });

  it('WhatsApp: sem DDD, 0800, exterior ou nada guardado não têm link', () => {
    expect(whatsappLink(normalizePhone('8765-4321'))).toBeNull();
    expect(whatsappLink(normalizePhone('98765-4321'))).toBeNull();
    expect(whatsappLink(normalizePhone('3456-7890'))).toBeNull();
    expect(whatsappLink(normalizePhone('0800 701 0102'))).toBeNull();
    expect(whatsappLink(normalizePhone('+1 (415) 555-2671'))).toBeNull();
    expect(whatsappLink(null)).toBeNull();
    expect(whatsappLink(undefined)).toBeNull();
    expect(whatsappLink('')).toBeNull();
  });

  it('WhatsApp: confere de novo o que veio do banco', () => {
    expect(whatsappLink('5510987654321')).toBeNull(); // DDD que não existe
    expect(whatsappLink('551112345678')).toBeNull(); // não é fixo nem celular
    expect(whatsappLink('55119876543')).toBeNull(); // faltam dígitos
    expect(whatsappLink('11987654321')).toBeNull(); // sem o 55
    expect(whatsappLink('551187654321')).toBeNull(); // celular sem o 9: o app sempre guarda com ele
    expect(whatsappLink('55 11 98765-4321')).toBeNull();
  });

  it('ligar: com +55 quando completo; como é discado sem DDD e no 0800', () => {
    expect(telLink(normalizePhone('(11) 98765-4321'))).toBe('tel:+5511987654321');
    expect(telLink(normalizePhone('(11) 3456-7890'))).toBe('tel:+551134567890');
    expect(telLink(normalizePhone('98765-4321'))).toBe('tel:987654321');
    expect(telLink(normalizePhone('3456-7890'))).toBe('tel:34567890');
    expect(telLink(normalizePhone('0800 701 0102'))).toBe('tel:08007010102');
    expect(telLink(normalizePhone('+1 (415) 555-2671'))).toBe('tel:+14155552671');
    expect(telLink(normalizePhone('1234'))).toBeNull();
    expect(telLink(null)).toBeNull();
    expect(telLink('abc')).toBeNull();
    expect(telLink('11 98765')).toBeNull();
  });
});

describe('lista de prestadores', () => {
  const providers = [
    provider('ze', 'Zé da Luz'),
    provider('ana', 'Ana Elétrica'),
    provider('bia', 'Bia Faxina', 'diarista'),
    provider('caio', 'Caio Instalações'),
    provider('alvaro', 'Álvaro'),
    provider('x', 'Faz Tudo', 'astronauta'),
    provider('lu', 'Lu Jardins', 'jardineiro'),
  ];
  const jobs = [
    job('j1', 'ze', '2026-03-12', 'Trocou o disjuntor', { amount: 180 }),
    job('j2', 'ana', '2026-05-02', 'Instalou tomadas'),
    job('j3', 'ze', '2025-11-20', 'Trocou a fiação do banheiro'),
    job('j4', 'bia', '2026-05-02', 'Faxina completa'),
    job('j5', 'sumiu', '2026-06-01', 'De um prestador que não está na lista'),
  ];

  it('agrupa pelo que fazem, na ordem da lista de ofícios, só os grupos com gente', () => {
    const groups = groupProviders(providers, jobs);
    expect(groups.map((g) => g.trade.label)).toEqual(['Diarista', 'Eletricista', 'Jardineiro', 'Outros']);
    expect(groups[3].rows.map((r) => r.provider.id)).toEqual(['x']);
  });

  it('no grupo, quem fez serviço há menos tempo vem primeiro; quem nunca fez fica no fim, por nome', () => {
    const [, electricians] = groupProviders(providers, jobs);
    expect(electricians.rows.map((r) => r.provider.name)).toEqual(['Ana Elétrica', 'Zé da Luz', 'Álvaro', 'Caio Instalações']);
    expect(electricians.rows.map((r) => r.lastJob?.id ?? null)).toEqual(['j2', 'j1', null, null]);
    expect(electricians.rows.map((r) => r.jobCount)).toEqual([1, 2, 0, 0]);
  });

  it('dois serviços no mesmo dia: vale o registrado por último; empate entre prestadores, por nome', () => {
    const same = [
      job('a', 'ze', '2026-03-12', 'De manhã', { created_at: '2026-03-12T10:00:00Z' }),
      job('b', 'ze', '2026-03-12', 'De tarde', { created_at: '2026-03-12T18:00:00Z' }),
      job('c', 'ana', '2026-03-12', 'Outro', { created_at: '2026-03-12T18:00:00Z' }),
    ];
    const [electricians] = groupProviders([provider('ze', 'Zé da Luz'), provider('ana', 'Ana Elétrica')], same);
    expect(electricians.rows.map((r) => r.lastJob?.id)).toEqual(['c', 'b']);
  });

  it('lista vazia não tem grupos', () => {
    expect(groupProviders([], jobs)).toEqual([]);
  });

  it('busca sem acento por nome, ofício e pelo que foi feito', () => {
    const names = (query: string, equipment?: Map<string, string>) =>
      searchProviders(query, providers, jobs, equipment).map((p) => p.id);
    expect(names('')).toEqual(providers.map((p) => p.id));
    expect(names('   ')).toEqual(providers.map((p) => p.id));
    expect(names('ze')).toEqual(['ze']);
    expect(names('ALVARO')).toEqual(['alvaro']);
    expect(names('eletrica')).toEqual(['ana']);
    expect(names('eletricista')).toEqual(['ze', 'ana', 'caio', 'alvaro']);
    expect(names('fiacao')).toEqual(['ze']);
    expect(names('faxina')).toEqual(['bia']);
    expect(names('jardin')).toEqual(['lu']);
    // Ofício que o app não conhece aparece (e é achado) como "Outros".
    expect(names('outros')).toEqual(['x']);
    expect(names('pedreiro')).toEqual([]);
  });

  it('busca: todas as palavras precisam aparecer, e o aparelho do serviço também conta', () => {
    const withAppliance = [...jobs, job('j6', 'caio', '2026-01-10', 'Trocou a placa', { equipment_id: 'maq' })];
    const equipment = new Map([['maq', 'Máquina de lavar']]);
    const names = (query: string) => searchProviders(query, providers, withAppliance, equipment).map((p) => p.id);
    expect(names('maquina')).toEqual(['caio']);
    expect(names('eletricista disjuntor')).toEqual(['ze']);
    expect(names('eletricista faxina')).toEqual([]);
    expect(searchProviders('maquina', providers, withAppliance).map((p) => p.id)).toEqual([]);
  });
});

describe('textos dos serviços', () => {
  it('último serviço: o que foi feito, data e valor', () => {
    expect(jobLine({ description: 'Consertou a máquina de lavar', done_on: '2026-03-12', amount: 180 })).toBe(
      'Consertou a máquina de lavar · 12/03/2026 · R$ 180,00',
    );
    expect(jobLine({ description: 'Faxina completa', done_on: '2026-05-02', amount: null })).toBe('Faxina completa · 02/05/2026');
    // Não cobrou: o zero aparece, é diferente de não saber o valor.
    expect(jobLine({ description: 'Voltou para apertar', done_on: '2026-05-02', amount: 0 })).toBe('Voltou para apertar · 02/05/2026 · R$ 0,00');
    expect(jobLine({ description: 'Pintou a sala', done_on: '2026-05-02', amount: 1234.5 })).toBe('Pintou a sala · 02/05/2026 · R$ 1.234,50');
  });

  it('último serviço: o aparelho entra, a não ser que o texto já fale dele', () => {
    const base = { done_on: '2026-03-12', amount: 180 };
    expect(jobLine({ ...base, description: 'Trocou a placa' }, 'Máquina de lavar')).toBe('Trocou a placa · Máquina de lavar · 12/03/2026 · R$ 180,00');
    expect(jobLine({ ...base, description: 'Consertou a maquina de lavar' }, 'Máquina de lavar')).toBe(
      'Consertou a maquina de lavar · 12/03/2026 · R$ 180,00',
    );
    expect(jobLine({ ...base, description: 'Trocou a placa', amount: null }, 'Máquina de lavar')).toBe('Trocou a placa · Máquina de lavar · 12/03/2026');
    expect(jobLine({ ...base, description: 'Trocou a placa' }, null)).toBe('Trocou a placa · 12/03/2026 · R$ 180,00');
    expect(jobLine({ ...base, description: 'Trocou a placa' }, '  ')).toBe('Trocou a placa · 12/03/2026 · R$ 180,00');
  });

  it('garantia do serviço: aparece até o último dia, inclusive', () => {
    expect(serviceWarrantyText('2026-06-12', '2026-03-12')).toBe('garantia do serviço até 12/06/2026');
    expect(serviceWarrantyText('2026-06-12', '2026-06-11')).toBe('garantia do serviço até 12/06/2026');
    expect(serviceWarrantyText('2026-06-12', '2026-06-12')).toBe('garantia do serviço até 12/06/2026');
    expect(serviceWarrantyText('2026-06-12', '2026-06-13')).toBeNull();
    expect(serviceWarrantyText('2026-12-31', '2027-01-01')).toBeNull();
    expect(serviceWarrantyText(null, '2026-06-12')).toBeNull();
  });

  it('histórico: data, quem ou onde, valor e a garantia que ainda vale', () => {
    const done = { done_on: '2026-03-12', amount: 180, warranty_until: '2026-06-12' };
    expect(jobDetails(done, { who: 'Zé da Luz', today: '2026-04-01' })).toBe(
      '12/03/2026 · Zé da Luz · R$ 180,00 · garantia do serviço até 12/06/2026',
    );
    expect(jobDetails(done, { who: 'Zé da Luz', today: '2026-06-13' })).toBe('12/03/2026 · Zé da Luz · R$ 180,00');
    expect(jobDetails(done, { today: '2026-06-13' })).toBe('12/03/2026 · R$ 180,00');
    expect(jobDetails({ done_on: '2026-03-12', amount: null, warranty_until: null }, { who: null, today: '2026-04-01' })).toBe('12/03/2026');
  });

  it('antes de excluir, diz o que vai junto, sem supor quem é a pessoa', () => {
    expect(deleteProviderWarning('Zé da Luz', 0)).toBe('Excluir Zé da Luz?');
    expect(deleteProviderWarning('Zé da Luz', 1)).toBe(
      'Excluir Zé da Luz e o serviço registrado? Não dá para desfazer. Os gastos já lançados em Finanças continuam lá.',
    );
    expect(deleteProviderWarning('Bia Faxina', 12)).toContain('Excluir Bia Faxina e os 12 serviços registrados? Não dá para desfazer.');
    // Os serviços não carregaram: o aviso não promete que não há nenhum.
    expect(deleteProviderWarning('Bia Faxina', null)).toContain('Excluir Bia Faxina e todo o histórico de serviços? Não dá para desfazer.');
  });

  it('na linha do aparelho: a data curta do último serviço', () => {
    expect(lastServiceMention({ done_on: '2026-03-12' }, 2026)).toBe('Último serviço: 12 mar');
    expect(lastServiceMention({ done_on: '2025-11-20' }, 2026)).toBe('Último serviço: 20 nov 2025');
  });
});

describe('gasto da casa', () => {
  it('a descrição junta o que foi feito e quem fez', () => {
    expect(expenseDescription('Trocou a resistência do chuveiro', 'Zé da Luz')).toBe('Trocou a resistência do chuveiro (Zé da Luz)');
    expect(expenseDescription('  Faxina completa ', ' Bia ')).toBe('Faxina completa (Bia)');
    expect(expenseDescription('Faxina completa', '')).toBe('Faxina completa');
  });

  it('vai para Moradia; do mecânico ou num veículo, para Transporte (categorias que já existem)', () => {
    expect(serviceExpenseCategory('eletricista', 'eletrodomestico')).toBe('moradia');
    expect(serviceExpenseCategory('diarista', null)).toBe('moradia');
    expect(serviceExpenseCategory('outros', undefined)).toBe('moradia');
    expect(serviceExpenseCategory(undefined, undefined)).toBe('moradia');
    expect(serviceExpenseCategory('mecanico', null)).toBe('transporte');
    expect(serviceExpenseCategory('mecanico', 'eletrodomestico')).toBe('transporte');
    // O eletricista que mexeu no carro, o chaveiro que abriu o carro.
    expect(serviceExpenseCategory('eletricista', 'veiculo')).toBe('transporte');
    expect(serviceExpenseCategory('chaveiro', 'veiculo')).toBe('transporte');
    for (const trade of PROVIDER_TRADES) {
      for (const appliance of [null, 'veiculo', 'climatizacao']) {
        const category = serviceExpenseCategory(trade.key, appliance);
        expect(FINANCE_CATEGORIES.some((c) => c.key === category)).toBe(true);
      }
    }
  });

  it('avisa que é uma cópia de uma vez só, e em qual categoria; num serviço que já existia, que pode ficar em dobro', () => {
    expect(expenseCopyNote(false, 'moradia')).toBe('Entra em Moradia, uma vez só: mudar o serviço depois não muda o gasto.');
    expect(expenseCopyNote(true, 'moradia')).toBe(
      'Cria um gasto novo em Moradia (se este serviço já foi lançado, fica em dobro). Mudar o serviço depois não muda o gasto.',
    );
    expect(expenseCopyNote(false, 'transporte')).toBe('Entra em Transporte, uma vez só: mudar o serviço depois não muda o gasto.');
    expect(expenseCopyNote(true, 'transporte')).toBe(
      'Cria um gasto novo em Transporte (se este serviço já foi lançado, fica em dobro). Mudar o serviço depois não muda o gasto.',
    );
  });

  it('atalhos da garantia do serviço: 3 meses, 6 meses e 1 ano', () => {
    expect(SERVICE_WARRANTY_PRESETS).toEqual([
      { months: 3, label: '3 meses' },
      { months: 6, label: '6 meses' },
      { months: 12, label: '1 ano' },
    ]);
  });

  it('só com valor acima de zero', () => {
    expect(canCopyToExpenses(180)).toBe(true);
    expect(canCopyToExpenses(0.01)).toBe(true);
    expect(canCopyToExpenses(0)).toBe(false);
    expect(canCopyToExpenses(null)).toBe(false);
  });
});

describe('formulário do prestador', () => {
  const form: ProviderForm = { name: ' Zé da Luz ', trade: 'eletricista', phone: ' (11) 98765-4321 ', notes: ' Só atende de manhã ', recommended: true };

  it('devolve o que gravar, com o telefone como foi digitado e o normalizado', () => {
    expect(validateProvider(form)).toEqual({
      ok: true,
      values: {
        name: 'Zé da Luz',
        trade: 'eletricista',
        phone: '(11) 98765-4321',
        phone_digits: '5511987654321',
        notes: 'Só atende de manhã',
        recommended: true,
      },
    });
  });

  it('telefone e observações são opcionais; telefone que não foi reconhecido fica só como digitado', () => {
    expect(validateProvider({ ...form, phone: '', notes: '  ', recommended: false })).toEqual({
      ok: true,
      values: { name: 'Zé da Luz', trade: 'eletricista', phone: null, phone_digits: null, notes: null, recommended: false },
    });
    const odd = validateProvider({ ...form, phone: 'ligar na loja 1234' });
    expect(odd).toMatchObject({ ok: true, values: { phone: 'ligar na loja 1234', phone_digits: null } });
  });

  it('nome obrigatório e com até 80 letras', () => {
    expect(validateProvider({ ...form, name: '   ' })).toMatchObject({ ok: false, title: 'Confira os dados' });
    expect(validateProvider({ ...form, name: 'a'.repeat(PROVIDER_LIMITS.name) })).toMatchObject({ ok: true });
    expect(validateProvider({ ...form, name: 'a'.repeat(PROVIDER_LIMITS.name + 1) })).toEqual({
      ok: false,
      title: 'Nome comprido demais',
      message: 'O nome pode ter até 80 letras.',
    });
  });

  it('ofício da lista; telefone e observações com limite', () => {
    expect(validateProvider({ ...form, trade: 'astronauta' })).toMatchObject({ ok: false, message: 'Escolha o que a pessoa faz.' });
    expect(validateProvider({ ...form, trade: '' })).toMatchObject({ ok: false });
    expect(validateProvider({ ...form, phone: '1'.repeat(PROVIDER_LIMITS.phone + 1) })).toMatchObject({ ok: false, title: 'Telefone comprido demais' });
    expect(validateProvider({ ...form, notes: 'a'.repeat(PROVIDER_LIMITS.notes) })).toMatchObject({ ok: true });
    expect(validateProvider({ ...form, notes: 'a'.repeat(PROVIDER_LIMITS.notes + 1) })).toMatchObject({ ok: false, title: 'Texto comprido demais' });
  });
});

describe('formulário do serviço', () => {
  const form: JobForm = {
    providerId: 'ze',
    date: '12/03/2026',
    description: ' Trocou a resistência do chuveiro ',
    equipmentId: 'chuveiro',
    amount: '180,00',
    warranty: '12/06/2026',
    notes: ' Peça original ',
  };

  it('devolve o que gravar', () => {
    expect(validateJob(form)).toEqual({
      ok: true,
      values: {
        provider_id: 'ze',
        equipment_id: 'chuveiro',
        done_on: '2026-03-12',
        description: 'Trocou a resistência do chuveiro',
        amount: 180,
        warranty_until: '2026-06-12',
        notes: 'Peça original',
      },
    });
  });

  it('aparelho, valor, garantia e observações são opcionais', () => {
    expect(validateJob({ ...form, equipmentId: null, amount: ' ', warranty: '', notes: '' })).toEqual({
      ok: true,
      values: {
        provider_id: 'ze',
        equipment_id: null,
        done_on: '2026-03-12',
        description: 'Trocou a resistência do chuveiro',
        amount: null,
        warranty_until: null,
        notes: null,
      },
    });
  });

  it('prestador, o que foi feito e data são obrigatórios', () => {
    expect(validateJob({ ...form, providerId: null })).toEqual({ ok: false, title: 'Confira os dados', message: 'Escolha quem fez o serviço.' });
    expect(validateJob({ ...form, providerId: '' })).toMatchObject({ ok: false });
    expect(validateJob({ ...form, description: '  ' })).toMatchObject({ ok: false, title: 'Confira os dados' });
    expect(validateJob({ ...form, date: '' })).toMatchObject({ ok: false, title: 'Data inválida' });
    expect(validateJob({ ...form, date: '31/02/2026' })).toMatchObject({ ok: false, title: 'Data inválida' });
  });

  it('"o que foi feito" com até 200 letras, observações com até 500', () => {
    expect(validateJob({ ...form, description: 'a'.repeat(PROVIDER_LIMITS.description) })).toMatchObject({ ok: true });
    expect(validateJob({ ...form, description: 'a'.repeat(PROVIDER_LIMITS.description + 1) })).toMatchObject({ ok: false, title: 'Texto comprido demais' });
    expect(validateJob({ ...form, notes: 'a'.repeat(PROVIDER_LIMITS.notes + 1) })).toMatchObject({ ok: false, title: 'Texto comprido demais' });
  });

  it('valor: com vírgula, com ponto de milhar, zero; negativo e texto não', () => {
    const amount = (typed: string) => {
      const result = validateJob({ ...form, amount: typed });
      return result.ok ? result.values.amount : result.title;
    };
    expect(amount('180,5')).toBe(180.5);
    expect(amount('1.234,56')).toBe(1234.56);
    expect(amount('R$ 90')).toBe(90);
    expect(amount('90.5')).toBe(90.5);
    expect(amount('15.90')).toBe(15.9);
    expect(amount('0')).toBe(0);
    expect(amount('12,346')).toBe(12.35);
    expect(amount('-50')).toBe('Valor inválido');
    expect(amount('cem reais')).toBe('Valor inválido');
    expect(amount('12,3,4')).toBe('Valor inválido');
    expect(amount('99999999999')).toBe('Valor inválido');
  });

  it('valor: ponto de milhar sem os centavos é mil, não um e meio', () => {
    const amount = (typed: string) => {
      const result = validateJob({ ...form, amount: typed });
      return result.ok ? result.values.amount : result.title;
    };
    expect(amount('1.500')).toBe(1500);
    expect(amount('2.000')).toBe(2000);
    expect(amount('10.000')).toBe(10000);
    expect(amount('R$ 1.500')).toBe(1500);
    expect(amount('1.234')).toBe(1234);
    expect(amount('12.345.678')).toBe(12345678);
    expect(amount('1.500,00')).toBe(1500);
    expect(amount('1.500,50')).toBe(1500.5);
    expect(amount('1.5')).toBe(1.5);
    expect(amount('99.999.999.999')).toBe('Valor inválido');
  });

  it('garantia: no dia do serviço vale; antes dele, não', () => {
    expect(validateJob({ ...form, warranty: '12/03/2026' })).toMatchObject({ ok: true, values: { warranty_until: '2026-03-12' } });
    expect(validateJob({ ...form, warranty: '11/03/2026' })).toEqual({
      ok: false,
      title: 'Data inválida',
      message: 'A garantia não pode acabar antes do dia do serviço.',
    });
    expect(validateJob({ ...form, warranty: 'junho' })).toMatchObject({ ok: false, title: 'Data inválida' });
  });
});
