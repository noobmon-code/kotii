import { useIsMutating } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Platform, ScrollView, StyleSheet, View, type LayoutRectangle } from 'react-native';

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
  type FeedbackItem,
  type FeedbackKindFilter,
  type FeedbackStatusFilter,
} from '@/domain/appFeedback';
import { PANEL_LIST_WIDTH } from '@/domain/panelLayout';
import { StaleNotice } from '@/features/health/StaleNotice';
import { errorMessage } from '@/lib/supabase';
import { Card, Chip, EmptyState, ErrorNotice, Icon, IconButton, Loading, Text, TextField, useGlassStyle } from '@/ui/primitives';
import { radius, space, useColors } from '@/ui/theme';

import { FeedbackDetailView } from './FeedbackDetailView';
import { FeedbackRowView } from './FeedbackRowView';
import { PanelLock } from './PanelLock';

/** Do mais novo para o mais antigo, como app_feedback_list ordena (created_at desc, id desc). */
function newestFirst(a: FeedbackItem, b: FeedbackItem): number {
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? 1 : -1;
  return a.id === b.id ? 0 : a.id < b.id ? 1 : -1;
}

/**
 * A lista que veio do servidor com os recados abertos neste filtro que saíram dela (o novo aberto vira lido e,
 * buscada de novo, a lista dos novos não o traz mais): eles ficam no lugar deles até a troca de filtro, para a
 * linha não sumir debaixo do dedo. O que veio do servidor vale mais que a cópia guardada.
 */
function withKept(items: FeedbackItem[], kept: ReadonlyMap<string, FeedbackItem>): FeedbackItem[] {
  const listed = new Set(items.map((item) => item.id));
  const extra = [...kept.values()].filter((item) => !listed.has(item.id)).sort(newestFirst);
  if (!extra.length) return items;
  const out: FeedbackItem[] = [];
  let next = 0;
  for (const item of items) {
    while (next < extra.length && newestFirst(extra[next], item) <= 0) out.push(extra[next++]);
    out.push(item);
  }
  return out.concat(extra.slice(next));
}

/** O foco num campo de texto do navegador: aí as teclas são do campo, não da lista. */
function typing(target: EventTarget | null): boolean {
  if (!target || typeof (target as HTMLElement).tagName !== 'string') return false;
  const element = target as HTMLElement;
  return element.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(element.tagName);
}

/**
 * A caixa de recados do Painel do app (aba Recados). Em cima, os filtros de situação (com as contagens), os de
 * tipo e a busca; embaixo, a lista e o recado aberto. Na janela larga (`masterDetail`, de domain/panelLayout), a
 * lista e o recado ficam lado a lado, cada um com a sua rolagem, e no navegador ↑/↓ e j/k passam de um recado
 * para o outro; no celular, a lista rola com a tela e o toque abre o recado na própria linha. Abrir um recado novo
 * o marca como lido, uma vez por abertura. Tudo o que aparece vem de domain/appFeedback; as mudanças passam pela
 * useSetAppFeedback (data/appFeedback).
 */
export function FeedbackInbox({ masterDetail }: { masterDetail: boolean }) {
  const c = useColors();
  const glass = useGlassStyle();
  // A lista dos novos decide o filtro com que a caixa abre: os novos, quando há algum, senão todos. É a mesma
  // lista do número da aba (uma busca só), e a escolha fica até a pessoa trocar de filtro.
  const fresh = useAppFeedback('novo');
  const [chosen, setChosen] = useState<FeedbackStatusFilter | null>(null);
  if (chosen === null && fresh.data !== undefined) setChosen(fresh.data ? defaultFeedbackStatus(fresh.data.counts) : 'novo');
  const status = chosen ?? 'novo';
  const list = useAppFeedback(feedbackStatusParam(status));
  const setFeedback = useSetAppFeedback();
  const busy = useIsMutating({ mutationKey: SET_APP_FEEDBACK_KEY }) > 0;
  const refetchAll = useRefetchAppFeedback();
  const [kind, setKind] = useState<FeedbackKindFilter>('todos');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [kept, setKept] = useState<ReadonlyMap<string, FeedbackItem>>(() => new Map());

  const data = list.data;
  const items = useMemo(() => (data ? withKept(data.items, kept) : []), [data, kept]);
  const view = useMemo(
    () => (data ? feedbackInboxView({ ...data, items }, { status, kind, query }) : null),
    [data, items, status, kind, query],
  );
  const opened = selected === null ? null : (items.find((item) => item.id === selected) ?? null);

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
        setSelected((current) => (current === change.id ? null : current));
      },
    );

  const open = (item: FeedbackItem) => {
    setSelected(item.id);
    setKept((before) => new Map(before).set(item.id, item));
    // Uma vez por abertura: o "Marcar como novo" com o recado aberto não é desfeito por aqui.
    if (item.status === 'novo') void write({ id: item.id, status: 'lido', quiet: true });
  };

  const chooseStatus = (next: FeedbackStatusFilter) => {
    if (next === status) return;
    setChosen(next);
    setKept(new Map());
  };

  const refresh = () => {
    setKept(new Map());
    void refetchAll();
  };

  // A lista rola sozinha até o recado que as teclas abriram, quando ele está fora da vista.
  const listRef = useRef<ScrollView>(null);
  const frames = useRef(new Map<string, LayoutRectangle>());
  const listView = useRef({ offset: 0, height: 0 });
  const reveal = (id: string) => {
    const frame = frames.current.get(id);
    const { offset, height } = listView.current;
    if (!frame || !height) return;
    if (frame.y < offset) listRef.current?.scrollTo({ y: Math.max(0, frame.y - space.sm), animated: true });
    else if (frame.y + frame.height > offset + height) {
      listRef.current?.scrollTo({ y: frame.y + frame.height - height + space.sm, animated: true });
    }
  };

  // No navegador, na janela larga: ↓ ou j abre o próximo, ↑ ou k o anterior. A tecla pega o estado da última
  // pintura da tela (a função muda a cada uma, o ouvinte do documento fica o mesmo).
  const step = useRef<(direction: 1 | -1) => void>(() => undefined);
  useEffect(() => {
    step.current = (direction) => {
      if (!view) return;
      const next = nextFeedbackSelection(view.rows.map((row) => row.id), selected, direction);
      const item = next === null || next === selected ? undefined : items.find((entry) => entry.id === next);
      if (!item) return;
      open(item);
      reveal(item.id);
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
    if (list.fetchStatus === 'paused') {
      return (
        <Card style={styles.notice}>
          <Icon name="wifi-off" color="warning" />
          <Text variant="muted" style={styles.flex}>
            Sem internet. Os recados aparecem quando a conexão voltar.
          </Text>
        </Card>
      );
    }
    if (list.isError) return <ErrorNotice error={new Error(errorMessage(list.error))} onRetry={() => void list.refetch()} />;
    return <Loading />;
  }
  if (data === null || !view) {
    return <EmptyState icon="database-clock-outline" title="Ainda não disponível" message={FEEDBACK_INBOX_NOT_READY} />;
  }

  const detailOf = (item: FeedbackItem) => (
    <FeedbackDetailView key={item.id} item={item} busy={busy} onWrite={(change) => write({ ...change, id: item.id })} />
  );
  const itemOf = (id: string) => items.find((item) => item.id === id);

  const rows = view.empty ? (
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
          <View key={row.id} onLayout={(event) => frames.current.set(row.id, event.nativeEvent.layout)}>
            {divider}
            <FeedbackRowView row={row} selected={row.id === selected} onPress={() => open(item)} />
          </View>
        );
      }
      // No celular, o toque abre o recado embaixo da linha; outro toque fecha.
      const expanded = row.id === selected;
      return (
        <View key={row.id}>
          {divider}
          <FeedbackRowView row={row} expanded={expanded} onPress={() => (expanded ? setSelected(null) : open(item))} />
          {expanded ? <View style={styles.inline}>{detailOf(item)}</View> : null}
        </View>
      );
    })
  );

  return (
    <View style={[styles.inbox, masterDetail && styles.flex]}>
      <View style={styles.toolbar}>
        <View style={styles.chips}>
          {view.statusChips.map((chip) => (
            <Chip
              key={chip.key}
              label={chip.label}
              accessibilityLabel={chip.accessibilityLabel}
              selected={chip.key === status}
              onPress={() => chooseStatus(chip.key)}
            />
          ))}
        </View>
        <View style={styles.chips}>
          {view.kindChips.map((chip) => (
            <Chip
              key={chip.key}
              label={chip.label}
              accessibilityLabel={chip.accessibilityLabel}
              selected={chip.key === kind}
              onPress={() => setKind(chip.key)}
            />
          ))}
        </View>
        <View style={styles.searchRow}>
          <View style={styles.flex}>
            <TextField
              value={query}
              onChangeText={setQuery}
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
        <Text variant="small">
          {view.countLabel}
          {view.cutNote ? ` · ${view.cutNote}` : ''}
        </Text>
      </View>

      {list.isError ? <StaleNotice onRetry={() => void list.refetch()} /> : null}

      {masterDetail ? (
        <View style={styles.panes}>
          <View style={[styles.pane, styles.listPane, glass, list.isPlaceholderData && styles.waiting]}>
            <ScrollView
              ref={listRef}
              contentContainerStyle={styles.listContent}
              scrollEventThrottle={32}
              onScroll={(event) => {
                listView.current.offset = event.nativeEvent.contentOffset.y;
              }}
              onLayout={(event) => {
                listView.current.height = event.nativeEvent.layout.height;
              }}>
              {rows}
            </ScrollView>
          </View>
          <View style={[styles.pane, styles.flex, glass]}>
            {opened ? (
              <ScrollView key={opened.id} contentContainerStyle={styles.detailContent}>
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
        <View style={[styles.pane, glass, styles.listContent, list.isPlaceholderData && styles.waiting]}>{rows}</View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  inbox: { gap: space.lg },
  notice: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  toolbar: { gap: space.md },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  // As duas partes enchem a altura que sobra embaixo dos filtros, cada uma com a sua rolagem.
  panes: { flex: 1, flexDirection: 'row', gap: space.lg },
  pane: { borderRadius: radius.lg, borderCurve: 'continuous', overflow: 'hidden' },
  listPane: { width: PANEL_LIST_WIDTH },
  listContent: { padding: space.sm },
  detailContent: { padding: space.xl },
  // A lista do filtro anterior, enquanto a do novo não chega.
  waiting: { opacity: 0.6 },
  divider: { height: 1, marginHorizontal: space.md },
  inline: { paddingHorizontal: space.md, paddingBottom: space.lg },
  empty: { padding: space.lg },
});
