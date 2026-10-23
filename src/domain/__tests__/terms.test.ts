import { describe, expect, it } from '@jest/globals';

import {
  TERMS_ACCEPT_VERSION,
  TERMS_CONSENT,
  TERMS_CONTACT,
  TERMS_NOTICE_TEXT,
  TERMS_SECTIONS,
  TERMS_VERSION,
  termsNotice,
  termsVersionLabel,
} from '../terms';

const all = TERMS_SECTIONS.flatMap((section) => [section.title, ...section.paragraphs]).join('\n');
const section = (title: string) => TERMS_SECTIONS.find((s) => s.title === title)?.paragraphs.join('\n') ?? '';

describe('termos de uso', () => {
  it('a versão é uma data e aparece como dia/mês/ano', () => {
    expect(TERMS_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(termsVersionLabel('2026-10-18')).toBe('Versão de 18/10/2026');
  });

  it('a versão do aceite é uma data e nunca passa da versão do texto', () => {
    expect(TERMS_ACCEPT_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // Mudança importante muda o texto: a data do aceite é a de uma versão do texto, a atual ou uma anterior.
    expect(TERMS_ACCEPT_VERSION <= TERMS_VERSION).toBe(true);
  });

  it('cada seção tem título único e texto', () => {
    expect(new Set(TERMS_SECTIONS.map((s) => s.title)).size).toBe(TERMS_SECTIONS.length);
    for (const s of TERMS_SECTIONS) expect(s.paragraphs.every((p) => p.trim().length > 0)).toBe(true);
  });

  it('o contato é um e-mail, nos pedidos da LGPD e no fim, e não sobra marcador para preencher', () => {
    expect(TERMS_CONTACT).toMatch(/^[^\s@]+@[^\s@]+\.[a-z]+$/);
    expect(all).not.toMatch(/\[[^\]]*\]/);
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

  it('os preços compartilhados: o que fica de fora, o que a revisão segura e o nome do mercado sem CPF', () => {
    const prices = section('Preços compartilhados');
    for (const part of ['os suplementos', 'os primeiros socorros', 'os itens de higiene pessoal', 'o que você corrige na revisão', 'troca o mercado ou a data']) {
      expect(prices).toContain(part);
    }
    expect(prices).toContain('sem o CPF');
  });

  it('não promete o que não cumpre: no dia em que só uma casa comprou num mercado, os preços contam o que ela comprou', () => {
    const prices = section('Preços compartilhados');
    expect(prices).toContain('Ninguém vê de qual casa veio um preço');
    expect(prices).not.toContain('Não entra nada que identifique você');
    // O risco é por dia (a base junta as casas só no mesmo mercado, item e dia de compra), não só no mercado
    // em que nenhuma outra casa compra: um mercado com outras casas em outros dias também entra.
    expect(prices).toContain('num dia em que só a sua casa, entre as que usam o Kotii, comprou num mercado');
    expect(prices).not.toContain('num mercado em que só a sua casa usa o Kotii');
    expect(prices).toContain('pode deduzir o que foi comprado lá naquele dia');
  });

  it('diz que guarda o aceite destes termos: quais versões e quando', () => {
    const account = section('Sua conta e sua casa');
    expect(account).toContain('O app guarda na sua conta quais versões destes termos você aceitou e quando');
    expect(account).toContain('também neste aparelho');
  });

  it('idade: conta só com 18 anos ou mais; crianças entram pela conta de um adulto da casa', () => {
    const account = section('Sua conta e sua casa');
    expect(account).toContain('Só quem tem 18 anos ou mais pode criar uma conta');
    expect(account).toContain('crianças e adolescentes');
    expect(account).toContain('entram pela conta de um adulto da casa, que responde por eles');
    // A tela de entrar e criar conta diz o mesmo antes do link para os termos.
    expect(TERMS_CONSENT).toContain('18 anos ou mais');
  });

  it('diz quem responde pelos dados: a empresa que está sendo criada, e o contato até lá', () => {
    const rights = section('Seus direitos (LGPD)');
    expect(rights).toContain('uma empresa que ainda está sendo criada');
    expect(rights).toContain('o nome e o CNPJ dela entram aqui');
    expect(rights).toContain(`Até lá, pedidos e dúvidas sobre os seus dados vão para o e-mail ${TERMS_CONTACT}.`);
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

  it('apagar a conta: pelo app, com a senha, o que fica com a casa e o contato para quem não conseguir', () => {
    const erase = section('Apagar dados e sair');
    expect(erase).not.toContain('ainda não tem um botão');
    expect(erase).toContain('use "Apagar minha conta" em Configurações, na aba Família, confirmando com a sua senha');
    expect(erase).toContain('você aparece como "Ex-morador"');
    expect(erase).toContain('A casa em que você é a última pessoa é apagada');
    expect(erase).toContain('Não tem volta.');
    expect(erase).toContain(`Se não conseguir apagar a conta pelo app, escreva para ${TERMS_CONTACT}`);
    expect(section('Sua conta e sua casa')).toContain('sai, é tirado dela ou apaga a conta');
  });

  it('o perfil: data de nascimento e telefone opcionais, só na conta da pessoa, fora da IA e da base de preços', () => {
    const account = section('Sua conta e sua casa');
    expect(account).toContain('A data de nascimento e o telefone são opcionais e ficam só na sua conta');
    expect(account).toContain('os outros moradores não veem');
    expect(account).toContain('não vão para a IA nem para a base de preços compartilhados');
    // O nome é um por pessoa: trocar muda em todas as casas.
    expect(account).toContain('ele muda em todas as suas casas');
    // Apagar a conta leva o perfil junto.
    expect(section('Apagar dados e sair')).toContain('o seu perfil (data de nascimento e telefone)');
    // O resumo que vai ao Nuke não fala de nenhum dos dois.
    expect(section('Inteligência artificial')).not.toMatch(/nascimento|telefone/);
  });

  it('o painel do app: quem mantém o Kotii vê só totais de uso, sem nomes, e-mails ou o que cada casa registrou', () => {
    const stored = section('O que o app guarda e para quê');
    expect(stored).toContain('Quem mantém o Kotii vê só números totais de uso');
    for (const part of [
      'quantas contas e casas existem',
      'de que tipo de aparelho',
      'quanto a IA foi usada',
      'quantas casas usam cada função',
      'quantos registros cada função recebeu nos últimos 30 dias',
    ]) {
      expect(stored).toContain(part);
    }
    expect(stored).toContain('registros de entrada do serviço de login');
    // A abertura da casa (household_sessions) é a fonte principal de "ativa": os termos dizem que ela é usada.
    expect(stored).toContain('quando cada pessoa abriu a casa no app');
    for (const part of ['quantas voltaram depois do primeiro dia', 'os avisos do navegador', 'os aceites dos termos']) {
      expect(stored).toContain(part);
    }
    expect(stored).toContain('sem nomes, sem e-mails e sem o que cada casa registrou');
  });

  it('o aceite é o da mudança do perfil; o painel do app mudou só o texto, e o aviso não volta', () => {
    // O perfil (22/10) mudou o que é guardado: o aviso voltou para todo mundo. O painel (23/10) só conta o que
    // o app já guardava, em totais: muda a versão do texto, não a do aceite.
    expect(TERMS_ACCEPT_VERSION).toBe('2026-10-22');
    expect(TERMS_VERSION).toBe('2026-10-23');
    expect(termsNotice(['2026-10-22'])).toBeNull();
    expect(termsNotice(['2026-10-20'])).toBe('mudou');
  });

  it('diz que uma mudança importante é avisada no app', () => {
    expect(section('Mudanças e contato')).toContain('o app avisa na tela Hoje');
  });
});

describe('aviso dos termos', () => {
  it('quem nunca aceitou vê "Leia os termos"; quem aceitou uma versão anterior, "mudaram"', () => {
    expect(termsNotice([], '2026-10-20')).toBe('primeira');
    expect(termsNotice(['2026-10-19'], '2026-10-20')).toBe('mudou');
    expect(TERMS_NOTICE_TEXT.primeira.title).toBe('Leia os termos de uso e privacidade');
    expect(TERMS_NOTICE_TEXT.mudou.title).toBe('Os termos de uso e privacidade mudaram');
  });

  it('com o aceite desta versão, ou de uma mais nova (aceita num app mais novo), não há aviso', () => {
    expect(termsNotice(['2026-10-19', '2026-10-20'], '2026-10-20')).toBeNull();
    expect(termsNotice(['2026-12-01'], '2026-10-20')).toBeNull();
    expect(termsNotice([TERMS_ACCEPT_VERSION])).toBeNull();
  });
});
