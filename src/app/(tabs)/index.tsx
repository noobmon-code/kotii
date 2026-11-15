import { onlineManager } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { toSchedules, useChoreRotations, useChores, useDoses, useMedications, usePantry } from '@/data/home';
import { useFamilyCalendar } from '@/data/family';
import { useBills, useBudgets, useRecentBillPayments, useSpending } from '@/data/finance';
import { usePeople } from '@/data/health';
import { useDocuments, useEquipmentList } from '@/data/house';
import { useAddItemsToList, useOpenMarketList, usePurchaseRecords, useShoppingLists } from '@/data/market';
import { useRefreshMarketTrips } from '@/data/marketTrips';
import { useMenu } from '@/data/menu';
import { useForecast, useHouseholdLocation, useRefreshWeather } from '@/data/weather';
import { usePendingReceipts } from '@/data/pendingReceipts';
import { useDraftReceipts } from '@/data/receipts';
import { useSupplies } from '@/data/supplies';
import { billsAboveUsual } from '@/domain/billUsual';
import { budgetProgress } from '@/domain/budget';
import { todayISO } from '@/domain/dates';
import { billsDueSoon, monthRange, summarize } from '@/domain/finance';
import { todayEntries } from '@/domain/familyEvents';
import type { FirstStepKey } from '@/domain/firstSteps';
import { currentTimeHHMM, doseKey, dosesForDay } from '@/domain/medications';
import { listExclusion, type PurchaseRecord } from '@/domain/recentPurchases';
import { restockSuggestions, type RestockItem } from '@/domain/restock';
import { currentSky, defaultSky } from '@/domain/sky';
import {
  ALL_CLEAR_TITLE,
  allClearMessage,
  arrangeToday,
  MARKET_LIST_OFFLINE,
  MARKET_LIST_SHORTCUT,
  marketListShortcut,
  nothingPending,
  TODAY_BLOCK_TITLES,
  todayAttention,
  todayItems,
  todaySummary,
} from '@/domain/today';
import { SCAN_TITLE } from '@/domain/scan';
import { FirstStepsCard, useFirstSteps } from '@/features/FirstStepsCard';
import { PayBillModal } from '@/features/finance/PayBillModal';
import { useRefills } from '@/features/health/MedicationSections';
import { useHealthOverview } from '@/features/health/useHealthOverview';
import { InstallAppCard } from '@/features/InstallAppCard';
import { MarketTripBanner } from '@/features/MarketTrip';
import { useJustListed } from '@/features/RecentPurchases';
import { SkyHeader } from '@/features/SkyHeader';
import { TermsNoticeCard } from '@/features/TermsNotice';
import { TodayBlock, TodaySuggestions, useTodayRow } from '@/features/TodayBlocks';
import { TodayGreeting } from '@/features/TodayGreeting';
import { useHousehold } from '@/lib/auth';
import { FEATURES } from '@/lib/features';
import { settledData } from '@/lib/settledData';
import type { Bill } from '@/lib/types';
import { errorMessage } from '@/lib/supabase';
import { notify } from '@/ui/dialogs';
import { Card, EmptyState, Icon, Screen, Text, Tile } from '@/ui/primitives';
import { fonts, radius, shadows, space, useColors, WASHES } from '@/ui/theme';

const capitalizeFirst = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/**
 * "Acho que acabou" da tela Hoje. O histórico pode ter milhares de linhas: só
 * refaz com dados novos ou noutro dia, não a cada renderização.
 */
function useRestock(
  onLists: { name: string; product_id: string | null }[] | undefined,
  records: PurchaseRecord[] | undefined,
  justListed: ReadonlySet<string>,
  today: string,
) {
  return useMemo(
    () =>
      onLists
        ? restockSuggestions(records ?? [], {
            // Fim do dia: entram as compras de hoje, de qualquer hora.
            now: new Date(`${today}T23:59:59.999`),
            listKind: 'mercado',
            // Também o mesmo item com outro nome ("Leite IL Desnatado" na lista tira "Leite desnatado").
            exclude: listExclusion(onLists, justListed),
            limit: 5,
          })
        : [],
    [onLists, records, justListed, today],
  );
}

export default function TodayScreen() {
  const now = new Date();
  const today = todayISO(now);
  const household = useHousehold();
  const medications = useMedications();
  const doses = useDoses(today);
  const chores = useChores();
  // Fora de `queries`: sem as ordens do rodízio, a tarefa mostra o responsável de sempre.
  const rotations = useChoreRotations();
  const pantry = usePantry();
  const lists = useShoppingLists();
  // Todos os rascunhos, também os antigos: a lista de notas não corta nenhum.
  const receipts = useDraftReceipts();
  // As notas pendentes deste aparelho (a Sefaz pediu o "não sou robô"): ficam fora de `queries`, como o clima.
  const pendingReceipts = usePendingReceipts();
  const health = useHealthOverview(today);
  // As fichas (a mesma busca da saúde): os primeiros passos contam as pessoas e os pets sem celular.
  const people = usePeople();
  const documents = useDocuments();
  const equipment = useEquipmentList();
  // Contas e orçamento são de Finanças: com a chave desligada (lib/features), nada disso busca nem aparece, e as
  // buscas ficam fora de `queries` (uma busca desligada nunca fica pronta, e o "Tudo em dia" esperaria para sempre).
  const finance = FEATURES.finance;
  const bills = useBills(finance);
  const budgets = useBudgets(finance);
  const month = today.slice(0, 7);
  // O gasto do mês só importa aqui para o orçamento: sem limites, nem busca.
  const hasBudgets = finance && Boolean(budgets.data?.length);
  const spending = useSpending(month, month, hasBudgets);
  // Os pagamentos recentes só servem ao selo "acima do normal": sem conta para mostrar, nem busca.
  const billsDue = finance ? billsDueSoon(bills.data ?? [], today) : [];
  const recentPayments = useRecentBillPayments(today, billsDue.length > 0);
  const purchases = usePurchaseRecords();
  const menu = useMenu(today, today);
  // Gás, água, ração: num banco ainda sem as tabelas a busca devolve vazio, sem erro.
  const supplies = useSupplies();
  const addToList = useAddItemsToList();
  const openMarketList = useOpenMarketList();
  const [paying, setPaying] = useState<Bill | null>(null);
  // Itens de todas as listas abertas; os postos agora há pouco somem já no toque.
  const onLists = useMemo(() => (lists.data ?? []).flatMap((l) => l.items), [lists.data]);
  const restocked = useJustListed(lists.data ? onLists : undefined);
  const firstSteps = useFirstSteps({
    householdId: household.data?.household.id,
    members: household.data?.members.length,
    openLists: lists.data,
    drafts: receipts.data,
    pantry: pantry.data,
    people: people.data,
  });

  const queries = [
    medications,
    doses,
    chores,
    pantry,
    lists,
    receipts,
    documents,
    equipment,
    ...(finance ? [bills, budgets] : []),
    ...(hasBudgets ? [spending] : []),
    purchases,
    menu,
    supplies,
    ...health.queries,
  ];
  const refreshing = queries.some((q) => q.isRefetching);
  // O clima, as idas ao mercado e os pagamentos recentes ficam fora de `queries` (não contam para "tudo em dia"), mas atualizam junto.
  const refreshWeather = useRefreshWeather();
  const refreshTrips = useRefreshMarketTrips();
  // Os compromissos também ficam fora de `queries`: sem eles (ou sem as tabelas deles), a tela é a de sempre.
  const family = useFamilyCalendar();
  const refresh = () => {
    queries.forEach((q) => q.refetch());
    rotations.refetch();
    refreshWeather();
    refreshTrips();
    family.refetch();
    firstSteps.refresh();
    if (billsDue.length) recentPayments.refetch();
  };

  const nowTime = currentTimeHHMM(now);
  const taken = new Set((doses.data ?? []).map((d) => doseKey(d.medication_id, d.scheduled_on, d.scheduled_time)));
  const pendingDoses = dosesForDay(toSchedules(medications.data ?? [], today, doses.data), today, taken).filter(
    (d) => !taken.has(doseKey(d.medicationId, d.date, d.time)),
  );
  // Remédios com a caixa acabando (pelas contas do app) ou a receita vencendo: só os que pedem
  // atenção (o que está parado há mais de duas semanas fica na tela Saúde e no remédio).
  const refills = useRefills(today).attention;
  // Sem os pagamentos recentes em dia (carregando, buscando de novo ou com erro), nenhuma conta ganha o selo.
  const billsAbove = billsAboveUsual(billsDue, settledData(recentPayments) ?? [], today);
  // Categorias do mês que passaram ou estão perto do limite.
  const budgetLines =
    finance && budgets.data && spending.data ? budgetProgress(budgets.data, summarize(spending.data, monthRange(month)).byCategory) : [];
  // Cada coisa no bloco que o estado dela diz (domain/today): "Agora" (atrasado ou de hoje) e "Em breve".
  const items = todayItems({
    today,
    nowTime,
    doses: pendingDoses,
    refills,
    appointments: health.upcoming,
    overdueAppointments: health.toConfirm,
    vaccines: health.vaccinesDue,
    workouts: health.workoutsToday,
    planDrafts: health.drafts,
    // Compromissos da família e aniversários de hoje e de amanhã: entram nos blocos, mas não são pendência (com
    // uma rotina, haveria um quase todo dia), por isso não contam no "tudo em dia" nem na frase do topo.
    events: todayEntries(family.calendar, today),
    chores: chores.data ?? [],
    bills: billsDue,
    budgets: budgetLines,
    pantry: pantry.data ?? [],
    supplies: supplies.data?.supplies ?? [],
    documents: documents.data ?? [],
    equipment: equipment.data ?? [],
    pendingReceipts: pendingReceipts.pending,
    drafts: receipts.data ?? [],
  });
  const blocks = arrangeToday(items);
  const attention = todayAttention(items);
  // Só afirma "tudo em dia" depois que tudo carregou.
  const loaded = queries.every((q) => q.isSuccess);
  const allClear = nothingPending(loaded, attention);
  const summary = todaySummary(loaded, attention);
  const row = useTodayRow({
    today,
    health,
    members: household.data?.members ?? [],
    rotations: rotations.data,
    equipment: equipment.data ?? [],
    storeNames: pendingReceipts.storeNames ?? {},
    billsAbove,
    onPay: setPaying,
  });
  const activeLists = (lists.data ?? []).filter((l) => l.pending > 0);
  // "Acho que acabou": do mercado, menos o que já está em alguma lista aberta.
  const restock = useRestock(lists.isSuccess ? onLists : undefined, purchases.data, restocked.pending, today);
  const dateLabel = capitalizeFirst(now.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' }));
  // O céu de agora (do clima da casa) é o fundo do topo; sem bairro ou sem previsão, o céu de sempre da hora.
  const colors = useColors();
  const location = useHouseholdLocation();
  const forecast = useForecast(location.data);
  const sky = currentSky(forecast.data, now) ?? defaultSky(now);
  // Com mais de uma casa, o topo diz qual está aberta e troca com um toque.
  const houses = household.data?.households ?? [];

  const onError = (err: unknown) => notify('Erro', errorMessage(err));

  // Uma inclusão por vez (os botões ficam desativados enquanto isso): sem lista
  // de mercado aberta, dois pedidos ao mesmo tempo criariam duas "Mercado".
  const addingRestock = useRef(false);
  async function addRestock(restockItems: RestockItem[], open: boolean) {
    if (addingRestock.current) return;
    addingRestock.current = true;
    const names = restockItems.map((i) => i.name);
    // Some já no toque; volta quando as listas carregadas trouxerem o item e
    // ele sair delas depois (useJustListed). A tela Hoje fica montada o tempo todo.
    restocked.add(names);
    try {
      const { id } = await addToList.mutateAsync({
        // A lista de mercado aberta mais recente vem do servidor, não do que a
        // tela tem guardado: pode ter sido arquivada por outra pessoa, ou
        // criada pelo toque anterior e ainda não ter chegado.
        newListName: 'Mercado',
        reuseMarketList: true,
        items: restockItems.map(({ name, category, productId, quantity, unit }) => ({ name, category, productId, quantity, unit })),
      });
      if (open) router.push({ pathname: '/lista/[id]', params: { id } });
    } catch (err) {
      restocked.drop(names);
      onError(err);
    } finally {
      addingRestock.current = false;
    }
  }

  // "Lista de mercado": abre a lista de mercado aberta mais recente, ou cria uma (domain/today). Um pedido por vez:
  // dois toques seguidos, sem lista aberta, não criam duas.
  const openingList = useRef(false);
  async function openMarket() {
    if (openingList.current) return;
    const target = marketListShortcut(onlineManager.isOnline(), lists.data);
    if (target.kind === 'offline') {
      notify(MARKET_LIST_SHORTCUT, MARKET_LIST_OFFLINE);
      return;
    }
    if (target.kind === 'open') {
      router.push({ pathname: '/lista/[id]', params: { id: target.id } });
      return;
    }
    openingList.current = true;
    try {
      const { id } = await openMarketList.mutateAsync();
      router.push({ pathname: '/lista/[id]', params: { id } });
    } catch (err) {
      onError(err);
    } finally {
      openingList.current = false;
    }
  }

  // Cada passo leva aonde ele se faz: o convite e as fichas ficam em Configurações (Casa).
  function openStep(step: FirstStepKey) {
    if (step === 'lista') void openMarket();
    else if (step === 'nota') router.push('/escanear');
    // O que a casa já tem: a mesma câmera, só nos produtos, direto para a despensa.
    else if (step === 'despensa') router.push({ pathname: '/escanear', params: { para: 'despensa' } });
    else router.push('/configuracoes');
  }

  return (
    <Screen fab edges={[]} refreshing={refreshing} onRefresh={refresh}>
      <SkyHeader sky={sky}>
        <View>
          {houses.length > 1 ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Casa aberta: ${household.data?.household.name}. Trocar de casa`}
              onPress={() => router.push('/casas')}
              style={styles.houseSwitch}>
              <Icon name="home-outline" size={16} color="primary" />
              <Text variant="label" color="primary" numberOfLines={1} style={styles.houseName}>
                {household.data?.household.name}
              </Text>
              <Icon name="chevron-down" size={16} color="primary" />
            </Pressable>
          ) : null}
          <Text style={styles.eyebrow}>{dateLabel}</Text>
          <TodayGreeting now={now} displayName={household.data?.me.display_name ?? ''} />
        </View>
        <Text style={styles.summary}>{summary}</Text>
        <Pressable
          accessibilityRole="button"
          onPress={() => router.push('/agenda')}
          style={[styles.agendaLink, { backgroundColor: colors.glassStrong }]}>
          <Icon name="calendar-month-outline" size={16} color="primary" />
          <Text style={[styles.agendaText, { color: colors.primary }]}>Ver a agenda</Text>
        </Pressable>
      </SkyHeader>

      {/* Os termos mudaram (ou a pessoa nunca os viu): um aviso que some no "Entendi". */}
      <TermsNoticeCard />

      {/* Alguém da casa está indo às compras: ainda dá tempo de pôr na lista o que falta. */}
      <MarketTripBanner openable />

      <InstallAppCard />

      <View style={styles.quickActions}>
        <Tile art="camera" wash={WASHES.yellow} label={SCAN_TITLE} onPress={() => router.push('/escanear')} />
        <Tile art="carrinho" wash={WASHES.blue} label={MARKET_LIST_SHORTCUT} onPress={() => void openMarket()} />
        <Tile
          art="tarefa"
          wash={WASHES.green}
          label="Criar nova tarefa"
          onPress={() => router.push({ pathname: '/tarefa/[id]', params: { id: 'nova' } })}
        />
      </View>

      {/* Com os primeiros passos na tela, o cartão deles fica no lugar deste (o topo já diz "Tudo em dia por aqui."). */}
      {allClear && !firstSteps.shown && !firstSteps.deciding ? (
        <Card>
          <EmptyState icon="check-circle-outline" tint="green" title={ALL_CLEAR_TITLE} message={allClearMessage(finance)} />
        </Card>
      ) : null}

      <TodayBlock title={TODAY_BLOCK_TITLES.agora} block={blocks.agora} row={row} />
      <TodayBlock title={TODAY_BLOCK_TITLES.emBreve} block={blocks.emBreve} row={row} />

      {firstSteps.shown ? (
        <FirstStepsCard steps={firstSteps.shown} onStep={openStep} onSkip={firstSteps.skip} onDismiss={firstSteps.dismiss} />
      ) : null}

      <TodaySuggestions
        restock={restock}
        adding={addToList.isPending}
        onRestock={(restockItems, open) => void addRestock(restockItems, open)}
        menu={menu.data ?? []}
        lists={activeLists}
      />

      {paying ? <PayBillModal bill={paying} onClose={() => setPaying(null)} /> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  eyebrow: { fontFamily: fonts.bold, fontSize: 13, lineHeight: 18 },
  summary: { fontFamily: fonts.semibold, fontSize: 15, lineHeight: 21 },
  quickActions: { flexDirection: 'row', alignItems: 'stretch', gap: space.md },
  agendaLink: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    justifyContent: 'center',
    gap: 6,
    // 44 de altura: o toque inteiro.
    minHeight: 44,
    paddingVertical: 8,
    paddingLeft: 12,
    paddingRight: 14,
    borderRadius: radius.pill,
    boxShadow: shadows.pill,
  },
  agendaText: { fontFamily: fonts.heavy, fontSize: 14, lineHeight: 18 },
  // O mesmo respiro de antes até a data, agora que os dois ficam no mesmo bloco.
  houseSwitch: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    alignSelf: 'flex-start',
    paddingVertical: space.xs,
    marginBottom: 6,
  },
  houseName: { flexShrink: 1 },
});
