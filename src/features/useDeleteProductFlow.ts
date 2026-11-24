import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';

import {
  deleteErrorNotice,
  fetchDeleteFacts,
  forgetDeletedProduct,
  pairsToCarry,
  refreshDeletedProduct,
  useDeleteProduct,
} from '@/data/productDelete';
import { isProductGone } from '@/data/productMerge';
import { DELETE_CHECK_FAILED_TITLE, deleteStep, isProductInReview, isProductPurchased, OPEN_REVIEW, type DeleteFacts } from '@/domain/productDelete';
import type { ProductName } from '@/domain/similarNames';
import { errorMessage } from '@/lib/supabase';
import { confirmAction, notify } from '@/ui/dialogs';

/** O que a tela faz com o fim de cada caminho. Só é chamado com a tela (o dono do hook) ainda montada. */
export interface DeleteProductFlowEnds {
  /** Excluiu, com o nome que a pergunta leu. */
  onDeleted: (productId: string, name: string) => void;
  /** Já não existia (a leitura do toque não o achou, ou o pedido respondeu P0002/23503): o aviso já foi dado. */
  onGone: (productId: string) => void;
  /** Ganhou uma compra ou entrou numa nota em revisão (na leitura ou na recusa do banco): o aviso já foi dado. */
  onRefused?: (productId: string) => void;
}

/**
 * Excluir um produto, do toque ao fim, o mesmo caminho em todo lugar que oferece excluir: a tela do produto
 * (DeleteProductButton) e a nota confirmada depois de "Trocar produto" (LeftProductOffer). Quem chama decide quando
 * oferecer (o banco que sabe excluir, delete_product_available, e o que a tela sabe); daqui em diante é sempre igual.
 *
 * O toque (`ask`) lê o produto de novo no banco (fetchDeleteFacts) antes de perguntar: se ele sumiu, se ganhou uma
 * compra, se está num item de nota para revisar, ou a pergunta (deleteQuestion), com o nome lido. Uma confirmação
 * manda um pedido só (delete_product com o nome lido, useDeleteProduct: os pares que passam e as buscas novas), e o
 * erro do pedido aparece mesmo depois de sair da tela; o da leitura, não (nada foi tentado). Os fins (`ends`) só rodam
 * com a tela montada: uma resposta que chega depois de ela sair não mexe em nada.
 */
export function useDeleteProductFlow(ends: DeleteProductFlowEnds): { ask: (productId: string) => Promise<void>; busy: boolean } {
  const queryClient = useQueryClient();
  const remove = useDeleteProduct();
  const [checking, setChecking] = useState(false);
  // Uma leitura de cada vez: o segundo toque enquanto lê não faz nada.
  const reading = useRef(false);
  // Um pedido por confirmação, por produto: volta a valer depois de um erro, e não depois de excluir (a nota pode
  // oferecer outro produto depois, e esse vale).
  const sent = useRef<string | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  async function ask(productId: string) {
    if (reading.current) return;
    reading.current = true;
    setChecking(true);
    // Os pares que passam para o gêmeo de nome, se a leitura achar o produto já excluído: do que a memória tem
    // antes dela, como o pedido de excluir (uma busca nova que chegue no meio pode já ter tirado o produto).
    const carry = pairsToCarry(queryClient, productId);
    let facts: DeleteFacts;
    try {
      facts = await fetchDeleteFacts(productId);
    } catch (err) {
      // Sem internet, "Sem internet agora…"; o prazo da leitura, DELETE_CHECK_FAILED. Nada foi tentado.
      if (mounted.current) notify(DELETE_CHECK_FAILED_TITLE, errorMessage(err));
      return;
    } finally {
      reading.current = false;
      if (mounted.current) setChecking(false);
    }
    // A tela saiu enquanto lia: nada é mostrado nem perguntado.
    if (!mounted.current) return;
    const cached = queryClient.getQueryData<ProductName[]>(['products'])?.find((product) => product.id === productId);
    // O nome mudou em outro aparelho: a tela passa a mostrar o de agora, e a pergunta já sai com ele.
    if (facts.product && cached && facts.product.name !== cached.name) queryClient.invalidateQueries({ queryKey: ['products'] });
    const step = deleteStep(facts);
    if (step.kind === 'gone') {
      // Outro aparelho excluiu ou juntou: sai da memória na hora, como depois de excluir aqui, com os pares que
      // passam, e eles são gravados (quem excluiu pode não ter gravado os dele; a busca nova dos pares vem depois).
      forgetDeletedProduct(queryClient, productId, carry);
      refreshDeletedProduct(queryClient, { carry });
      notify(step.title, step.message);
      ends.onGone(productId);
    } else if (step.kind === 'refuse' && step.reason === 'purchased') {
      notify(step.title, step.message);
      // As compras buscadas de novo escondem o botão da tela do produto.
      queryClient.invalidateQueries({ queryKey: ['priceHistory'] });
      ends.onRefused?.(productId);
    } else if (step.kind === 'refuse') {
      queryClient.invalidateQueries({ queryKey: ['receipts'] });
      const receiptId = step.receiptId;
      if (receiptId) {
        confirmAction(step.title, step.message, OPEN_REVIEW, () => router.push({ pathname: '/nota/[id]', params: { id: receiptId } }), false);
      } else {
        notify(step.title, step.message);
      }
      ends.onRefused?.(productId);
    } else {
      confirmAction(step.title, step.message, step.confirmLabel, () => void run(productId, step.name));
    }
  }

  async function run(productId: string, name: string) {
    if (sent.current === productId) return;
    sent.current = productId;
    try {
      // O fim roda pelo onSuccess deste pedido, antes de qualquer busca nova chegar; sem aviso de sucesso aqui: quem
      // chama diz (a tela do produto, saindo; a nota, no lugar da oferta).
      await remove.mutateAsync({ id: productId, name }, { onSuccess: () => (mounted.current ? ends.onDeleted(productId, name) : undefined) });
    } catch (err) {
      if (sent.current === productId) sent.current = null;
      const notice = deleteErrorNotice(err);
      notify(notice.title, notice.message);
      if (!mounted.current) return;
      // Já não existe (outra pessoa excluiu ou juntou, ou a resposta de antes se perdeu).
      if (isProductGone(err)) ends.onGone(productId);
      // Ganhou uma compra ou entrou numa nota em revisão entre a leitura e o pedido.
      else if (isProductPurchased(err) || isProductInReview(err)) ends.onRefused?.(productId);
    }
  }

  return { ask, busy: checking || remove.isPending };
}
