/**
 * Chaves do app: partes inteiras que esta versão mostra ou esconde, sem mexer no servidor.
 *
 * `finance`: Finanças inteira. Desligada, não há a parte dela na aba Casa, nem as telas dela (contas, gastos,
 * orçamento, imposto de renda, consultor), nem nenhuma busca às tabelas dela em tela nenhuma: a Hoje, a agenda, os
 * avisos, o Nuke e o
 * Mercado do mês deixam contas, gastos e orçamento de fora, a nota não pergunta "Quem pagou" e o serviço não se
 * lança nos gastos. Os dados continuam no banco, intactos (e as versões antigas do app já instaladas seguem
 * mostrando Finanças): para voltar, basta ligar a chave.
 *
 * Lida sempre na hora do uso (dentro da função ou da tela), nunca guardada numa constante ao carregar o módulo:
 * os testes ligam a chave com `jest.replaceProperty(FEATURES, 'finance', true)`.
 */
export const FEATURES: { readonly finance: boolean } = { finance: true };
