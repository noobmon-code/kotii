import * as Clipboard from 'expo-clipboard';
// O Linking do React Native: na web ele abre o link numa aba nova e o Kotii
// continua aberto (o do expo-linking troca a página do app pela do WhatsApp).
import { Linking, Platform, ScrollView, Share, StyleSheet, useWindowDimensions } from 'react-native';

import { listShareHint, listShareText, whatsappUrl, type ShareItem } from '@/domain/listShare';
import { ActionSheet, type SheetAction } from '@/ui/ActionSheet';
import { notify } from '@/ui/dialogs';
import { Text } from '@/ui/primitives';
import { radius, space, useColors } from '@/ui/theme';

/**
 * "Mandar a lista": a lista em texto (domain/listShare) para quem não tem o
 * app, com a prévia do que sai e três caminhos: WhatsApp, outro app ou
 * copiar. O app não guarda nem envia nada; quem manda é o app escolhido.
 */
export function ListShareSheet({
  visible,
  list,
  items,
  onClose,
}: {
  visible: boolean;
  list: { name: string };
  /** A lista inteira: o texto leva o que falta comprar; o que está no carrinho fica de fora (o menu avisa). */
  items: readonly ShareItem[];
  onClose: () => void;
}) {
  const c = useColors();
  const { height } = useWindowDimensions();
  // Segue a lista também enquanto o menu fecha: a prévia não muda no meio da animação.
  const text = listShareText(list, items);

  // Enquanto o menu estava aberto, outra pessoa pôs tudo no carrinho.
  if (!text) {
    return (
      <ActionSheet
        visible={visible}
        title="Mandar a lista"
        message="Não há nada para comprar nesta lista agora."
        actions={[]}
        onClose={onClose}
      />
    );
  }

  /** Copia e avisa. No navegador a cópia pode ser recusada: aí a pessoa copia da prévia. */
  const copy = async (message: string) => {
    const copied = await Clipboard.setStringAsync(text).catch(() => false);
    if (copied) notify('Lista copiada', message);
    else notify('Não deu para copiar', 'Abra "Mandar a lista" de novo, selecione o texto da lista e copie por lá.');
  };

  const sendWhatsApp = () => {
    const url = whatsappUrl(text);
    // Texto que não cabe num link: vai copiado, para colar na conversa.
    if (!url) return void copy('A lista é grande: o texto foi copiado, é só colar na conversa.');
    // Sem WhatsApp para abrir o link: o menu já fechou, então o texto vai copiado.
    Linking.openURL(url).catch(() => void copy('Não deu para abrir o WhatsApp: o texto foi copiado, é só colar na conversa.'));
  };

  const actions: SheetAction[] = [{ label: 'WhatsApp', icon: 'whatsapp', onPress: sendWhatsApp }];
  // No navegador, o menu de compartilhar do sistema só existe em alguns (navigator.share).
  if (Platform.OS !== 'web' || (typeof navigator !== 'undefined' && typeof navigator.share === 'function')) {
    actions.push({
      label: 'Outro app',
      icon: 'share-variant-outline',
      onPress: () =>
        void Share.share({ message: text }).catch((error: unknown) => {
          // Fechar o menu do sistema sem escolher não é erro (no navegador, AbortError). No iOS a falha
          // só chega depois de o menu ter aberto, vinda do app escolhido: dizer que não abriu seria mentira.
          if (Platform.OS === 'ios' || (error as { name?: unknown } | null)?.name === 'AbortError') return;
          // O menu não abriu e o do Kotii já fechou: o texto vai copiado.
          void copy('Não deu para abrir o menu de compartilhar: o texto foi copiado, é só colar na conversa.');
        }),
    });
  }
  actions.push({
    label: 'Copiar',
    icon: 'content-copy',
    onPress: () => void copy('Cole na conversa com quem vai fazer as compras.'),
  });

  // Até 30% da tela, mas sem empurrar as ações para fora em telas baixas (navegador do celular com a
  // barra de endereço): ACTIONS_ROOM é o que o título, o aviso e as três ações ocupam no menu.
  const previewMax = Math.round(Math.max(PREVIEW_MIN, Math.min(height * 0.3, height * 0.85 - ACTIONS_ROOM)));

  return (
    <ActionSheet visible={visible} title="Mandar a lista" actions={actions} onClose={onClose}>
      <ScrollView
        style={[styles.preview, { backgroundColor: c.surfaceAlt, maxHeight: previewMax }]}
        contentContainerStyle={styles.previewContent}>
        <Text variant="body" selectable>
          {text}
        </Text>
      </ScrollView>
      <Text variant="small">{listShareHint(items)}</Text>
    </ActionSheet>
  );
}

const PREVIEW_MIN = 96;
const ACTIONS_ROOM = 340;

const styles = StyleSheet.create({
  preview: { flexGrow: 0, borderRadius: radius.md },
  previewContent: { padding: space.md },
});
