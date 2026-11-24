import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { useFreezePantryItems, useFreezer, useThawPantryItems } from '@/data/freezer';
import { useConsumePantryItems, usePantry, useTakeOneFromPantry } from '@/data/home';
import { useAddToPantryList, useProducts, useShoppingLists } from '@/data/market';
import { deviceDayError, formatShortDate, todayISO } from '@/domain/dates';
import {
  FREEZER_DAY_PURPOSE,
  FREEZER_SECTION,
  freezeChoices,
  freezeKindOf,
  freezeNotice,
  frozenSheetText,
  hasFreezerFields,
  THAW_ACTION,
  thawedFormLine,
  thawedSuffix,
  thawNotice,
  type FreezeKind,
} from '@/domain/freezer';
import { genericItem } from '@/domain/genericItem';
import { describeLots, expiryBadge, expiryStatus, groupPantry, takeOne, type ExpiryStatus, type PantryGroup } from '@/domain/pantry';
import { listsFor, newListKind } from '@/domain/pantryList';
import { formatQuantity } from '@/domain/money';
import { errorMessage } from '@/lib/supabase';
import type { PantryItem } from '@/lib/types';
import { ActionSheet, type SheetAction } from '@/ui/ActionSheet';
import { notify } from '@/ui/dialogs';
import {
  Badge,
  Button,
  CategoryIcon,
  EmptyState,
  ErrorNotice,
  ListCard,
  ListRow,
  Loading,
  Section,
  type Tone,
} from '@/ui/primitives';
import { space } from '@/ui/theme';

// Na ordem da tela. O que está no congelador fica numa seção só, qualquer que seja a validade (também a que já
// tinha passado quando foi congelado): é o lugar dele, e o selo diz a validade.
type SectionKind = ExpiryStatus['kind'] | 'congelado';
const SECTIONS: { kind: SectionKind; title: string }[] = [
  { kind: 'vencido', title: 'Vencidos' },
  { kind: 'vence_logo', title: 'Vencem em breve' },
  { kind: 'ok', title: 'Em dia' },
  { kind: 'congelado', title: FREEZER_SECTION },
  { kind: 'sem_validade', title: 'Sem validade' },
];

/** A cor do selo da validade certa; a estimada é neutra (expiryBadge). */
const STATUS_TONE: Record<ExpiryStatus['kind'], Tone> = { vencido: 'danger', vence_logo: 'warning', ok: 'primary', sem_validade: 'neutral' };

type Group = PantryGroup<PantryItem>;

/** "2 un", "0,75 kg e 2 un". */
const describeTotals = (group: Group) => group.totals.map((t) => formatQuantity(t.quantity, t.unit)).join(' e ');

/** O subtítulo da linha: quanto há, quantas compras e, na compra que decide a validade, quando saiu do congelador. */
function rowSubtitle(group: Group, today: string): string {
  const base = group.lots.length > 1 ? `${describeTotals(group)} · ${group.lots.length} compras` : describeTotals(group);
  return group.thawedOn ? `${base}${thawedSuffix(group.thawedOn, today)}` : base;
}

/** O texto do menu do grupo: as compras, a descongelada e, no congelador, o que descongelar hoje faria. */
function sheetMessage(group: Group, today: string): string | undefined {
  const parts: string[] = [];
  if (group.lots.length > 1) parts.push(describeLots(group, today));
  else if (group.lots[0]?.thawed_on) parts.push(thawedFormLine(group.lots[0].thawed_on, today));
  if (group.frozen) parts.push(frozenSheetText(group.lots, today));
  return parts.join(' ') || undefined;
}

/**
 * A ação principal de Compras → Despensa, no alto da parte (antes de "Gás, água e ração"): um botão primário, como
 * o de cada parte. Fica na tela também com a despensa carregando ou com erro.
 */
export function PantryAddButton() {
  return (
    <Button title="Adicionar à despensa" icon="plus" onPress={() => router.push({ pathname: '/despensa/[id]', params: { id: 'novo' } })} />
  );
}

export function PantryPanel() {
  const today = todayISO();
  const pantry = usePantry();
  const products = useProducts();
  const consume = useConsumePantryItems();
  const takeOneFrom = useTakeOneFromPantry();
  const lists = useShoppingLists();
  const addToList = useAddToPantryList();
  const freezer = useFreezer();
  const freeze = useFreezePantryItems();
  const thaw = useThawPantryItems();
  const [selected, setSelected] = useState<Group | null>(null);
  // "Escolher a lista": o segundo menu, com as listas abertas em que o item cabe. `consume`: "Acabou" (dá baixa)
  // ou "Está acabando" (o item continua na despensa).
  const [picking, setPicking] = useState<{ group: Group; consume: boolean } | null>(null);
  const onError = (err: unknown) => notify('Erro', errorMessage(err));
  const choicesFor = (group: Group) => listsFor(group.category, lists.data ?? []);

  // Primeiro a lista, depois a baixa: se a baixa falhar, o item continua na
  // despensa e repetir não duplica (a lista ignora item já pendente).
  // Sem `listId`, a lista é a que o menu mostrou como a última (`shownListId`), se ainda está aberta; senão, a mais
  // nova em que o item cabe, conferida no servidor na hora.
  // O item vai sem a marca ("Leite desnatado", e não o "Leite IL Desnatado" do produto), com o produto como dica de
  // preço, como na lista e na tela do produto: a marca se escolhe na hora, ou em "Marca preferida" (domain/genericItem).
  // "Está acabando" (`consume` falso) põe na lista do mesmo jeito, sem a baixa: o que sobrou continua na despensa.
  async function putOnList(group: Group, consumeLots: boolean, listId?: string, shownListId?: string) {
    const newest = group.lots[group.lots.length - 1];
    const itemName = genericItem(group.name, group.category).name;
    try {
      const list = await addToList.mutateAsync({
        name: itemName,
        category: group.category,
        productId: group.productId,
        quantity: newest.quantity,
        unit: newest.unit,
        listId,
        shownListId,
      });
      if (consumeLots) await consume.mutateAsync(group.lots.map((lot) => lot.id));
      const stays = consumeLots ? '' : ' Continua na despensa até acabar.';
      notify(
        list.added ? 'Adicionado à lista' : 'Já estava na lista',
        list.added ? `${itemName} foi para "${list.name}".${stays}` : `${itemName} já estava pendente em "${list.name}".${stays}`,
      );
    } catch (err) {
      onError(err);
    }
  }

  /** "Congelar": as compras do grupo, no dia escolhido (o banco não congela antes da compra). */
  async function freezeGroup(group: Group, kind: FreezeKind, frozenOn: string) {
    const clock = deviceDayError(today, FREEZER_DAY_PURPOSE);
    if (clock) return notify(clock.title, clock.message);
    const ids = group.lots.map((lot) => lot.id);
    try {
      const notice = freezeNotice(group.name, ids.length, await freeze.mutateAsync({ ids, kind, frozenOn }), today);
      notify(notice.title, notice.message);
    } catch (err) {
      onError(err);
    }
  }

  /** "Descongelei": o grupo inteiro sai do congelador hoje. */
  async function thawGroup(group: Group) {
    const clock = deviceDayError(today, FREEZER_DAY_PURPOSE);
    if (clock) return notify(clock.title, clock.message);
    const ids = group.lots.map((lot) => lot.id);
    try {
      const notice = thawNotice(group.name, ids.length, await thaw.mutateAsync({ ids, thawedOn: today }), today);
      notify(notice.title, notice.message);
    } catch (err) {
      onError(err);
    }
  }

  /**
   * As ações do congelador no menu. No congelador: "Descongelei", sempre (a linha só está aqui depois da migração).
   * Fora dele: congelar, só com o congelador no banco, um tipo que vai ao congelador e compras que trazem as colunas
   * dele (a cópia guardada de antes desta versão, não: congelaria o que talvez já esteja no congelador).
   */
  function freezerActions(group: Group): SheetAction[] {
    if (group.frozen) return [{ label: THAW_ACTION, icon: 'snowflake-off', onPress: () => void thawGroup(group) }];
    if (freezer.available !== true || !group.lots.every(hasFreezerFields)) return [];
    const newest = group.lots[group.lots.length - 1];
    const kind = freezeKindOf([group.name, newest.name], group.category, newest.unit);
    if (!kind) return [];
    return freezeChoices(group.lots, today).map((choice) => ({
      label: choice.label,
      icon: 'snowflake' as const,
      onPress: () => void freezeGroup(group, kind, choice.frozenOn),
    }));
  }

  function groupActions(group: Group): SheetAction[] {
    const ids = group.lots.map((lot) => lot.id);
    const take = takeOne(group.lots);
    const oldest = group.lots[0];
    const several = group.lots.length > 1;
    const choices = choicesFor(group);
    const newestList = choices[0];
    const target = newestList
      ? `pôr na última lista (“${newestList.name}”)`
      : `pôr na lista ${newListKind(group.category) === 'farmacia' ? 'da farmácia' : 'de mercado'}`;
    const actions: SheetAction[] = [];
    // "Acabou" dá baixa; "Está acabando" só põe na lista, e o item continua na despensa até acabar.
    for (const [when, consumeLots, icon] of [
      ['Acabou', true, 'cart-plus'],
      ['Está acabando', false, 'cart-arrow-down'],
    ] as const) {
      actions.push({ label: `${when} — ${target}`, icon, onPress: () => putOnList(group, consumeLots, undefined, newestList?.id) });
      if (choices.length > 1) {
        actions.push({
          label: `${when} — escolher a lista`,
          icon: 'format-list-bulleted',
          onPress: () => setPicking({ group, consume: consumeLots }),
        });
      }
    }
    if (take) {
      const units = group.totals.find((t) => t.unit === 'un')?.quantity ?? 0;
      const left = Math.round((units - 1) * 1000) / 1000;
      actions.push({
        label:
          oldest.unit === 'un'
            ? `Usei 1 (${left === 1 ? 'fica' : 'ficam'} ${formatQuantity(left, 'un')})`
            : `Acabou a compra de ${formatShortDate(oldest.purchased_on)}`,
        icon: 'minus-circle-outline',
        onPress: () => takeOneFrom.mutate(take, { onError }),
      });
    }
    actions.push(...freezerActions(group));
    actions.push({
      label: several ? 'Consumido / descartado (tudo)' : 'Consumido / descartado',
      icon: 'check',
      onPress: () => consume.mutate(ids, { onError }),
    });
    // Item ligado a um produto: a tela dele tem o histórico de preço.
    const { productId } = group;
    if (productId) {
      actions.push({
        label: 'Ver preços',
        icon: 'chart-line',
        onPress: () => router.push({ pathname: '/produto/[id]', params: { id: productId } }),
      });
    }
    // Uma por compra, da mais nova para a mais antiga; duas no mesmo dia e com a
    // mesma quantidade ganham um número para não confundir.
    const lots = several ? [...group.lots].reverse() : group.lots;
    const labels = lots.map((lot) =>
      several
        ? `Editar a compra de ${formatShortDate(lot.purchased_on)} (${formatQuantity(lot.quantity, lot.unit)})`
        : 'Editar validade e quantidade',
    );
    lots.forEach((lot, index) => {
      const same = labels.filter((label) => label === labels[index]).length;
      const nth = labels.slice(0, index + 1).filter((label) => label === labels[index]).length;
      actions.push({
        label: same > 1 ? `${labels[index]} · ${nth}ª` : labels[index],
        icon: 'pencil-outline',
        onPress: () => router.push({ pathname: '/despensa/[id]', params: { id: lot.id } }),
      });
    });
    return actions;
  }

  if (pantry.isPending) return <Loading />;
  if (pantry.isError) return <ErrorNotice error={pantry.error} onRetry={() => pantry.refetch()} />;

  const productNames = new Map((products.data ?? []).map((p) => [p.id, p.name]));
  const withStatus = groupPantry(pantry.data, productNames).map((group) => {
    const status = expiryStatus(group.expiresOn, today);
    return { group, status, section: (group.frozen ? 'congelado' : status.kind) as SectionKind };
  });

  return (
    <View style={styles.gap}>
      {pantry.data.length === 0 ? (
        <EmptyState
          icon="fridge-outline"
          title="Despensa vazia"
          message="Ao confirmar uma nota fiscal, os alimentos entram aqui com validade estimada automaticamente."
        />
      ) : (
        SECTIONS.map((section) => {
          const rows = withStatus.filter((r) => r.section === section.kind);
          if (!rows.length) return null;
          return (
            <Section key={section.kind} title={`${section.title} (${rows.length})`}>
              <ListCard>
                {rows.map(({ group, status }) => {
                  const subtitle = rowSubtitle(group, today);
                  // A validade estimada (pela categoria, pelo congelador, depois de descongelar) é neutra, com "~";
                  // a vermelha e a laranja ficam para a que alguém digitou ou o produto aprendeu.
                  const badge = expiryBadge(status, group.expiryEstimated);
                  return (
                    <ListRow
                      key={group.key}
                      left={<CategoryIcon category={group.category} name={group.name} />}
                      title={group.name}
                      subtitle={subtitle}
                      right={badge ? <Badge label={badge.label} tone={badge.estimated ? 'neutral' : STATUS_TONE[status.kind]} /> : null}
                      accessibilityLabel={badge ? `${group.name}, ${subtitle}, ${badge.accessibilityLabel}` : undefined}
                      onPress={() => {
                        // O menu diz qual é a última lista: confere as listas de novo enquanto ele abre.
                        lists.refetch?.();
                        setSelected(group);
                      }}
                    />
                  );
                })}
              </ListCard>
            </Section>
          );
        })
      )}
      <ActionSheet
        visible={Boolean(selected)}
        onClose={() => setSelected(null)}
        title={selected?.name}
        message={selected ? sheetMessage(selected, today) : undefined}
        actions={selected ? groupActions(selected) : []}
      />
      <ActionSheet
        visible={Boolean(picking)}
        onClose={() => setPicking(null)}
        title={picking ? `${picking.group.name}: para qual lista?` : undefined}
        message={picking && !picking.consume ? 'O item continua na despensa até acabar.' : undefined}
        actions={
          picking
            ? choicesFor(picking.group).map((list, index) => ({
                label: index === 0 ? `${list.name} (a mais nova)` : list.name,
                icon: 'cart-plus',
                onPress: () => putOnList(picking.group, picking.consume, list.id),
              }))
            : []
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  gap: { gap: space.lg },
});
