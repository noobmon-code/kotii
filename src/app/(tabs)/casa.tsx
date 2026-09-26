import { router, useLocalSearchParams } from 'expo-router';

import { ChoresPanel } from '@/features/ChoresPanel';
import { PantryPanel } from '@/features/PantryPanel';
import { ShoppingListsPanel } from '@/features/ShoppingListsPanel';
import { useChores, usePantry } from '@/data/home';
import { useShoppingLists } from '@/data/market';
import { Screen, Segmented, Text } from '@/ui/primitives';

type Tab = 'compras' | 'despensa' | 'tarefas';
const TABS: Tab[] = ['compras', 'despensa', 'tarefas'];

export default function HouseScreen() {
  // A aba vive na URL: atalhos da tela Hoje abrem direto nela.
  const { aba } = useLocalSearchParams<{ aba?: string }>();
  const tab: Tab = aba && (TABS as string[]).includes(aba) ? (aba as Tab) : 'compras';
  const setTab = (value: Tab) => router.setParams({ aba: value });

  const lists = useShoppingLists();
  const pantry = usePantry();
  const chores = useChores();
  const active = { compras: lists, despensa: pantry, tarefas: chores }[tab];

  return (
    <Screen refreshing={active.isRefetching} onRefresh={() => active.refetch()}>
      <Text variant="title">Casa</Text>
      <Segmented
        value={tab}
        onChange={setTab}
        options={[
          { value: 'compras', label: 'Compras' },
          { value: 'despensa', label: 'Despensa' },
          { value: 'tarefas', label: 'Tarefas' },
        ]}
      />
      {tab === 'compras' ? <ShoppingListsPanel /> : null}
      {tab === 'despensa' ? <PantryPanel /> : null}
      {tab === 'tarefas' ? <ChoresPanel /> : null}
    </Screen>
  );
}
