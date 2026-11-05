import { router } from 'expo-router';
import { useState, type ReactNode } from 'react';

import { useConsumePantryItems, useTakeOneFromPantry } from '@/data/home';
import { useAddToPantryList, useShoppingLists } from '@/data/market';
import { formatShortDate, todayISO } from '@/domain/dates';
import { genericItem } from '@/domain/genericItem';
import { formatQuantity } from '@/domain/money';
import { describePantryLots, pantryEditActions, takeOne, type PantryFocus, type PantryGroup } from '@/domain/pantry';
import { listsFor, newListKind } from '@/domain/pantryList';
import { errorMessage } from '@/lib/supabase';
import type { PantryItem } from '@/lib/types';
import { ActionSheet, type SheetAction } from '@/ui/ActionSheet';
import { notify } from '@/ui/dialogs';

type Group = PantryGroup<PantryItem>;

/**
 * O menu de um produto da despensa ("Acabou", "Está acabando", "Usei 1", "Consumido / descartado", "Ver preços",
 * "Editar…"), um só para a aba Casa → Despensa e para a seção Despensa da tela Hoje (onde cada linha é uma compra e
 * abre o menu do produto dela, domain/pantry pantryGroupOf). `open(group)` abre; `element` precisa ser renderizado
 * pela tela, que deve ficar montada (os avisos de erro de "Usei 1" e da baixa só chegam à tela que fez o pedido).
 * `focusLotId`: a compra tocada (a tela Hoje), que o menu nomeia pela validade e põe primeiro entre as de editar.
 */
export function usePantryMenu(): { open: (group: Group, focusLotId?: string) => void; element: ReactNode } {
  const consume = useConsumePantryItems();
  const takeOneFrom = useTakeOneFromPantry();
  const lists = useShoppingLists();
  const addToList = useAddToPantryList();
  const [selected, setSelected] = useState<{ group: Group; focus: PantryFocus | null } | null>(null);
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

  function groupActions(group: Group, focus: PantryFocus | null): SheetAction[] {
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
    // Uma por compra, da mais nova para a mais antiga (a tocada na tela Hoje primeiro), domain/pantry pantryEditActions.
    for (const { lot, label } of pantryEditActions(group.lots, focus)) {
      actions.push({
        label,
        icon: 'pencil-outline',
        onPress: () => router.push({ pathname: '/despensa/[id]', params: { id: lot.id } }),
      });
    }
    return actions;
  }

  const open = (group: Group, focusLotId?: string) => {
    // O menu diz qual é a última lista: confere as listas de novo enquanto ele abre.
    lists.refetch?.();
    setSelected({ group, focus: focusLotId ? { lotId: focusLotId, today: todayISO() } : null });
  };

  const element = (
    <>
      <ActionSheet
        visible={Boolean(selected)}
        onClose={() => setSelected(null)}
        title={selected?.group.name}
        message={selected && selected.group.lots.length > 1 ? describePantryLots(selected.group.lots, selected.focus) : undefined}
        actions={selected ? groupActions(selected.group, selected.focus) : []}
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
    </>
  );

  return { open, element };
}
