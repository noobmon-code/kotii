import { useQueryClient } from '@tanstack/react-query';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';

import { useChores } from '@/data/home';
import { useEquipmentList } from '@/data/house';
import { JOBS_KEY, PROVIDERS_KEY } from '@/data/providers';
import {
  casaParts,
  casaTabs,
  casaTabsFit,
  DIA_A_DIA,
  movedFromCasa,
  type CasaTab,
  type DiaADia,
  type Financas,
} from '@/domain/tabs';
import { AgendaPanel, agendaQueryKeys } from '@/features/AgendaPanel';
import { ChoresPanel } from '@/features/ChoresPanel';
import { DocumentsSection } from '@/features/DocumentsSection';
import { EquipmentPanel } from '@/features/EquipmentPanel';
import { FinancePanel, financeQueryKeys } from '@/features/finance/FinancePanel';
import { MovedSubTab } from '@/features/MovedSubTab';
import { FEATURES } from '@/lib/features';
import { Screen, Segmented } from '@/ui/primitives';
import { space } from '@/ui/theme';

type Params = { aba?: string; dia?: string; financas?: string };

/**
 * Casa: o que mantém a casa funcionando. O Dia a dia (as Tarefas, com os pontos das crianças, que é a parte que
 * abre, e a Agenda, com os compromissos e o que vence em cada dia, num seletor próprio), Finanças (o Resumo e as
 * Contas, também num seletor; só com a chave ligada, lib/features), Aparelhos (e os prestadores) e Documentos. A
 * parte e o que está aberto dentro dela vivem na URL (?aba=, ?dia=, ?financas=): os atalhos e o Nuke abrem direto
 * neles. Os endereços antigos continuam valendo (domain/tabs): /casa?aba=tarefas e /casa?aba=agenda, de quando cada
 * uma era uma parte, abrem o Dia a dia naquela; as compras e a despensa, que eram daqui, estão na aba Compras, e
 * /casa?aba=compras e /casa?aba=despensa levam até lá.
 */
export default function HouseScreen() {
  const params = useLocalSearchParams<Params>();
  const moved = movedFromCasa(params.aba);
  if (moved) return <MovedSubTab to={moved} />;
  return <HouseTabs {...params} />;
}

function HouseTabs({ aba, dia, financas }: Params) {
  // Lida aqui, na hora de desenhar (lib/features): sem Finanças, a parte dela não entra no seletor.
  const finance = FEATURES.finance;
  const { tab, day, money, moved } = casaParts(aba, dia, financas, finance);
  const tabs = casaTabs(finance);
  const { width } = useWindowDimensions();

  // O endereço antigo vira o de agora (sem passar pelo histórico: setParams troca os parâmetros da própria aba).
  // A tela já mostra o Dia a dia na parte certa antes disso; a troca é para o endereço, e o que ler o ?aba= depois,
  // dizerem a mesma coisa que a tela.
  useFocusEffect(
    useCallback(() => {
      if (moved) router.setParams({ aba: 'dia', dia: day });
    }, [moved, day]),
  );

  // Trocar de parte deixa o ?dia= e o ?financas= como estão (setParams junta): voltar ao Dia a dia reabre a agenda,
  // se era ela que estava aberta, e voltar a Finanças reabre as contas.
  const setTab = (value: CasaTab) => router.setParams({ aba: value });
  const setDay = (value: DiaADia) => router.setParams({ aba: 'dia', dia: value });
  const setMoney = (value: Financas) => router.setParams({ aba: 'financas', financas: value });
  const showsChores = tab === 'dia' && day === 'tarefas';
  const showsAgenda = tab === 'dia' && day === 'agenda';

  const chores = useChores();
  const equipment = useEquipmentList();
  const queryClient = useQueryClient();
  // A Agenda, as Finanças e os Documentos são várias buscas cada: o "girando" é o desta tela, até todas voltarem.
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
  // prestadores, que volta quando o banco ganha as tabelas. Na Agenda, tudo o que ela junta; em Finanças, o que o
  // Resumo ou as Contas mostram; nos Documentos, eles e as fichas (os donos). Só as que a parte está mostrando (type
  // 'active': as outras partes nem as buscam), e dos serviços só a lista da casa toda (a de um prestador ou de um
  // aparelho é de outra tela).
  const refresh = () => {
    if (showsChores) {
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
    if (showsAgenda) refetchAll(agendaQueryKeys(finance));
    if (tab === 'financas') refetchAll(financeQueryKeys(money));
    if (tab === 'documentos') refetchAll(['documents', 'people']);
  };
  const refreshing = showsChores ? chores.isRefetching : tab === 'aparelhos' ? equipment.isRefetching : refreshingMany;

  return (
    <Screen fab heading="Casa" refreshing={refreshing} onRefresh={refresh}>
      {/* "Documentos" não cabe numa parte igual às outras num celular de 360: cada parte do tamanho do rótulo. E as
          quatro juntas não cabem com folga num celular estreito: ali o seletor aperta (domain/tabs). */}
      <Segmented value={tab} onChange={setTab} options={tabs} widths="content" fit={casaTabsFit(tabs.length, width)} />
      {tab === 'dia' ? (
        <View style={styles.part}>
          {/* Fora dos painéis: o seletor fica na tela também enquanto as tarefas ou a agenda carregam. */}
          <Segmented value={day} onChange={setDay} options={DIA_A_DIA} />
          {day === 'tarefas' ? <ChoresPanel /> : <AgendaPanel />}
        </View>
      ) : null}
      {tab === 'financas' ? <FinancePanel part={money} onChange={setMoney} /> : null}
      {tab === 'aparelhos' ? <EquipmentPanel /> : null}
      {tab === 'documentos' ? <DocumentsSection /> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  part: { gap: space.lg },
});
