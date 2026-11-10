import { useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';

import { useChores } from '@/data/home';
import { useEquipmentList } from '@/data/house';
import { JOBS_KEY, PROVIDERS_KEY } from '@/data/providers';
import { CASA_TABS, movedFromCasa, tabFromParam, type CasaTab } from '@/domain/tabs';
import { AgendaPanel, agendaQueryKeys } from '@/features/AgendaPanel';
import { ChoresPanel } from '@/features/ChoresPanel';
import { DocumentsSection } from '@/features/DocumentsSection';
import { EquipmentPanel } from '@/features/EquipmentPanel';
import { MovedSubTab } from '@/features/MovedSubTab';
import { FEATURES } from '@/lib/features';
import { Screen, Segmented } from '@/ui/primitives';

/**
 * Casa: o que mantém a casa funcionando. Tarefas (e os pontos das crianças), Agenda (os compromissos e o que vence
 * em cada dia), Aparelhos (e os prestadores) e Documentos. A parte vive na URL (?aba=): os atalhos e o Nuke abrem
 * direto nela. As compras e a despensa, que eram daqui, estão na aba Compras, e os endereços antigos delas
 * (/casa?aba=compras e /casa?aba=despensa) levam até lá.
 */
export default function HouseScreen() {
  const { aba } = useLocalSearchParams<{ aba?: string }>();
  const moved = movedFromCasa(aba);
  if (moved) return <MovedSubTab to={moved} />;
  return <HouseTabs aba={aba} />;
}

function HouseTabs({ aba }: { aba: string | undefined }) {
  const tab = tabFromParam(CASA_TABS, aba);
  const setTab = (value: CasaTab) => router.setParams({ aba: value });

  const chores = useChores();
  const equipment = useEquipmentList();
  const queryClient = useQueryClient();
  // A Agenda e os Documentos são várias buscas cada: o "girando" é o desta tela, até todas voltarem.
  const [refreshingMany, setRefreshingMany] = useState(false);
  const refetchAll = (keys: string[]) => {
    setRefreshingMany(true);
    Promise.all(keys.map((key) => queryClient.refetchQueries({ queryKey: [key], type: 'active' }))).finally(() =>
      setRefreshingMany(false),
    );
  };
  // Em Tarefas, as ordens do rodízio e as fichas (os nomes), como a tela Hoje: com a tarefa nova e a ordem de antes,
  // a lista diria quem vem depois num rodízio que já acabou ou mudou. Em Aparelhos, o resto do que a lista mostra: a
  // próxima manutenção (as tarefas), o último serviço (o conserto registrado em outro celular) e o botão dos
  // prestadores, que volta quando o banco ganha as tabelas. Na Agenda, tudo o que ela junta; nos Documentos, eles e
  // as fichas (os donos). Só as que a parte está mostrando (type 'active': as outras partes nem as buscam), e dos
  // serviços só a lista da casa toda (a de um prestador ou de um aparelho é de outra tela).
  const refresh = () => {
    if (tab === 'tarefas') {
      chores.refetch();
      queryClient.refetchQueries({ queryKey: ['choreRotations'], type: 'active' });
      queryClient.refetchQueries({ queryKey: ['people'], type: 'active' });
    }
    if (tab === 'aparelhos') {
      equipment.refetch();
      chores.refetch();
      queryClient.refetchQueries({ queryKey: [JOBS_KEY], exact: true, type: 'active' });
      queryClient.refetchQueries({ queryKey: [PROVIDERS_KEY], exact: true, type: 'active' });
    }
    if (tab === 'agenda') refetchAll(agendaQueryKeys(FEATURES.finance));
    if (tab === 'documentos') refetchAll(['documents', 'people']);
  };
  const refreshing = tab === 'tarefas' ? chores.isRefetching : tab === 'aparelhos' ? equipment.isRefetching : refreshingMany;

  return (
    <Screen fab heading="Casa" refreshing={refreshing} onRefresh={refresh}>
      {/* "Documentos" não cabe numa parte igual às outras num celular de 360: cada parte do tamanho do rótulo. */}
      <Segmented value={tab} onChange={setTab} options={CASA_TABS} widths="content" />
      {tab === 'tarefas' ? <ChoresPanel /> : null}
      {tab === 'agenda' ? <AgendaPanel /> : null}
      {tab === 'aparelhos' ? <EquipmentPanel /> : null}
      {tab === 'documentos' ? <DocumentsSection /> : null}
    </Screen>
  );
}
