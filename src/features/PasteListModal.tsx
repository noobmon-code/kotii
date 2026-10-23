import * as Clipboard from 'expo-clipboard';
import { useMemo, useState } from 'react';
import { Modal, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { getCategory } from '@/domain/categories';
import { PASTE_MAX_ITEMS, parsePastedList, pastePreview, pasteToAdd, type PastedItem } from '@/domain/listPaste';
import { formatQuantity } from '@/domain/money';
import { Backdrop } from '@/ui/Backdrop';
import { notify } from '@/ui/dialogs';
import { Button, CategoryIcon, IconButton, ListCard, ListRow, Row, Text, TextField } from '@/ui/primitives';
import { MAX_WIDTH, space, useColors } from '@/ui/theme';

/**
 * Ler a área de transferência: no app, sempre (o iPhone pede licença); no
 * navegador, só onde ele deixa (sem a função, a pessoa cola no campo).
 */
const canReadClipboard =
  Platform.OS !== 'web' || (typeof navigator !== 'undefined' && typeof navigator.clipboard?.readText === 'function');

const itemCount = (n: number) => `${n} ${n === 1 ? 'item' : 'itens'}`;

/**
 * "Colar lista": a pessoa cola o texto (de uma conversa, de uma nota, ou o
 * que o próprio app mandou pelo WhatsApp) e vê o que vai entrar antes de pôr.
 * O que já está para comprar na lista aparece, mas não entra de novo
 * (domain/listPaste). Renderize só quando aberto.
 */
export function PasteListModal({
  pending,
  onAdd,
  onClose,
}: {
  /** Os itens da lista: os que ainda estão para comprar não entram de novo. */
  pending: readonly { name: string; category: string; checked_at: string | null }[];
  onAdd: (items: PastedItem[]) => void;
  onClose: () => void;
}) {
  const c = useColors();
  const [text, setText] = useState('');
  const parsed = useMemo(() => parsePastedList(text), [text]);
  const rows = useMemo(() => pastePreview(parsed.items, pending), [parsed.items, pending]);
  const toAdd = pasteToAdd(rows);

  async function pasteCopied() {
    // Negada a licença ou sem nada copiado, a resposta é a mesma: vazio.
    const copied = await Clipboard.getStringAsync().catch(() => '');
    if (copied.trim()) setText(copied);
    else notify('Nada para colar', 'Copie a lista e toque de novo, ou segure no campo e escolha colar.');
  }

  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={[styles.flex, { backgroundColor: c.background }]}>
        <Backdrop />
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Row>
            <Text variant="heading" style={styles.flex}>
              Colar lista
            </Text>
            <IconButton icon="close" label="Fechar" onPress={onClose} />
          </Row>
          <Text variant="muted">
            Cole a lista que veio de uma conversa ou de uma nota, um item por linha. A quantidade também vale: “2 kg arroz”,
            “leite (2)”.
          </Text>
          <TextField
            value={text}
            onChangeText={setText}
            placeholder={'- 2 kg arroz\n- leite (2)\n- banana'}
            accessibilityLabel="Texto da lista"
            multiline
            style={styles.field}
          />
          {canReadClipboard ? (
            <Button title="Colar o que copiei" icon="content-paste" variant="secondary" compact onPress={() => void pasteCopied()} />
          ) : null}

          {rows.length ? (
            <View style={styles.gap}>
              <Text variant="label">Prévia</Text>
              <ListCard>
                {rows.map((row, index) => (
                  <ListRow
                    key={`${index}:${row.item.name}`}
                    left={<CategoryIcon category={row.item.category} name={row.item.name} size={32} />}
                    title={row.item.name}
                    subtitle={
                      row.listed
                        ? `Já está na lista${row.listed === row.item.name ? '' : ` como ${row.listed}`}: não entra de novo`
                        : `${formatQuantity(row.item.quantity, row.item.unit)} · ${getCategory(row.item.category).label}`
                    }
                  />
                ))}
              </ListCard>
            </View>
          ) : text.trim() ? (
            <Text variant="muted">Nenhum item nesse texto. Ponha um item por linha.</Text>
          ) : null}
          {parsed.cut ? (
            <Text variant="small">
              Só os primeiros {PASTE_MAX_ITEMS} itens entram de uma vez: {itemCount(parsed.cut)} ficaram de fora. Cole o
              resto depois.
            </Text>
          ) : null}

          <Button
            title={toAdd.length ? `Adicionar ${itemCount(toAdd.length)}` : 'Adicionar'}
            icon="playlist-plus"
            disabled={!toAdd.length}
            onPress={() => onAdd(toAdd)}
          />
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  gap: { gap: space.sm },
  content: { width: '100%', maxWidth: MAX_WIDTH, alignSelf: 'center', padding: space.lg, gap: space.lg },
  field: { minHeight: 140, textAlignVertical: 'top' },
});
