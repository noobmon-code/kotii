import { describe, expect, it } from '@jest/globals';

import {
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
      ['Gama GT', 'GGT', 'Gama-GT', 'Gama glutamil transferase'],
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
    expect(parseResultValue('98')).toEqual({ number: 98, decimals: 0, mark: null, unit: null });
    expect(parseResultValue('5,6')).toEqual({ number: 5.6, decimals: 1, mark: null, unit: null });
    expect(parseResultValue('1.234,5')).toEqual({ number: 1234.5, decimals: 1, mark: null, unit: null });
    expect(parseResultValue('1234.5')).toEqual({ number: 1234.5, decimals: 1, mark: null, unit: null });
    expect(parseResultValue(' 13,20 ')).toEqual({ number: 13.2, decimals: 2, mark: null, unit: null });
    expect(number('12.345,67')).toBe(12345.67);
  });

  it('ponto com três dígitos depois é milhar; fora disso é decimal', () => {
    expect(parseResultValue('1.234')).toEqual({ number: 1234, decimals: 0, mark: null, unit: null });
    expect(number('7.500')).toBe(7500);
    expect(number('150.000')).toBe(150000);
    expect(number('1.234.567')).toBe(1234567);
    expect(parseResultValue('1.2')).toEqual({ number: 1.2, decimals: 1, mark: null, unit: null });
    expect(number('12.50')).toBe(12.5);
    expect(number('1.2345')).toBe(1.2345);
    // Zero na frente não é milhar.
    expect(parseResultValue('0.500')).toEqual({ number: 0.5, decimals: 3, mark: null, unit: null });
  });

  it('guarda "<" e ">" como marca', () => {
    expect(parseResultValue('< 0,5')).toEqual({ number: 0.5, decimals: 1, mark: '<', unit: null });
    expect(parseResultValue('<0,5')?.mark).toBe('<');
    expect(parseResultValue('> 1.000')).toEqual({ number: 1000, decimals: 0, mark: '>', unit: null });
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
    expect(parseResultValue('12 mg/dL')).toEqual({ number: 12, decimals: 0, mark: null, unit: 'mg/dL' });
    expect(parseResultValue('5,6%')).toEqual({ number: 5.6, decimals: 1, mark: null, unit: '%' });
    expect(parseResultValue('150.000 /mm³')).toEqual({ number: 150000, decimals: 0, mark: null, unit: '/mm³' });
    expect(parseResultValue('< 0,5 mg/L')).toEqual({ number: 0.5, decimals: 1, mark: '<', unit: 'mg/L' });
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
    expect(changeSentence(point('3.000', '2026-09-05'), point('2', '2026-03-12'))).toBe('subiu 2.998 (149.900%) desde 12/03/2026');
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

  it('o mesmo item duas vezes no mesmo laudo mantém os dois, na ordem do laudo', () => {
    const trends = examTrends([exam('2026-03-12', [result('Glicose', '95', 'mg/dL'), result('Glicose', '140', 'mg/dL')])]);
    expect(trends.series[0].points.map((p) => p.value)).toEqual(['95', '140']);
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
      ['Glicose', ['hemolisado']],
      ['HIV', ['Não reagente', 'não reagente']],
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

  it('ordena: marcados no último resultado primeiro, depois o mais recente, depois o nome', () => {
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
    // TSH já não está marcado no último; Ácido úrico e Ureia empatam na data.
    expect(trends.series.map((s) => s.name)).toEqual(['HDL', 'LDL', 'Creatinina', 'Ácido úrico', 'TSH', 'Ureia']);
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
        '- Glicemia de jejum: 108 mg/dL em 05/09/2026; subiu 9 (9%) desde 12/03/2026',
        '- Hemoglobina glicada: 5,6% em 05/09/2026; igual ao de 12/03/2026',
        '- TSH: 2,10 µUI/mL em 05/09/2026; igual ao de 12/03/2026',
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
        '- Creatinina: 1,6 mg/dL em 01/08/2026; subiu 0,4 (33%) desde 01/02/2026',
        '',
        'Gerado pelo Kotii em 12/10/2026. Confira com os laudos.',
      ].join('\n'),
    );
  });

  it('nunca avalia: nenhuma palavra de julgamento sai do app', () => {
    const all = examTrends(exams.filter((e) => e.person_id === 'ana'));
    const outputs = [
      visitSummary(person({ birth_date: '1984-05-02', allergies: 'dipirona', conditions: 'hipertensão' }), exams, medications, today),
      visitSummary(person(), [], [], today),
      ...all.series.flatMap((s) => [s.change, chartDescription(s)]),
      ...[...all.single, ...all.text].map((i) => `${i.name}: ${valueLabel(i.last)}`),
      changeSentence(point('99', '2026-09-05'), point('99', '2026-03-12')),
      changeSentence(point('50', '2026-09-05'), point('99', '2026-03-12')),
      changeSentence(point('< 5', '2026-09-05'), point('9', '2026-03-12')),
      changeSentence(point('5', '2026-09-05'), point('0', '2026-09-05')),
      countLabel(1),
      countLabel(3),
    ];
    for (const output of outputs) expect([output, JUDGEMENT.test(output)]).toEqual([output, false]);
    // As palavras da marcação só aparecem quando o resultado guardado tem a marca.
    const unflagged = exams.map((e) => ({ ...e, results: e.results.map((r) => ({ ...r, flag: null })) }));
    expect(visitSummary(person(), unflagged, [], today)).not.toMatch(/acima|abaixo|alterado|marcado/i);
  });
});
