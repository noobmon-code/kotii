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
 * `onboarding`: o começo novo de quem chega (domain/onboarding: boas-vindas, criar conta, o nome, a casa, a primeira
 * lista, chamar a casa e a tela de início). Ligada para todos desde 20/11/2026 (decisão do dono): quem chega vê o
 * começo novo, e as partes dele que ficam dentro do app (o convite nos Primeiros passos da Hoje e o link em
 * Configurações) valem para todas as casas. A prévia (Configurações → Manutenção do app) continua, para o dono ver o
 * começo como uma conta nova. Desligada, quem chega vê as telas de entrar e de boas-vindas de antes, e o começo novo
 * só pela prévia. Ligar ou desligar é trocar a constante: o servidor não muda.
 *
 * Lida sempre na hora do uso (dentro da função ou da tela), nunca guardada numa constante ao carregar o módulo:
 * os testes ligam ou desligam a chave com `jest.replaceProperty(FEATURES, 'finance', true)` (ou
 * `jest.replaceProperty(FEATURES, 'onboarding', false)`, nos testes das telas de antes).
 */
export const FEATURES: { readonly finance: boolean; readonly onboarding: boolean } = { finance: true, onboarding: true };
