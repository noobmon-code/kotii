import { useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';

import { BillsPanel } from '@/features/finance/BillsPanel';
import { FinanceSummaryPanel } from '@/features/finance/FinanceSummaryPanel';
import { ReceiptsPanel } from '@/features/finance/ReceiptsPanel';
import { PageTitle, Screen, Segmented } from '@/ui/primitives';

type Tab = 'resumo' | 'contas' | 'notas';
const TABS: Tab[] = ['resumo', 'contas', 'notas'];

const QUERIES: Record<Tab, string[]> = {
  resumo: ['spending', 'bills'],
  contas: ['bills'],
  notas: ['receipts'],
};

export default function FinanceScreen() {
  // A aba vive na URL: a tela Hoje e o resumo abrem direto nela.
  const { aba } = useLocalSearchParams<{ aba?: string }>();
  const tab: Tab = aba && (TABS as string[]).includes(aba) ? (aba as Tab) : 'resumo';
  const setTab = (value: Tab) => router.setParams({ aba: value });

  const queryClient = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);
  const refresh = () => {
    setRefreshing(true);
    Promise.all(QUERIES[tab].map((key) => queryClient.refetchQueries({ queryKey: [key], type: 'active' }))).finally(() =>
      setRefreshing(false),
    );
  };

  return (
    <Screen refreshing={refreshing} onRefresh={refresh}>
      <PageTitle title="Finanças" subtitle="Gastos, contas e notas" tint="green" />
      <Segmented
        value={tab}
        onChange={setTab}
        options={[
          { value: 'resumo', label: 'Resumo' },
          { value: 'contas', label: 'Contas' },
          { value: 'notas', label: 'Notas' },
        ]}
      />
      {tab === 'resumo' ? <FinanceSummaryPanel /> : null}
      {tab === 'contas' ? <BillsPanel /> : null}
      {tab === 'notas' ? <ReceiptsPanel /> : null}
    </Screen>
  );
}
