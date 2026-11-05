import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { usePantry } from '@/data/home';
import { useProducts } from '@/data/market';
import { todayISO } from '@/domain/dates';
import { describeExpiry, expiryStatus, groupPantry, productNameMap, type ExpiryStatus, type PantryGroup } from '@/domain/pantry';
import { formatQuantity } from '@/domain/money';
import { usePantryMenu } from '@/features/PantryMenu';
import type { PantryItem } from '@/lib/types';
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

export function PantryPanel() {
  const today = todayISO();
  const pantry = usePantry();
  const products = useProducts();
  // O menu de cada produto (o mesmo da seção Despensa da tela Hoje).
  const menu = usePantryMenu();

  if (pantry.isPending) return <Loading />;
  if (pantry.isError) return <ErrorNotice error={pantry.error} onRetry={() => pantry.refetch()} />;

  const productNames = productNameMap(products.data);
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
                    onPress={() => menu.open(group)}
                  />
                ))}
              </ListCard>
            </Section>
          );
        })
      )}
      {menu.element}
    </View>
  );
}

const styles = StyleSheet.create({
  gap: { gap: space.lg },
});
