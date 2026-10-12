import * as Clipboard from 'expo-clipboard';
// O Linking do React Native: na web ele abre o link numa aba nova e o Kotii
// continua aberto (o do expo-linking troca a página do app pela do WhatsApp).
import { Linking, Platform, ScrollView, Share, StyleSheet, useWindowDimensions } from 'react-native';

import { listShareText, whatsappUrl, type ShareItem } from '@/domain/listShare';
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
  /** A lista inteira: o texto leva o que falta comprar e só conta o que está no carrinho. */
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
    Linking.openURL(url).catch(() => notify('Não deu para abrir o WhatsApp', 'Use "Copiar" e cole o texto na conversa.'));
  };

  const actions: SheetAction[] = [{ label: 'WhatsApp', icon: 'whatsapp', onPress: sendWhatsApp }];
  // No navegador, o menu de compartilhar do sistema só existe em alguns (navigator.share).
  if (Platform.OS !== 'web' || (typeof navigator !== 'undefined' && typeof navigator.share === 'function')) {
    actions.push({
      label: 'Outro app',
      icon: 'share-variant-outline',
      // Fechar o menu do sistema sem escolher não é erro.
      onPress: () => void Share.share({ message: text }).catch(() => undefined),
    });
  }
  actions.push({
    label: 'Copiar',
    icon: 'content-copy',
    onPress: () => void copy('Cole na conversa com quem vai fazer as compras.'),
  });

  return (
    <ActionSheet visible={visible} title="Mandar a lista" actions={actions} onClose={onClose}>
      <ScrollView
        style={[styles.preview, { backgroundColor: c.surfaceAlt, maxHeight: Math.round(height * 0.3) }]}
        contentContainerStyle={styles.previewContent}>
        <Text variant="body" selectable>
          {text}
        </Text>
      </ScrollView>
      <Text variant="small">
        Vai só o que falta comprar, sem preços. No WhatsApp, o que está entre asteriscos aparece em negrito.
      </Text>
    </ActionSheet>
  );
}

const styles = StyleSheet.create({
  preview: { flexGrow: 0, borderRadius: radius.md },
  previewContent: { padding: space.md },
});
