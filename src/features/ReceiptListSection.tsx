// Revisão da nota: que itens das listas abertas esta compra cumpriu. Os
// marcados saem da lista ao confirmar, e a ligação fica para a próxima nota.

import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import type { OpenListEntry } from '@/data/market';
import type { ListChoice, ListMatch } from '@/domain/listLinks';
import { Button, CategoryIcon, CheckCircle, Icon, ListCard, Section, Text } from '@/ui/primitives';
import { PickerModal } from '@/ui/PickerModal';
import { space } from '@/ui/theme';

/** Item da nota como aparece aqui: o nome do produto escolhido na revisão. */
export interface ReceiptChoiceLine {
  id: string;
  name: string;
  category: string;
}

type Picking = { step: 'list' } | { step: 'receipt'; listItemId: string };

const HINTS: Partial<Record<ListMatch['reason'], string>> = {
  nome: 'Nome parecido: confira e marque',
  vinculo: 'Ligado numa nota anterior',
};

export function ReceiptListSection({
  listItems,
  matches,
  receipt,
  onChoose,
}: {
  listItems: OpenListEntry[];
  matches: ListMatch[];
  receipt: ReceiptChoiceLine[];
  onChoose: (listItemId: string, choice: ListChoice) => void;
}) {
  const [picking, setPicking] = useState<Picking | null>(null);
  const order = new Map(listItems.map((item, index) => [item.id, index]));
  const listItem = new Map(listItems.map((item) => [item.id, item]));
  const receiptLine = new Map(receipt.map((line) => [line.id, line]));
  const rows = matches
    .filter((m) => listItem.has(m.listItemId) && receiptLine.has(m.receiptItemId))
    .sort((a, b) => order.get(a.listItemId)! - order.get(b.listItemId)!);
  const matched = new Set(rows.map((m) => m.listItemId));
  const unmatched = listItems.filter((item) => !matched.has(item.id));
  const severalLists = new Set(listItems.map((item) => item.list_id)).size > 1;
  const label = (item: OpenListEntry) => (severalLists ? `${item.name} · ${item.list_name}` : item.name);

  const target = picking?.step === 'receipt' ? listItem.get(picking.listItemId) : undefined;
  const current = target ? rows.find((m) => m.listItemId === target.id) : undefined;

  return (
    <Section
      title="Lista de compras"
      action={
        unmatched.length ? (
          <Button title="Ligar item" icon="link-variant" variant="ghost" compact onPress={() => setPicking({ step: 'list' })} />
        ) : null
      }>
      <Text variant="muted">
        {rows.length
          ? 'Os marcados saem da lista ao confirmar a nota, e a ligação fica guardada para a próxima.'
          : 'Nenhum item das listas abertas parece estar nesta nota. Comprou algum? Toque em "Ligar item".'}
      </Text>
      {rows.length ? (
        <ListCard>
          {rows.map((match) => {
            const item = listItem.get(match.listItemId)!;
            const line = receiptLine.get(match.receiptItemId)!;
            const hint = match.checked && match.reason === 'nome' ? null : HINTS[match.reason];
            return (
              <View key={item.id} style={styles.row}>
                <CheckCircle
                  checked={match.checked}
                  label={`Tirar ${item.name} da lista`}
                  onPress={() => onChoose(item.id, { receiptItemId: match.receiptItemId, checked: !match.checked })}
                />
                <Pressable
                  style={styles.flex}
                  accessibilityRole="button"
                  accessibilityLabel={`Trocar o item da nota que cumpre ${item.name}`}
                  onPress={() => setPicking({ step: 'receipt', listItemId: item.id })}>
                  <Text variant="body" numberOfLines={2}>
                    {label(item)}
                  </Text>
                  <Text variant="muted" numberOfLines={2}>{`Comprado: ${line.name}`}</Text>
                  {hint ? (
                    <Text variant="small" color={match.reason === 'nome' ? 'warning' : 'textMuted'}>
                      {hint}
                    </Text>
                  ) : null}
                </Pressable>
                <Icon name="chevron-right" color="textMuted" />
              </View>
            );
          })}
        </ListCard>
      ) : null}

      {/* Um passo de cada vez na mesma tela: escolher o item da lista, depois o da nota. */}
      <PickerModal
        key={picking?.step === 'receipt' ? `nota-${picking.listItemId}` : 'lista'}
        visible={Boolean(picking)}
        title={target ? `"${target.name}" foi comprado como` : 'Qual item da lista você comprou?'}
        options={
          target
            ? receipt.map((line) => ({
                id: line.id,
                title: line.name,
                left: <CategoryIcon category={line.category} name={line.name} size={32} />,
              }))
            : unmatched.map((item) => ({
                id: item.id,
                title: item.name,
                subtitle: item.list_name,
                left: <CategoryIcon category={item.category} name={item.name} size={32} />,
              }))
        }
        onClose={() => setPicking(null)}
        onSelect={(id) => {
          if (!target) {
            setPicking({ step: 'receipt', listItemId: id });
            return;
          }
          onChoose(target.id, { receiptItemId: id, checked: true });
          setPicking(null);
        }}
        extraActions={() =>
          current ? (
            <Button
              title="Não foi comprado nesta nota"
              icon="link-variant-off"
              variant="ghost"
              compact
              onPress={() => {
                onChoose(current.listItemId, { receiptItemId: null, checked: false });
                setPicking(null);
              }}
            />
          ) : null
        }
      />
    </Section>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.md },
});
