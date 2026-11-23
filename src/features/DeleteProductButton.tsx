import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';

import {
  deleteErrorNotice,
  fetchDeleteFacts,
  forgetDeletedProduct,
  refreshDeletedProduct,
  useDeleteProduct,
  useDeleteProductAvailable,
} from '@/data/productDelete';
import { isProductGone } from '@/data/productMerge';
import { DELETE_BUTTON, DELETE_CHECK_FAILED_TITLE, deleteStep, OPEN_REVIEW, type DeleteFacts } from '@/domain/productDelete';
import type { ProductName } from '@/domain/similarNames';
import { errorMessage } from '@/lib/supabase';
import { confirmAction, notify } from '@/ui/dialogs';
import { Button } from '@/ui/primitives';

/**
 * "Excluir produto", no fim da tela do produto que não tem compra (a tela decide quando mostrar). Só aparece quando
 * o banco já sabe excluir (delete_product_available): o app pode chegar antes da migração.
 *
 * O toque lê o produto de novo no banco (fetchDeleteFacts) antes de perguntar: se ele sumiu, se ganhou uma compra,
 * se está num item de nota para revisar, ou a pergunta, com o nome lido. Uma confirmação manda um pedido só, e o
 * erro do pedido aparece mesmo depois de sair da tela; o da leitura, não (nada foi tentado).
 */
export function DeleteProductButton({ productId, onDeleted }: { productId: string; onDeleted: () => void }) {
  const queryClient = useQueryClient();
  const available = useDeleteProductAvailable();
  const remove = useDeleteProduct();
  const [checking, setChecking] = useState(false);
  // Uma leitura de cada vez: o segundo toque enquanto lê não faz nada.
  const reading = useRef(false);
  // Um pedido por confirmação: volta a valer depois de um erro, e não depois de excluir.
  const sent = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  if (available.data !== true) return null;

  async function ask() {
    if (reading.current) return;
    reading.current = true;
    setChecking(true);
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
      // Outro aparelho excluiu ou juntou: sai da memória na hora, como depois de excluir aqui.
      forgetDeletedProduct(queryClient, productId);
      refreshDeletedProduct(queryClient);
      notify(step.title, step.message);
      onDeleted();
    } else if (step.kind === 'refuse' && step.reason === 'purchased') {
      notify(step.title, step.message);
      // As compras buscadas de novo escondem o botão.
      queryClient.invalidateQueries({ queryKey: ['priceHistory'] });
    } else if (step.kind === 'refuse') {
      queryClient.invalidateQueries({ queryKey: ['receipts'] });
      const receiptId = step.receiptId;
      if (receiptId) {
        confirmAction(step.title, step.message, OPEN_REVIEW, () => router.push({ pathname: '/nota/[id]', params: { id: receiptId } }), false);
      } else {
        notify(step.title, step.message);
      }
    } else {
      confirmAction(step.title, step.message, step.confirmLabel, () => void run(step.name));
    }
  }

  async function run(name: string) {
    if (sent.current) return;
    sent.current = true;
    try {
      // A tela sai pelo onSuccess deste pedido, antes de qualquer busca nova chegar; sem aviso de sucesso: a tela
      // saindo é o aviso, como nas outras exclusões.
      await remove.mutateAsync({ id: productId, name }, { onSuccess: () => (mounted.current ? onDeleted() : undefined) });
    } catch (err) {
      sent.current = false;
      const notice = deleteErrorNotice(err);
      notify(notice.title, notice.message);
      // Já não existe (outra pessoa excluiu ou juntou, ou a resposta de antes se perdeu): a tela sai também.
      if (isProductGone(err) && mounted.current) onDeleted();
    }
  }

  return (
    <Button
      title={DELETE_BUTTON}
      variant="danger"
      icon="trash-can-outline"
      loading={checking || remove.isPending}
      onPress={() => void ask()}
    />
  );
}
