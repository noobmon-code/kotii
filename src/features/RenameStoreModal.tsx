import { useState } from 'react';
import { Modal, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useRenameStores } from '@/data/market';
import {
  backToPrintedLabel,
  printedNameLine,
  sameCompanyStores,
  STORE_CHAIN_HINT,
  STORE_CHAIN_TITLE,
  STORE_RENAME_GONE,
  STORE_RENAME_LABEL,
  STORE_RENAME_TITLE,
  storeNameError,
  storeRenameChange,
  storeRenameHint,
  storeRevertChange,
} from '@/domain/storeName';
import { errorMessage } from '@/lib/supabase';
import type { Store } from '@/lib/types';
import { Backdrop } from '@/ui/Backdrop';
import { notify } from '@/ui/dialogs';
import { Button, CheckCircle, IconButton, ListCard, Row, Text, TextField } from '@/ui/primitives';
import { MAX_WIDTH, space, useColors } from '@/ui/theme';

/**
 * Dar outro nome ao mercado, para toda a casa: o da nota chega com a razão social do CNPJ. As outras lojas da
 * mesma empresa que a casa tem aparecem para a pessoa marcar (a empresa pode ter mais de uma bandeira). Com o
 * nome trocado, "Voltar ao nome da nota" desfaz. Renderize só quando aberto.
 */
export function RenameStoreModal({ store, stores, onClose }: { store: Store; stores: readonly Store[]; onClose: () => void }) {
  const c = useColors();
  const rename = useRenameStores();
  const [text, setText] = useState(store.name);
  const [tried, setTried] = useState(false);
  const [marked, setMarked] = useState<Record<string, boolean>>({});
  const company = sameCompanyStores(stores, store);
  const error = storeNameError(text);
  const printed = printedNameLine(store);
  const back = backToPrintedLabel(store);

  /** Grava (uma gravação por vez: o Enter do campo também chega aqui) e fecha; sem o que gravar, só fecha. */
  function save(change: { name: string; ids: string[] } | null) {
    if (rename.isPending) return;
    if (!change) return onClose();
    rename.mutate(change, {
      onSuccess: (saved) => {
        if (!saved.length) notify('Não deu para renomear o mercado', STORE_RENAME_GONE);
        onClose();
      },
      onError: (err) => notify('Não deu para renomear o mercado', errorMessage(err)),
    });
  }

  function onSave() {
    setTried(true);
    if (!error) save(storeRenameChange(store, text, company.filter((other) => marked[other.id])));
  }

  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={[styles.flex, { backgroundColor: c.background }]}>
        <Backdrop />
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Row>
            <Text variant="heading" style={styles.flex}>
              {STORE_RENAME_TITLE}
            </Text>
            <IconButton icon="close" label="Fechar" onPress={onClose} />
          </Row>
          {printed || store.address ? (
            <View style={styles.gapXs}>
              {printed ? <Text variant="muted">{printed}</Text> : null}
              {store.address ? <Text variant="muted">{store.address}</Text> : null}
            </View>
          ) : null}
          <TextField
            label={STORE_RENAME_LABEL}
            value={text}
            onChangeText={setText}
            placeholder="Pão de Açúcar, Assaí, a feira do bairro…"
            hint={storeRenameHint(store)}
            autoFocus
            selectTextOnFocus
            onSubmitEditing={onSave}
          />
          {tried && error ? (
            <Text variant="small" color="danger">
              {error}
            </Text>
          ) : null}
          {company.length ? (
            <View style={styles.gapSm}>
              <Text variant="label" accessibilityRole="header">
                {STORE_CHAIN_TITLE}
              </Text>
              <Text variant="muted">{STORE_CHAIN_HINT}</Text>
              <ListCard>
                {company.map((other) => (
                  <View key={other.id} style={styles.row}>
                    <CheckCircle
                      checked={Boolean(marked[other.id])}
                      label={`Usar o nome novo também em ${other.name}${other.address ? `, ${other.address}` : ''}`}
                      onPress={() => setMarked((prev) => ({ ...prev, [other.id]: !prev[other.id] }))}
                    />
                    <View style={styles.flex}>
                      <Text variant="body" numberOfLines={2}>
                        {other.name}
                      </Text>
                      {other.address ? <Text variant="muted">{other.address}</Text> : null}
                    </View>
                  </View>
                ))}
              </ListCard>
            </View>
          ) : null}
          <Button title="Salvar" icon="check" loading={rename.isPending} disabled={rename.isPending} onPress={onSave} />
          {back ? (
            <Button title={back} icon="undo" variant="secondary" disabled={rename.isPending} onPress={() => save(storeRevertChange(store))} />
          ) : null}
          <Button title="Cancelar" variant="secondary" onPress={onClose} />
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { width: '100%', maxWidth: MAX_WIDTH, alignSelf: 'center', padding: space.lg, gap: space.lg },
  gapXs: { gap: space.xs },
  gapSm: { gap: space.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.md, paddingVertical: space.sm },
});
