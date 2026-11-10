// "Finalizar compra" com a nota: a lista que abriu o leitor, e a nota que a revisão confirmou nesse meio. A revisão
// (nota/[id]) não sabe de onde veio (o leitor, o QR code, a pendente da Sefaz, que trocam de tela entre si): ela
// entrega aqui o que aconteceu e volta, e a lista, de novo em foco, é quem diz, com a pergunta de encerrar a ida no
// fim do fluxo (domain/finishPurchase). Uma espera por vez, só na memória: recarregar a página ou fechar o app
// esquece, e a revisão então avisa sozinha, como antes.

import type { ConfirmedReceipt } from '@/domain/finishPurchase';

interface Waiting {
  listId: string;
  startedAt: number;
  receipt: ConfirmedReceipt | null;
}

let waiting: Waiting | null = null;

/** A pessoa escolheu ler a nota no "Finalizar compra" desta lista: a nota que for confirmada agora é dela. */
export function waitForReceipt(listId: string, now: number = Date.now()) {
  waiting = { listId, startedAt: now, receipt: null };
}

/**
 * A revisão confirmou uma nota. Com uma lista esperando (e o toque de confirmar depois de ela abrir o leitor), o
 * que houve fica para a lista dizer: true, e a revisão não avisa ela mesma. Sem lista esperando, false.
 */
export function handConfirmedReceipt(receipt: Omit<ConfirmedReceipt, 'confirmedAt'>, now: number = Date.now()): boolean {
  if (!waiting || receipt.tappedAt < waiting.startedAt) return false;
  waiting.receipt = { ...receipt, confirmedAt: now };
  return true;
}

/**
 * A lista voltou ao foco: a nota confirmada no fluxo (null quando a pessoa voltou sem confirmar), e a espera acaba.
 * A espera de outra lista fica.
 */
export function takeConfirmedReceipt(listId: string): ConfirmedReceipt | null {
  if (waiting?.listId !== listId) return null;
  const { receipt } = waiting;
  waiting = null;
  return receipt;
}

/** A lista desistiu da nota (o "Limpar" no lugar dela) ou saiu da tela: ninguém mais espera. */
export function stopWaitingForReceipt(listId: string) {
  if (waiting?.listId === listId) waiting = null;
}
