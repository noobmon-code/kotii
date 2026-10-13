import { router, useLocalSearchParams } from 'expo-router';

import { ChoresPanel } from '@/features/ChoresPanel';
import { EquipmentPanel } from '@/features/EquipmentPanel';
import { PantryPanel } from '@/features/PantryPanel';
import { ShoppingListsPanel } from '@/features/ShoppingListsPanel';
import { useChores, usePantry } from '@/data/home';
import { useEquipmentList } from '@/data/house';
import { useShoppingLists } from '@/data/market';
import { useSupplies } from '@/data/supplies';
import { PageTitle, Screen, Segmented } from '@/ui/primitives';

type Tab = 'compras' | 'despensa' | 'tarefas' | 'aparelhos';
const TABS: Tab[] = ['compras', 'despensa', 'tarefas', 'aparelhos'];

export default function HouseScreen() {
  // A aba vive na URL: atalhos da tela Hoje abrem direto nela.
  const { aba } = useLocalSearchParams<{ aba?: string }>();
  const tab: Tab = aba && (TABS as string[]).includes(aba) ? (aba as Tab) : 'compras';
  const setTab = (value: Tab) => router.setParams({ aba: value });

  const lists = useShoppingLists();
  const pantry = usePantry();
  const chores = useChores();
  const equipment = useEquipmentList();
  const supplies = useSupplies();
  const active = { compras: lists, despensa: pantry, tarefas: chores, aparelhos: equipment }[tab];
  // Na Despensa, puxar para atualizar traz também o gás, a água e a ração.
  const refresh = () => {
    active.refetch();
    if (tab === 'despensa') supplies.refetch();
  };

  return (
    <Screen fab refreshing={active.isRefetching} onRefresh={refresh}>
      <PageTitle title="Casa" subtitle="Compras, despensa, tarefas e aparelhos" tint="blue" />
      <Segmented
        value={tab}
        onChange={setTab}
        options={[
          { value: 'compras', label: 'Compras' },
          { value: 'despensa', label: 'Despensa' },
          { value: 'tarefas', label: 'Tarefas' },
          { value: 'aparelhos', label: 'Aparelhos' },
        ]}
      />
      {tab === 'compras' ? <ShoppingListsPanel /> : null}
      {tab === 'despensa' ? <PantryPanel /> : null}
      {tab === 'tarefas' ? <ChoresPanel /> : null}
      {tab === 'aparelhos' ? <EquipmentPanel /> : null}
    </Screen>
  );
}
