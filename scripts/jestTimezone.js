// O fuso de São Paulo para a suíte toda, qualquer que seja o da máquina (a nuvem e a CI rodam em UTC). As datas do
// app são as do aparelho, e os testes contam com o da casa: a nota das 23h30 de um dia 30 fica no mês dela. É o
// `globalSetup` do Jest (package.json): roda no processo do Jest antes de ele abrir os processos dos testes, que
// herdam o TZ. Trocar process.env.TZ dentro de um arquivo de teste não muda o fuso: o Jest dá a cada arquivo uma
// cópia do process.env.
module.exports = () => {
  process.env.TZ = 'America/Sao_Paulo';
};
