// A suíte roda no fuso de São Paulo, o da casa, em qualquer máquina (um contêiner em UTC, um computador em
// outro fuso): as datas do app são do fuso do aparelho, e os testes de virada de dia e de mês contam com ele.
// Tem de valer antes de nascer qualquer worker, que herda o ambiente deste processo. Dentro de um arquivo de
// teste é tarde: lá o `process.env` é uma cópia, e escrever nele não troca o fuso das datas do Node.
const ZONE = 'America/Sao_Paulo';

module.exports = function globalSetup() {
  process.env.TZ = ZONE;
  // Com um arquivo só, ou `--runInBand`, os testes rodam neste processo: o fuso tem de valer aqui também.
  // 2h30 do dia 1º em UTC é dia 30 em São Paulo.
  if (new Date('2026-10-01T02:30:00Z').getDate() !== 30) {
    throw new Error(`O fuso ${ZONE} não valeu para os testes.`);
  }
};
