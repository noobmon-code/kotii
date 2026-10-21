// Revisão da nota: que itens das listas abertas esta compra cumpriu. Os
// marcados saem da lista ao confirmar, e a ligação fica para a próxima nota.
// Cada sugestão traz a linha da nota e a pergunta "Comprou este?", que marca
// com um toque.

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

/** De onde veio a ligação, quando ajuda a conferir. Marcado pelo nome ou pela escolha da pessoa, não precisa dizer. */
function hintFor(match: ListMatch, inCart: boolean): string | null {
  if (match.reason === 'vinculo') return 'Ligado numa nota anterior';
  if (match.reason === 'item') return match.checked && inCart ? 'Estava no carrinho e é o mesmo item' : 'O mesmo item, de outra marca ou com outro nome';
  if (match.checked) return null;
  if (match.reason === 'nome') return 'Nome parecido';
  if (match.reason === 'parecido') return 'Pode ser este: confira';
  return null;
}

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
          ? `Os marcados saem da lista ao confirmar a nota, e a ligação fica guardada para a próxima.${
              rows.some((m) => !m.checked) ? ' Nas sugestões, toque em "Sim" no que você comprou.' : ''
            }`
          : 'Nenhum item das listas abertas parece estar nesta nota. Comprou algum? Toque em "Ligar item".'}
      </Text>
      {rows.length ? (
        <ListCard>
          {rows.map((match) => {
            const item = listItem.get(match.listItemId)!;
            const line = receiptLine.get(match.receiptItemId)!;
            const hint = hintFor(match, Boolean(item.checked_at));
            const check = () => onChoose(item.id, { receiptItemId: match.receiptItemId, checked: true });
            return (
              <View key={item.id} style={styles.row}>
                <CheckCircle
                  checked={match.checked}
                  label={`Tirar ${item.name} da lista`}
                  onPress={() => onChoose(item.id, { receiptItemId: match.receiptItemId, checked: !match.checked })}
                />
                <View style={styles.flex}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Trocar o item da nota que cumpre ${item.name}`}
                    onPress={() => setPicking({ step: 'receipt', listItemId: item.id })}>
                    <Text variant="body" numberOfLines={2}>
                      {label(item)}
                    </Text>
                    <Text variant="muted" numberOfLines={2}>{`${match.checked ? 'Comprado' : 'Na nota'}: ${line.name}`}</Text>
                    {hint ? (
                      <Text variant="small" color={match.checked ? 'textMuted' : 'warning'}>
                        {hint}
                      </Text>
                    ) : null}
                  </Pressable>
                  {/* A sugestão é uma pergunta de um toque: sem precisar achar o item em "Ligar item". */}
                  {match.checked ? null : (
                    <View style={styles.ask}>
                      <Text variant="label">Comprou este?</Text>
                      <Button
                        title="Sim"
                        icon="check"
                        variant="secondary"
                        compact
                        accessibilityLabel={`Sim, comprei ${line.name}: tirar ${item.name} da lista`}
                        onPress={check}
                      />
                    </View>
                  )}
                </View>
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
  flex: { flex: 1, gap: space.sm },
  ask: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: space.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.md },
});
