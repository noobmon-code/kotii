import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { useConsumePantryItem, usePantry } from '@/data/home';
import { useAddToMarketList } from '@/data/market';
import { todayISO } from '@/domain/dates';
import { describeExpiry, expiryStatus, type ExpiryStatus } from '@/domain/pantry';
import { formatQuantity } from '@/domain/money';
import { errorMessage } from '@/lib/supabase';
import type { PantryItem } from '@/lib/types';
import { ActionSheet } from '@/ui/ActionSheet';
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

const GROUPS: { kind: ExpiryStatus['kind']; title: string; tone: Tone }[] = [
  { kind: 'vencido', title: 'Vencidos', tone: 'danger' },
  { kind: 'vence_logo', title: 'Vencem em breve', tone: 'warning' },
  { kind: 'ok', title: 'Em dia', tone: 'primary' },
  { kind: 'sem_validade', title: 'Sem validade', tone: 'neutral' },
];

export function PantryPanel() {
  const today = todayISO();
  const pantry = usePantry();
  const consume = useConsumePantryItem();
  const addToMarketList = useAddToMarketList();
  const [selected, setSelected] = useState<PantryItem | null>(null);

  // Primeiro a lista, depois a baixa: se a baixa falhar, o item continua na
  // despensa e repetir não duplica (a lista ignora item já pendente).
  async function finishAndRestock(item: PantryItem) {
    try {
      const list = await addToMarketList.mutateAsync({
        name: item.name,
        category: item.category,
        productId: item.product_id,
        quantity: item.quantity,
        unit: item.unit,
      });
      await consume.mutateAsync(item.id);
      notify(
        list.added ? 'Adicionado à lista' : 'Já estava na lista',
        list.added ? `${item.name} foi para "${list.name}".` : `${item.name} já estava pendente em "${list.name}".`,
      );
    } catch (err) {
      notify('Erro', errorMessage(err));
    }
  }

  if (pantry.isPending) return <Loading />;
  if (pantry.isError) return <ErrorNotice error={pantry.error} onRetry={() => pantry.refetch()} />;

  const withStatus = pantry.data.map((item) => ({ item, status: expiryStatus(item.expires_on, today) }));

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
        GROUPS.map((group) => {
          const rows = withStatus.filter((r) => r.status.kind === group.kind);
          if (!rows.length) return null;
          return (
            <Section key={group.kind} title={`${group.title} (${rows.length})`}>
              <ListCard>
                {rows.map(({ item, status }) => (
                  <ListRow
                    key={item.id}
                    left={<CategoryIcon category={item.category} />}
                    title={item.name}
                    subtitle={formatQuantity(item.quantity, item.unit)}
                    right={status.kind === 'sem_validade' ? null : <Badge label={describeExpiry(status)} tone={group.tone} />}
                    onPress={() => setSelected(item)}
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
        actions={
          selected
            ? [
                {
                  label: 'Acabou — pôr na lista de mercado',
                  icon: 'cart-plus',
                  onPress: () => finishAndRestock(selected),
                },
                {
                  label: 'Consumido / descartado',
                  icon: 'check',
                  onPress: () =>
                    consume.mutate(selected.id, { onError: (err) => notify('Erro', errorMessage(err)) }),
                },
                {
                  label: 'Editar validade e quantidade',
                  icon: 'pencil-outline',
                  onPress: () => router.push({ pathname: '/despensa/[id]', params: { id: selected.id } }),
                },
              ]
            : []
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  gap: { gap: space.lg },
});
