import { getCategory } from '@/domain/categories';
import { foundTitle, MAX_SCAN_QUANTITY, SCAN_TO_LIST, SCAN_TO_PANTRY, type ScanItem, type ScanMode } from '@/domain/scan';
import { Button, CategoryIcon, IconButton, ListCard, ListRow, Row, Section, Text } from '@/ui/primitives';
import { space } from '@/ui/theme';

/**
 * Os produtos achados no "Escanear", até a pessoa dizer para onde vão: cada um com a quantidade (mais um, menos
 * um) e o "tirar", e embaixo o destino de todos de uma vez. No modo da despensa só há um destino.
 */
export function FoundList({
  items,
  mode,
  busy,
  savingPantry,
  savingList,
  onChange,
  onRemove,
  onPantry,
  onList,
}: {
  items: readonly ScanItem[];
  mode: ScanMode;
  /** A tela está ocupada (lendo uma foto, guardando): nada aqui responde. */
  busy: boolean;
  savingPantry: boolean;
  savingList: boolean;
  onChange: (key: string, delta: number) => void;
  onRemove: (key: string) => void;
  onPantry: () => void;
  onList: () => void;
}) {
  return (
    <Section title={foundTitle(items.length)}>
      <ListCard>
        {items.map((item) => (
          <ListRow
            key={item.key}
            left={<CategoryIcon category={item.category} name={item.name} />}
            title={item.name}
            subtitle={getCategory(item.category).label}
            right={
              <Row gap={space.xs}>
                <IconButton
                  icon="minus"
                  label={`Menos um de ${item.name}`}
                  disabled={busy || item.quantity <= 1}
                  onPress={() => onChange(item.key, -1)}
                />
                <Text variant="label" accessibilityLabel={`${item.quantity} de ${item.name}`}>
                  {item.quantity}
                </Text>
                <IconButton
                  icon="plus"
                  label={`Mais um de ${item.name}`}
                  disabled={busy || item.quantity >= MAX_SCAN_QUANTITY}
                  onPress={() => onChange(item.key, 1)}
                />
                <IconButton icon="close" label={`Tirar ${item.name}`} disabled={busy} onPress={() => onRemove(item.key)} />
              </Row>
            }
          />
        ))}
      </ListCard>
      <Button title={SCAN_TO_PANTRY} icon="fridge-outline" loading={savingPantry} disabled={busy} onPress={onPantry} />
      {mode === 'tudo' ? (
        <Button title={SCAN_TO_LIST} icon="cart-outline" variant="secondary" loading={savingList} disabled={busy} onPress={onList} />
      ) : null}
    </Section>
  );
}
