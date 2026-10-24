import { useState } from 'react';
import { Modal, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useRenameList } from '@/data/market';
import { cleanListName, listNameError } from '@/domain/shoppingListName';
import { errorMessage } from '@/lib/supabase';
import { Backdrop } from '@/ui/Backdrop';
import { notify } from '@/ui/dialogs';
import { Button, IconButton, Row, Text, TextField } from '@/ui/primitives';
import { MAX_WIDTH, space, useColors } from '@/ui/theme';

/**
 * "Renomear" a lista, para toda a casa: o nome novo aparece na lista, nas listas e na faixa da ida ao mercado.
 * Sem internet não grava (data/market, useRenameList) e diz isso. Renderize só quando aberto.
 */
export function RenameListModal({ listId, name, onClose }: { listId: string; name: string; onClose: () => void }) {
  const c = useColors();
  const rename = useRenameList(listId);
  const [text, setText] = useState(name);
  const [tried, setTried] = useState(false);
  const error = listNameError(text);

  function onSave() {
    setTried(true);
    // Uma gravação por vez: o Enter do campo também chega aqui.
    if (error || rename.isPending) return;
    const clean = cleanListName(text);
    if (clean === name) return onClose();
    rename.mutate(clean, {
      onSuccess: onClose,
      onError: (err) => notify('Não deu para renomear a lista', errorMessage(err)),
    });
  }

  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={[styles.flex, { backgroundColor: c.background }]}>
        <Backdrop />
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Row>
            <Text variant="heading" style={styles.flex}>
              Renomear lista
            </Text>
            <IconButton icon="close" label="Fechar" onPress={onClose} />
          </Row>
          <TextField
            label="Nome da lista"
            value={text}
            onChangeText={setText}
            placeholder="Compras do mês, Feira, Churrasco…"
            autoFocus
            selectTextOnFocus
            onSubmitEditing={onSave}
          />
          {tried && error ? (
            <Text variant="small" color="danger">
              {error}
            </Text>
          ) : null}
          <Button title="Salvar" icon="check" loading={rename.isPending} onPress={onSave} />
          <Button title="Cancelar" variant="secondary" onPress={onClose} />
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { width: '100%', maxWidth: MAX_WIDTH, alignSelf: 'center', padding: space.lg, gap: space.lg },
});
