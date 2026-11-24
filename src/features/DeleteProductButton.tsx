import { useDeleteProductAvailable } from '@/data/productDelete';
import { DELETE_BUTTON } from '@/domain/productDelete';
import { Button } from '@/ui/primitives';

import { useDeleteProductFlow } from './useDeleteProductFlow';

/**
 * "Excluir produto", no fim da tela do produto que não tem compra (a tela decide quando mostrar). Só aparece quando
 * o banco já sabe excluir (delete_product_available): o app pode chegar antes da migração.
 *
 * O toque é o caminho de sempre (useDeleteProductFlow): lê o produto de novo no banco, recusa ou pergunta, e manda um
 * pedido só. Excluído, ou já não existindo, a tela sai (`onDeleted`): sem aviso de sucesso, a tela saindo é o aviso,
 * como nas outras exclusões.
 */
export function DeleteProductButton({ productId, onDeleted }: { productId: string; onDeleted: () => void }) {
  const available = useDeleteProductAvailable();
  const flow = useDeleteProductFlow({ onDeleted, onGone: onDeleted });

  if (available.data !== true) return null;

  return (
    <Button title={DELETE_BUTTON} variant="danger" icon="trash-can-outline" loading={flow.busy} onPress={() => void flow.ask(productId)} />
  );
}
