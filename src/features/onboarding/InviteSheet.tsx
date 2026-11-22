import * as Clipboard from 'expo-clipboard';
import { Platform, Share, StyleSheet, View } from 'react-native';

import {
  INVITE_COPIED,
  INVITE_COPIED_TITLE,
  INVITE_COPY,
  INVITE_COPY_FAILED,
  INVITE_OTHER,
  INVITE_SKIP,
  INVITE_TEXT,
  INVITE_TITLE,
  INVITE_WHATSAPP,
  inviteMessage,
} from '@/domain/onboarding';
import { whatsappUrl } from '@/domain/listShare';
import { openExternal } from '@/lib/openLink';
import { ActionSheet, type SheetAction } from '@/ui/ActionSheet';
import { notify } from '@/ui/dialogs';
import { Text } from '@/ui/primitives';
import { radius, space, useColors } from '@/ui/theme';

/** O endereço do site para o link do convite: só no navegador (no aparelho, o convite vai só com o código). */
export function inviteOrigin(): string | null {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return null;
  return window.location?.origin ?? null;
}

/** O convite da casa: a mensagem, com o link do site no navegador e sempre com o código. */
export function houseInviteText(house: { name: string; invite_code: string }, withLink: boolean): string {
  return inviteMessage(house.name, house.invite_code, withLink ? inviteOrigin() : null);
}

/**
 * Chamar a casa: o convite pelo WhatsApp, por outro app (o menu de compartilhar do sistema) ou copiado. Fecha em
 * qualquer escolha, também em "Agora não" (`onClose`): quem abriu segue o caminho dele. O app não manda nada; quem
 * manda é o app escolhido. `onClosed` (ui/ActionSheet): o menu já saiu e a escolha já rodou; quem tira o convite da
 * tela ao fechar (a faixa da primeira lista) espera por ele, senão no iOS a escolha some junto com o menu.
 */
export function InviteSheet({
  visible,
  house,
  onClose,
  onClosed,
}: {
  visible: boolean;
  house: { name: string; invite_code: string };
  onClose: () => void;
  onClosed?: () => void;
}) {
  const c = useColors();
  const message = houseInviteText(house, true);

  const copy = async () => {
    const copied = await Clipboard.setStringAsync(message).catch(() => false);
    notify(copied ? INVITE_COPIED_TITLE : 'Não deu para copiar', copied ? INVITE_COPIED : INVITE_COPY_FAILED);
  };

  const actions: SheetAction[] = [
    {
      label: INVITE_WHATSAPP,
      icon: 'whatsapp',
      onPress: () => {
        const url = whatsappUrl(message);
        // No navegador o WhatsApp abre em outra aba; sem ele para abrir, o convite vai copiado.
        if (url) void openExternal(url).then((opened) => (opened ? undefined : copy()));
        else void copy();
      },
    },
  ];
  // No navegador, o menu de compartilhar do sistema só existe em alguns (navigator.share).
  if (Platform.OS !== 'web' || (typeof navigator !== 'undefined' && typeof navigator.share === 'function')) {
    actions.push({
      label: INVITE_OTHER,
      icon: 'share-variant-outline',
      onPress: () =>
        void Share.share({ message }).catch((error: unknown) => {
          // Fechar o menu do sistema sem escolher não é erro (no navegador, AbortError).
          if (Platform.OS === 'ios' || (error as { name?: unknown } | null)?.name === 'AbortError') return;
          void copy();
        }),
    });
  }
  actions.push({ label: INVITE_COPY, icon: 'content-copy', onPress: () => void copy() });

  return (
    <ActionSheet
      visible={visible}
      title={INVITE_TITLE}
      message={INVITE_TEXT}
      actions={actions}
      cancelLabel={INVITE_SKIP}
      onClose={onClose}
      onClosed={onClosed}>
      <View style={[styles.code, { backgroundColor: c.surfaceAlt }]}>
        <Text variant="small">Código da casa</Text>
        <Text variant="title" selectable style={styles.letters}>
          {house.invite_code}
        </Text>
      </View>
    </ActionSheet>
  );
}

const styles = StyleSheet.create({
  code: { alignItems: 'center', gap: space.xs, padding: space.md, borderRadius: radius.md },
  letters: { letterSpacing: 6 },
});
