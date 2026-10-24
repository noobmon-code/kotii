import { useIsMutating } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { Platform, ScrollView, StyleSheet, View } from 'react-native';

import { AppDashboardForbidden } from '@/data/appDashboard';
import {
  FeedbackGone,
  SET_APP_FEEDBACK_KEY,
  useAppFeedback,
  useRefetchAppFeedback,
  useSetAppFeedback,
  type FeedbackChange,
} from '@/data/appFeedback';
import {
  defaultFeedbackStatus,
  FEEDBACK_DETAIL_EMPTY,
  FEEDBACK_INBOX_NOT_READY,
  FEEDBACK_KEYS_HINT,
  FEEDBACK_SEARCH_PLACEHOLDER,
  feedbackInboxView,
  feedbackKeyStep,
  feedbackStatusParam,
  nextFeedbackSelection,
  withOpenedFeedback,
  type FeedbackChip,
  type FeedbackItem,
  type FeedbackKindFilter,
  type FeedbackStatusFilter,
} from '@/domain/appFeedback';
import { PANEL_LIST_MIN_WIDTH, PANEL_LIST_WIDTH } from '@/domain/panelLayout';
import { StaleNotice } from '@/features/health/StaleNotice';
import { errorMessage } from '@/lib/supabase';
import { Card, Chip, EmptyState, ErrorNotice, Icon, IconButton, Loading, Text, TextField, useGlassStyle } from '@/ui/primitives';
import { radius, space, useColors } from '@/ui/theme';

import { FeedbackDetailView } from './FeedbackDetailView';
import { FeedbackRowView, ROW_TEXT_INSET } from './FeedbackRowView';
import { PanelLock } from './PanelLock';

/** O foco num campo de texto do navegador: aí as teclas são do campo, não da lista. */
function typing(target: EventTarget | null): boolean {
  if (!target || typeof (target as HTMLElement).tagName !== 'string') return false;
  const element = target as HTMLElement;
  return element.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(element.tagName);
}

/**
 * Leva a lista até a linha aberta pelas teclas, no navegador (lá a View é o elemento da página): rola só quando ela
 * está fora da vista, medida na hora (as linhas acima mudam de altura e de lugar com os filtros e a marcação de
 * lido); com `focus`, o foco do teclado vai com ela, sem rolar de novo, para o Enter e o contorno ficarem na linha
 * aberta.
 */
function revealRow(node: View | undefined, focus: boolean) {
  if (Platform.OS !== 'web' || !node) return;
  const element = node as unknown as HTMLElement;
  if (focus) element.focus?.({ preventScroll: true });
  element.scrollIntoView?.({ block: 'nearest' });
}

/**
 * O que a pessoa escolheu na caixa: o filtro de situação (null enquanto não escolheu: a caixa abre nos novos quando
 * há algum, senão em todos), o tipo, a busca, o recado aberto e a nota que está sendo escrita nele (null: a
 * guardada). Fica com a tela do painel, fora da caixa: a caixa é montada de novo quando a janela passa de uma faixa
 * para outra (a tela troca a rolagem e o recado muda de lugar), e isso não pode perder o que a pessoa escolheu.
 */
export interface FeedbackInboxState {
  chosen: FeedbackStatusFilter | null;
  kind: FeedbackKindFilter;
  query: string;
  selected: string | null;
  draft: string | null;
}

/** A caixa como abre. */
export const FEEDBACK_INBOX_START: FeedbackInboxState = { chosen: null, kind: 'todos', query: '', selected: null, draft: null };

/** Sem internet: os recados do filtro escolhido chegam sozinhos quando a conexão voltar. */
function OfflineCard() {
  return (
    <Card style={styles.notice}>
      <Icon name="wifi-off" color="warning" />
      <Text variant="muted" style={styles.flex}>
        Sem internet. Os recados aparecem quando a conexão voltar.
      </Text>
    </Card>
  );
}

/** Os filtros de situação, com as contagens. */
function StatusChips({
  chips,
  status,
  onChoose,
}: {
  chips: FeedbackChip<FeedbackStatusFilter>[];
  status: FeedbackStatusFilter;
  onChoose: (next: FeedbackStatusFilter) => void;
}) {
  return (
    <View style={styles.chips}>
      {chips.map((chip) => (
        <Chip
          key={chip.key}
          label={chip.label}
          accessibilityLabel={chip.accessibilityLabel}
          selected={chip.key === status}
          onPress={() => onChoose(chip.key)}
        />
      ))}
    </View>
  );
}

/**
 * A caixa de recados do Painel do app (aba Recados). Em cima, os filtros de situação (com as contagens), os de
 * tipo e a busca; embaixo, a lista e o recado aberto. Na janela larga (`masterDetail`, de domain/panelLayout), a
 * lista e o recado ficam lado a lado, cada um com a sua rolagem, e no navegador ↑/↓ e j/k passam de um recado
 * para o outro; no celular, a lista rola com a tela e o toque abre o recado na própria linha. `paneHeight`: a
 * altura das duas partes quando a janela é baixa e a tela rola (panelPaneHeight); sem ela, as duas partes enchem
 * o que sobra da tela. O que a pessoa escolheu fica em `state` (com quem usa: FeedbackInboxState). Abrir um recado
 * novo o marca como lido, uma vez por abertura. Tudo o que aparece vem de domain/appFeedback; as mudanças passam
 * pela useSetAppFeedback (data/appFeedback).
 */
export function FeedbackInbox({
  masterDetail,
  paneHeight,
  state,
  onState,
}: {
  masterDetail: boolean;
  paneHeight?: number;
  state: FeedbackInboxState;
  onState: Dispatch<SetStateAction<FeedbackInboxState>>;
}) {
  const c = useColors();
  const glass = useGlassStyle();
  // A lista dos novos decide o filtro com que a caixa abre: os novos, quando há algum, senão todos. É a mesma
  // lista do número da aba (uma busca só), e a escolha fica até a pessoa trocar de filtro.
  const fresh = useAppFeedback('novo');
  const initial: FeedbackStatusFilter | null =
    fresh.data === undefined ? null : fresh.data ? defaultFeedbackStatus(fresh.data.counts) : 'novo';
  const { kind, query, selected } = state;
  const status = state.chosen ?? initial ?? 'novo';
  useEffect(() => {
    if (state.chosen === null && initial !== null) onState((before) => (before.chosen === null ? { ...before, chosen: initial } : before));
  }, [state.chosen, initial, onState]);
  const list = useAppFeedback(feedbackStatusParam(status));
  const setFeedback = useSetAppFeedback();
  const busy = useIsMutating({ mutationKey: SET_APP_FEEDBACK_KEY }) > 0;
  const refetchAll = useRefetchAppFeedback();
  const [kept, setKept] = useState<ReadonlyMap<string, FeedbackItem>>(() => new Map());
  // Trocando de filtro sem internet, a lista do filtro de antes fica no lugar da nova (keepPreviousData) e a busca
  // parada: as linhas não são do filtro escolhido, e não aparecem.
  const waitingOffline = list.isPlaceholderData && list.fetchStatus === 'paused';

  const data = list.data;
  const items = useMemo(() => (data ? withOpenedFeedback(data.items, kept) : []), [data, kept]);
  const view = useMemo(
    () => (data ? feedbackInboxView({ ...data, items }, { status, kind, query }) : null),
    [data, items, status, kind, query],
  );
  const opened = selected === null ? null : (items.find((item) => item.id === selected) ?? null);

  /** Abre (ou fecha, com null) um recado; a nota que estava sendo escrita no outro fica para trás. */
  const select = (id: string | null) => onState((before) => (before.selected === id ? before : { ...before, selected: id, draft: null }));

  /** Grava e põe o recado que voltou na cópia guardada; o recado que sumiu sai da tela. Nunca falha. */
  const write = (change: FeedbackChange): Promise<void> =>
    setFeedback.mutateAsync(change).then(
      (item) => setKept((before) => (before.has(item.id) ? new Map(before).set(item.id, item) : before)),
      (err: unknown) => {
        if (!(err instanceof FeedbackGone)) return;
        setKept((before) => {
          const after = new Map(before);
          after.delete(change.id);
          return after;
        });
        onState((before) => (before.selected === change.id ? { ...before, selected: null, draft: null } : before));
      },
    );

  const open = (item: FeedbackItem) => {
    select(item.id);
    setKept((before) => new Map(before).set(item.id, item));
    // Uma vez por abertura: o "Marcar como novo" com o recado aberto não é desfeito por aqui.
    if (item.status === 'novo') void write({ id: item.id, status: 'lido', quiet: true });
  };

  const chooseStatus = (next: FeedbackStatusFilter) => {
    if (next === status) return;
    onState((before) => ({ ...before, chosen: next }));
    setKept(new Map());
  };

  const refresh = () => {
    setKept(new Map());
    void refetchAll();
  };

  // As linhas da janela larga, pelo id, e o recado que as teclas abriram (null: aberto com um clique, que não mexe
  // na rolagem nem no foco). Marcado como lido, o título perde o negrito e a linha cresce um pouco: a lista rola de
  // novo até ela.
  const rowNodes = useRef(new Map<string, View>());
  const keyed = useRef<string | null>(null);
  const openedStatus = opened?.status;
  useEffect(() => {
    if (selected !== null && keyed.current === selected) revealRow(rowNodes.current.get(selected), false);
  }, [selected, openedStatus]);

  // No navegador, na janela larga: ↓ ou j abre o próximo, ↑ ou k o anterior. A tecla pega o estado da última
  // pintura da tela (a função muda a cada uma, o ouvinte do documento fica o mesmo).
  const step = useRef<(direction: 1 | -1) => void>(() => undefined);
  useEffect(() => {
    step.current = (direction) => {
      if (!view || waitingOffline) return;
      const next = nextFeedbackSelection(view.rows.map((row) => row.id), selected, direction);
      const item = next === null || next === selected ? undefined : items.find((entry) => entry.id === next);
      if (!item) return;
      open(item);
      keyed.current = item.id;
      revealRow(rowNodes.current.get(item.id), true);
    };
  });
  useEffect(() => {
    if (Platform.OS !== 'web' || !masterDetail || typeof document === 'undefined') return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || typing(event.target)) return;
      const direction = feedbackKeyStep(event.key);
      if (direction === null) return;
      event.preventDefault();
      step.current(direction);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [masterDetail]);

  if (list.error instanceof AppDashboardForbidden) return <PanelLock />;
  if (data === undefined) {
    // Sem internet e nada na memória, a busca fica parada (não vira erro) e volta sozinha com a conexão.
    const notice =
      list.fetchStatus === 'paused' ? (
        <OfflineCard />
      ) : list.isError ? (
        <ErrorNotice error={new Error(errorMessage(list.error))} onRetry={() => void list.refetch()} />
      ) : (
        <Loading />
      );
    // Com as contagens já conhecidas (a lista dos novos as traz), os filtros de situação ficam: a pessoa volta
    // para um filtro que funciona.
    if (!fresh.data) return notice;
    const chips = feedbackInboxView({ ...fresh.data, items: [] }, { status }).statusChips;
    return (
      <View style={styles.inbox}>
        <StatusChips chips={chips} status={status} onChoose={chooseStatus} />
        {notice}
      </View>
    );
  }
  if (data === null || !view) {
    return <EmptyState icon="database-clock-outline" title="Ainda não disponível" message={FEEDBACK_INBOX_NOT_READY} />;
  }

  const detailOf = (item: FeedbackItem, badges = true) => (
    <FeedbackDetailView
      key={item.id}
      item={item}
      busy={busy}
      badges={badges}
      draft={selected === item.id ? state.draft : null}
      onDraft={(text) => onState((before) => (before.selected === item.id ? { ...before, draft: text } : before))}
      onWrite={(change) => {
        // O recado aberto fica neste filtro também quando foi aberto em outro (a troca de filtro mantém o aberto):
        // mudar a situação dele não o tira da lista debaixo do dedo.
        if (!list.isPlaceholderData) setKept((before) => (before.has(item.id) ? before : new Map(before).set(item.id, item)));
        return write({ ...change, id: item.id });
      }}
    />
  );
  const itemOf = (id: string) => items.find((item) => item.id === id);

  const rows = waitingOffline ? (
    <OfflineCard />
  ) : view.empty ? (
    <Text variant="muted" style={styles.empty}>
      {view.empty}
    </Text>
  ) : (
    view.rows.map((row, index) => {
      const item = itemOf(row.id);
      if (!item) return null;
      const divider = index > 0 ? <View style={[styles.divider, { backgroundColor: c.hairline }]} /> : null;
      if (masterDetail) {
        return (
          <View key={row.id}>
            {divider}
            <FeedbackRowView
              ref={(node) => {
                if (node) rowNodes.current.set(row.id, node);
                else rowNodes.current.delete(row.id);
              }}
              row={row}
              selected={row.id === selected}
              onPress={() => {
                keyed.current = null;
                open(item);
              }}
            />
          </View>
        );
      }
      // No celular, o toque abre o recado embaixo da linha, os dois no mesmo fundo; outro toque fecha.
      const expanded = row.id === selected;
      return (
        <View key={row.id} style={expanded ? [styles.open, { backgroundColor: c.primarySoft }] : undefined}>
          {divider}
          <FeedbackRowView row={row} expanded={expanded} onPress={() => (expanded ? select(null) : open(item))} />
          {expanded ? <View style={styles.inline}>{detailOf(item, false)}</View> : null}
        </View>
      );
    })
  );

  return (
    <View style={[styles.inbox, masterDetail && paneHeight === undefined && styles.flex]}>
      <View style={styles.toolbar}>
        <StatusChips chips={view.statusChips} status={status} onChoose={chooseStatus} />
        {/* Na janela larga, os tipos e a busca dividem uma linha: sobra mais altura para as duas partes. */}
        <View style={masterDetail ? styles.toolbarRow : styles.toolbar}>
          <View style={styles.chips}>
            {view.kindChips.map((chip) => (
              <Chip
                key={chip.key}
                label={chip.label}
                accessibilityLabel={chip.accessibilityLabel}
                selected={chip.key === kind}
                onPress={() => onState((before) => ({ ...before, kind: chip.key }))}
              />
            ))}
          </View>
          <View style={[styles.searchRow, masterDetail && styles.searchWide]}>
            <View style={styles.flex}>
              <TextField
                value={query}
                onChangeText={(text) => onState((before) => ({ ...before, query: text }))}
                placeholder={FEEDBACK_SEARCH_PLACEHOLDER}
                accessibilityLabel={FEEDBACK_SEARCH_PLACEHOLDER}
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="search"
                clearButtonMode="while-editing"
              />
            </View>
            {/* Na janela larga a tela não é puxada para baixo: o botão busca de novo. */}
            {masterDetail ? <IconButton icon="refresh" label="Buscar os recados de novo" onPress={refresh} /> : null}
          </View>
        </View>
        {/* A contagem é do filtro escolhido: sem a lista dele, nada. */}
        {waitingOffline ? null : (
          <Text variant="small">
            {view.countLabel}
            {view.cutNote ? ` · ${view.cutNote}` : ''}
          </Text>
        )}
      </View>

      {list.isError ? <StaleNotice onRetry={() => void list.refetch()} /> : null}

      {masterDetail ? (
        <View style={[styles.panes, paneHeight === undefined ? styles.flex : { height: paneHeight }]}>
          <View style={[styles.pane, styles.listPane, glass, list.isPlaceholderData && !waitingOffline && styles.waiting]}>
            <ScrollView contentContainerStyle={styles.listContent} keyboardShouldPersistTaps="handled" nestedScrollEnabled>
              {rows}
            </ScrollView>
          </View>
          <View style={[styles.pane, styles.flex, glass]}>
            {opened ? (
              <ScrollView
                key={opened.id}
                contentContainerStyle={styles.detailContent}
                keyboardShouldPersistTaps="handled"
                nestedScrollEnabled>
                {detailOf(opened)}
              </ScrollView>
            ) : (
              <EmptyState
                icon="message-text-outline"
                tint="blue"
                title={FEEDBACK_DETAIL_EMPTY}
                message={Platform.OS === 'web' ? FEEDBACK_KEYS_HINT : undefined}
              />
            )}
          </View>
        </View>
      ) : (
        <View style={[styles.pane, glass, styles.listContent, list.isPlaceholderData && !waitingOffline && styles.waiting]}>{rows}</View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  inbox: { gap: space.lg },
  notice: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  toolbar: { gap: space.md },
  toolbarRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.md },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  // Ao lado dos tipos, quando cabe; numa janela estreita, desce para a linha de baixo.
  searchWide: { flexGrow: 1, flexBasis: 280, minWidth: 240 },
  // As duas partes enchem a altura que sobra embaixo dos filtros (flex), ou têm a altura dada, cada uma com a sua
  // rolagem. Nunca flex 0 com a altura: no react-native-web ele vira uma base 0%, que vale mais que a altura.
  panes: { flexDirection: 'row', gap: space.lg },
  pane: { borderRadius: radius.lg, borderCurve: 'continuous', overflow: 'hidden' },
  // 40% da linha, entre 280 e 360: logo acima da janela larga, o recado aberto (o que se lê) fica com a parte maior.
  listPane: { width: '40%', minWidth: PANEL_LIST_MIN_WIDTH, maxWidth: PANEL_LIST_WIDTH },
  listContent: { padding: space.sm },
  detailContent: { padding: space.xl },
  // A lista do filtro anterior, enquanto a do novo não chega.
  waiting: { opacity: 0.6 },
  divider: { height: 1, marginHorizontal: space.md },
  // No celular, a linha aberta e o recado embaixo dela num fundo só, o recado alinhado com o texto da linha.
  open: { borderRadius: radius.sm, borderCurve: 'continuous' },
  inline: { paddingLeft: ROW_TEXT_INSET, paddingRight: space.md, paddingBottom: space.lg },
  empty: { padding: space.lg },
});
