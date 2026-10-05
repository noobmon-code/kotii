import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { useConsumePantryItems, usePantry, useTakeOneFromPantry } from '@/data/home';
import { useAddToMarketList, useProducts } from '@/data/market';
import { formatShortDate, todayISO } from '@/domain/dates';
import { describeExpiry, expiryStatus, groupPantry, takeOne, type ExpiryStatus, type PantryGroup } from '@/domain/pantry';
import { formatQuantity } from '@/domain/money';
import { errorMessage } from '@/lib/supabase';
import type { PantryItem } from '@/lib/types';
import { ActionSheet, type SheetAction } from '@/ui/ActionSheet';
import { notify } from '@/ui/dialogs';
import {
  Badge,
  Button,
  CategoryIcon,
  EmptyState,
  ErrorNotice,
  ListCard,
  ListRow,
  Loading,
  Section,
  type Tone,
} from '@/ui/primitives';
import { space } from '@/ui/theme';

const SECTIONS: { kind: ExpiryStatus['kind']; title: string; tone: Tone }[] = [
  { kind: 'vencido', title: 'Vencidos', tone: 'danger' },
  { kind: 'vence_logo', title: 'Vencem em breve', tone: 'warning' },
  { kind: 'ok', title: 'Em dia', tone: 'primary' },
  { kind: 'sem_validade', title: 'Sem validade', tone: 'neutral' },
];

type Group = PantryGroup<PantryItem>;

/** "2 un", "0,75 kg e 2 un". */
const describeTotals = (group: Group) => group.totals.map((t) => formatQuantity(t.quantity, t.unit)).join(' e ');

/** "Compras: 2 set (1 un), 27 set (1 un) e 3 out (1 un)." */
function describeLots(group: Group): string {
  const parts = group.lots.map((lot) => `${formatShortDate(lot.purchased_on)} (${formatQuantity(lot.quantity, lot.unit)})`);
  return `Compras: ${parts.slice(0, -1).join(', ')} e ${parts[parts.length - 1]}.`;
}

export function PantryPanel() {
  const today = todayISO();
  const pantry = usePantry();
  const products = useProducts();
  const consume = useConsumePantryItems();
  const takeOneFrom = useTakeOneFromPantry();
  const addToMarketList = useAddToMarketList();
  const [selected, setSelected] = useState<Group | null>(null);
  const onError = (err: unknown) => notify('Erro', errorMessage(err));

  // Primeiro a lista, depois a baixa: se a baixa falhar, o item continua na
  // despensa e repetir não duplica (a lista ignora item já pendente).
  async function finishAndRestock(group: Group) {
    const newest = group.lots[group.lots.length - 1];
    try {
      const list = await addToMarketList.mutateAsync({
        name: group.name,
        category: group.category,
        productId: group.productId,
        quantity: newest.quantity,
        unit: newest.unit,
      });
      await consume.mutateAsync(group.lots.map((lot) => lot.id));
      notify(
        list.added ? 'Adicionado à lista' : 'Já estava na lista',
        list.added ? `${group.name} foi para "${list.name}".` : `${group.name} já estava pendente em "${list.name}".`,
      );
    } catch (err) {
      onError(err);
    }
  }

  function groupActions(group: Group): SheetAction[] {
    const ids = group.lots.map((lot) => lot.id);
    const take = takeOne(group.lots);
    const oldest = group.lots[0];
    const several = group.lots.length > 1;
    const actions: SheetAction[] = [
      { label: 'Acabou — pôr na lista de mercado', icon: 'cart-plus', onPress: () => finishAndRestock(group) },
    ];
    if (take) {
      const units = group.totals.find((t) => t.unit === 'un')?.quantity ?? 0;
      const left = Math.round((units - 1) * 1000) / 1000;
      actions.push({
        label:
          oldest.unit === 'un'
            ? `Usei 1 (${left === 1 ? 'fica' : 'ficam'} ${formatQuantity(left, 'un')})`
            : `Acabou a compra de ${formatShortDate(oldest.purchased_on)}`,
        icon: 'minus-circle-outline',
        onPress: () => takeOneFrom.mutate(take, { onError }),
      });
    }
    actions.push({
      label: several ? 'Consumido / descartado (tudo)' : 'Consumido / descartado',
      icon: 'check',
      onPress: () => consume.mutate(ids, { onError }),
    });
    for (const lot of several ? [...group.lots].reverse() : group.lots) {
      actions.push({
        label: several
          ? `Editar a compra de ${formatShortDate(lot.purchased_on)}`
          : 'Editar validade e quantidade',
        icon: 'pencil-outline',
        onPress: () => router.push({ pathname: '/despensa/[id]', params: { id: lot.id } }),
      });
    }
    return actions;
  }

  if (pantry.isPending) return <Loading />;
  if (pantry.isError) return <ErrorNotice error={pantry.error} onRetry={() => pantry.refetch()} />;

  const productNames = new Map((products.data ?? []).map((p) => [p.id, p.name]));
  const withStatus = groupPantry(pantry.data, productNames).map((group) => ({
    group,
    status: expiryStatus(group.expiresOn, today),
  }));

  return (
    <View style={styles.gap}>
      <Button
        title="Adicionar item"
        icon="plus"
        variant="secondary"
        onPress={() => router.push({ pathname: '/despensa/[id]', params: { id: 'novo' } })}
      />
      {pantry.data.length === 0 ? (
        <EmptyState
          icon="fridge-outline"
          title="Despensa vazia"
          message="Ao confirmar uma nota fiscal, os alimentos entram aqui com validade estimada automaticamente."
        />
      ) : (
        SECTIONS.map((section) => {
          const rows = withStatus.filter((r) => r.status.kind === section.kind);
          if (!rows.length) return null;
          return (
            <Section key={section.kind} title={`${section.title} (${rows.length})`}>
              <ListCard>
                {rows.map(({ group, status }) => (
                  <ListRow
                    key={group.key}
                    left={<CategoryIcon category={group.category} name={group.name} />}
                    title={group.name}
                    subtitle={
                      group.lots.length > 1 ? `${describeTotals(group)} · ${group.lots.length} compras` : describeTotals(group)
                    }
                    right={status.kind === 'sem_validade' ? null : <Badge label={describeExpiry(status)} tone={section.tone} />}
                    onPress={() => setSelected(group)}
                  />
                ))}
              </ListCard>
            </Section>
          );
        })
      )}
      <ActionSheet
        visible={Boolean(selected)}
        onClose={() => setSelected(null)}
        title={selected?.name}
        message={selected && selected.lots.length > 1 ? describeLots(selected) : undefined}
        actions={selected ? groupActions(selected) : []}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  gap: { gap: space.lg },
});
