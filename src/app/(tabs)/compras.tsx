import { useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { usePantry } from '@/data/home';
import { ARCHIVED_LISTS_KEY, useShoppingLists } from '@/data/market';
import { useSupplies } from '@/data/supplies';
import { COMPRAS_TABS, tabFromParam, type ComprasTab } from '@/domain/tabs';
import { ReceiptsPanel } from '@/features/market/ReceiptsPanel';
import { PantryPanel } from '@/features/PantryPanel';
import { ShoppingListsPanel } from '@/features/ShoppingListsPanel';
import { SuppliesSection } from '@/features/SuppliesSection';
import { Screen, Segmented } from '@/ui/primitives';
import { space } from '@/ui/theme';

/**
 * Compras: o ciclo do que entra na casa. Listas (as abertas e as arquivadas, Preços e Cardápio), Notas (as notas
 * fiscais, com o Mercado do mês no alto) e Despensa (com "Gás, água e ração"). A parte vive na URL (?aba=): os
 * atalhos da tela Hoje e o Nuke abrem direto nela, e os endereços antigos da Casa e de Finanças chegam aqui
 * (domain/tabs).
 */
export default function ShoppingScreen() {
  const { aba } = useLocalSearchParams<{ aba?: string }>();
  const tab = tabFromParam(COMPRAS_TABS, aba);
  const setTab = (value: ComprasTab) => router.setParams({ aba: value });

  const lists = useShoppingLists();
  const pantry = usePantry();
  const supplies = useSupplies();
  const queryClient = useQueryClient();
  // As notas são várias buscas (os rascunhos, o histórico em páginas e a situação das pendentes deste aparelho),
  // todas debaixo de 'receipts': o "girando" é o desta tela, até todas voltarem.
  const [refreshingReceipts, setRefreshingReceipts] = useState(false);
  // Só as que a parte aberta mostra (as das outras partes, montadas ou não, ficam como estão). Nas Listas, também
  // as arquivadas (a entrada delas só aparece quando há alguma). Na Despensa, também o gás, a água e a ração.
  const refresh = () => {
    if (tab === 'listas') {
      lists.refetch();
      queryClient.refetchQueries({ queryKey: [ARCHIVED_LISTS_KEY], type: 'active' });
    }
    if (tab === 'notas') {
      setRefreshingReceipts(true);
      queryClient.refetchQueries({ queryKey: ['receipts'], type: 'active' }).finally(() => setRefreshingReceipts(false));
    }
    if (tab === 'despensa') {
      pantry.refetch();
      supplies.refetch();
    }
  };
  const refreshing = tab === 'listas' ? lists.isRefetching : tab === 'despensa' ? pantry.isRefetching : refreshingReceipts;

  return (
    <Screen fab heading="Compras" refreshing={refreshing} onRefresh={refresh}>
      <Segmented value={tab} onChange={setTab} options={COMPRAS_TABS} />
      {tab === 'listas' ? <ShoppingListsPanel /> : null}
      {tab === 'notas' ? <ReceiptsPanel /> : null}
      {tab === 'despensa' ? (
        <View style={styles.gap}>
          {/* O que não passa por nota (gás, água, ração) vem antes da despensa e fora dela: aparece
              com ela carregando, vazia ou com erro, e o "Adicionar item" fica junto da lista dele. */}
          <SuppliesSection />
          <PantryPanel />
        </View>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  // O mesmo espaço que a despensa põe entre as partes dela; cresce para o "carregando" da despensa ficar no meio do que sobra.
  gap: { gap: space.lg, flexGrow: 1 },
});
