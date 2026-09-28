import { Stack } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { useAddToMarketList } from '@/data/market';
import { useApplyMenu, useMenu, useSaveMenuItem, useSuggestMenu, type MenuSuggestion } from '@/data/menu';
import { useNukeContext } from '@/data/nuke';
import { addDays, todayISO } from '@/domain/dates';
import { dayTitle, MEALS, menuLines, planningWeek, suggestionToItems, weekDays, weekLabel, type Meal } from '@/domain/menu';
import { formatQuantity } from '@/domain/money';
import { FieldsModal } from '@/features/health/FieldsModal';
import { errorMessage } from '@/lib/supabase';
import { notify } from '@/ui/dialogs';
import { NukeAvatar } from '@/ui/NukeArt';
import { NukeLive } from '@/ui/NukeLive';
import {
  Badge,
  Button,
  Card,
  ErrorNotice,
  Icon,
  IconButton,
  ListRow,
  Loading,
  Row,
  Screen,
  Text,
  TextField,
} from '@/ui/primitives';
import { space } from '@/ui/theme';

type Suggestion = MenuSuggestion & { weekStart: string; applied: boolean; listed: boolean };

/** Cardápio da semana: almoço e jantar de segunda a domingo, com sugestão do Nuke. */
export default function MenuScreen() {
  const today = todayISO();
  const [weekStart, setWeekStart] = useState(planningWeek(today));
  const days = weekDays(weekStart);
  const menu = useMenu(days[0], days[6]);
  const save = useSaveMenuItem();
  const apply = useApplyMenu();
  const suggest = useSuggestMenu();
  const addToList = useAddToMarketList();
  const nuke = useNukeContext(today);
  const [preferences, setPreferences] = useState('');
  const [suggestion, setSuggestion] = useState<Suggestion | null>(null);
  const [editing, setEditing] = useState<{ day: string; meal: Meal } | null>(null);
  const [listing, setListing] = useState(false);

  const onError = (err: unknown) => notify('Erro', errorMessage(err));
  const dishOf = (day: string, meal: Meal) => menu.data?.find((i) => i.day === day && i.meal === meal)?.dish ?? null;
  const shown = suggestion?.weekStart === weekStart ? suggestion : null;
  // Semana que já passou: só mostra o que foi feito, sem pedir sugestão ao Nuke.
  const past = days[6] < today;

  function askNuke() {
    if (nuke.status !== 'ready' || past) return;
    const current = menuLines(menu.data ?? []);
    const context = `${nuke.context}\nCARDÁPIO já definido nesta semana: ${current.length ? current.join('; ') : 'nada'}.`;
    suggest.mutate(
      { context, today, weekStart, preferences },
      {
        onSuccess: (result) => {
          // Dias que já passaram não entram.
          const days = result.days.filter((d) => d.date >= today);
          if (days.length) setSuggestion({ ...result, days, weekStart, applied: false, listed: false });
          else notify('O Nuke não montou a semana', 'Tente de novo, talvez contando o que a casa gosta de comer.');
        },
        onError: (err) => notify('Não deu para montar o cardápio', errorMessage(err)),
      },
    );
  }

  function applySuggestion() {
    if (!shown) return;
    apply.mutate(suggestionToItems(shown.days, today), {
      onSuccess: () => setSuggestion({ ...shown, applied: true }),
      onError,
    });
  }

  async function listShopping() {
    if (!shown) return;
    setListing(true);
    try {
      let added = 0;
      let listName = 'Mercado';
      for (const item of shown.shopping) {
        const result = await addToList.mutateAsync({ ...item, productId: null });
        listName = result.name;
        if (result.added) added += 1;
      }
      setSuggestion({ ...shown, listed: true });
      notify('Na lista', `${added} ${added === 1 ? 'item foi' : 'itens foram'} para "${listName}"${added < shown.shopping.length ? '; o resto já estava lá' : ''}.`);
    } catch (err) {
      onError(err);
    } finally {
      setListing(false);
    }
  }

  const editingDish = editing ? dishOf(editing.day, editing.meal) : null;

  return (
    <Screen edges={[]}>
      <Stack.Screen options={{ title: 'Cardápio da semana' }} />

      <Row style={styles.weekNav}>
        <IconButton icon="chevron-left" label="Semana anterior" onPress={() => setWeekStart(addDays(weekStart, -7))} />
        <Text variant="label" style={styles.weekTitle}>
          {weekLabel(weekStart)}
        </Text>
        <IconButton icon="chevron-right" label="Próxima semana" onPress={() => setWeekStart(addDays(weekStart, 7))} />
      </Row>

      {past ? null : (
        <Card style={styles.gap}>
          <Row>
            {suggest.isPending ? <NukeLive size={48} state="think" /> : <NukeAvatar size={48} mood="joy" />}
            <View style={styles.flex}>
              <Text variant="heading">Monto a semana para vocês?</Text>
              <Text variant="small">Uso primeiro o que tem na despensa e o que vence logo, e digo o que falta comprar.</Text>
            </View>
          </Row>
          <TextField
            value={preferences}
            onChangeText={setPreferences}
            placeholder="Ex.: sem carne vermelha, jantar leve, marmita para o trabalho"
            accessibilityLabel="Preferências para o cardápio"
          />
          <Button
            title={suggest.isPending ? 'Montando a semana…' : nuke.status === 'ready' ? 'Montar com o Nuke' : 'Carregando a casa…'}
            icon="silverware-fork-knife"
            onPress={askNuke}
            loading={suggest.isPending}
            disabled={nuke.status !== 'ready'}
          />
          {nuke.status === 'error' ? <Button title="Tentar carregar de novo" variant="ghost" compact onPress={nuke.retry} /> : null}
        </Card>
      )}

      {shown ? (
        <Card style={styles.gap}>
          <Text variant="heading">Sugestão do Nuke</Text>
          {shown.note ? <Text variant="muted">{shown.note}</Text> : null}
          {shown.days.map((d) => (
            <View key={d.date} style={styles.suggestionDay}>
              <Text variant="label">{dayTitle(d.date)}</Text>
              {d.lunch ? <Text variant="small">Almoço: {d.lunch}</Text> : null}
              {d.dinner ? <Text variant="small">Jantar: {d.dinner}</Text> : null}
            </View>
          ))}
          {shown.applied ? (
            <Badge label="No cardápio" tone="primary" />
          ) : (
            <Button title="Usar este cardápio" icon="check" onPress={applySuggestion} loading={apply.isPending} />
          )}
          {shown.shopping.length ? (
            <>
              <Text variant="label">Falta comprar</Text>
              <Text variant="small">{shown.shopping.map((i) => `${i.name} (${formatQuantity(i.quantity, i.unit)})`).join(', ')}</Text>
              {shown.listed ? (
                <Badge label="Na lista de compras" tone="primary" />
              ) : (
                <Button
                  title={`Pôr ${shown.shopping.length} ${shown.shopping.length === 1 ? 'item' : 'itens'} na lista`}
                  icon="cart-plus"
                  variant="secondary"
                  onPress={listShopping}
                  loading={listing}
                />
              )}
            </>
          ) : null}
          <Button title="Descartar sugestão" variant="ghost" compact onPress={() => setSuggestion(null)} />
        </Card>
      ) : null}

      {menu.isPending ? (
        <Loading />
      ) : menu.isError ? (
        <ErrorNotice error={menu.error} onRetry={() => menu.refetch()} />
      ) : (
        days.map((day) => (
          <Card key={day} style={styles.gapSm}>
            <Row>
              <Text variant="heading" style={styles.flex}>
                {dayTitle(day)}
              </Text>
              {day === today ? <Badge label="Hoje" tone="primary" /> : null}
            </Row>
            {MEALS.map(({ key, label }) => {
              const dish = dishOf(day, key);
              return (
                <ListRow
                  key={key}
                  title={dish ?? 'Escolher prato'}
                  subtitle={label}
                  right={<Icon name={dish ? 'pencil-outline' : 'plus'} color="textMuted" />}
                  onPress={() => setEditing({ day, meal: key })}
                />
              );
            })}
          </Card>
        ))
      )}

      {editing ? (
        <FieldsModal
          title={`${MEALS.find((m) => m.key === editing.meal)!.label} de ${dayTitle(editing.day).toLowerCase()}`}
          fields={[{ key: 'dish', label: 'Prato', placeholder: 'Ex.: Frango assado com batata', required: true }]}
          initial={{ dish: editingDish }}
          onClose={() => setEditing(null)}
          onSave={({ dish }) => save.mutate({ ...editing, dish }, { onSuccess: () => setEditing(null), onError })}
          onDelete={editingDish ? () => save.mutate({ ...editing, dish: '' }, { onSuccess: () => setEditing(null), onError }) : undefined}
        />
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  gap: { gap: space.md },
  gapSm: { gap: space.xs },
  weekNav: { justifyContent: 'space-between' },
  weekTitle: { flex: 1, textAlign: 'center' },
  suggestionDay: { gap: 2 },
});
