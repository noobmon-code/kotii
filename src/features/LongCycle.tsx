// Prazos de troca ("Hora de trocar", domain/longCycle): o grupo das Sugestões do Hoje, o menu de opções de um item
// (o mesmo no Hoje e na tela dos prazos, app/trocas), a folha do prazo e o caminho único de pôr na lista de mercado,
// que "Acho que acabou" também usa.

import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { StyleSheet, View } from 'react-native';

import { useLongCycleHistory, useLongCycleSettings, useSetLongCycleSetting } from '@/data/longCycle';
import { useAddItemsToList, type NewListItem } from '@/data/market';
import { todayISO } from '@/domain/dates';
import {
  describeLongCycle,
  LONG_CYCLE_ACTIONS,
  LONG_CYCLE_ERROR_TITLE,
  LONG_CYCLE_PERIOD_QUESTION,
  LONG_CYCLE_SHEET,
  LONG_CYCLE_UNDO,
  longCycleAddLabel,
  longCycleDayError,
  longCycleDefaultChipLabel,
  longCycleDefaultLine,
  longCycleMonthsText,
  longCycleNotice,
  longCycleOptionsLabel,
  longCyclePeriodChoices,
  longCycleRestate,
  longCycleRowText,
  longCycleSaveMonths,
  longCycleSeeMore,
  longCycleSeeMoreLabel,
  longCycleSkipKeys,
  longCycleStates,
  longCycleSuggestions,
  longCycleUndo,
  longCycleUndoLabel,
  type LongCycleChange,
  type LongCycleSetting,
  type LongCycleState,
  type LongCycleSuggestion,
  type LongCycleUndoKind,
} from '@/domain/longCycle';
import { listExclusion, type PurchaseRecord } from '@/domain/recentPurchases';
import type { RestockItem } from '@/domain/restock';
import { SUGGESTION_TITLES } from '@/domain/today';
import { SuggestionGroup } from '@/features/TodayBlocks';
import { errorMessage } from '@/lib/supabase';
import type { Chore, Equipment } from '@/lib/types';
import { ActionSheet, type SheetAction } from '@/ui/ActionSheet';
import { useAnnounce } from '@/ui/announce';
import { notify } from '@/ui/dialogs';
import { moveFocus } from '@/ui/focus';
import { AddCircle, Button, CategoryIcon, Chip, IconButton, LinkButton, ListCard, ListRow, Row, Text } from '@/ui/primitives';
import { SheetModal } from '@/ui/SheetModal';
import { space } from '@/ui/theme';

/** Os nomes postos agora há pouco (useJustListed, de features/RecentPurchases). */
interface JustListed {
  pending: ReadonlySet<string>;
  add: (names: string[]) => void;
  drop: (names: string[]) => void;
}

export type MarketAddItem = NewListItem & { cycleKey?: string };

/**
 * Pôr na lista de mercado aberta mais recente (ou numa "Mercado" nova), a do servidor: o caminho de "Acho que acabou"
 * e de "Hora de trocar". Um pedido por vez para os dois grupos (sem lista de mercado aberta, dois toques criariam duas
 * "Mercado"). O item some já no toque (`justListed`) e volta se falhar. `open` abre a lista depois.
 */
export function useMarketAdd({ justListed, onError }: { justListed: JustListed; onError: (err: unknown) => void }) {
  const addToList = useAddItemsToList();
  const adding = useRef(false);
  async function add(items: MarketAddItem[], open = false): Promise<boolean> {
    if (adding.current) return false;
    adding.current = true;
    const names = items.map((i) => i.name);
    // Some já no toque; volta quando as listas carregadas trouxerem o item e ele sair delas depois (useJustListed).
    justListed.add(names);
    try {
      const { id } = await addToList.mutateAsync({
        // A lista de mercado aberta mais recente vem do servidor, não do que a tela tem guardado: pode ter sido
        // arquivada por outra pessoa, ou criada pelo toque anterior e ainda não ter chegado.
        newListName: 'Mercado',
        reuseMarketList: true,
        items: items.map(({ name, category, productId, quantity, unit, cycleKey }) => ({
          name,
          category,
          productId,
          quantity,
          unit,
          ...(cycleKey ? { cycleKey } : null),
        })),
      });
      if (open) router.push({ pathname: '/lista/[id]', params: { id } });
      return true;
    } catch (err) {
      justListed.drop(names);
      onError(err);
      return false;
    } finally {
      adding.current = false;
    }
  }
  return { add, busy: addToList.isPending };
}

/** O item da lista dos prazos, como useMarketAdd o manda. */
export const marketItemOf = (s: LongCycleSuggestion): MarketAddItem => ({
  name: s.name,
  category: s.category,
  productId: s.productId,
  quantity: s.quantity,
  unit: s.unit,
  cycleKey: s.key,
});

/** O aviso que fica no lugar da linha que saiu do grupo por uma gravação, com o "Desfazer". */
export interface LongCycleNotice {
  kind: LongCycleUndoKind;
  state: LongCycleState;
  /** O ajuste como estava antes da gravação (o "Desfazer" grava de volta). */
  previous: LongCycleSetting | undefined;
  /** O prazo novo (para o aviso de "Mudar o prazo"). */
  months: number;
  /** Onde a linha estava. */
  index: number;
}

/**
 * O grupo "Hora de trocar" do Hoje. Só sai com tudo o que pode esconder uma linha em mãos (as linhas não aparecem e
 * somem, e nada é oferecido duas vezes): os ajustes da casa (null, antes da migração, conta), as listas abertas
 * (`onLists`, só com a busca delas certa), o histórico dos 180 dias, as reposições, as tarefas e os aparelhos; e a
 * leitura longa fora da primeira busca (falhou, parada sem nada guardado ou null: só os 180 dias, que dão menos
 * sugestões, nunca uma errada). Cada argumento é undefined enquanto não está pronto.
 */
export function useLongCycleToday({
  onLists,
  justListed,
  purchases,
  restock,
  supplies,
  chores,
  equipment,
  today,
}: {
  onLists: readonly { name: string; category?: string | null; product_id: string | null }[] | undefined;
  justListed: JustListed;
  purchases: readonly PurchaseRecord[] | undefined;
  restock: readonly RestockItem[] | undefined;
  supplies: readonly { name: string; kind: string }[] | undefined;
  chores: readonly Pick<Chore, 'title' | 'recurrence' | 'equipment_id'>[] | undefined;
  equipment: readonly Pick<Equipment, 'id' | 'name' | 'category'>[] | undefined;
  today: string;
}) {
  const settings = useLongCycleSettings();
  const history = useLongCycleHistory();
  const historyFirstFetch = history.data === undefined && history.fetchStatus === 'fetching';
  const settingsData = settings.data;
  const historyData = history.data;
  const pending = justListed.pending;
  const computed = useMemo(() => {
    if (settingsData === undefined || !onLists || !purchases || !restock || !supplies || !chores || !equipment || historyFirstFetch) {
      return null;
    }
    const states = longCycleStates({ records: [...purchases, ...(historyData ?? [])], settings: settingsData, today });
    const skip = longCycleSkipKeys({ restock, supplies, chores, equipment });
    return longCycleSuggestions(states, { lists: onLists, exclude: listExclusion(onLists, pending), skip });
  }, [settingsData, historyData, historyFirstFetch, onLists, purchases, restock, supplies, chores, equipment, pending, today]);

  // Um aviso por vez, no lugar da linha; sai quando a Hoje deixa de estar à vista.
  const [notice, setNotice] = useState<LongCycleNotice | null>(null);
  useFocusEffect(useCallback(() => () => setNotice(null), []));

  const refetchSettings = settings.refetch;
  const refetchHistory = history.refetch;
  const refetch = useCallback(() => {
    void refetchSettings();
    void refetchHistory();
  }, [refetchSettings, refetchHistory]);

  return {
    shown: computed?.shown ?? [],
    total: computed?.total ?? 0,
    /** Os ajustes existem (depois da migração): as opções e o "Ver os outros". */
    editable: computed !== null && settingsData !== null,
    settings: settingsData ?? null,
    notice,
    setNotice,
    refetch,
  };
}

/**
 * As gravações do grupo e da tela dos prazos, uma por vez (um segundo toque enquanto uma está saindo não faz nada).
 * A falha avisa e não muda nada na tela; devolve a linha gravada, ou null.
 */
export function useLongCycleWrite() {
  const save = useSetLongCycleSetting();
  const writing = useRef(false);
  const [busy, setBusy] = useState(false);
  const write = useCallback(
    async (itemKey: string, change: LongCycleChange): Promise<LongCycleSetting | null> => {
      if (writing.current) return null;
      writing.current = true;
      setBusy(true);
      try {
        return await save.mutateAsync({ itemKey, change });
      } catch (err) {
        notify(LONG_CYCLE_ERROR_TITLE, errorMessage(err));
        return null;
      } finally {
        writing.current = false;
        setBusy(false);
      }
    },
    [save],
  );
  return { write, busy, writing };
}

export type LongCycleWrite = ReturnType<typeof useLongCycleWrite>;

/** O que gravou: `replaced`, `off` e `period` são os do "Desfazer" do Hoje; `undoReplaced` e `on` são da tela dos prazos. */
export type LongCycleDone = LongCycleUndoKind | 'undoReplaced' | 'on';

/**
 * O menu de opções de um item (sempre montado, `visible` pelo alvo) e a folha do prazo, que ele mesmo abre. No Hoje:
 * "Já troquei", "Mudar o prazo" e "Não sugerir mais". Na tela dos prazos: também "Pôr na lista" (quando cabe),
 * "Desfazer o “Já troquei”" (quando a última vez foi uma troca) e "Voltar a sugerir". Faz a conferência da data, as
 * gravações e os avisos de erro, e conta o que gravou (`onDone`), com o ajuste de antes e o gravado.
 */
export function LongCycleControls({
  target,
  context,
  settings,
  writer,
  onStart,
  onAdd,
  onDone,
  onClose,
}: {
  target: LongCycleState | null;
  context: 'hoje' | 'trocas';
  settings: readonly LongCycleSetting[] | null;
  writer: LongCycleWrite;
  /** Uma gravação vai começar (no Hoje, o aviso de antes sai). */
  onStart?: () => void;
  /** Na tela dos prazos: põe o item na lista; sem ele, a opção não aparece. */
  onAdd?: (state: LongCycleState) => void;
  onDone: (kind: LongCycleDone, state: LongCycleState, previous: LongCycleSetting | undefined, saved: LongCycleSetting) => void;
  onClose: () => void;
}) {
  const [period, setPeriod] = useState<LongCycleState | null>(null);

  async function run(state: LongCycleState, kind: LongCycleDone, change: LongCycleChange): Promise<boolean> {
    if (writer.writing.current) return false;
    const previous = settings?.find((s) => s.item_key === state.item.key);
    onStart?.();
    const saved = await writer.write(state.item.key, change);
    if (!saved) return false;
    onDone(kind, state, previous, saved);
    return true;
  }

  function replaced(state: LongCycleState) {
    const today = todayISO();
    const clock = longCycleDayError(today);
    if (clock) {
      notify(clock.title, clock.message);
      return;
    }
    void run(state, 'replaced', { replaced_on: today });
  }

  const today = todayISO();
  const actions: SheetAction[] = [];
  if (target) {
    if (context === 'trocas' && onAdd) actions.push({ label: LONG_CYCLE_ACTIONS.add, icon: 'cart-plus', onPress: () => onAdd(target) });
    actions.push({ label: LONG_CYCLE_ACTIONS.replaced, icon: 'check', onPress: () => replaced(target) });
    if (context === 'trocas' && target.last?.via === 'troca') {
      actions.push({
        label: LONG_CYCLE_ACTIONS.undoReplaced,
        icon: 'undo',
        onPress: () => void run(target, 'undoReplaced', { replaced_on: null }),
      });
    }
    // Abre a folha do prazo pela ação, que no iPhone só roda depois de o menu sair (duas janelas de uma vez falham).
    actions.push({ label: LONG_CYCLE_ACTIONS.period, icon: 'calendar-edit', onPress: () => setPeriod(target) });
    actions.push(
      target.off
        ? { label: LONG_CYCLE_ACTIONS.on, icon: 'bell-outline', onPress: () => void run(target, 'on', { off: false }) }
        : { label: LONG_CYCLE_ACTIONS.off, icon: 'bell-off-outline', onPress: () => void run(target, 'off', { off: true }) },
    );
  }

  return (
    <>
      <ActionSheet
        visible={Boolean(target)}
        title={target?.item.name}
        message={target ? (context === 'hoje' ? describeLongCycle(target, today) : longCycleRowText(target, today)) : undefined}
        actions={actions}
        onClose={onClose}
      />
      {period ? (
        <LongCyclePeriodSheet
          key={period.item.key}
          state={period}
          onClose={() => setPeriod(null)}
          onSave={async (months) => {
            const saved = await run(period, 'period', { every_months: longCycleSaveMonths(period.item, months) });
            if (saved) setPeriod(null);
            return saved;
          }}
        />
      ) : null}
    </>
  );
}

/**
 * "Mudar o prazo": os prazos em selos (o guardado fora deles ganha o seu), o do app marcado para o leitor de tela, e
 * "Salvar". A falha avisa e deixa a folha aberta, com o selo escolhido. Esc e o voltar do Android fecham; o clique fora
 * não (SheetModal).
 */
export function LongCyclePeriodSheet({
  state,
  onClose,
  onSave,
}: {
  state: LongCycleState;
  onClose: () => void;
  /** Grava; true fechou. */
  onSave: (months: number) => Promise<boolean>;
}) {
  const [chosen, setChosen] = useState(state.months);
  const [saving, setSaving] = useState(false);
  const busy = useRef(false);
  const { item } = state;

  async function save() {
    if (busy.current) return;
    busy.current = true;
    setSaving(true);
    try {
      await onSave(chosen);
    } finally {
      busy.current = false;
      setSaving(false);
    }
  }

  return (
    <SheetModal onClose={onClose}>
      <View style={styles.sheet}>
        <Text variant="heading" accessibilityRole="header">
          {item.name}
        </Text>
        <Text variant="label">{LONG_CYCLE_PERIOD_QUESTION}</Text>
        <Row style={styles.wrap}>
          {longCyclePeriodChoices(state.months).map((months) => (
            <Chip
              key={months}
              toggle
              label={longCycleMonthsText(months)}
              accessibilityLabel={months === item.months ? longCycleDefaultChipLabel(months) : undefined}
              selected={chosen === months}
              disabled={saving}
              onPress={() => setChosen(months)}
            />
          ))}
        </Row>
        <Text variant="muted">{longCycleDefaultLine(item.months)}</Text>
        <Button title={LONG_CYCLE_SHEET.save} loading={saving} onPress={() => void save()} />
        <Button title={LONG_CYCLE_SHEET.cancel} variant="ghost" disabled={saving} onPress={onClose} />
      </View>
    </SheetModal>
  );
}

/**
 * O grupo "Hora de trocar" nas Sugestões do Hoje: a linha tem os gestos da de "Acho que acabou" (o toque e o círculo
 * põem na lista) e, depois da migração, as opções num botão pequeno. A gravação que tira a linha deixa um aviso no
 * lugar dela, com o "Desfazer", que recebe o foco. Sem linha e sem aviso, nada.
 */
export function LongCycleGroup({
  today,
  suggestions,
  total,
  editable,
  settings,
  notice,
  setNotice,
  busy,
  onAdd,
}: {
  today: string;
  suggestions: LongCycleSuggestion[];
  total: number;
  editable: boolean;
  settings: readonly LongCycleSetting[] | null;
  notice: LongCycleNotice | null;
  setNotice: (notice: LongCycleNotice | null) => void;
  /** Uma inclusão por vez (as de "Acho que acabou" também): os botões ficam desativados enquanto isso. */
  busy: boolean;
  onAdd: (suggestion: LongCycleSuggestion) => void;
}) {
  const writer = useLongCycleWrite();
  const [target, setTarget] = useState<LongCycleState | null>(null);
  // Onde estava a linha cujas opções abriram: o aviso fica nesse lugar.
  const targetIndex = useRef(0);
  // O botão de opções de cada linha, pela chave do item (as linhas mudam de lugar; a chave fica).
  const optionNodes = useRef(new Map<string, View | null>());
  const focusOptions = (key: string) => moveFocus(nodeRef(() => optionNodes.current.get(key) ?? null));
  const undoRef = useRef<View>(null);
  const { announce, clear, region } = useAnnounce('long-cycle-announce');
  // Depois de pôr na lista: o foco vai para as opções da linha que ficou no lugar (a seguinte, senão a de antes).
  const focusAt = useRef<number | null>(null);
  const keys = suggestions.map((s) => s.key).join('|');
  useEffect(() => {
    const at = focusAt.current;
    if (at === null) return;
    focusAt.current = null;
    const next = suggestions[Math.min(at, suggestions.length - 1)];
    if (next) focusOptions(next.key);
    // Só quando as linhas mudam (a que foi para a lista saiu).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keys]);

  const noticeKey = notice ? `${notice.kind}:${notice.state.item.key}` : null;
  useEffect(() => {
    if (!notice) return;
    clear();
    announce(longCycleNotice(notice.kind, notice.state.item.name, notice.months));
    moveFocus(undoRef);
    // Uma vez por aviso.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [noticeKey]);

  if (!suggestions.length && !notice) return null;

  function add(suggestion: LongCycleSuggestion, index: number) {
    if (busy) return;
    if (editable) focusAt.current = index;
    onAdd(suggestion);
  }

  async function undo(current: LongCycleNotice) {
    const saved = await writer.write(current.state.item.key, longCycleUndo(current.kind, current.previous));
    if (!saved) return;
    setNotice(null);
    focusOptions(current.state.item.key);
  }

  function done(kind: LongCycleDone, state: LongCycleState, previous: LongCycleSetting | undefined, saved: LongCycleSetting) {
    const index = targetIndex.current;
    if (kind === 'period') {
      const next = longCycleRestate(state, saved, today);
      // Ainda na hora: a linha fica, com a frase nova, e o foco volta às opções dela (a folha não o devolve).
      if (next.status === 'trocar') {
        focusOptions(state.item.key);
        return;
      }
      setNotice({ kind, state, previous, months: next.months, index });
      return;
    }
    if (kind === 'replaced' || kind === 'off') setNotice({ kind, state, previous, months: state.months, index });
  }

  const rows = suggestions.map((suggestion, index) => {
    const { state } = suggestion;
    return (
      <ListRow
        key={suggestion.key}
        left={<CategoryIcon category={suggestion.category} name={state.item.noArt ? undefined : suggestion.name} />}
        title={suggestion.name}
        subtitle={describeLongCycle(state, today)}
        right={
          <View style={styles.right}>
            {editable ? (
              <IconButton
                ref={(node: View | null) => {
                  optionNodes.current.set(suggestion.key, node);
                }}
                icon="dots-horizontal"
                label={longCycleOptionsLabel(suggestion.name)}
                disabled={writer.busy}
                onPress={() => {
                  targetIndex.current = index;
                  setTarget(state);
                }}
              />
            ) : null}
            <AddCircle label={longCycleAddLabel(suggestion.name)} disabled={busy} onPress={() => add(suggestion, index)} />
          </View>
        }
        onPress={busy ? undefined : () => add(suggestion, index)}
      />
    );
  });
  if (notice) {
    const { state } = notice;
    rows.splice(
      Math.min(notice.index, rows.length),
      0,
      <ListRow
        key={`aviso:${state.item.key}`}
        left={<CategoryIcon category={state.item.category} name={state.item.noArt ? undefined : state.item.name} />}
        title={state.item.name}
        subtitle={longCycleNotice(notice.kind, state.item.name, notice.months)}
        right={
          <Button
            ref={undoRef}
            title={LONG_CYCLE_UNDO}
            variant="ghost"
            compact
            accessibilityLabel={longCycleUndoLabel(notice.kind, state.item.name)}
            loading={writer.busy}
            onPress={() => void undo(notice)}
          />
        }
      />,
    );
  }

  const hidden = total - suggestions.length;
  return (
    <SuggestionGroup
      title={SUGGESTION_TITLES.longCycle}
      action={
        editable && hidden > 0 ? (
          <LinkButton title={longCycleSeeMore(hidden)} accessibilityLabel={longCycleSeeMoreLabel(hidden)} onPress={() => router.push('/trocas')} />
        ) : undefined
      }>
      <ListCard>{rows}</ListCard>
      {region}
      <LongCycleControls
        target={target}
        context="hoje"
        settings={settings}
        writer={writer}
        onStart={() => setNotice(null)}
        onDone={done}
        onClose={() => setTarget(null)}
      />
    </SuggestionGroup>
  );
}

/** Um ref que lê o nó na hora (moveFocus o lê depois do próximo quadro, quando a linha já foi redesenhada). */
function nodeRef(read: () => View | null): RefObject<View | null> {
  return {
    get current() {
      return read();
    },
  };
}

const styles = StyleSheet.create({
  right: { flexDirection: 'row', alignItems: 'center' },
  sheet: { gap: space.md, padding: space.lg },
  wrap: { flexWrap: 'wrap' },
});
