import { useMemo, useState } from 'react';
import { StyleSheet } from 'react-native';

import { useLongCycleHistory, useLongCycleSettings } from '@/data/longCycle';
import { usePurchaseRecords, useShoppingLists } from '@/data/market';
import { todayISO } from '@/domain/dates';
import { housePlaceHouseLine, openHouseName } from '@/domain/housePlace';
import {
  LONG_CYCLE_BADGES,
  LONG_CYCLE_ERROR_TITLE,
  LONG_CYCLE_FOOTNOTE,
  LONG_CYCLE_HISTORY_FAILED,
  LONG_CYCLE_INTRO,
  LONG_CYCLE_NOT_READY,
  LONG_CYCLE_OFFLINE,
  longCycleOnList,
  longCycleRowText,
  longCycleScreenOrder,
  longCycleStates,
  longCycleSuggestion,
  type LongCycleState,
} from '@/domain/longCycle';
import { listExclusion } from '@/domain/recentPurchases';
import { StaleNotice } from '@/features/health/StaleNotice';
import { LongCycleControls, marketItemOf, useLongCycleWrite, useMarketAdd } from '@/features/LongCycle';
import { useJustListed } from '@/features/RecentPurchases';
import { useHousehold } from '@/lib/auth';
import { errorMessage } from '@/lib/supabase';
import { notify } from '@/ui/dialogs';
import { Badge, Button, Card, CategoryIcon, ErrorNotice, ListCard, ListRow, Loading, Screen, Text } from '@/ui/primitives';
import { space } from '@/ui/theme';

/**
 * Os prazos de troca da casa (Configurações → Casa → "Prazos de troca", e o "Ver os outros" do Hoje): cada item da
 * tabela do app (domain/longCycle), o que está na hora primeiro, com o prazo, a última vez e as opções. Valem para a
 * casa aberta. Antes da migração, só os prazos do app, sem opções.
 */
export default function LongCycleScreen() {
  const today = todayISO();
  const household = useHousehold();
  const settings = useLongCycleSettings();
  const history = useLongCycleHistory();
  const purchases = usePurchaseRecords();
  const lists = useShoppingLists();
  const onLists = useMemo(() => (lists.data ?? []).flatMap((l) => l.items), [lists.data]);
  const justListed = useJustListed(lists.data ? onLists : undefined);
  const onError = (err: unknown) => notify(LONG_CYCLE_ERROR_TITLE, errorMessage(err));
  const marketAdd = useMarketAdd({ justListed, onError });
  const writer = useLongCycleWrite();
  const [target, setTarget] = useState<LongCycleState | null>(null);

  const refresh = () => {
    void settings.refetch();
    void history.refetch();
    void purchases.refetch();
    void lists.refetch();
  };
  const refreshing = settings.isRefetching || history.isRefetching || purchases.isRefetching || lists.isRefetching;

  const states = useMemo(
    () =>
      settings.data === undefined
        ? []
        : longCycleScreenOrder(
            longCycleStates({ records: [...(purchases.data ?? []), ...(history.data ?? [])], settings: settings.data, today }),
          ),
    [settings.data, purchases.data, history.data, today],
  );

  if (settings.data === undefined) {
    // Sem nada guardado: a primeira busca, sem internet, ou a falha.
    if (settings.fetchStatus === 'paused') {
      return (
        <Screen edges={[]}>
          <Card style={styles.gap}>
            <Text variant="body">{LONG_CYCLE_OFFLINE}</Text>
            <Button title="Tentar de novo" variant="secondary" compact onPress={() => void settings.refetch()} />
          </Card>
        </Screen>
      );
    }
    if (settings.isError) {
      return (
        <Screen edges={[]}>
          <ErrorNotice error={settings.error} onRetry={() => void settings.refetch()} />
        </Screen>
      );
    }
    return (
      <Screen edges={[]}>
        <Loading />
      </Screen>
    );
  }
  // As compras chegam antes de dizer "nenhuma compra pelo app".
  const firstFetch = (query: { data: unknown; fetchStatus: string }) => query.data === undefined && query.fetchStatus === 'fetching';
  if (firstFetch(history) || firstFetch(purchases)) {
    return (
      <Screen edges={[]}>
        <Loading />
      </Screen>
    );
  }

  const editable = settings.data !== null;
  const houseName = openHouseName(household.data);
  // O que está numa lista aberta (ou acabou de ir): só com as listas em mãos.
  const exclude = lists.isSuccess ? listExclusion(onLists, justListed.pending) : null;
  const onList = (state: LongCycleState) => Boolean(exclude && longCycleOnList(state, { lists: onLists, exclude }));
  const historyMissing = history.data === undefined && (history.isError || history.fetchStatus === 'paused');

  return (
    <Screen edges={[]} refreshing={refreshing} onRefresh={refresh}>
      {houseName ? <Text variant="muted">{housePlaceHouseLine(houseName)}</Text> : null}
      <Text variant="muted">{LONG_CYCLE_INTRO}</Text>
      {editable ? null : (
        <Card>
          <Text variant="body">{LONG_CYCLE_NOT_READY}</Text>
        </Card>
      )}
      {settings.isError ? <StaleNotice onRetry={() => void settings.refetch()} /> : null}
      {historyMissing ? (
        <StaleNotice
          message={LONG_CYCLE_HISTORY_FAILED}
          // Parada sem internet, segue sozinha quando a conexão volta.
          onRetry={history.fetchStatus === 'paused' ? undefined : () => void history.refetch()}
        />
      ) : null}
      <ListCard>
        {states.map((state) => {
          const badge = state.off
            ? { label: LONG_CYCLE_BADGES.off, tone: 'neutral' as const }
            : onList(state)
              ? { label: LONG_CYCLE_BADGES.onList, tone: 'neutral' as const }
              : state.status === 'trocar'
                ? { label: LONG_CYCLE_BADGES.due, tone: 'warning' as const }
                : null;
          return (
            <ListRow
              key={state.item.key}
              left={
                <CategoryIcon category={state.record?.category || state.item.category} name={state.item.noArt ? undefined : state.item.name} />
              }
              title={state.item.name}
              subtitle={longCycleRowText(state, today)}
              right={badge ? <Badge label={badge.label} tone={badge.tone} /> : null}
              onPress={editable && !writer.busy ? () => setTarget(state) : undefined}
            />
          );
        })}
      </ListCard>
      <Text variant="muted">{LONG_CYCLE_FOOTNOTE}</Text>

      <LongCycleControls
        target={target}
        context="trocas"
        settings={settings.data}
        writer={writer}
        onAdd={
          target && lists.isSuccess && !onList(target) && !marketAdd.busy
            ? (state) => void marketAdd.add([marketItemOf(longCycleSuggestion(state))])
            : undefined
        }
        // Aqui não há aviso: a linha fica, e o selo e a frase dela dizem o que mudou.
        onDone={() => undefined}
        onClose={() => setTarget(null)}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  gap: { gap: space.sm },
});
