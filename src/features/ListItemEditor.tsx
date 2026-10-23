import { Image } from 'expo-image';
import { useState } from 'react';
import { Modal, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { pickImages, type ScanSource } from '@/data/images';
import { CATEGORIES, getCategory } from '@/domain/categories';
import { switchBrand, type BrandChoice } from '@/domain/genericItem';
import { MAX_NOTES, PRIORITIES, type ListPriority } from '@/domain/listItem';
import { formatQuantity, parseDecimal } from '@/domain/money';
import { errorMessage } from '@/lib/supabase';
import { UNITS, type ShoppingListItem, type Unit } from '@/lib/types';
import { Backdrop } from '@/ui/Backdrop';
import { confirmAction, notify } from '@/ui/dialogs';
import { PickerModal } from '@/ui/PickerModal';
import { Button, Card, CategoryIcon, Chip, Icon, IconButton, Row, Text, TextField } from '@/ui/primitives';
import { MAX_WIDTH, radius, space, useColors } from '@/ui/theme';

export type PhotoChange = { kind: 'keep' } | { kind: 'new'; uri: string } | { kind: 'remove' };

export interface ItemDetails {
  name: string;
  quantity: number;
  unit: Unit;
  /** A seção do item na lista e no texto que vai pelo WhatsApp. */
  category: string;
  notes: string | null;
  priority: ListPriority;
  /** A "Marca preferida"; ausente quando os detalhes não a oferecem (o banco ainda não a guarda). */
  brandPreferred?: boolean;
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
  facts,
  brand,
  onSeePrices,
  onSave,
  onRemove,
  onClose,
}: {
  item: ShoppingListItem;
  /**
   * O que a casa sabe do item: preços e despensa (itemFacts), em frases. Pela
   * prioridade marcada aqui, ainda sem salvar: "só em promoção" mostra o preço bom.
   */
  facts?: (priority: ListPriority) => string[];
  /**
   * "Marca preferida": o produto do item tem marca para escolher (domain/genericItem, brandChoice). Ligada, o nome
   * do item vira o do produto; desligada, o nome sem a marca. A escolha é guardada no item (brand_preferred); sem
   * o campo (o banco ainda não tem a coluna), os detalhes não a oferecem.
   */
  brand?: BrandChoice | null;
  /** O item tem um produto, com ou sem preço: "Ver preços" leva à tela dele (quem chama fecha os detalhes). */
  onSeePrices?: () => void;
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
  const initialQuantity = formatQuantity(Number(item.quantity), item.unit).split(' ')[0];
  const [quantity, setQuantity] = useState(initialQuantity);
  const [unit, setUnit] = useState<Unit>(item.unit);
  const [category, setCategory] = useState(item.category);
  const [pickingCategory, setPickingCategory] = useState(false);
  const [notes, setNotes] = useState(item.notes ?? '');
  const [priority, setPriority] = useState<ListPriority>(item.priority ?? 'normal');
  const [photo, setPhoto] = useState<PhotoChange>({ kind: 'keep' });

  const shown = photo.kind === 'new' ? photo.uri : photo.kind === 'remove' ? null : photoUri;
  const qty = parseDecimal(quantity);
  const invalid = !name.trim() || !qty || qty <= 0;
  const shownFacts = facts?.(priority) ?? [];
  const savedBrand = item.brand_preferred === true;
  const [prefersBrand, setPrefersBrand] = useState(savedBrand);
  // A escolha aparece com o banco que a guarda: com um produto com marca, ou já ligada (para dar para desligar).
  const offersBrand = typeof item.brand_preferred === 'boolean' && (brand != null || savedBrand);

  /** Liga a marca do produto (o nome vira o dele), ou desliga (volta o nome que o item tinha, ou o sem a marca). */
  function toggleBrand() {
    const next = switchBrand({ on: prefersBrand, name }, item.name, brand ?? null);
    setPrefersBrand(next.on);
    setName(next.name);
  }

  /** "Ver preços" sai dos detalhes: com algo mudado e ainda não salvo, pergunta antes. */
  function seePrices() {
    const changed =
      name !== item.name ||
      prefersBrand !== savedBrand ||
      quantity !== initialQuantity ||
      unit !== item.unit ||
      category !== item.category ||
      notes !== (item.notes ?? '') ||
      priority !== (item.priority ?? 'normal') ||
      photo.kind !== 'keep';
    if (!changed) return onSeePrices?.();
    confirmAction('Ver preços', 'As mudanças neste item ainda não foram salvas. Sair sem salvar?', 'Sair sem salvar', () => onSeePrices?.());
  }

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
                <CategoryIcon category={category} name={name} size={72} backdrop={false} />
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

          {/* Item com produto e ainda sem preço também leva ao produto: o histórico e os preços de outras casas ficam lá. */}
          {shownFacts.length || onSeePrices ? (
            <Card style={styles.gap}>
              <Row>
                <Icon name="tag-outline" color="primary" />
                <Text variant="label" style={styles.flex}>
                  Preço e despensa
                </Text>
              </Row>
              {shownFacts.map((fact) => (
                <Text key={fact} variant="muted">
                  {fact}
                </Text>
              ))}
              {shownFacts.length ? null : (
                <Text variant="muted">O histórico de preço e os preços vistos em outras casas ficam na tela do produto.</Text>
              )}
              {onSeePrices ? <Button title="Ver preços" icon="chart-line" variant="ghost" compact onPress={seePrices} /> : null}
            </Card>
          ) : null}

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
          {offersBrand ? (
            <View style={styles.gap}>
              <View style={styles.wrap}>
                <Chip label="Marca preferida" icon="star-outline" selected={prefersBrand} onPress={toggleBrand} />
              </View>
              <Text variant="small">
                {brandHint(prefersBrand, brand ?? null)}
              </Text>
            </View>
          ) : null}
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

          {/* A categoria é a seção do item: o chute pelo nome pode errar ("Rúcula" em "Outros"), e a pessoa corrige. */}
          <View style={styles.gap}>
            <Text variant="label">Categoria</Text>
            <View style={styles.wrap}>
              <Chip
                label={getCategory(category).label}
                icon="tag-outline"
                onPress={() => setPickingCategory(true)}
                accessibilityLabel={`Categoria: ${getCategory(category).label}. Trocar a categoria`}
              />
            </View>
            <Text variant="small">Decide em que parte da lista o item aparece, aqui e no texto que vai pelo WhatsApp.</Text>
          </View>

          <Button
            title="Salvar"
            icon="check"
            disabled={invalid}
            onPress={() =>
              onSave(
                {
                  name: name.trim(),
                  quantity: qty!,
                  unit,
                  category,
                  notes: notes.trim() || null,
                  priority,
                  ...(offersBrand ? { brandPreferred: prefersBrand } : {}),
                },
                photo,
              )
            }
          />
          <Button title="Remover da lista" variant="danger" icon="trash-can-outline" onPress={onRemove} />
        </ScrollView>
        <PickerModal
          visible={pickingCategory}
          title="Categoria"
          message="O item muda de seção quando salvar."
          options={CATEGORIES.map((cat) => ({ id: cat.key, title: cat.label, left: <CategoryIcon category={cat.key} size={32} /> }))}
          onClose={() => setPickingCategory(false)}
          onSelect={(key) => {
            setPickingCategory(false);
            setCategory(key);
          }}
        />
      </SafeAreaView>
    </Modal>
  );
}

/** O que a "Marca preferida" faz, ligada ou não; sem produto com marca, a escolha que ficou de antes. */
function brandHint(on: boolean, brand: BrandChoice | null): string {
  if (!brand) return on ? 'Na nota, só o mesmo produto tira o item da lista.' : 'Qualquer marca serve.';
  return on
    ? `A lista pede ${brand.brandName}. Na nota, só esse produto tira o item da lista.`
    : `Qualquer marca serve. Ligue para pedir ${brand.brandName}.`;
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
