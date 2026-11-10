import { useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';

import { useBeta } from '@/data/financeBeta';
import { movedFromFinance } from '@/domain/tabs';
import { BillsPanel } from '@/features/finance/BillsPanel';
import { ConsultorCard } from '@/features/finance/ConsultorCard';
import { FinanceSummaryPanel } from '@/features/finance/FinanceSummaryPanel';
import { MovedSubTab } from '@/features/MovedSubTab';
import { Screen, Segmented } from '@/ui/primitives';

type Tab = 'resumo' | 'contas';
const TABS: Tab[] = ['resumo', 'contas'];

const QUERIES: Record<Tab, string[]> = {
  resumo: ['spending', 'bills'],
  // Os pagamentos recentes decidem o selo "Acima do normal" das contas.
  contas: ['bills', 'billPayments'],
};

/**
 * Finanças (só com a chave ligada, lib/features): Resumo e Contas. As notas, que eram daqui, estão em Compras →
 * Notas, e o endereço antigo delas (/financas?aba=notas) leva até lá.
 */
export default function FinanceScreen() {
  const { aba } = useLocalSearchParams<{ aba?: string }>();
  const moved = movedFromFinance(aba);
  if (moved) return <MovedSubTab to={moved} />;
  return <FinanceTabs aba={aba} />;
}

function FinanceTabs({ aba }: { aba: string | undefined }) {
  // A aba vive na URL: a tela Hoje e o resumo abrem direto nela.
  const tab: Tab = aba && (TABS as string[]).includes(aba) ? (aba as Tab) : 'resumo';
  const setTab = (value: Tab) => router.setParams({ aba: value });
  // Consultor financeiro (beta): só para quem tem a liberação nesta casa.
  const consultor = useBeta('finance').data === true;

  const queryClient = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);
  const refresh = () => {
    setRefreshing(true);
    Promise.all(QUERIES[tab].map((key) => queryClient.refetchQueries({ queryKey: [key], type: 'active' }))).finally(() =>
      setRefreshing(false),
    );
  };

  return (
    <Screen fab heading="Finanças" refreshing={refreshing} onRefresh={refresh}>
      <Segmented
        value={tab}
        onChange={setTab}
        options={[
          { value: 'resumo', label: 'Resumo' },
          { value: 'contas', label: 'Contas' },
        ]}
      />
      {tab === 'resumo' && consultor ? <ConsultorCard /> : null}
      {tab === 'resumo' ? <FinanceSummaryPanel /> : null}
      {tab === 'contas' ? <BillsPanel /> : null}
    </Screen>
  );
}
