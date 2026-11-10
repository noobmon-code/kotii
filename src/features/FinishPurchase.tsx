import { onlineManager } from '@tanstack/react-query';
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';

import { FINISH_OFFLINE_NOTICE, FINISH_SHEET, finishStart, type ConfirmedReceipt } from '@/domain/finishPurchase';
import { stopWaitingForReceipt, takeConfirmedReceipt, waitForReceipt } from '@/lib/finishPurchase';
import { ActionSheet } from '@/ui/ActionSheet';

import { useReceiptScanner } from './ReceiptScanner';

interface Handlers {
  /** Sem a nota (escolhido, ou sem internet, com o aviso): o "Limpar o carrinho" de sempre. */
  withoutReceipt: (notice?: string) => void;
  /** De volta à lista (em `now`), a nota que a revisão confirmou no fluxo. */
  receiptConfirmed: (receipt: ConfirmedReceipt, now: number) => void;
}

/**
 * "Finalizar compra", na lista (domain/finishPurchase): a nota antes de limpar. `start` pergunta como finalizar,
 * com as opções do leitor de nota de sempre (useReceiptScanner) e o caminho sem a nota; sem internet, a nota fica
 * para depois e o "Limpar" segue com o aviso. Com a nota, a lista espera por ela (lib/finishPurchase): a revisão
 * confirma, tira da lista o que casou, guarda na despensa e volta, e a lista, de novo em foco, recebe o que
 * aconteceu. Voltar sem confirmar acaba a espera, sem aviso. `element` precisa ser renderizado pela tela.
 */
export function useFinishPurchase(listId: string, handlers: Handlers) {
  const scanner = useReceiptScanner();
  const [asking, setAsking] = useState(false);
  // O foco chega sem render: lê as funções do último desenho da tela (o carrinho e a ida de agora).
  const latest = useRef(handlers);
  useEffect(() => {
    latest.current = handlers;
  });

  useFocusEffect(
    useCallback(() => {
      const receipt = takeConfirmedReceipt(listId);
      if (receipt) latest.current.receiptConfirmed(receipt, Date.now());
    }, [listId]),
  );
  // A lista saiu da tela (voltou para as listas, trocou de casa): a nota que vier depois avisa sozinha.
  useEffect(() => () => stopWaitingForReceipt(listId), [listId]);

  const withoutReceipt = (notice?: string) => {
    stopWaitingForReceipt(listId);
    latest.current.withoutReceipt(notice);
  };

  const start = () => {
    if (finishStart(onlineManager.isOnline()) === 'clearOffline') withoutReceipt(FINISH_OFFLINE_NOTICE);
    else setAsking(true);
  };

  const element = (
    <>
      <ActionSheet
        visible={asking}
        title={FINISH_SHEET.title}
        message={FINISH_SHEET.message}
        actions={[
          // A espera começa já na escolha: a câmera, a galeria ou o QR code abrem depois que o menu fecha.
          ...scanner.actions.map((action) => ({
            ...action,
            onPress: () => {
              waitForReceipt(listId);
              action.onPress();
            },
          })),
          { label: FINISH_SHEET.withoutReceipt, icon: 'cart-remove', onPress: () => withoutReceipt() },
        ]}
        onClose={() => setAsking(false)}
      />
      {scanner.element}
    </>
  );

  return { start, element, busy: scanner.busy };
}
