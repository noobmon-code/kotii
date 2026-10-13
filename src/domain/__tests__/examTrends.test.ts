import { describe, expect, it } from '@jest/globals';

import {
  apartNote,
  changeSentence,
  chartDescription,
  chartPoints,
  countLabel,
  examItemKey,
  examTrends,
  formatResultNumber,
  hasExamResults,
  normalizeUnit,
  parseResultValue,
  valueLabel,
  visitSummary,
  type SummaryMedication,
  type SummaryPerson,
  type TrendExam,
  type TrendPoint,
} from '../examTrends';
import type { ExamResult, ResultFlag } from '../health';

const result = (name: string, value: string, unit: string | null = null, flag: ResultFlag | null = null, reference: string | null = null): ExamResult => ({
  name,
  value,
  unit,
  reference,
  flag,
});

let seq = 0;
const exam = (exam_date: string | null, results: ExamResult[], partial: Partial<TrendExam> = {}): TrendExam => {
  seq += 1;
  return {
    id: `e${seq}`,
    person_id: 'ana',
    title: `Exame ${seq}`,
    status: 'realizado',
    exam_date,
    created_at: `2026-01-01T10:00:${String(seq % 60).padStart(2, '0')}Z`,
    results,
    ...partial,
  };
};

const point = (value: string, date: string, partial: Partial<TrendPoint> = {}): TrendPoint => {
  const parsed = parseResultValue(value);
  return {
    examId: 'e',
    examTitle: 'Exame',
    date,
    value: parsed ? `${parsed.mark ? `${parsed.mark} ` : ''}${formatResultNumber(parsed.number, parsed.decimals)}` : value,
    number: parsed?.number ?? null,
    decimals: parsed?.decimals ?? 0,
    mark: parsed?.mark ?? null,
    ambiguous: parsed?.ambiguous ?? false,
    unit: null,
    flag: null,
    reference: null,
    ...partial,
  };
};

const person = (partial: Partial<SummaryPerson> = {}): SummaryPerson => ({
  id: 'ana',
  name: 'Ana Souza',
  kind: 'pessoa',
  birth_date: null,
  allergies: null,
  conditions: null,
  species: null,
  ...partial,
});

const medication = (partial: Partial<SummaryMedication> = {}): SummaryMedication => ({
  person_id: 'ana',
  name: 'Losartana',
  dosage: '50 mg',
  times: ['08:00'],
  start_on: '2026-01-01',
  end_on: null,
  active: true,
  frequency: 'daily',
  weekdays: null,
  interval_days: null,
  total_doses: null,
  taken_count: 0,
  ...partial,
});

// O app nunca avalia um resultado: estas palavras não podem sair dele.
const JUDGEMENT = /\b(normal|normais|bom|boa|bons|ruim|ruins|preocupante|[óo]timo|saud[áa]vel|adequado|inadequado|perigos[oa]|grave)\b/i;

describe('examItemKey', () => {
  const same = (names: string[]) => new Set(names.map(examItemKey)).size;

  it('junta as grafias comuns de cada item', () => {
    const groups: string[][] = [
      ['Glicose', 'Glicemia', 'Glicemia de jejum', 'Glicose em jejum'],
      ['Hemoglobina glicada', 'HbA1c', 'A1C', 'Hemoglobina Glicada - HbA1c'],
      ['Colesterol total', 'COLESTEROL TOTAL'],
      ['HDL', 'Colesterol HDL', 'HDL-colesterol', 'HDL-c'],
      ['LDL', 'Colesterol LDL', 'LDL - Colesterol'],
      ['VLDL', 'Colesterol VLDL'],
      ['Triglicerídeos', 'Triglicérides', 'Triglicerides', 'TRIGLICERIDEOS'],
      ['TSH', 'tsh', 'TSH ultrassensível'],
      ['T4 livre', 'T4 Livre', 'Tiroxina livre (T4 livre)'],
      ['Vitamina D', '25-hidroxivitamina D', '25(OH)D', 'Vitamina D (25-OH)'],
      ['Vitamina B12', 'VITAMINA B-12'],
      ['Ferritina', 'FERRITINA'],
      ['Ferro sérico', 'Ferro Serico'],
      ['Creatinina', 'CREATININA'],
      ['Ureia', 'Uréia'],
      ['Ácido úrico', 'Acido Urico'],
      ['TGO', 'AST', 'TGO (AST)', 'Aspartato aminotransferase'],
      ['TGP', 'ALT', 'TGP (ALT)', 'Alanina aminotransferase'],
      ['Gama GT', 'GGT', 'Gama-GT', 'Gama glutamil transferase', 'γ-GT', 'Γ-GT'],
      ['Hemoglobina', 'HEMOGLOBINA'],
      ['Hematócrito', 'Hematocrito'],
      ['Leucócitos', 'Leucocitos'],
      ['Plaquetas', 'PLAQUETAS'],
      ['PSA total', 'PSA Total'],
      ['PCR', 'Proteína C reativa', 'Proteína C Reativa (PCR)'],
      ['Sódio', 'Sodio'],
      ['Potássio', 'POTASSIO'],
      ['Cálcio', 'Calcio'],
      ['Insulina', 'INSULINA'],
    ];
    for (const names of groups) expect([names[0], same(names)]).toEqual([names[0], 1]);
    // Cada grupo é um item diferente dos outros.
    expect(same(groups.map((names) => names[0]))).toBe(groups.length);
  });

  it('ignora acento, maiúsculas, pontuação e espaços a mais', () => {
    expect(examItemKey('GLICOSE (jejum)')).toBe('glicose');
    expect(examItemKey('Glicose - Jejum')).toBe('glicose');
    expect(examItemKey(' glicemia   de jejum ')).toBe('glicose');
    expect(examItemKey('  Neutrófilos:  ')).toBe('neutrofilos');
    expect(examItemKey('Relação A/G')).toBe(examItemKey('relacao a g'));
  });

  it('letra grega vale como a palavra', () => {
    expect(examItemKey('α1-globulina')).toBe(examItemKey('Alfa 1 globulina'));
    expect(examItemKey('β2-microglobulina')).toBe('beta 2 microglobulina');
    expect(examItemKey('β-HCG')).toBe(examItemKey('Beta HCG'));
    expect(examItemKey('γ-globulina')).toBe('gama globulina');
    expect(examItemKey('δ-ALA')).toBe('delta ala');
  });

  it('nunca junta coisas diferentes', () => {
    const apart: [string, string][] = [
      ['Colesterol total', 'Colesterol HDL'],
      ['Colesterol HDL', 'Colesterol LDL'],
      ['Colesterol HDL', 'Colesterol não-HDL'],
      ['Colesterol LDL', 'Colesterol VLDL'],
      ['Colesterol', 'Colesterol total'],
      ['Hemoglobina', 'Hemoglobina glicada'],
      ['Hemoglobina', 'Hematócrito'],
      ['T4 livre', 'T4 total'],
      ['T4 livre', 'T3 livre'],
      ['T4', 'T4 livre'],
      ['PSA total', 'PSA livre'],
      ['Cálcio', 'Cálcio iônico'],
      ['Ferro sérico', 'Ferritina'],
      ['Vitamina D', 'Vitamina B12'],
      ['Glicose', 'Glicose pós-prandial'],
      ['PCR', 'PCR ultrassensível'],
      ['TGO', 'TGP'],
      ['Creatinina', 'Creatinina urinária'],
      ['Insulina', 'Glicose'],
      ['α1-globulina', 'β1-globulina'],
      ['α1-globulina', 'α2-globulina'],
      ['β1-globulina', 'β2-globulina'],
      ['γ-globulina', 'α1-globulina'],
      ['β-HCG', 'HCG'],
      ['γ-GT', 'GT'],
    ];
    for (const [a, b] of apart) expect([a, b, examItemKey(a) === examItemKey(b)]).toEqual([a, b, false]);
  });

  it('nome fora da tabela só junta com ele mesmo', () => {
    expect(examItemKey('Homocisteína')).toBe('homocisteina');
    expect(examItemKey('HOMOCISTEINA')).toBe('homocisteina');
    expect(examItemKey('+++')).toBe('+++');
  });
});

describe('parseResultValue', () => {
  const number = (value: string) => parseResultValue(value)?.number ?? null;

  it('lê números do jeito brasileiro', () => {
    expect(parseResultValue('98')).toEqual({ number: 98, decimals: 0, mark: null, unit: null, ambiguous: false });
    expect(parseResultValue('5,6')).toEqual({ number: 5.6, decimals: 1, mark: null, unit: null, ambiguous: false });
    expect(parseResultValue('1.234,5')).toEqual({ number: 1234.5, decimals: 1, mark: null, unit: null, ambiguous: false });
    expect(parseResultValue('1234.5')).toEqual({ number: 1234.5, decimals: 1, mark: null, unit: null, ambiguous: false });
    expect(parseResultValue(' 13,20 ')).toEqual({ number: 13.2, decimals: 2, mark: null, unit: null, ambiguous: false });
    expect(number('12.345,67')).toBe(12345.67);
  });

  it('ponto com três dígitos depois é milhar; fora disso é decimal', () => {
    expect(parseResultValue('1.234')).toEqual({ number: 1234, decimals: 0, mark: null, unit: null, ambiguous: true });
    expect(number('7.500')).toBe(7500);
    expect(number('150.000')).toBe(150000);
    expect(number('1.234.567')).toBe(1234567);
    expect(parseResultValue('1.2')).toEqual({ number: 1.2, decimals: 1, mark: null, unit: null, ambiguous: false });
    expect(number('12.50')).toBe(12.5);
    expect(number('1.2345')).toBe(1.2345);
    // Zero na frente não é milhar.
    expect(parseResultValue('0.500')).toEqual({ number: 0.5, decimals: 3, mark: null, unit: null, ambiguous: false });
  });

  it('marca como ambíguo o milhar escrito com um ponto só e sem vírgula', () => {
    // "1.020" é lido como 1020 (regra acima), mas pode ser 1,020 escrito com ponto.
    const ambiguous = (value: string) => parseResultValue(value)?.ambiguous ?? null;
    for (const value of ['1.020', '2.450', '7.500', '150.000', '< 1.000']) expect([value, ambiguous(value)]).toEqual([value, true]);
    for (const value of ['1.234,5', '1.234.567', '1,020', '1020', '0.500', '12.50', '1.2', '98']) {
      expect([value, ambiguous(value)]).toEqual([value, false]);
    }
  });

  it('lê o limite escrito por extenso como "<" ou ">"', () => {
    expect(parseResultValue('inferior a 0,5')).toEqual({ number: 0.5, decimals: 1, mark: '<', unit: null, ambiguous: false });
    expect(parseResultValue('Inferior a 0,3')?.mark).toBe('<');
    expect(parseResultValue('INFERIOR À 0,5')?.mark).toBe('<');
    expect(parseResultValue('menor que 5')).toEqual({ number: 5, decimals: 0, mark: '<', unit: null, ambiguous: false });
    expect(parseResultValue('Abaixo de 10 mg/dL')).toEqual({ number: 10, decimals: 0, mark: '<', unit: 'mg/dL', ambiguous: false });
    expect(parseResultValue('superior a 90')).toEqual({ number: 90, decimals: 0, mark: '>', unit: null, ambiguous: false });
    expect(parseResultValue('Maior  que 90')?.mark).toBe('>');
    expect(parseResultValue('acima de 1.000')).toEqual({ number: 1000, decimals: 0, mark: '>', unit: null, ambiguous: true });
    // Outras palavras antes do número continuam sendo texto.
    for (const value of ['inferior a', 'inferior ao limite', 'cerca de 5', 'menor 5', 'até 0,5', 'inferior a < 5', 'não inferior a 5']) {
      expect([value, parseResultValue(value)]).toEqual([value, null]);
    }
  });

  it('guarda "<" e ">" como marca', () => {
    expect(parseResultValue('< 0,5')).toEqual({ number: 0.5, decimals: 1, mark: '<', unit: null, ambiguous: false });
    expect(parseResultValue('<0,5')?.mark).toBe('<');
    expect(parseResultValue('> 1.000')).toEqual({ number: 1000, decimals: 0, mark: '>', unit: null, ambiguous: true });
    expect(parseResultValue('≤ 5')?.mark).toBe('≤');
    expect(parseResultValue('>= 5')?.mark).toBe('≥');
  });

  it('aceita negativos', () => {
    expect(number('-1,5')).toBe(-1.5);
    expect(number('−2')).toBe(-2);
    expect(number('- 3')).toBe(-3);
    expect(Object.is(number('-0'), 0)).toBe(true);
  });

  it('aceita a unidade digitada junto do valor', () => {
    expect(parseResultValue('12 mg/dL')).toEqual({ number: 12, decimals: 0, mark: null, unit: 'mg/dL', ambiguous: false });
    expect(parseResultValue('5,6%')).toEqual({ number: 5.6, decimals: 1, mark: null, unit: '%', ambiguous: false });
    expect(parseResultValue('150.000 /mm³')).toEqual({ number: 150000, decimals: 0, mark: null, unit: '/mm³', ambiguous: true });
    expect(parseResultValue('< 0,5 mg/L')).toEqual({ number: 0.5, decimals: 1, mark: '<', unit: 'mg/L', ambiguous: false });
  });

  it('o que não é número fica como texto', () => {
    for (const value of [
      'negativo',
      'Não reagente',
      'reagente',
      'normal',
      '+++',
      '+',
      '',
      '   ',
      '1:80',
      '120/80',
      '2 a 4 por campo',
      '10 a 20',
      '3+',
      '12/03/2026',
      '08:30',
      '1,234.5',
      '1.2.3',
      '98.',
      ',5',
      '1,2,3',
      'A+',
      'Reagente 1:160',
      '98 mg/dL (jejum)',
      '12345678901234567890',
    ]) {
      expect([value, parseResultValue(value)]).toEqual([value, null]);
    }
  });
});

describe('formatResultNumber', () => {
  it('escreve com vírgula e as casas do laudo', () => {
    expect(formatResultNumber(5.6, 1)).toBe('5,6');
    expect(formatResultNumber(108, 0)).toBe('108');
    expect(formatResultNumber(13.2, 2)).toBe('13,20');
    expect(formatResultNumber(1234.5, 1)).toBe('1.234,5');
    expect(formatResultNumber(150000, 0)).toBe('150.000');
    expect(formatResultNumber(-1.5, 1)).toBe('-1,5');
    expect(formatResultNumber(-0.04, 1)).toBe('0,0');
  });
});

describe('normalizeUnit', () => {
  it('junta a mesma unidade escrita de outro jeito', () => {
    const groups = [
      ['mg/dL', 'mg/dl', 'MG/DL', ' mg / dL ', 'mg/dL.', 'mg%'],
      ['g/dL', 'g/dl', 'g%'],
      ['U/L', 'u/l', 'UI/L', 'mUI/mL'],
      ['µUI/mL', 'μUI/mL', 'uUI/mL', 'mcUI/mL', 'mUI/L', 'µU/mL'],
      ['µg/dL', 'mcg/dL', 'ug/dl'],
      ['ng/mL', 'µg/L', 'mcg/L'],
      ['pg/mL', 'ng/L'],
      ['/mm³', '/mm3', '/µL', '/uL'],
      ['milhões/mm³', 'milhoes/mm3'],
      ['%', ' % '],
    ];
    for (const units of groups) expect([units[0], new Set(units.map(normalizeUnit)).size]).toEqual([units[0], 1]);
    expect(new Set(groups.map((units) => normalizeUnit(units[0]))).size).toBe(groups.length);
  });

  it('não converte: unidades diferentes ficam separadas', () => {
    const apart: [string, string][] = [
      ['mg/dL', 'mmol/L'],
      ['mg/dL', 'g/dL'],
      ['mg/dL', 'mg/L'],
      ['g/dL', 'g/L'],
      ['ng/mL', 'ng/dL'],
      ['/mm³', 'mil/mm³'],
      ['U/L', 'U/mL'],
      ['%', ''],
    ];
    for (const [a, b] of apart) expect([a, b, normalizeUnit(a) === normalizeUnit(b)]).toEqual([a, b, false]);
  });

  it('sem unidade dá vazio', () => {
    expect(normalizeUnit(null)).toBe('');
    expect(normalizeUnit(undefined)).toBe('');
    expect(normalizeUnit('  ')).toBe('');
  });
});

describe('changeSentence', () => {
  it('diz quanto subiu ou desceu, em valor e em %', () => {
    expect(changeSentence(point('108', '2026-09-05'), point('99', '2026-03-12'))).toBe('subiu 9 (9%) desde 12/03/2026');
    expect(changeSentence(point('5,2', '2026-09-05'), point('5,6', '2026-03-12'))).toBe('desceu 0,4 (7%) desde 12/03/2026');
    expect(changeSentence(point('1.500', '2026-09-05'), point('1.000', '2026-03-12'))).toBe('subiu 500 (50%) desde 12/03/2026');
    expect(changeSentence(point('7.500', '2026-09-05'), point('10.000', '2026-03-12'))).toBe('desceu 2.500 (25%) desde 12/03/2026');
  });

  it('usa as casas do laudo, com vírgula', () => {
    expect(changeSentence(point('1,25', '2026-09-05'), point('1,1', '2026-03-12'))).toBe('subiu 0,15 (14%) desde 12/03/2026');
    expect(changeSentence(point('13,0', '2026-09-05'), point('12', '2026-03-12'))).toBe('subiu 1,0 (8%) desde 12/03/2026');
    // 0,1 + 0,2 não vira 0,30000000000000004.
    expect(changeSentence(point('0,3', '2026-09-05'), point('0,1', '2026-03-12'))).toBe('subiu 0,2 (200%) desde 12/03/2026');
  });

  it('arredonda a %', () => {
    expect(changeSentence(point('205', '2026-09-05'), point('200', '2026-03-12'))).toBe('subiu 5 (3%) desde 12/03/2026');
    expect(changeSentence(point('102', '2026-09-05'), point('100', '2026-03-12'))).toBe('subiu 2 (2%) desde 12/03/2026');
    expect(changeSentence(point('149', '2026-09-05'), point('100', '2026-03-12'))).toBe('subiu 49 (49%) desde 12/03/2026');
    expect(changeSentence(point('1.001', '2026-09-05'), point('1.000', '2026-03-12'))).toBe('subiu 1 (menos de 1%) desde 12/03/2026');
    expect(changeSentence(point('950', '2026-09-05'), point('100', '2026-03-12'))).toBe('subiu 850 (850%) desde 12/03/2026');
  });

  it('dez vezes maior ou menor que o anterior: sem conta, só o valor anterior', () => {
    expect(changeSentence(point('120', '2026-09-05'), point('0,9', '2026-03-12'))).toBe('era 0,9 em 12/03/2026');
    expect(changeSentence(point('0,9', '2026-09-05'), point('120', '2026-03-12'))).toBe('era 120 em 12/03/2026');
    expect(changeSentence(point('3.000', '2026-09-05'), point('2', '2026-03-12'))).toBe('era 2 em 12/03/2026');
    // Dez vezes já conta, nos dois sentidos.
    expect(changeSentence(point('10', '2026-09-05'), point('1', '2026-03-12'))).toBe('era 1 em 12/03/2026');
    expect(changeSentence(point('11', '2026-09-05'), point('1,1', '2026-03-12'))).toBe('era 1,1 em 12/03/2026');
    expect(changeSentence(point('1', '2026-09-05'), point('10', '2026-03-12'))).toBe('era 10 em 12/03/2026');
    expect(changeSentence(point('-20', '2026-09-05'), point('-1', '2026-03-12'))).toBe('era -1 em 12/03/2026');
    expect(changeSentence(point('100', '2026-09-05'), point('5', '2026-09-05'))).toBe('era 5 no resultado anterior do mesmo dia');
    // Um pouco menos que dez vezes ainda tem conta.
    expect(changeSentence(point('9,9', '2026-09-05'), point('1', '2026-03-12'))).toBe('subiu 8,9 (890%) desde 12/03/2026');
    expect(changeSentence(point('1,1', '2026-09-05'), point('10', '2026-03-12'))).toBe('desceu 8,9 (89%) desde 12/03/2026');
    // Zero não tem "vezes": valem as frases de sempre.
    expect(changeSentence(point('50', '2026-09-05'), point('0', '2026-03-12'))).toBe('subiu 50 desde 12/03/2026');
    expect(changeSentence(point('0', '2026-09-05'), point('50', '2026-03-12'))).toBe('desceu 50 (100%) desde 12/03/2026');
  });

  it('"1.020" ao lado de "1,015": leituras que não se comparam ficam sem conta', () => {
    expect(changeSentence(point('1.025', '2026-09-05'), point('1,015', '2026-06-10'))).toBe('era 1,015 em 10/06/2026');
    expect(changeSentence(point('1,015', '2026-09-05'), point('1.020', '2026-06-10'))).toBe('era 1.020 em 10/06/2026');
    expect(changeSentence(point('2.450', '2026-09-05'), point('2,45', '2026-03-12'))).toBe('era 2,45 em 12/03/2026');
    // Escritos do mesmo jeito, a conta continua.
    expect(changeSentence(point('1.025', '2026-09-05'), point('1.020', '2026-06-10'))).toBe('subiu 5 (menos de 1%) desde 10/06/2026');
    expect(changeSentence(point('1,025', '2026-09-05'), point('1,020', '2026-06-10'))).toBe('subiu 0,005 (menos de 1%) desde 10/06/2026');
  });

  it('em %, a mudança é em pontos percentuais, sem a porcentagem da mudança', () => {
    const pct = (value: string, date: string) => point(value, date, { unit: '%' });
    expect(changeSentence(pct('6,0', '2026-09-05'), pct('5,6', '2026-03-12'))).toBe('subiu 0,4 ponto percentual desde 12/03/2026');
    expect(changeSentence(pct('38', '2026-09-05'), pct('41', '2026-03-12'))).toBe('desceu 3 pontos percentuais desde 12/03/2026');
    expect(changeSentence(pct('2', '2026-09-05'), pct('1', '2026-03-12'))).toBe('subiu 1 ponto percentual desde 12/03/2026');
    // Abaixo de 2 fica no singular (1,5 ponto), de 2 em diante no plural.
    expect(changeSentence(pct('6,5', '2026-09-05'), pct('5,0', '2026-03-12'))).toBe('subiu 1,5 ponto percentual desde 12/03/2026');
    expect(changeSentence(pct('5,9', '2026-09-05'), pct('4,0', '2026-03-12'))).toBe('subiu 1,9 ponto percentual desde 12/03/2026');
    expect(changeSentence(pct('7,0', '2026-09-05'), pct('5,0', '2026-03-12'))).toBe('subiu 2,0 pontos percentuais desde 12/03/2026');
    expect(changeSentence(pct('4', '2026-09-05'), pct('6', '2026-03-12'))).toBe('desceu 2 pontos percentuais desde 12/03/2026');
    expect(changeSentence(pct('1', '2026-09-05'), pct('0', '2026-03-12'))).toBe('subiu 1 ponto percentual desde 12/03/2026');
    expect(changeSentence(pct('5,6', '2026-09-05'), pct('5,6', '2026-03-12'))).toBe('igual ao de 12/03/2026');
    expect(changeSentence(point('31', '2026-09-05', { unit: ' % ' }), pct('30', '2026-09-05'))).toBe(
      'subiu 1 ponto percentual desde o resultado anterior do mesmo dia',
    );
    // Dez vezes maior: sem conta, como nas outras unidades.
    expect(changeSentence(pct('6', '2026-09-05'), pct('0,5', '2026-03-12'))).toBe('era 0,5 em 12/03/2026');
  });

  it('igual, e a partir de zero (sem %)', () => {
    expect(changeSentence(point('99', '2026-09-05'), point('99', '2026-03-12'))).toBe('igual ao de 12/03/2026');
    expect(changeSentence(point('5,60', '2026-09-05'), point('5,6', '2026-03-12'))).toBe('igual ao de 12/03/2026');
    expect(changeSentence(point('5', '2026-09-05'), point('0', '2026-03-12'))).toBe('subiu 5 desde 12/03/2026');
    expect(changeSentence(point('0', '2026-09-05'), point('5', '2026-03-12'))).toBe('desceu 5 (100%) desde 12/03/2026');
    expect(changeSentence(point('-1', '2026-09-05'), point('-2', '2026-03-12'))).toBe('subiu 1 (50%) desde 12/03/2026');
  });

  it('com "<" ou ">" não faz conta', () => {
    expect(changeSentence(point('< 0,5', '2026-09-05'), point('0,8', '2026-03-12'))).toBe('era 0,8 em 12/03/2026');
    expect(changeSentence(point('0,8', '2026-09-05'), point('<0,5', '2026-03-12'))).toBe('era < 0,5 em 12/03/2026');
    expect(changeSentence(point('<0,5', '2026-09-05'), point('< 0,5', '2026-03-12'))).toBe('igual ao de 12/03/2026');
  });

  it('dois resultados no mesmo dia', () => {
    expect(changeSentence(point('101', '2026-09-05'), point('99', '2026-09-05'))).toBe('subiu 2 (2%) desde o resultado anterior do mesmo dia');
    expect(changeSentence(point('99', '2026-09-05'), point('99', '2026-09-05'))).toBe('igual ao resultado anterior do mesmo dia');
    expect(changeSentence(point('< 5', '2026-09-05'), point('9', '2026-09-05'))).toBe('era 9 no resultado anterior do mesmo dia');
  });
});

describe('rótulos', () => {
  it('valor com unidade', () => {
    expect(valueLabel({ value: '108', unit: 'mg/dL' })).toBe('108 mg/dL');
    expect(valueLabel({ value: '5,6', unit: '%' })).toBe('5,6%');
    expect(valueLabel({ value: 'Não reagente', unit: null })).toBe('Não reagente');
  });

  it('singular e plural', () => {
    expect(countLabel(1)).toBe('1 resultado');
    expect(countLabel(2)).toBe('2 resultados');
    expect(countLabel(12)).toBe('12 resultados');
  });
});

describe('chartPoints', () => {
  it('escala de 0 a 1, com o x seguindo o tempo', () => {
    expect(chartPoints([point('92', '2026-01-01'), point('108', '2026-01-11'), point('100', '2026-01-21')])).toEqual([
      { x: 0, y: 0 },
      { x: 0.5, y: 1 },
      { x: 1, y: 0.5 },
    ]);
    expect(chartPoints([point('10', '2026-01-01'), point('20', '2026-01-02'), point('30', '2026-01-11')]).map((p) => p.x)).toEqual([0, 0.1, 1]);
  });

  it('valores iguais ficam no meio; tudo no mesmo dia se espalha por igual', () => {
    expect(chartPoints([point('5', '2026-01-01'), point('5', '2026-06-01')])).toEqual([
      { x: 0, y: 0.5 },
      { x: 1, y: 0.5 },
    ]);
    expect(chartPoints([point('1', '2026-01-01'), point('2', '2026-01-01'), point('3', '2026-01-01')]).map((p) => p.x)).toEqual([0, 0.5, 1]);
    expect(chartPoints([point('1', '2026-01-01')])).toEqual([{ x: 0.5, y: 0.5 }]);
  });
});

describe('examTrends', () => {
  it('monta a série de um item em vários laudos, com a grafia mais recente', () => {
    const trends = examTrends([
      exam('2026-09-05', [result('Glicemia de jejum', '108', 'mg/dL', 'alto', '70 a 99')], { id: 'c', title: 'Check-up' }),
      exam('2026-01-10', [result('GLICOSE', '92', 'mg/dl')], { id: 'a', title: 'Rotina' }),
      exam('2026-03-12', [result('Glicose (jejum)', '99', 'MG/DL')], { id: 'b', title: 'Sangue' }),
    ]);
    expect(trends.single).toEqual([]);
    expect(trends.text).toEqual([]);
    expect(trends.series).toHaveLength(1);
    const [glicose] = trends.series;
    expect(glicose.name).toBe('Glicemia de jejum');
    expect(glicose.points.map((p) => [p.date, p.value, p.unit, p.examId, p.examTitle])).toEqual([
      ['2026-01-10', '92', 'mg/dl', 'a', 'Rotina'],
      ['2026-03-12', '99', 'MG/DL', 'b', 'Sangue'],
      ['2026-09-05', '108', 'mg/dL', 'c', 'Check-up'],
    ]);
    expect(glicose.last).toBe(glicose.points[2]);
    expect(glicose.last.flag).toBe('alto');
    expect(glicose.last.reference).toBe('70 a 99');
    expect(glicose.change).toBe('subiu 9 (9%) desde 12/03/2026');
    expect(glicose.chart.map((p) => p.y)).toEqual([0, 0.4375, 1]);
    expect(chartDescription(glicose)).toBe(
      'Glicemia de jejum, 3 resultados: 92 mg/dl em 10/01/2026, 99 MG/DL em 12/03/2026, 108 mg/dL em 05/09/2026.',
    );
  });

  it('um resultado só não é série', () => {
    const trends = examTrends([exam('2026-03-12', [result('Ferritina', '85,4', 'ng/mL')])]);
    expect(trends.series).toEqual([]);
    expect(trends.single.map((i) => [i.name, valueLabel(i.last), i.points.length])).toEqual([['Ferritina', '85,4 ng/mL', 1]]);
  });

  it('só compara a mesma unidade (ou os dois sem unidade), sem converter', () => {
    const trends = examTrends([
      exam('2026-01-10', [result('Glicose', '92', 'mg/dL'), result('Hemácias', '4,5'), result('TSH', '2,1', 'µUI/mL')]),
      exam('2026-03-12', [result('Glicose', '5,5', 'mmol/L'), result('Hemácias', '4,7'), result('TSH', '2,4', 'mUI/L')]),
      exam('2026-09-05', [result('Glicose', '101')]),
    ]);
    expect(trends.series.map((s) => [s.name, s.points.map((p) => p.value)])).toEqual([
      ['Hemácias', ['4,5', '4,7']],
      ['TSH', ['2,1', '2,4']],
    ]);
    // Glicose em mg/dL, em mmol/L e sem unidade: três itens, nenhuma conta entre eles.
    expect(trends.single.map((i) => valueLabel(i.last))).toEqual(['101', '5,5 mmol/L', '92 mg/dL']);
    expect(new Set(trends.single.map((i) => i.name))).toEqual(new Set(['Glicose']));
    expect(new Set([...trends.series, ...trends.single].map((i) => i.key)).size).toBe(5);
  });

  it('a unidade digitada junto do valor vale quando o campo está vazio', () => {
    const trends = examTrends([
      exam('2026-01-10', [result('Creatinina', '0,9 mg/dL')]),
      exam('2026-03-12', [result('Creatinina', '1,1', 'mg/dL')]),
      exam('2026-09-05', [result('Creatinina', '1,0 mg/dL', 'mg/dl')]),
      // Unidade do valor diferente da do campo: na dúvida, fica como texto.
      exam('2026-09-20', [result('Creatinina', '88 µmol/L', 'mg/dL')]),
    ]);
    expect(trends.series.map((s) => s.points.map((p) => valueLabel(p)))).toEqual([['0,9 mg/dL', '1,1 mg/dL', '1,0 mg/dl']]);
    expect(trends.text.map((i) => [i.name, i.last.value, i.last.number])).toEqual([['Creatinina', '88 µmol/L', null]]);
    // Sem a unidade do campo ao lado: "88 µmol/L mg/dL" não é o que o laudo diz.
    expect(trends.text.map((i) => valueLabel(i.last))).toEqual(['88 µmol/L']);
  });

  it('dois exames no mesmo dia mantêm os dois pontos, na ordem em que foram criados', () => {
    const trends = examTrends([
      exam('2026-03-12', [result('Glicose', '101', 'mg/dL')], { id: 'tarde', created_at: '2026-03-12T18:00:00Z' }),
      exam('2026-03-12', [result('Glicose', '95', 'mg/dL')], { id: 'manha', created_at: '2026-03-12T09:00:00Z' }),
      exam('2026-01-10', [result('Glicose', '90', 'mg/dL')], { id: 'antes', created_at: '2026-03-13T09:00:00Z' }),
    ]);
    expect(trends.series[0].points.map((p) => p.examId)).toEqual(['antes', 'manha', 'tarde']);
    expect(trends.series[0].change).toBe('subiu 6 (6%) desde o resultado anterior do mesmo dia');
  });

  it('o mesmo item duas vezes no mesmo laudo não vira série: são dois itens, na ordem do laudo', () => {
    const trends = examTrends([exam('2026-03-12', [result('Glicose', '95', 'mg/dL'), result('Glicose', '140', 'mg/dL')])]);
    expect(trends.series).toEqual([]);
    expect(trends.single.map((i) => [i.name, i.last.value])).toEqual([
      ['Glicose', '95'],
      ['Glicose', '140'],
    ]);
    expect(new Set(trends.single.map((i) => i.key)).size).toBe(2);
  });

  it('o mesmo item em texto duas vezes no mesmo laudo também são dois itens', () => {
    const trends = examTrends([
      exam('2026-03-12', [result('Nitrito', 'Negativo'), result('Nitrito', 'Positivo', null, 'alterado')], { title: 'Urina' }),
      exam('2026-09-05', [result('Nitrito', 'Negativo'), result('Nitrito', 'Negativo')], { title: 'Urina' }),
      exam('2026-09-06', [result('Conclusão', 'Sem alterações.'), result('Conclusão', 'Cisto simples no rim direito.')], { title: 'Ultrassom' }),
    ]);
    // A primeira ocorrência segue a primeira dos outros laudos; a segunda segue a segunda.
    expect(trends.text.map((i) => [i.name, i.points.map((p) => p.value)])).toEqual([
      ['Ultrassom: Conclusão', ['Sem alterações.']],
      ['Ultrassom: Conclusão', ['Cisto simples no rim direito.']],
      ['Nitrito', ['Negativo', 'Negativo']],
      ['Nitrito', ['Positivo', 'Negativo']],
    ]);
    expect(new Set(trends.text.map((i) => i.key)).size).toBe(4);
  });

  it('entre laudos, a primeira ocorrência segue a primeira e a segunda segue a segunda', () => {
    // Hemograma sem unidade: o percentual e o absoluto com o mesmo nome.
    const trends = examTrends([
      exam('2026-03-12', [result('Linfócitos', '30'), result('Linfócitos', '2.250')]),
      exam('2026-09-05', [result('Linfócitos', '28'), result('LINFÓCITOS', '2.100')]),
      exam('2026-10-01', [result('Linfócitos', '27')]),
    ]);
    // O nome é o do último ponto do próprio grupo.
    expect(trends.series.map((s) => [s.name, s.points.map((p) => p.value), s.change])).toEqual([
      ['Linfócitos', ['30', '28', '27'], 'desceu 1 (4%) desde 05/09/2026'],
      ['LINFÓCITOS', ['2.250', '2.100'], 'desceu 150 (7%) desde 12/03/2026'],
    ]);
    expect(trends.single).toEqual([]);
  });

  it('urina, fezes e líquor nunca entram na série de quem não diz o material', () => {
    const blood = (title: string) =>
      examTrends([
        exam('2026-01-10', [result('Creatinina', '0,9', 'mg/dL')], { title: 'Sangue de janeiro' }),
        exam('2026-03-12', [result('Creatinina', '120', 'mg/dL')], { title }),
        exam('2026-09-05', [result('Creatinina', '1,0', 'mg/dL')], { title: 'Check-up' }),
      ]);
    for (const title of [
      'Microalbuminúria (urina)',
      'URINA TIPO 1',
      'EAS',
      'Sumário urinário',
      'Creatinina urinária',
      'Proteinúria de 24h',
      'Clearance 24 horas',
      'Parasitológico de fezes',
      'Líquor',
      // Um exame só, mesmo com "e", "/", " - " ou a palavra "sangue" no título.
      'Urina tipo I e sedimento',
      'Pesquisa de sangue oculto nas fezes',
      'Relação albumina/creatinina (urina)',
      'EAS - rotina',
      'Urina 24h e clearance',
    ]) {
      const trends = blood(title);
      expect([title, trends.series.map((s) => [s.points.map((p) => p.value), s.change])]).toEqual([
        title,
        [[['0,9', '1,0'], 'subiu 0,1 (11%) desde 10/01/2026']],
      ]);
      // Nada some: o resultado do outro material fica como um item à parte.
      expect(trends.single.map((i) => [i.name, valueLabel(i.last), i.last.examTitle])).toEqual([['Creatinina', '120 mg/dL', title]]);
    }
    // Sem a palavra no título nem no nome, o app não tem como saber: junta pelo nome.
    expect(blood('Albumina/creatinina').series[0].points).toHaveLength(3);
  });

  it('o material vale pelo nome do resultado ou pelo título do exame, e junta com o mesmo material', () => {
    const trends = examTrends([
      exam('2026-01-10', [result('Densidade urinária', '1,015'), result('Creatinina', '100', 'mg/dL')], { title: 'Check-up' }),
      exam('2026-03-12', [result('Densidade urinária', '1,020'), result('Creatinina', '110', 'mg/dL')], { title: 'Urina tipo 1' }),
      exam('2026-06-10', [result('Creatinina', '95', 'mg/dL')], { title: 'EAS' }),
      exam('2026-09-05', [result('Creatinina', '900', 'mg/dL')], { title: 'Urina de 24h' }),
      exam('2026-09-06', [result('Creatinina', '3', 'mg/dL')], { title: 'Fezes' }),
    ]);
    expect(trends.series.map((s) => [s.name, s.points.map((p) => [p.value, p.examTitle])])).toEqual([
      [
        'Creatinina',
        [
          ['110', 'Urina tipo 1'],
          ['95', 'EAS'],
        ],
      ],
      [
        'Densidade urinária',
        [
          ['1,015', 'Check-up'],
          ['1,020', 'Urina tipo 1'],
        ],
      ],
    ]);
    // Sangue (sem material), urina de 24h e fezes: cada um no seu item.
    expect(trends.single.map((i) => [i.last.value, i.last.examTitle])).toEqual([
      ['3', 'Fezes'],
      ['900', 'Urina de 24h'],
      ['100', 'Check-up'],
    ]);
  });

  it('nome genérico ("Conclusão", "Resultado") é um item por exame, com o título do exame no nome', () => {
    const trends = examTrends([
      exam('2026-02-01', [result('Conclusão', 'Nódulo em lobo direito da tireoide (TI-RADS 4)', null, 'alterado')], { title: 'Ultrassom de tireoide' }),
      exam('2026-06-01', [result('CONCLUSÃO:', 'Sem alterações significativas')], { title: 'Raio-X de tórax' }),
      exam('2026-03-12', [result('Resultado', '92', 'mg/dL')], { title: 'Glicose' }),
      exam('2026-09-05', [result('Resultado', '212', 'mg/dL')], { title: 'Colesterol total' }),
    ]);
    expect(trends.series).toEqual([]);
    expect(trends.text.map((i) => [i.name, i.points.length, i.last.flag])).toEqual([
      ['Ultrassom de tireoide: Conclusão', 1, 'alterado'],
      ['Raio-X de tórax: CONCLUSÃO:', 1, null],
    ]);
    expect(trends.single.map((i) => [i.name, valueLabel(i.last)])).toEqual([
      ['Colesterol total: Resultado', '212 mg/dL'],
      ['Glicose: Resultado', '92 mg/dL'],
    ]);
    for (const name of ['Conclusão', 'Resultado', 'Laudo', 'Impressão diagnóstica', 'Observação', 'Valor']) {
      const each = examTrends([
        exam('2026-01-10', [result(name, '10'), result(name, 'sem achados')], { title: 'Um' }),
        exam('2026-03-12', [result(name, '12'), result(name, 'sem achados')], { title: 'Outro' }),
      ]);
      expect([name, each.series.length, each.single.map((i) => i.name), each.text.map((i) => i.name)]).toEqual([
        name,
        0,
        [`Outro: ${name}`, `Um: ${name}`],
        [`Outro: ${name}`, `Um: ${name}`],
      ]);
    }
    // Um nome que só contém a palavra não é genérico.
    expect(examTrends([exam('2026-01-10', [result('Valor de TSH', '2')]), exam('2026-03-12', [result('Valor de TSH', '3')])]).series).toHaveLength(1);
  });

  it('"%" ou "#" no fim do nome, com a unidade vazia, separa o percentual do absoluto', () => {
    const trends = examTrends([
      exam('2026-03-12', [result('LYM%', '30,5'), result('LYM#', '2,1'), result('HbA1c %', '5,6'), result('Hematócrito (%)', '41')]),
      exam('2026-09-05', [result('LYM%', '28,0'), result('LYM#', '1,9'), result('Hemoglobina glicada', '6,0', '%'), result('Hematócrito', '38', '%')]),
    ]);
    expect(trends.series.map((s) => [s.name, s.points.map((p) => valueLabel(p)), s.change])).toEqual([
      ['LYM%', ['30,5%', '28,0%'], 'desceu 2,5 pontos percentuais desde 12/03/2026'],
      ['LYM#', ['2,1', '1,9'], 'desceu 0,2 (10%) desde 12/03/2026'],
      ['Hemoglobina glicada', ['5,6%', '6,0%'], 'subiu 0,4 ponto percentual desde 12/03/2026'],
      ['Hematócrito', ['41%', '38%'], 'desceu 3 pontos percentuais desde 12/03/2026'],
    ]);
    expect(trends.single).toEqual([]);
    // "#" não junta com o nome sem símbolo, nem com o percentual.
    const apart = examTrends([
      exam('2026-03-12', [result('Neutrófilos', '55'), result('Neutrófilos #', '3.300')]),
      exam('2026-09-05', [result('Neutrófilos %', '60'), result('Neutrófilos #', '3.900')]),
    ]);
    expect(apart.series.map((s) => [s.name, s.points.map((p) => valueLabel(p))])).toEqual([['Neutrófilos #', ['3.300', '3.900']]]);
    expect(apart.single.map((i) => [i.name, valueLabel(i.last)])).toEqual([
      ['Neutrófilos %', '60%'],
      ['Neutrófilos', '55'],
    ]);
    // Com a unidade preenchida, o símbolo do nome não muda nada.
    const filled = examTrends([
      exam('2026-03-12', [result('Leucócitos #', '7.500', '/mm³')]),
      exam('2026-09-05', [result('Leucócitos', '8.200', '/mm³')]),
    ]);
    expect(filled.series.map((s) => s.points.map((p) => valueLabel(p)))).toEqual([['7.500 /mm³', '8.200 /mm³']]);
    // A contagem com a unidade junto do valor num laudo e no campo no outro é a mesma série.
    const counts = examTrends([
      exam('2026-03-12', [result('Linfócitos #', '2.250 /mm³')]),
      exam('2026-09-05', [result('Linfócitos #', '2.100', '/mm³')]),
    ]);
    expect(counts.series.map((s) => [s.points.map((p) => valueLabel(p)), s.change])).toEqual([
      [['2.250 /mm³', '2.100 /mm³'], 'desceu 150 (7%) desde 12/03/2026'],
    ]);
    // "#" sem unidade ao lado do mesmo item com unidade: à parte, e a linha avisa.
    const loose = examTrends([exam('2026-03-12', [result('LYM#', '2,1')]), exam('2026-09-05', [result('LYM#', '1,9', '10³/µL')])]);
    expect(loose.single.map((i) => [valueLabel(i.last), apartNote(i)])).toEqual([
      ['1,9 10³/µL', null],
      ['2,1', 'Há um resultado mais recente com unidade: 1,9 10³/µL em 05/09/2026. Não foi comparado.'],
    ]);
    // "Neutrófilos" e "Neutrófilos #", os dois sem unidade: os nomes já dizem, sem aviso.
    expect([...apart.series, ...apart.single].map((i) => [i.name, apartNote(i)])).toEqual([
      ['Neutrófilos #', null],
      ['Neutrófilos %', null],
      ['Neutrófilos', 'Há um resultado mais recente com unidade: 60% em 05/09/2026. Não foi comparado.'],
    ]);
    // Texto não ganha "%" do nome.
    expect(examTrends([exam('2026-03-12', [result('LYM%', 'aumentado')])]).text.map((i) => valueLabel(i.last))).toEqual(['aumentado']);
  });

  it('limite por extenso entra na série, sem conta', () => {
    const trends = examTrends([
      exam('2026-01-10', [result('PCR', '0,8', 'mg/dL')]),
      exam('2026-06-10', [result('PCR', 'Inferior a 0,5', 'mg/dL')]),
      exam('2026-09-05', [result('PCR', '0,9', 'mg/dL')]),
    ]);
    expect(trends.text).toEqual([]);
    expect(trends.series.map((s) => [s.points.map((p) => p.value), s.change])).toEqual([[['0,8', '< 0,5', '0,9'], 'era < 0,5 em 10/06/2026']]);
  });

  it('série com "1.020" e "1,015" fica sem conta e sem gráfico', () => {
    const density = examTrends([
      exam('2026-01-10', [result('Densidade', '1.020')]),
      exam('2026-06-10', [result('Densidade', '1,015')]),
      exam('2026-09-05', [result('Densidade', '1.025')]),
    ]).series[0];
    expect([density.points.map((p) => p.value), density.change, density.chart]).toEqual([['1.020', '1,015', '1.025'], 'era 1,015 em 10/06/2026', []]);
    const tsh = examTrends([
      exam('2026-03-12', [result('TSH', '2,45', 'µUI/mL')]),
      exam('2026-09-05', [result('TSH', '2.450', 'µUI/mL')]),
    ]).series[0];
    expect([tsh.points.map((p) => p.value), tsh.change, tsh.chart]).toEqual([['2,45', '2.450'], 'era 2,45 em 12/03/2026', []]);
    // O gráfico sai mesmo quando os dois últimos pontos foram escritos do mesmo jeito.
    const later = examTrends([
      exam('2026-01-10', [result('Densidade', '1,015')]),
      exam('2026-06-10', [result('Densidade', '1.020')]),
      exam('2026-09-05', [result('Densidade', '1.025')]),
    ]).series[0];
    expect([later.change, later.chart]).toEqual(['subiu 5 (menos de 1%) desde 10/06/2026', []]);
    // Tudo escrito do mesmo jeito: conta e gráfico de sempre.
    const same = examTrends([
      exam('2026-01-10', [result('Leucócitos', '7.500', '/mm³')]),
      exam('2026-06-10', [result('Leucócitos', '8.200', '/mm³')]),
    ]).series[0];
    expect([same.change, same.chart.length]).toEqual(['subiu 700 (9%) desde 10/01/2026', 2]);
    // Dez vezes maior, sem milhar ambíguo: sem conta, mas o gráfico fica.
    const jump = examTrends([exam('2026-01-10', [result('PCR', '0,4', 'mg/dL')]), exam('2026-06-10', [result('PCR', '12,0', 'mg/dL')])]).series[0];
    expect([jump.change, jump.chart.length]).toEqual(['era 0,4 em 10/01/2026', 2]);
  });

  it('exame realizado com data no futuro sai da evolução e vai para a lista dele', () => {
    const exams = [
      exam('2026-03-12', [result('TSH', '2,1', 'µUI/mL')]),
      exam('2027-03-12', [result('TSH', '4,9', 'µUI/mL', 'alto')], { id: 'futuro', title: 'Tireoide' }),
      exam('2026-10-12', [result('TSH', '2,3', 'µUI/mL')]),
      exam('2026-10-13', [], { id: 'vazio', title: 'Sem resultados' }),
      exam('2026-11-01', [result('TSH', '9', 'µUI/mL')], { status: 'agendado' }),
    ];
    const trends = examTrends(exams, '2026-10-12');
    // O de hoje entra; o de amanhã em diante, não.
    expect(trends.series.map((s) => s.points.map((p) => p.value))).toEqual([['2,1', '2,3']]);
    expect(trends.future).toEqual([{ id: 'futuro', title: 'Tireoide', date: '2027-03-12' }]);
    // Sem "hoje", não há como saber: entra tudo o que tem data.
    expect(examTrends(exams).future).toEqual([]);
    expect(examTrends(exams).series[0].points.map((p) => p.value)).toEqual(['2,1', '2,3', '4,9']);
  });

  it('o mesmo item em outra unidade (ou sem unidade) fica à parte, e a linha avisa', () => {
    const trends = examTrends([
      exam('2026-01-10', [result('Glicose', '92', 'mg/dL')]),
      exam('2026-03-12', [result('Glicose', '99', 'mg/dL')]),
      exam('2026-09-05', [result('glicemia', '104', null, 'alto')]),
    ]);
    const [series] = trends.series;
    const [loose] = trends.single;
    expect([series.name, valueLabel(series.last), series.change]).toEqual(['Glicose', '99 mg/dL', 'subiu 7 (8%) desde 10/01/2026']);
    expect(series.newerElsewhere).toBe(loose.last);
    expect(apartNote(series)).toBe('Há um resultado mais recente sem unidade: 104 em 05/09/2026. Não foi comparado.');
    expect([loose.name, loose.newerElsewhere]).toEqual(['glicemia', null]);
    expect(apartNote(loose)).toBe('Sem unidade: não foi comparado com os resultados em mg/dL.');

    // Outra unidade: o mais antigo avisa; o mais novo não precisa.
    const units = examTrends([
      exam('2024-05-02', [result('Vitamina D', '18', 'ng/mL', 'baixo')]),
      exam('2025-05-02', [result('Vitamina D', '60', 'nmol/L')]),
    ]);
    expect(units.single.map((i) => [valueLabel(i.last), apartNote(i)])).toEqual([
      ['18 ng/mL', 'Há um resultado mais recente em outra unidade: 60 nmol/L em 02/05/2025. Não foi comparado.'],
      ['60 nmol/L', null],
    ]);

    // O sem unidade é o mais antigo.
    const older = examTrends([exam('2025-01-10', [result('Glicose', '110')]), exam('2026-09-05', [result('Glicose', '92', 'mg/dL')])]);
    expect(older.single.map((i) => [valueLabel(i.last), apartNote(i)])).toEqual([
      ['92 mg/dL', null],
      ['110', 'Há um resultado mais recente com unidade: 92 mg/dL em 05/09/2026. Não foi comparado.'],
    ]);

    // No mesmo dia nenhum é mais novo: só o sem unidade explica por que ficou à parte.
    const sameDay = examTrends([
      exam('2026-09-05', [result('Glicose', '92', 'mg/dL'), result('Hemoglobina', '13,5', 'g/dL')], { created_at: '2026-09-05T08:00:00Z' }),
      exam('2026-09-05', [result('Glicose', '5,1', 'mmol/L')], { created_at: '2026-09-05T09:00:00Z' }),
      exam('2026-09-05', [result('Glicose', '95')], { created_at: '2026-09-05T10:00:00Z' }),
    ]);
    expect(sameDay.single.map((i) => [valueLabel(i.last), apartNote(i)])).toEqual([
      ['92 mg/dL', null],
      ['13,5 g/dL', null],
      ['5,1 mmol/L', null],
      ['95', 'Sem unidade: não foi comparado com os resultados em mg/dL e mmol/L.'],
    ]);
  });

  it('título que junta exames não vale como material: a série do sangue continua', () => {
    for (const title of [
      'Hemograma + EAS',
      'Sangue e urina',
      'Sangue/urina',
      'Exames de rotina (sangue e urina)',
      'Hemograma, EAS e parasitológico de fezes',
      'Bioquímica - EAS',
      'Urina e fezes',
      // O sangue dito pelo adjetivo.
      'Dosagens séricas e urinárias',
      'Exames sanguíneos e de urina',
      'Dosagem plasmática + urina de 24h',
    ]) {
      const trends = examTrends([
        exam('2026-01-10', [result('Hemoglobina', '13,1', 'g/dL'), result('Glicose', '92', 'mg/dL')], { title: 'Exames de rotina' }),
        exam(
          '2026-09-05',
          [result('Hemoglobina', '12,2', 'g/dL', 'baixo'), result('Glicose', '99', 'mg/dL'), result('Densidade urinária', '1,020')],
          { title },
        ),
      ]);
      expect([title, trends.series.map((s) => [s.name, s.change, apartNote(s)])]).toEqual([
        title,
        [
          ['Hemoglobina', 'desceu 0,9 (7%) desde 10/01/2026', null],
          ['Glicose', 'subiu 7 (8%) desde 10/01/2026', null],
        ],
      ]);
      // O que o próprio nome diz que é de urina continua à parte.
      expect(trends.single.map((i) => [i.name, i.material])).toEqual([['Densidade urinária', 'urina']]);
    }
  });

  it('o mesmo nome em outro material fica à parte, e a linha avisa', () => {
    const trends = examTrends([
      exam('2026-01-10', [result('Densidade', '1,015'), result('pH', '6,0')], { title: 'Exames de rotina' }),
      exam('2026-09-05', [result('Densidade', '1,020'), result('pH', '5,5')], { title: 'EAS' }),
      exam('2026-09-06', [result('Densidade', '1,010')], { title: 'Urina de 24h' }),
    ]);
    expect(trends.series).toEqual([]);
    expect(trends.single.map((i) => [i.name, i.last.value, i.last.examTitle, apartNote(i)])).toEqual([
      ['Densidade', '1,010', 'Urina de 24h', 'Exame de urina de 24 horas: não foi comparado com os resultados de mesmo nome de outros exames.'],
      ['Densidade', '1,020', 'EAS', 'Exame de urina: não foi comparado com os resultados de mesmo nome de outros exames.'],
      ['pH', '5,5', 'EAS', 'Exame de urina: não foi comparado com os resultados de mesmo nome de outros exames.'],
      ['Densidade', '1,015', 'Exames de rotina', 'Não foi comparado com os resultados de mesmo nome dos exames de urina e urina de 24 horas.'],
      ['pH', '6,0', 'Exames de rotina', 'Não foi comparado com os resultados de mesmo nome dos exames de urina.'],
    ]);
    // Nome diferente já diz que é outra coisa: sem aviso.
    const named = examTrends([
      exam('2026-01-10', [result('Creatinina', '0,9', 'mg/dL'), result('Creatinina urinária', '120', 'mg/dL')], { title: 'Rotina' }),
    ]);
    expect(named.single.map((i) => [i.name, apartNote(i)])).toEqual([
      ['Creatinina', null],
      ['Creatinina urinária', null],
    ]);
    // A urina de 24 horas junta pelo nome do resultado ou pelo título, com ou sem "urina" escrito.
    const day = examTrends([
      exam('2026-01-10', [result('Proteinúria 24h', '120', 'mg/24h')], { title: 'Rotina' }),
      exam('2026-09-05', [result('Proteinúria 24h', '150', 'mg/24h')], { title: 'Urina 24h' }),
    ]);
    expect(day.series.map((s) => [s.points.map((p) => p.value), apartNote(s)])).toEqual([[['120', '150'], null]]);
  });

  it('percentual e contagem do diferencial não são o mesmo item em outra unidade', () => {
    const differential = examTrends([
      exam('2026-03-12', [result('Neutrófilos', '55', '%'), result('Neutrófilos', '4.125', '/mm³', 'alto')]),
      exam('2026-09-05', [result('Neutrófilos', '60', '%')]),
    ]);
    expect(differential.series.map((s) => [valueLabel(s.last), apartNote(s)])).toEqual([['60%', null]]);
    expect(differential.single.map((i) => [valueLabel(i.last), i.newerElsewhere, i.otherUnits, apartNote(i)])).toEqual([
      ['4.125 /mm³', null, [], null],
    ]);
    // Fora do diferencial, "%" e outra unidade em laudos diferentes são o mesmo item em outra unidade: avisa.
    const glicada = examTrends([
      exam('2026-03-12', [result('HbA1c', '5,6', '%')]),
      exam('2026-09-05', [result('Hemoglobina glicada', '38', 'mmol/mol')]),
    ]);
    expect(glicada.single.map((i) => [valueLabel(i.last), apartNote(i)])).toEqual([
      ['38 mmol/mol', null],
      ['5,6%', 'Há um resultado mais recente em outra unidade: 38 mmol/mol em 05/09/2026. Não foi comparado.'],
    ]);
    // O laudo que traz as duas medidas é o que diz que são duas: daí em diante, cada uma segue a sua.
    const both = examTrends([
      exam('2026-03-12', [result('HbA1c', '5,6', '%'), result('HbA1c', '38', 'mmol/mol')]),
      exam('2026-09-05', [result('HbA1c', '42', 'mmol/mol')]),
    ]);
    expect([...both.series, ...both.single].map((i) => [valueLabel(i.last), apartNote(i)])).toEqual([
      ['42 mmol/mol', null],
      ['5,6%', null],
    ]);
    // Sem unidade ao lado do percentual continua avisando.
    const bare = examTrends([exam('2026-03-12', [result('Hematócrito', '42')]), exam('2026-09-05', [result('Hematócrito', '41', '%')])]);
    expect(bare.single.map((i) => [valueLabel(i.last), apartNote(i)])).toEqual([
      ['41%', null],
      ['42', 'Há um resultado mais recente com unidade: 41% em 05/09/2026. Não foi comparado.'],
    ]);
  });

  it('o aviso de outra unidade não cruza materiais (aí o aviso é o do material), exames de nome genérico nem resultados em texto', () => {
    const trends = examTrends([
      exam('2026-01-10', [result('Creatinina', '0,9', 'mg/dL'), result('Resultado', '5', 'mg/dL'), result('HIV', 'Não reagente')], { title: 'Sangue' }),
      exam('2026-09-05', [result('Creatinina', '120'), result('Resultado', '7')], { title: 'Urina tipo 1' }),
      exam('2026-09-06', [result('HIV', '0,1')], { title: 'Sorologia' }),
    ]);
    expect([...trends.series, ...trends.single, ...trends.text].map((i) => [i.name, valueLabel(i.last), i.newerElsewhere, apartNote(i)])).toEqual([
      ['HIV', '0,1', null, null],
      ['Creatinina', '120', null, 'Exame de urina: não foi comparado com os resultados de mesmo nome de outros exames.'],
      ['Urina tipo 1: Resultado', '7', null, null],
      ['Creatinina', '0,9 mg/dL', null, 'Não foi comparado com os resultados de mesmo nome dos exames de urina.'],
      ['Sangue: Resultado', '5 mg/dL', null, null],
      ['HIV', 'Não reagente', null, null],
    ]);
  });

  it('exame sem data ou não realizado fica de fora', () => {
    const exams = [
      exam('2026-01-10', [result('Glicose', '92', 'mg/dL')]),
      exam(null, [result('Glicose', '150', 'mg/dL')], { id: 'semdata', title: 'Sem data' }),
      exam('2026-03-12', [result('Glicose', '200', 'mg/dL')], { status: 'agendado' }),
      exam('2026-04-12', [result('Glicose', '210', 'mg/dL')], { status: 'pedido' }),
      exam('2026-99-99', [result('Glicose', '220', 'mg/dL')], { id: 'ruim', title: 'Data errada' }),
      exam(null, [], { title: 'Sem nada' }),
    ];
    const trends = examTrends(exams);
    expect(trends.series).toEqual([]);
    expect(trends.single.map((i) => i.last.value)).toEqual(['92']);
    expect(trends.undated).toEqual([
      { id: 'semdata', title: 'Sem data' },
      { id: 'ruim', title: 'Data errada' },
    ]);
  });

  it('resultados em texto ficam à parte, e valor vazio é ignorado', () => {
    const trends = examTrends([
      exam('2026-01-10', [result('HIV', 'Não reagente'), result('Proteínas na urina', '+++'), result('ERITROGRAMA', ' ')]),
      exam('2026-03-12', [result('HIV', 'não reagente'), result('PCR', '< 0,5', 'mg/dL'), result('Glicose', 'hemolisado')]),
      exam('2026-09-05', [result('PCR', '0,8', 'mg/dL')]),
    ]);
    expect(trends.text.map((i) => [i.name, i.points.map((p) => p.value)])).toEqual([
      ['HIV', ['Não reagente', 'não reagente']],
      ['Glicose', ['hemolisado']],
      ['Proteínas na urina', ['+++']],
    ]);
    expect(trends.series.map((s) => [s.name, s.points.map((p) => p.value), s.change])).toEqual([
      ['PCR', ['< 0,5', '0,8'], 'era < 0,5 em 12/03/2026'],
    ]);
    expect(trends.single).toEqual([]);
  });

  it('campo do banco que não veio como texto não quebra', () => {
    const odd = (value: unknown) => ({ name: 'Glicose', value, unit: undefined, reference: undefined, flag: undefined }) as unknown as ExamResult;
    const trends = examTrends([exam('2026-01-10', [odd(92), odd(null)]), exam('2026-03-12', [odd('99')])]);
    expect(trends.series.map((s) => s.points.map((p) => [p.value, p.unit, p.flag, p.reference]))).toEqual([
      [
        ['92', null, null, null],
        ['99', null, null, null],
      ],
    ]);
  });

  it('ordena: marcados no último resultado primeiro, depois o mais recente, depois a ordem do laudo', () => {
    const trends = examTrends([
      exam('2026-01-10', [
        result('Ureia', '30', 'mg/dL'),
        result('Creatinina', '0,9', 'mg/dL'),
        result('TSH', '2,0', 'µUI/mL', 'alto'),
        result('LDL', '160', 'mg/dL', 'alto'),
        result('Ácido úrico', '5,0', 'mg/dL'),
      ]),
      exam('2026-03-12', [
        result('Ureia', '32', 'mg/dL'),
        result('Creatinina', '1,0', 'mg/dL'),
        result('TSH', '2,2', 'µUI/mL'),
        result('LDL', '150', 'mg/dL', 'alterado'),
        result('Ácido úrico', '5,1', 'mg/dL'),
      ]),
      exam('2026-09-05', [result('Creatinina', '1,1', 'mg/dL'), result('HDL', '38', 'mg/dL', 'baixo')]),
      exam('2026-06-01', [result('HDL', '40', 'mg/dL')]),
    ]);
    // TSH já não está marcado no último; Ureia, TSH e Ácido úrico empatam na data e seguem o laudo.
    expect(trends.series.map((s) => s.name)).toEqual(['HDL', 'LDL', 'Creatinina', 'Ureia', 'TSH', 'Ácido úrico']);
  });

  it('itens da mesma data seguem a ordem do laudo (e a dos exames), não a do alfabeto', () => {
    const hemograma = ['Hemácias', 'Hemoglobina', 'Hematócrito', 'VCM', 'HCM', 'CHCM', 'RDW', 'Leucócitos', 'Neutrófilos', 'Linfócitos', 'Monócitos', 'Plaquetas'];
    const trends = examTrends([
      exam('2026-09-05', [result('Colesterol total', '180', 'mg/dL'), result('Albumina', '4,1', 'g/dL')], { created_at: '2026-09-06T10:00:00Z' }),
      exam(
        '2026-09-05',
        hemograma.map((name, index) => result(name, String(10 + index), null, name === 'RDW' ? 'alto' : null)),
        { created_at: '2026-09-05T10:00:00Z' },
      ),
      exam('2026-09-06', [result('Ferritina', '85', 'ng/mL')]),
    ]);
    expect(trends.single.map((i) => i.name)).toEqual([
      'RDW',
      'Ferritina',
      ...hemograma.filter((name) => name !== 'RDW'),
      'Colesterol total',
      'Albumina',
    ]);
  });

  it('diz se há algo para a evolução', () => {
    expect(hasExamResults([])).toBe(false);
    expect(hasExamResults([exam('2026-01-10', [])])).toBe(false);
    expect(hasExamResults([exam('2026-01-10', [result('Glicose', '92')], { status: 'pedido' })])).toBe(false);
    expect(hasExamResults([exam(null, [result('Glicose', '92')])])).toBe(true);
  });

  it('a descrição falada de um gráfico longo lê só os mais recentes', () => {
    const exams = Array.from({ length: 10 }, (_, i) => exam(`2026-01-${String(i + 1).padStart(2, '0')}`, [result('Peso', String(70 + i), 'kg')]));
    const description = chartDescription(examTrends(exams).series[0]);
    expect(description.startsWith('Peso, 10 resultados. Os 8 mais recentes: 72 kg em 03/01/2026, ')).toBe(true);
    expect(description.endsWith('79 kg em 10/01/2026.')).toBe(true);
  });
});

describe('visitSummary', () => {
  const today = '2026-10-12';
  const exams: TrendExam[] = [
    exam('2025-06-01', [result('Vitamina D', '22', 'ng/mL', 'baixo'), result('Ferritina', '80', 'ng/mL')], { title: 'Antigo' }),
    exam('2025-09-01', [result('Ferritina', '90', 'ng/mL')], { title: 'Ferro' }),
    exam('2026-03-12', [result('Glicose', '99', 'mg/dL'), result('HbA1c', '5,6', '%'), result('TSH', '2,10', 'µUI/mL')], { title: 'Rotina' }),
    exam(
      '2026-09-05',
      [
        result('Glicemia de jejum', '108', 'mg/dL', 'alto', '70 a 99'),
        result('Hemoglobina glicada', '5,6', '%'),
        result('TSH', '2,10', 'µUI/mL'),
        result('Urina: nitrito', 'Negativo'),
      ],
      { title: 'Check-up' },
    ),
    exam('2026-10-20', [], { title: 'Ultrassom de abdome', status: 'agendado' }),
    exam(null, [], { title: 'Colonoscopia', status: 'pedido' }),
    exam(null, [result('Sódio', '140', 'mEq/L')], { title: 'Sangue do hospital' }),
    exam('2026-09-30', [result('Glicose', '300', 'mg/dL', 'alto')], { title: 'De outra pessoa', person_id: 'beto' }),
  ];
  const medications = [
    medication(),
    medication({ name: 'Vitamina D', dosage: '7.000 UI', frequency: 'weekdays', weekdays: [0], times: ['09:00'] }),
    medication({ name: 'Amoxicilina', dosage: null, times: ['16:00', '08:00'], end_on: '2026-10-15' }),
    medication({ name: 'Terminado', end_on: '2026-10-11' }),
    medication({ name: 'Arquivado', active: false }),
    medication({ name: 'Doses completas', total_doses: 3, taken_count: 3 }),
    medication({ name: 'Do Beto', person_id: 'beto' }),
    medication({ name: 'Prednisona', dosage: '20 mg', start_on: '2026-10-20', total_doses: 5 }),
  ];

  it('monta o texto de quem tem tudo, na ordem, só com o que é da pessoa', () => {
    const text = visitSummary(
      person({ birth_date: '1984-05-02', allergies: ' dipirona,\n amendoim ', conditions: 'hipertensão' }),
      exams,
      medications,
      today,
    );
    expect(text).toBe(
      [
        'Resumo para a consulta: Ana Souza, 42 anos',
        '',
        'Alergias: dipirona, amendoim',
        'Condições: hipertensão',
        '',
        'Remédios em uso:',
        '- Losartana 50 mg: todo dia, 08:00 (uso contínuo)',
        '- Vitamina D 7.000 UI: todo domingo, 09:00 (uso contínuo)',
        '- Amoxicilina: todo dia, 08:00, 16:00 (até 15/10/2026)',
        '- Prednisona 20 mg: todo dia, 08:00 (0 de 5 doses, começa em 20/10/2026)',
        '',
        'Últimos resultados:',
        '- Glicemia de jejum: 108 mg/dL em 05/09/2026 (marcado no laudo: acima)',
        '- Hemoglobina glicada: 5,6% em 05/09/2026',
        '- TSH: 2,10 µUI/mL em 05/09/2026',
        '- Urina: nitrito: Negativo em 05/09/2026',
        '- Vitamina D: 22 ng/mL em 01/06/2025 (marcado no laudo: abaixo)',
        '',
        'O que mudou:',
        '- Glicemia de jejum: subiu 9 (9%) desde 12/03/2026',
        '',
        'Exames pedidos ou agendados:',
        '- Ultrassom de abdome (agendado, 20/10/2026)',
        '- Colonoscopia (pedido)',
        '',
        'Exames realizados sem data anotada (os resultados ficaram fora deste resumo):',
        '- Sangue do hospital',
        '',
        'Gerado pelo Kotii em 12/10/2026. Confira com os laudos.',
      ].join('\n'),
    );
  });

  it('"O que mudou" só traz séries com o último resultado nos últimos 12 meses', () => {
    const text = visitSummary(person(), exams, [], '2026-10-12');
    // Ferritina: último resultado em 01/09/2025, há mais de 12 meses.
    expect(text).not.toContain('Ferritina');
    expect(visitSummary(person(), exams, [], '2026-09-01')).toContain('- Ferritina: 90 ng/mL em 01/09/2025; subiu 10 (13%) desde 01/06/2025');
  });

  const body = (text: string) => text.split('\n\n').slice(1, -1).join('\n\n');

  it('"Últimos resultados" traz os 30 dias antes do exame mais recente, e o que está marcado', () => {
    const text = visitSummary(
      person(),
      [
        exam('2019-03-12', [result('Vitamina B12', '180', 'pg/mL', 'baixo')]),
        // 31 dias antes do mais recente: fora. 30 dias antes: entra.
        exam('2026-09-07', [result('Potássio', '4,1', 'mEq/L')]),
        exam('2026-09-08', [result('Sódio', '140', 'mEq/L')]),
        exam('2026-10-05', [result('Ferritina', '85,4', 'ng/mL'), result('TSH', '2,1', 'µUI/mL')], { title: 'Sangue' }),
        exam('2026-10-08', [result('Nitrito', 'Negativo'), result('Densidade', '1.020')], { title: 'Urina' }),
      ],
      [],
      today,
    );
    expect(body(text)).toBe(
      [
        'Últimos resultados:',
        '- Nitrito: Negativo em 08/10/2026',
        '- Densidade: 1.020 em 08/10/2026',
        '- Ferritina: 85,4 ng/mL em 05/10/2026',
        '- TSH: 2,1 µUI/mL em 05/10/2026',
        '- Sódio: 140 mEq/L em 08/09/2026',
        '- Vitamina B12: 180 pg/mL em 12/03/2019 (marcado no laudo: abaixo)',
      ].join('\n'),
    );
  });

  it('"Últimos resultados" segue a ordem do laudo na mesma data, com itens novos e em texto no lugar deles', () => {
    const text = visitSummary(
      person(),
      [
        exam('2026-03-12', [result('Hemácias', '4,5', 'milhões/mm³'), result('Hemoglobina', '13,5', 'g/dL'), result('Hematócrito', '41', '%')]),
        exam('2026-09-05', [
          result('Hemácias', '4,6', 'milhões/mm³'),
          result('Eritroblastos', '0', '%'),
          result('Hemoglobina', '13,8', 'g/dL'),
          result('Bastonetes', 'Ausentes'),
          result('Hematócrito', '42', '%'),
        ]),
      ],
      [],
      today,
    );
    expect(body(text).split('\n\n')[0]).toBe(
      [
        'Últimos resultados:',
        '- Hemácias: 4,6 milhões/mm³ em 05/09/2026',
        '- Eritroblastos: 0% em 05/09/2026',
        '- Hemoglobina: 13,8 g/dL em 05/09/2026',
        '- Bastonetes: Ausentes em 05/09/2026',
        '- Hematócrito: 42% em 05/09/2026',
      ].join('\n'),
    );
  });

  it('"O que mudou" não repete o que já está em "Últimos resultados" e deixa de fora o que ficou igual', () => {
    const text = visitSummary(
      person(),
      [
        exam('2026-01-10', [result('Glicose', '92', 'mg/dL'), result('Ferritina', '80', 'ng/mL'), result('TSH', '2,10', 'µUI/mL')]),
        exam('2026-03-12', [result('Ferritina', '90', 'ng/mL')]),
        exam('2026-09-05', [result('Glicose', '99', 'mg/dL'), result('TSH', '2,1', 'µUI/mL')]),
      ],
      [],
      today,
    );
    expect(body(text)).toBe(
      [
        'Últimos resultados:',
        '- Glicose: 99 mg/dL em 05/09/2026',
        '- TSH: 2,1 µUI/mL em 05/09/2026',
        '',
        'O que mudou:',
        // Já está acima: só a mudança. A Ferritina não está: leva valor e data. O TSH ficou igual.
        '- Glicose: subiu 7 (8%) desde 10/01/2026',
        '- Ferritina: 90 ng/mL em 12/03/2026; subiu 10 (13%) desde 10/01/2026',
      ].join('\n'),
    );
    // Tudo igual: o bloco nem aparece.
    const equal = visitSummary(
      person(),
      [exam('2026-03-12', [result('TSH', '2,1', 'µUI/mL')]), exam('2026-09-05', [result('TSH', '2,10', 'µUI/mL')])],
      [],
      today,
    );
    expect(body(equal)).toBe('Últimos resultados:\n- TSH: 2,10 µUI/mL em 05/09/2026');
  });

  it('laudos de imagem: cada "Conclusão" aparece com o título do exame, e a marcada não some', () => {
    const text = visitSummary(
      person(),
      [
        exam('2026-02-01', [result('Conclusão', 'Nódulo em lobo direito da tireoide (TI-RADS 4)', null, 'alterado')], { title: 'Ultrassom de tireoide' }),
        exam('2026-06-01', [result('Conclusão', 'Sem alterações significativas')], { title: 'Raio-X de tórax' }),
      ],
      [],
      today,
    );
    expect(body(text)).toBe(
      [
        'Últimos resultados:',
        '- Raio-X de tórax: Conclusão: Sem alterações significativas em 01/06/2026',
        '- Ultrassom de tireoide: Conclusão: Nódulo em lobo direito da tireoide (TI-RADS 4) em 01/02/2026 (marcado no laudo: alterado)',
      ].join('\n'),
    );
  });

  it('avisa quando há resultado mais novo do mesmo item sem unidade (ou em outra), sem esconder o marcado', () => {
    const old = visitSummary(
      person(),
      [
        exam('2025-01-10', [result('Glicose', '110', 'mg/dL', 'alto')]),
        exam('2026-09-05', [result('Glicose', '92'), result('Vitamina D', '32', 'ng/mL')]),
      ],
      [],
      today,
    );
    expect(body(old)).toBe(
      [
        'Últimos resultados:',
        '- Glicose: 92 em 05/09/2026',
        '- Vitamina D: 32 ng/mL em 05/09/2026',
        '- Glicose: 110 mg/dL em 10/01/2025 (marcado no laudo: acima). Há um resultado mais recente sem unidade: 92 em 05/09/2026. Não foi comparado.',
      ].join('\n'),
    );
    const series = visitSummary(
      person(),
      [
        exam('2026-01-10', [result('Glicose', '92', 'mg/dL')]),
        exam('2026-03-12', [result('Glicose', '99', 'mg/dL')]),
        exam('2026-09-05', [result('Glicose', '130', null, 'alto')]),
      ],
      [],
      today,
    );
    expect(body(series)).toBe(
      [
        'Últimos resultados:',
        '- Glicose: 130 em 05/09/2026 (marcado no laudo: acima)',
        '',
        'O que mudou:',
        '- Glicose: 99 mg/dL em 12/03/2026; subiu 7 (8%) desde 10/01/2026. Há um resultado mais recente sem unidade: 130 em 05/09/2026. Não foi comparado.',
      ].join('\n'),
    );
  });

  it('exame realizado com data no futuro fica fora dos resultados e é listado para conferir', () => {
    const text = visitSummary(
      person(),
      [
        exam('2026-03-12', [result('TSH', '2,1', 'µUI/mL')]),
        exam('2027-03-12', [result('TSH', '4,9', 'µUI/mL', 'alto')], { title: 'Tireoide' }),
        exam('2026-09-05', [result('Glicose', '92', 'mg/dL')]),
      ],
      [],
      today,
    );
    expect(body(text)).toBe(
      [
        'Últimos resultados:',
        '- Glicose: 92 mg/dL em 05/09/2026',
        '',
        'Exames com data no futuro: confira a data. Os resultados ficaram fora deste resumo.',
        '- Tireoide (12/03/2027)',
      ].join('\n'),
    );
  });

  it('exames por fazer: agendados de hoje em diante primeiro, depois os outros do mais novo para o mais antigo', () => {
    const pending = (title: string, status: 'pedido' | 'agendado', date: string | null, created_at = '2026-01-01T10:00:00Z') =>
      exam(date, [], { title, status, created_at });
    const text = visitSummary(
      person(),
      [
        pending('Hemograma', 'pedido', '2023-03-02'),
        pending('Ultrassom', 'agendado', '2026-10-20'),
        pending('Raio-X', 'pedido', null, '2026-10-01T10:00:00Z'),
        pending('Ecocardiograma', 'agendado', '2026-10-12'),
        pending('Mamografia', 'agendado', '2026-08-01'),
        pending('Tomografia', 'pedido', '2026-09-30'),
        pending('Endoscopia', 'agendado', null, '2026-09-01T10:00:00Z'),
        pending('Ressonância', 'pedido', '2026-11-05'),
      ],
      [],
      today,
    );
    expect(body(text)).toBe(
      [
        'Exames pedidos ou agendados:',
        '- Ecocardiograma (agendado, 12/10/2026)',
        '- Ultrassom (agendado, 20/10/2026)',
        '- Ressonância (pedido em 05/11/2026)',
        '- Tomografia (pedido em 30/09/2026)',
        '- Mamografia (agendado, 01/08/2026)',
        '- Hemograma (pedido em 02/03/2023)',
        '- Raio-X (pedido)',
        '- Endoscopia (agendado)',
      ].join('\n'),
    );
  });

  it('sem nada anotado ainda é um texto curto e válido', () => {
    expect(visitSummary(person({ name: ' Ana ' }), [], [], today)).toBe(
      [
        'Resumo para a consulta: Ana',
        '',
        'Ainda não há alergias, condições, remédios nem exames anotados no Kotii.',
        '',
        'Gerado pelo Kotii em 12/10/2026. Confira com os laudos.',
      ].join('\n'),
    );
    // Só dados de outra pessoa da casa: nada entra.
    expect(visitSummary(person({ id: 'caio', name: 'Caio' }), exams, medications, today)).toBe(
      visitSummary(person({ id: 'caio', name: 'Caio' }), [], [], today),
    );
  });

  it('serve para um pet', () => {
    const text = visitSummary(
      person({ id: 'rex', name: 'Rex', kind: 'pet', species: 'Cachorro', birth_date: '2023-08-01', allergies: 'frango' }),
      [
        exam('2026-02-01', [result('Creatinina', '1,2', 'mg/dL')], { person_id: 'rex' }),
        exam('2026-08-01', [result('Creatinina', '1,6', 'mg/dL', 'alto')], { person_id: 'rex' }),
      ],
      [medication({ person_id: 'rex', name: 'Antipulgas', dosage: null, frequency: 'monthly', start_on: '2026-01-05', times: ['09:00'] })],
      today,
    );
    expect(text).toBe(
      [
        'Resumo para a consulta: Rex (Cachorro), 3 anos',
        '',
        'Alergias: frango',
        '',
        'Remédios em uso:',
        '- Antipulgas: todo dia 5 do mês, 09:00 (uso contínuo)',
        '',
        'Últimos resultados:',
        '- Creatinina: 1,6 mg/dL em 01/08/2026 (marcado no laudo: acima)',
        '',
        'O que mudou:',
        '- Creatinina: subiu 0,4 (33%) desde 01/02/2026',
        '',
        'Gerado pelo Kotii em 12/10/2026. Confira com os laudos.',
      ].join('\n'),
    );
  });

  it('nunca avalia: nenhuma palavra de julgamento sai do app', () => {
    const all = examTrends(exams.filter((e) => e.person_id === 'ana'));
    const apartExams = [
      exam('2025-01-10', [result('Glicose', '110', 'mg/dL', 'alto')]),
      exam('2026-03-12', [result('Glicose', '5,1', 'mmol/L')]),
      exam('2026-09-05', [result('Glicose', '92')]),
    ];
    const apart = examTrends(apartExams);
    const outputs = [
      visitSummary(person({ birth_date: '1984-05-02', allergies: 'dipirona', conditions: 'hipertensão' }), exams, medications, today),
      visitSummary(person(), [], [], today),
      ...all.series.flatMap((s) => [s.change, chartDescription(s)]),
      ...[...all.single, ...all.text].map((i) => `${i.name}: ${valueLabel(i.last)}`),
      changeSentence(point('99', '2026-09-05'), point('99', '2026-03-12')),
      changeSentence(point('50', '2026-09-05'), point('99', '2026-03-12')),
      changeSentence(point('< 5', '2026-09-05'), point('9', '2026-03-12')),
      changeSentence(point('5', '2026-09-05'), point('0', '2026-09-05')),
      changeSentence(point('120', '2026-09-05'), point('0,9', '2026-03-12')),
      changeSentence(point('6,0', '2026-09-05', { unit: '%' }), point('5,6', '2026-03-12', { unit: '%' })),
      changeSentence(point('7', '2026-09-05', { unit: '%' }), point('5', '2026-03-12', { unit: '%' })),
      ...apart.single.map((i) => apartNote(i) ?? ''),
      visitSummary(person(), apartExams, [], today),
      visitSummary(person(), [exam('2027-03-12', [result('TSH', '4,9')], { title: 'Tireoide' })], [], today),
      countLabel(1),
      countLabel(3),
    ];
    for (const output of outputs) expect([output, JUDGEMENT.test(output)]).toEqual([output, false]);
    // As palavras da marcação só aparecem quando o resultado guardado tem a marca.
    const unflagged = exams.map((e) => ({ ...e, results: e.results.map((r) => ({ ...r, flag: null })) }));
    expect(visitSummary(person(), unflagged, [], today)).not.toMatch(/acima|abaixo|alterado|marcado/i);
  });
});
