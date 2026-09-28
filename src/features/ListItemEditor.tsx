import { Image } from 'expo-image';
import { useState } from 'react';
import { Modal, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { pickImages, type ScanSource } from '@/data/images';
import { MAX_NOTES, PRIORITIES, type ListPriority } from '@/domain/listItem';
import { formatQuantity, parseDecimal } from '@/domain/money';
import { errorMessage } from '@/lib/supabase';
import { UNITS, type ShoppingListItem, type Unit } from '@/lib/types';
import { Backdrop } from '@/ui/Backdrop';
import { notify } from '@/ui/dialogs';
import { Button, CategoryIcon, Chip, IconButton, Row, Text, TextField } from '@/ui/primitives';
import { MAX_WIDTH, radius, space, useColors } from '@/ui/theme';

export type PhotoChange = { kind: 'keep' } | { kind: 'new'; uri: string } | { kind: 'remove' };

export interface ItemDetails {
  name: string;
  quantity: number;
  unit: Unit;
  notes: string | null;
  priority: ListPriority;
}

/**
 * Detalhes do item da lista: foto do produto certo, descrição, prioridade
 * (uma só, com todas as opções à vista), nome e quantidade. Renderize só
 * quando aberto.
 */
export function ListItemEditor({
  item,
  photoUri,
  photoPending,
  onSave,
  onRemove,
  onClose,
}: {
  item: ShoppingListItem;
  /** A foto atual (já enviada ou esperando internet). */
  photoUri: string | null;
  /** A foto atual ainda não subiu. */
  photoPending: boolean;
  onSave: (details: ItemDetails, photo: PhotoChange) => void;
  onRemove: () => void;
  onClose: () => void;
}) {
  const c = useColors();
  const [name, setName] = useState(item.name);
  const [quantity, setQuantity] = useState(formatQuantity(Number(item.quantity), item.unit).split(' ')[0]);
  const [unit, setUnit] = useState<Unit>(item.unit);
  const [notes, setNotes] = useState(item.notes ?? '');
  const [priority, setPriority] = useState<ListPriority>(item.priority ?? 'normal');
  const [photo, setPhoto] = useState<PhotoChange>({ kind: 'keep' });

  const shown = photo.kind === 'new' ? photo.uri : photo.kind === 'remove' ? null : photoUri;
  const qty = parseDecimal(quantity);
  const invalid = !name.trim() || !qty || qty <= 0;

  async function choose(source: ScanSource) {
    try {
      const [uri] = await pickImages(source);
      if (uri) setPhoto({ kind: 'new', uri });
    } catch (err) {
      notify('Não foi possível abrir a imagem', errorMessage(err));
    }
  }

  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={[styles.flex, { backgroundColor: c.background }]}>
        <Backdrop />
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Row>
            <Text variant="heading" style={styles.flex}>
              Detalhes do item
            </Text>
            <IconButton icon="close" label="Fechar" onPress={onClose} />
          </Row>

          <View style={styles.gap}>
            {shown ? (
              <Image
                source={{ uri: shown }}
                style={[styles.photo, { backgroundColor: c.surfaceAlt }]}
                contentFit="cover"
                accessibilityLabel={`Foto de ${item.name}`}
              />
            ) : (
              <View style={[styles.photo, styles.placeholder, { backgroundColor: c.glass, borderColor: c.glassBorder }]}>
                <CategoryIcon category={item.category} name={name} size={72} backdrop={false} />
                <Text variant="small" style={styles.center}>
                  Uma foto mostra o produto certo: a marca, o tamanho, a embalagem.
                </Text>
              </View>
            )}
            {photo.kind === 'new' || (photo.kind === 'keep' && photoPending) ? (
              <Text variant="small" style={styles.center}>
                A foto sobe quando tiver internet.
              </Text>
            ) : null}
            <Row>
              <View style={styles.flex}>
                <Button title="Tirar foto" icon="camera-outline" variant="secondary" compact onPress={() => choose('camera')} />
              </View>
              <View style={styles.flex}>
                <Button title="Da galeria" icon="image-outline" variant="secondary" compact onPress={() => choose('library')} />
              </View>
            </Row>
            {shown ? (
              <Button title="Remover a foto" variant="ghost" compact onPress={() => setPhoto({ kind: 'remove' })} />
            ) : null}
          </View>

          <View style={styles.gap}>
            <Text variant="label">Prioridade</Text>
            <View style={styles.wrap}>
              {PRIORITIES.map((p) => (
                <Chip key={p.key} label={p.label} selected={priority === p.key} onPress={() => setPriority(p.key)} />
              ))}
            </View>
          </View>

          <TextField
            label="Descrição"
            value={notes}
            onChangeText={setNotes}
            placeholder="Ex.: o de coco, embalagem azul, 2 L"
            multiline
            maxLength={MAX_NOTES}
          />

          <TextField label="Nome" value={name} onChangeText={setName} />
          <Row style={styles.qtyRow}>
            <View style={styles.qty}>
              <TextField label="Quantidade" value={quantity} onChangeText={setQuantity} keyboardType="decimal-pad" />
            </View>
            <View style={[styles.flex, styles.wrap]}>
              {UNITS.map((u) => (
                <Chip key={u} label={u} selected={unit === u} onPress={() => setUnit(u)} />
              ))}
            </View>
          </Row>

          <Button
            title="Salvar"
            icon="check"
            disabled={invalid}
            onPress={() =>
              onSave({ name: name.trim(), quantity: qty!, unit, notes: notes.trim() || null, priority }, photo)
            }
          />
          <Button title="Remover da lista" variant="danger" icon="trash-can-outline" onPress={onRemove} />
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { textAlign: 'center' },
  gap: { gap: space.sm },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  content: { width: '100%', maxWidth: MAX_WIDTH, alignSelf: 'center', padding: space.lg, gap: space.lg },
  photo: { width: '100%', aspectRatio: 4 / 3, borderRadius: radius.lg },
  placeholder: { alignItems: 'center', justifyContent: 'center', gap: space.sm, padding: space.lg, borderWidth: 1 },
  qtyRow: { alignItems: 'flex-end' },
  qty: { width: 110 },
});
