import { StyleSheet, View } from 'react-native';

import { useBeta } from '@/data/financeBeta';
import { FINANCAS, type Financas } from '@/domain/tabs';
import { Segmented } from '@/ui/primitives';
import { space } from '@/ui/theme';

import { BillsPanel } from './BillsPanel';
import { ConsultorCard } from './ConsultorCard';
import { FinanceSummaryPanel } from './FinanceSummaryPanel';

/**
 * O que cada parte de Finanças mostra, para o "puxar para atualizar" da Casa refazer só as buscas dela. Nas contas,
 * os pagamentos recentes decidem o selo "Acima do normal".
 */
export const financeQueryKeys = (part: Financas): string[] => (part === 'resumo' ? ['spending', 'bills'] : ['bills', 'billPayments']);

/**
 * Casa → Finanças (só com a chave ligada, lib/features): o Resumo, que é a parte que abre, e as Contas, num
 * seletor próprio. Já foi uma aba; as notas, que eram dela, estão em Compras → Notas.
 */
export function FinancePanel({ part, onChange }: { part: Financas; onChange: (part: Financas) => void }) {
  // Consultor financeiro (beta): só para quem tem a liberação nesta casa.
  const consultor = useBeta('finance').data === true;
  return (
    <View style={styles.gap}>
      {/* Fora dos painéis: o seletor fica na tela também enquanto a parte carrega, ou quando a busca falha. */}
      <Segmented value={part} onChange={onChange} options={FINANCAS} />
      {part === 'resumo' && consultor ? <ConsultorCard /> : null}
      {part === 'resumo' ? <FinanceSummaryPanel /> : <BillsPanel />}
    </View>
  );
}

const styles = StyleSheet.create({
  gap: { gap: space.lg },
});
