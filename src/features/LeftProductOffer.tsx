import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, type ReactElement } from 'react';
import { StyleSheet, View } from 'react-native';

import { fetchLeftProduct } from '@/data/productDelete';
import {
  LEFT_PRODUCT_DELETE,
  LEFT_PRODUCT_KEEP,
  leftProductAnnouncement,
  leftProductDeleted,
  leftProductDeleteLabel,
  leftProductKeepLabel,
  leftProductMessage,
  productLeftBehind,
  type LeftProduct,
} from '@/domain/receiptCorrection';
import { useAnnounce } from '@/ui/announce';
import { moveFocus } from '@/ui/focus';
import { Button, Icon, Row, Text } from '@/ui/primitives';
import { space } from '@/ui/theme';

import { useDeleteProductFlow } from './useDeleteProductFlow';

/** O que a nota confirmada usa da oferta (useLeftProductOffer). */
export interface LeftProductOfferState {
  /** A oferta (ou o aviso de excluído) guardada; a tela ainda a esconde por leftProductShown. */
  left: LeftProduct | null;
  /** A troca respondeu: confere se o produto de antes dá para excluir agora, e oferece. */
  check: (itemId: string, before: string | null, result: { productId: string; changed: boolean }) => void;
  /** "Excluir o produto de antes": o caminho de sempre (useDeleteProductFlow). */
  remove: () => void;
  /** "Manter": a oferta sai, e o foco vai para o "Trocar produto" da linha. */
  keep: () => void;
  /** A leitura do toque ou o pedido de excluir a caminho. */
  busy: boolean;
  /** O selo "Trocar produto" de cada linha: é para ele que o foco vai quando a oferta sai. */
  chipRef: (itemId: string) => (node: View | null) => void;
  /** A região do leitor de tela no navegador (null no celular): num lugar da tela que não some com a oferta. */
  region: ReactElement | null;
}

/**
 * "Excluir o produto de antes", na nota confirmada, depois de "Trocar produto" (decisão do dono de 2026-11-24). Só
 * depois de uma troca que mudou mesmo a linha (productLeftBehind), e só quando uma leitura feita para isto diz que o
 * produto de antes dá para excluir (fetchLeftProduct: o banco que sabe excluir, e nenhuma linha de nota apontando para
 * ele); sem internet, ou com a leitura que falha, nada. Uma oferta de cada vez: a da troca seguinte toma o lugar.
 *
 * A oferta aparece na linha trocada e o leitor de tela a ouve (useAnnounce), sem levar o foco. O toque passa pelo mesmo
 * caminho da tela do produto (useDeleteProductFlow: a leitura com as recusas, a pergunta, o pedido com o nome lido, os
 * pares que passam, as buscas novas); excluído, a tela da nota fica e diz isso no lugar da oferta. Quando a oferta sai
 * (excluído, "Manter", já não existia, ou ganhou uma compra), o foco vai para o "Trocar produto" da mesma linha. Uma
 * resposta que chega depois de a tela sair não mostra nem anuncia nada.
 */
export function useLeftProductOffer(): LeftProductOfferState {
  const queryClient = useQueryClient();
  const [left, setLeft] = useState<LeftProduct | null>(null);
  // A conferência mais recente: a de uma troca anterior que responde depois não toma o lugar dela.
  const checks = useRef(0);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const { announce, clear, region } = useAnnounce('left-product-region');
  const chips = useRef(new Map<string, View | null>());
  // O selo é lido no quadro seguinte, quando a oferta já saiu da tela.
  const focusChip = (itemId: string) =>
    moveFocus({
      get current() {
        return chips.current.get(itemId) ?? null;
      },
    });

  // A oferta deste desenho: é dela que falam os fins do toque (o caminho de excluir guarda os fins do desenho do toque).
  const offer = left && !left.deleted ? left : null;
  const drop = (productId: string) => {
    if (offer?.productId !== productId) return;
    setLeft((now) => (now && !now.deleted && now.productId === productId ? null : now));
    focusChip(offer.itemId);
  };
  const deletion = useDeleteProductFlow({
    onDeleted: (productId, name) => {
      if (offer?.productId !== productId) return;
      setLeft({ ...offer, name, deleted: true });
      focusChip(offer.itemId);
      clear();
      announce(leftProductDeleted(name));
    },
    onGone: drop,
    onRefused: drop,
  });

  const check: LeftProductOfferState['check'] = (itemId, before, result) => {
    const productId = productLeftBehind(before, result);
    if (!productId) return;
    checks.current += 1;
    const seq = checks.current;
    void fetchLeftProduct(queryClient, productId).then((product) => {
      if (!product || !mounted.current || seq !== checks.current) return;
      setLeft({ itemId, productId: product.id, name: product.name, deleted: false });
      clear();
      announce(leftProductAnnouncement(product.name));
    });
  };

  const keep = () => {
    if (!offer) return;
    setLeft(null);
    clear();
    focusChip(offer.itemId);
  };

  const chipRef = (itemId: string) => (node: View | null) => {
    if (node) chips.current.set(itemId, node);
    else chips.current.delete(itemId);
  };

  return {
    left,
    check,
    remove: () => {
      if (offer) void deletion.ask(offer.productId);
    },
    keep,
    busy: deletion.busy,
    chipRef,
    region,
  };
}

/**
 * A oferta na linha da nota (ou, excluído, o aviso no lugar dela). `name` é o nome de agora (o catálogo, quando o
 * tem: outro aparelho pode ter renomeado); o aviso de excluído diz o nome que a pergunta leu.
 */
export function LeftProductOffer({
  left,
  name,
  busy,
  onDelete,
  onKeep,
}: {
  left: LeftProduct;
  name: string;
  busy: boolean;
  onDelete: () => void;
  onKeep: () => void;
}) {
  if (left.deleted) {
    return (
      <Row>
        <Icon name="check-circle-outline" size={18} color="textMuted" />
        <Text variant="small" style={styles.flex}>
          {leftProductDeleted(left.name)}
        </Text>
      </Row>
    );
  }
  return (
    <View style={styles.offer}>
      <Text variant="small">{leftProductMessage(name)}</Text>
      <Row style={styles.wrap}>
        <Button
          title={LEFT_PRODUCT_DELETE}
          variant="danger"
          icon="trash-can-outline"
          compact
          loading={busy}
          accessibilityLabel={leftProductDeleteLabel(name)}
          onPress={onDelete}
        />
        <Button
          title={LEFT_PRODUCT_KEEP}
          variant="secondary"
          compact
          disabled={busy}
          accessibilityLabel={leftProductKeepLabel(name)}
          onPress={onKeep}
        />
      </Row>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  offer: { gap: space.xs },
  wrap: { flexWrap: 'wrap' },
});
