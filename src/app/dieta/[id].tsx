import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { useDeleteDietPlan, useDietPlan, usePeople, useUpdateDietPlan } from '@/data/health';
import { useAddItemsToList, usePendingItemNames, useShoppingLists } from '@/data/market';
import { formatBRDate, formatShortDate, parseBRDate } from '@/domain/dates';
import { dietProblem, dietShoppingSelection, type DietMeal, type DietShoppingItem } from '@/domain/health';
import { parseTimes } from '@/domain/medications';
import { guessCategory, normalizeSearch } from '@/domain/search';
import { FieldsModal, orNull } from '@/features/health/FieldsModal';
import { PhotoStrip } from '@/features/PhotoStrip';
import { errorMessage } from '@/lib/supabase';
import type { DietPlan } from '@/lib/types';
import { confirmAction, notify } from '@/ui/dialogs';
import {
  Badge,
  Button,
  Card,
  CategoryIcon,
  CheckCircle,
  Chip,
  ErrorNotice,
  IconButton,
  ListCard,
  ListRow,
  Loading,
  Row,
  Screen,
  Section,
  Text,
} from '@/ui/primitives';
import { space } from '@/ui/theme';

type Editing =
  | { kind: 'info' }
  | { kind: 'meal'; index: number | null }
  | { kind: 'option'; meal: number; index: number | null }
  | { kind: 'item'; meal: number; option: number; index: number | null }
  | { kind: 'guideline'; index: number | null }
  | { kind: 'shopping'; index: number | null };

export default function DietPlanScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const plan = useDietPlan(id);
  if (plan.isPending) return <Loading />;
  if (plan.isError) return <ErrorNotice error={plan.error} onRetry={() => plan.refetch()} />;
  return <DietPlanView plan={plan.data} />;
}

function DietPlanView({ plan }: { plan: DietPlan }) {
  const people = usePeople();
  const update = useUpdateDietPlan(plan.id);
  const remove = useDeleteDietPlan();
  const [editing, setEditing] = useState<Editing | null>(null);
  const onError = (err: unknown) => notify('Erro', errorMessage(err));
  const meals = plan.meals;
  const personName = people.data?.find((p) => p.id === plan.person_id)?.name;
  const close = () => setEditing(null);
  const saveMeals = (next: DietMeal[]) => update.mutate({ meals: next }, { onSuccess: close, onError });
  const mapMeal = (index: number, fn: (meal: DietMeal) => DietMeal) => meals.map((m, i) => (i === index ? fn(m) : m));

  function activate() {
    const problem = dietProblem(meals);
    if (problem) {
      notify('Falta pouco', problem);
      return;
    }
    update.mutate({ status: 'active' }, { onError });
  }

  const meal = editing && 'meal' in editing ? meals[editing.meal] : null;
  const editingMeal = editing?.kind === 'meal' && editing.index != null ? meals[editing.index] : null;
  const editingOption = editing?.kind === 'option' && editing.index != null ? meal!.options[editing.index] : null;
  const editingItem =
    editing?.kind === 'item' && editing.index != null ? meal!.options[editing.option].items[editing.index] : null;

  return (
    <Screen edges={[]}>
      <Stack.Screen options={{ title: 'Plano alimentar' }} />

      <Card style={styles.gapSm}>
        <Row>
          <View style={styles.flex}>
            <Text variant="heading">{plan.title}</Text>
            <Text variant="muted">
              {[personName, plan.professional, plan.valid_until ? `até ${formatShortDate(plan.valid_until)}` : null]
                .filter(Boolean)
                .join(' · ')}
            </Text>
          </View>
          <IconButton icon="pencil-outline" label="Editar dados do plano" onPress={() => setEditing({ kind: 'info' })} />
        </Row>
        {plan.notes ? <Text variant="body">{plan.notes}</Text> : null}
        {plan.status === 'draft' ? (
          <>
            <Badge label="Rascunho" tone="info" />
            <Text variant="muted">Confira as refeições e a lista de compras: toque em qualquer item para corrigir.</Text>
            <Button title="Ativar plano" icon="check" onPress={activate} loading={update.isPending} />
          </>
        ) : null}
      </Card>

      {plan.file_paths.length ? <PhotoStrip bucket="health" paths={plan.file_paths} /> : null}

      {meals.map((m, mealIndex) => (
        <Section
          key={`${mealIndex}-${m.name}`}
          title={[m.time, m.name].filter(Boolean).join(' · ')}
          action={<IconButton icon="pencil-outline" label={`Editar ${m.name}`} onPress={() => setEditing({ kind: 'meal', index: mealIndex })} />}>
          {m.options.map((option, optionIndex) => (
            <View key={optionIndex} style={styles.gapSm}>
              {m.options.length > 1 || option.label ? (
                <Row>
                  <Text variant="label" style={styles.flex}>
                    {option.label ?? `Opção ${optionIndex + 1}`}
                  </Text>
                  <IconButton
                    icon="pencil-outline"
                    label="Editar opção"
                    onPress={() => setEditing({ kind: 'option', meal: mealIndex, index: optionIndex })}
                  />
                </Row>
              ) : null}
              <ListCard>
                {option.items.map((item, itemIndex) => (
                  <ListRow
                    key={`${itemIndex}-${item.food}`}
                    title={item.food}
                    subtitle={[item.quantity, item.notes].filter(Boolean).join(' · ') || undefined}
                    onPress={() => setEditing({ kind: 'item', meal: mealIndex, option: optionIndex, index: itemIndex })}
                  />
                ))}
                <Button
                  title="Alimento"
                  icon="plus"
                  variant="ghost"
                  compact
                  onPress={() => setEditing({ kind: 'item', meal: mealIndex, option: optionIndex, index: null })}
                />
              </ListCard>
            </View>
          ))}
          <Button
            title={m.options.length ? 'Outra opção' : 'Alimento'}
            icon="plus"
            variant="ghost"
            compact
            onPress={() =>
              m.options.length
                ? setEditing({ kind: 'option', meal: mealIndex, index: null })
                : saveMeals(mapMeal(mealIndex, (x) => ({ ...x, options: [{ label: null, items: [] }] })))
            }
          />
        </Section>
      ))}
      <Button title="Adicionar refeição" icon="plus" variant="secondary" onPress={() => setEditing({ kind: 'meal', index: null })} />

      <Section
        title="Orientações"
        action={<Button title="Orientação" icon="plus" variant="ghost" compact onPress={() => setEditing({ kind: 'guideline', index: null })} />}>
        {plan.guidelines.length ? (
          <ListCard>
            {plan.guidelines.map((g, index) => (
              <ListRow key={`${index}-${g}`} title={g} onPress={() => setEditing({ kind: 'guideline', index })} />
            ))}
          </ListCard>
        ) : (
          <Text variant="muted">Nenhuma orientação.</Text>
        )}
      </Section>

      <ShoppingSection plan={plan} onEdit={(index) => setEditing({ kind: 'shopping', index })} />

      <Row>
        {plan.status === 'active' ? (
          <Button
            title="Arquivar"
            variant="secondary"
            icon="archive-outline"
            style={styles.flex}
            onPress={() =>
              confirmAction(
                'Arquivar plano',
                'O plano sai da lista de dietas em uso.',
                'Arquivar',
                () => update.mutate({ status: 'archived' }, { onSuccess: () => router.back(), onError }),
                false,
              )
            }
          />
        ) : null}
        <Button
          title="Apagar"
          variant="danger"
          icon="trash-can-outline"
          style={styles.flex}
          onPress={() =>
            confirmAction('Apagar plano', `Apagar ${plan.title} e as fotos?`, 'Apagar', () =>
              remove.mutate(plan, { onSuccess: () => router.back(), onError }),
            )
          }
        />
      </Row>

      {editing?.kind === 'info' ? (
        <FieldsModal<'title' | 'professional' | 'valid_until' | 'notes'>
          title="Dados do plano"
          initial={{
            title: plan.title,
            professional: plan.professional,
            valid_until: plan.valid_until ? formatBRDate(plan.valid_until) : '',
            notes: plan.notes,
          }}
          fields={[
            { key: 'title', label: 'Nome', required: true },
            { key: 'professional', label: 'Nutricionista', placeholder: 'Nome e CRN' },
            { key: 'valid_until', label: 'Retorno', placeholder: 'dd/mm/aaaa', keyboardType: 'numbers-and-punctuation' },
            { key: 'notes', label: 'Observações', multiline: true },
          ]}
          onClose={close}
          onSave={(values) => {
            const validUntil = values.valid_until.trim() ? parseBRDate(values.valid_until) : null;
            if (values.valid_until.trim() && !validUntil) {
              notify('Data inválida', 'Use dd/mm/aaaa.');
              return;
            }
            update.mutate(
              { title: values.title.trim(), professional: orNull(values.professional), valid_until: validUntil, notes: orNull(values.notes) },
              { onSuccess: close, onError },
            );
          }}
        />
      ) : null}

      {editing?.kind === 'meal' ? (
        <FieldsModal<'name' | 'time'>
          title={editingMeal ? 'Editar refeição' : 'Nova refeição'}
          initial={editingMeal ?? {}}
          fields={[
            { key: 'name', label: 'Refeição', placeholder: 'Ex.: Café da manhã', required: true },
            { key: 'time', label: 'Horário', placeholder: 'Ex.: 07:30', keyboardType: 'numbers-and-punctuation' },
          ]}
          onClose={close}
          onSave={(values) => {
            const time = values.time.trim() ? parseTimes(values.time) : [];
            if (!time || time.length > 1) {
              notify('Horário inválido', 'Use um horário como 07:30.');
              return;
            }
            const next: DietMeal = {
              name: values.name.trim(),
              time: time[0] ?? null,
              options: editingMeal?.options ?? [{ label: null, items: [] }],
            };
            saveMeals(editing.index == null ? [...meals, next] : mapMeal(editing.index, () => next));
          }}
          onDelete={
            editing.index != null
              ? () =>
                  confirmAction('Remover refeição', `Remover ${editingMeal?.name}?`, 'Remover', () =>
                    saveMeals(meals.filter((_, i) => i !== editing.index)),
                  )
              : undefined
          }
        />
      ) : null}

      {editing?.kind === 'option' ? (
        <FieldsModal<'label'>
          title={editingOption ? 'Editar opção' : 'Nova opção'}
          initial={{ label: editingOption?.label ?? (editingOption ? '' : `Opção ${meal!.options.length + 1}`) }}
          fields={[{ key: 'label', label: 'Nome da opção', placeholder: 'Ex.: Opção 2' }]}
          onClose={close}
          onSave={({ label }) =>
            saveMeals(
              mapMeal(editing.meal, (m) => ({
                ...m,
                options:
                  editing.index == null
                    ? [...m.options, { label: orNull(label), items: [] }]
                    : m.options.map((o, i) => (i === editing.index ? { ...o, label: orNull(label) } : o)),
              })),
            )
          }
          onDelete={
            editing.index != null
              ? () =>
                  confirmAction('Remover opção', 'Remover esta opção e seus alimentos?', 'Remover', () =>
                    saveMeals(mapMeal(editing.meal, (m) => ({ ...m, options: m.options.filter((_, i) => i !== editing.index) }))),
                  )
              : undefined
          }
        />
      ) : null}

      {editing?.kind === 'item' ? (
        <FieldsModal<'food' | 'quantity' | 'notes'>
          title={editingItem ? 'Editar alimento' : 'Novo alimento'}
          initial={editingItem ?? {}}
          fields={[
            { key: 'food', label: 'Alimento', placeholder: 'Ex.: Pão integral', required: true },
            { key: 'quantity', label: 'Quantidade', placeholder: 'Ex.: 2 fatias, 100 g' },
            { key: 'notes', label: 'Observações', placeholder: 'Ex.: sem açúcar' },
          ]}
          onClose={close}
          onSave={(values) => {
            const item = { food: values.food.trim(), quantity: orNull(values.quantity), notes: orNull(values.notes) };
            saveMeals(
              mapMeal(editing.meal, (m) => ({
                ...m,
                options: m.options.map((o, i) =>
                  i !== editing.option
                    ? o
                    : {
                        ...o,
                        items: editing.index == null ? [...o.items, item] : o.items.map((x, j) => (j === editing.index ? item : x)),
                      },
                ),
              })),
            );
          }}
          onDelete={
            editing.index != null
              ? () =>
                  saveMeals(
                    mapMeal(editing.meal, (m) => ({
                      ...m,
                      options: m.options.map((o, i) =>
                        i !== editing.option ? o : { ...o, items: o.items.filter((_, j) => j !== editing.index) },
                      ),
                    })),
                  )
              : undefined
          }
        />
      ) : null}

      {editing?.kind === 'guideline' ? (
        <FieldsModal<'text'>
          title={editing.index != null ? 'Editar orientação' : 'Nova orientação'}
          initial={{ text: editing.index != null ? plan.guidelines[editing.index] : '' }}
          fields={[{ key: 'text', label: 'Orientação', placeholder: 'Ex.: Beber 2 L de água por dia', multiline: true, required: true }]}
          onClose={close}
          onSave={({ text }) => {
            const next =
              editing.index == null
                ? [...plan.guidelines, text.trim()]
                : plan.guidelines.map((g, i) => (i === editing.index ? text.trim() : g));
            update.mutate({ guidelines: next }, { onSuccess: close, onError });
          }}
          onDelete={
            editing.index != null
              ? () =>
                  update.mutate(
                    { guidelines: plan.guidelines.filter((_, i) => i !== editing.index) },
                    { onSuccess: close, onError },
                  )
              : undefined
          }
        />
      ) : null}

      {editing?.kind === 'shopping' ? (
        <FieldsModal<'name'>
          title={editing.index != null ? 'Editar item de compra' : 'Novo item de compra'}
          initial={{ name: editing.index != null ? plan.shopping_items[editing.index].name : '' }}
          fields={[{ key: 'name', label: 'Item', placeholder: 'Ex.: Aveia em flocos', required: true }]}
          onClose={close}
          onSave={({ name }) => {
            const item: DietShoppingItem = {
              name: name.trim(),
              category:
                editing.index != null && normalizeSearch(plan.shopping_items[editing.index].name) === normalizeSearch(name)
                  ? plan.shopping_items[editing.index].category
                  : guessCategory(name),
            };
            const next =
              editing.index == null
                ? [...plan.shopping_items, item]
                : plan.shopping_items.map((s, i) => (i === editing.index ? item : s));
            update.mutate({ shopping_items: next }, { onSuccess: close, onError });
          }}
          onDelete={
            editing.index != null
              ? () =>
                  update.mutate(
                    { shopping_items: plan.shopping_items.filter((_, i) => i !== editing.index) },
                    { onSuccess: close, onError },
                  )
              : undefined
          }
        />
      ) : null}
    </Screen>
  );
}

/** Itens da dieta -> lista de compras escolhida, sem repetir o que já está nela. */
function ShoppingSection({ plan, onEdit }: { plan: DietPlan; onEdit: (index: number | null) => void }) {
  const lists = useShoppingLists();
  const add = useAddItemsToList();
  const openLists = (lists.data ?? []).filter((l) => l.kind !== 'outros');
  const defaultList = openLists.find((l) => l.kind === 'mercado') ?? openLists[0];
  // null = criar lista nova; undefined = ainda não escolhida (usa a padrão).
  const [chosen, setChosen] = useState<string | null | undefined>(undefined);
  const listId = chosen === undefined ? defaultList?.id : (chosen ?? undefined);
  const pending = usePendingItemNames(listId);
  const [unselected, setUnselected] = useState<Set<string>>(new Set());

  const items = dietShoppingSelection(plan.shopping_items, pending.data ?? []);
  const selected = items.filter((i) => !i.inList && !unselected.has(i.name));

  function addToList() {
    add.mutate(
      {
        listId,
        newListName: `Dieta — ${plan.title}`,
        items: selected.map((i) => ({ name: i.name, category: i.category, productId: null, quantity: 1, unit: 'un' })),
      },
      {
        onSuccess: ({ id }) => {
          setUnselected(new Set());
          router.push({ pathname: '/lista/[id]', params: { id } });
        },
        onError: (err) => notify('Erro', errorMessage(err)),
      },
    );
  }

  return (
    <Section
      title="Compras da dieta"
      action={<Button title="Item" icon="plus" variant="ghost" compact onPress={() => onEdit(null)} />}>
      {items.length === 0 ? (
        <Text variant="muted">Nenhum item. Adicione o que precisa comprar para seguir o plano.</Text>
      ) : (
        <>
          <Row style={styles.wrap}>
            {openLists.map((l) => (
              <Chip key={l.id} label={l.name} icon={l.kind === 'farmacia' ? 'pill' : 'cart-outline'} selected={listId === l.id} onPress={() => setChosen(l.id)} />
            ))}
            <Chip label="Nova lista" icon="plus" selected={!listId} onPress={() => setChosen(null)} />
          </Row>
          <ListCard>
            {items.map((item, index) => {
              const isSelected = !item.inList && !unselected.has(item.name);
              return (
                <ListRow
                  key={`${index}-${item.name}`}
                  left={<CategoryIcon category={item.category} size={32} />}
                  title={item.name}
                  subtitle={item.inList ? 'Já está na lista' : undefined}
                  dimmed={item.inList}
                  onPress={() => onEdit(index)}
                  right={
                    item.inList ? (
                      <Badge label="Na lista" tone="primary" />
                    ) : (
                      <CheckCircle
                        checked={isSelected}
                        label={`Comprar ${item.name}`}
                        onPress={() =>
                          setUnselected((prev) => {
                            const next = new Set(prev);
                            if (next.has(item.name)) next.delete(item.name);
                            else next.add(item.name);
                            return next;
                          })
                        }
                      />
                    )
                  }
                />
              );
            })}
          </ListCard>
          <Button
            title={selected.length ? `Adicionar ${selected.length} ${selected.length === 1 ? 'item' : 'itens'} à lista` : 'Tudo já está na lista'}
            icon="cart-plus"
            disabled={!selected.length}
            loading={add.isPending}
            onPress={addToList}
          />
        </>
      )}
    </Section>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  gapSm: { gap: space.sm },
  wrap: { flexWrap: 'wrap' },
});
