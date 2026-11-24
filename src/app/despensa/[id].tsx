import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { useFreezer, useThawPantryItems } from '@/data/freezer';
import { usePantryItem, useSavePantryItem } from '@/data/home';
import { CATEGORIES, getCategory } from '@/domain/categories';
import { deviceDayError, formatBRDate, parseBRDate, todayISO } from '@/domain/dates';
import {
  DEFAULT_FREEZE_DAYS,
  FREEZER_DAY_PURPOSE,
  freezeKind,
  frozenExpiryHint,
  frozenFormLine,
  frozenOnFits,
  FROZEN_CHIP,
  FROZEN_ON_INVALID,
  FROZEN_ON_INVALID_TITLE,
  FROZEN_ON_LABEL,
  hasFreezerFields,
  isFreezeKind,
  isFrozen,
  PANTRY_ITEM_CHANGED,
  pantryFormFreeze,
  THAW_ACTION,
  THAW_UNSAVED_CONFIRM,
  THAW_UNSAVED_MESSAGE,
  THAW_UNSAVED_TITLE,
  thawedFormLine,
  THAWED_EXPIRY_HINT,
  thawNotice,
  thawPreviewText,
  wasFrozen,
  type FreezeKind,
} from '@/domain/freezer';
import { parseDecimal } from '@/domain/money';
import { estimateExpiry, PANTRY_CHANGED_TITLE } from '@/domain/pantry';
import { guessCategory } from '@/domain/search';
import { closeWindow } from '@/lib/navigation';
import { errorMessage } from '@/lib/supabase';
import { UNITS, type PantryItem, type Unit } from '@/lib/types';
import { confirmAction, notify } from '@/ui/dialogs';
import { PickerModal } from '@/ui/PickerModal';
import {
  Button,
  CategoryIcon,
  Chip,
  DateField,
  ErrorNotice,
  Loading,
  Row,
  Screen,
  Text,
  TextField,
} from '@/ui/primitives';
import { space } from '@/ui/theme';

export default function PantryItemScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const isNew = id === 'novo';
  const item = usePantryItem(isNew ? undefined : id);

  if (!isNew && item.isPending) return <Loading />;
  if (!isNew && item.isError) return <ErrorNotice error={item.error} />;
  return <PantryForm item={isNew ? undefined : item.data} />;
}

/** "20/12/2026" digitado: a data, null quando apagado, undefined quando não dá para ler. */
const typedDate = (text: string): string | null | undefined => (text.trim() ? (parseBRDate(text) ?? undefined) : null);

function PantryForm({ item }: { item?: PantryItem }) {
  const today = todayISO();
  const save = useSavePantryItem();
  const thaw = useThawPantryItems();
  const freezer = useFreezer();
  const [name, setName] = useState(item?.name ?? '');
  const [category, setCategory] = useState<string | null>(item?.category ?? null);
  const initialQuantity = String(item?.quantity ?? 1).replace('.', ',');
  const [quantity, setQuantity] = useState(initialQuantity);
  const [unit, setUnit] = useState<Unit>(item?.unit ?? 'un');
  const initialPurchased = formatBRDate(item?.purchased_on ?? todayISO());
  const [purchased, setPurchased] = useState(initialPurchased);
  // null = validade não tocada pelo usuário nesta tela.
  const [expires, setExpires] = useState<string | null>(null);
  const [pickingCategory, setPickingCategory] = useState(false);
  // O congelador: "Congelei" ligado num item fora dele; "Congelado em" digitado (null: o padrão); a validade
  // digitada antes de ligar "Congelei", que vira a de antes do congelador (undefined: não digitou).
  const [freezing, setFreezing] = useState(false);
  const [frozenOnText, setFrozenOnText] = useState<string | null>(null);
  const [freshText, setFreshText] = useState<string | undefined>(undefined);

  const effectiveCategory = category ?? guessCategory(name);
  const purchasedISO = parseBRDate(purchased);
  const estimate = purchasedISO ? estimateExpiry({ purchasedOn: purchasedISO, category: effectiveCategory }) : null;

  // Os controles do congelador: só com o banco que o tem, e com a cópia que traz as colunas (a guardada de antes
  // desta versão não diz se a compra já está no congelador). O que a compra já diz (no congelador, descongelada)
  // aparece de qualquer jeito.
  const freezerOn = freezer.available === true && freezer.days != null && (!item || hasFreezerFields(item));
  const inFreezer = Boolean(item && isFrozen(item));
  const stored = item && isFreezeKind(item.freeze_kind) ? item.freeze_kind : null;
  // O tipo do item no congelador fica o que era, a não ser que o nome ou a categoria mudem nesta tela.
  const renamed = Boolean(item) && (name.trim() !== item?.name || effectiveCategory !== item?.category);
  const kind: FreezeKind | null = inFreezer
    ? renamed
      ? (freezeKind(name, effectiveCategory, unit) ?? stored)
      : stored
    : freezeKind(name, effectiveCategory, unit);

  function stopFreezing() {
    setFreezing(false);
    setFrozenOnText(null);
    // A data digitada antes de "Congelei" volta para o campo; a digitada com ele ligado sai junto.
    setExpires(freshText ?? null);
    setFreshText(undefined);
  }
  // O nome virou outra coisa ("Bolo"): o "Congelei" sai, e a escolha com ele.
  if (freezing && (!kind || !freezerOn || inFreezer)) stopFreezing();

  function toggleFreezing() {
    if (freezing) return stopFreezing();
    if (expires != null && typedDate(expires) === undefined) {
      notify('Validade inválida', 'Use o formato dd/mm/aaaa ou deixe em branco.');
      return;
    }
    // A data que estava digitada vira a de antes do congelador, e o campo passa a mostrar a do congelador.
    if (expires != null) setFreshText(expires);
    setExpires(null);
    setFreezing(true);
  }

  const frozenNow = freezerOn && kind != null && (inFreezer || freezing);
  // "Congelado em": o do item no congelador; para quem congela agora, o dia da compra (item novo) ou hoje, dentro
  // de [compra ou saída do congelador, hoje].
  const thawedOn = item?.thawed_on ?? null;
  const floor = [purchasedISO, freezing ? thawedOn : null].filter((d): d is string => Boolean(d)).sort().at(-1) ?? null;
  const proposed = inFreezer ? (item?.frozen_on ?? today) : !item && purchasedISO ? purchasedISO : today;
  const defaultFrozenOn = !inFreezer && floor && proposed < floor ? floor : proposed > today ? today : proposed;
  const frozenOnShown = frozenOnText ?? formatBRDate(defaultFrozenOn);
  const frozenOnISO = parseBRDate(frozenOnShown);

  const freshTyped = freshText === undefined ? undefined : typedDate(freshText);
  const expiryTyped = expires == null ? undefined : typedDate(expires);
  const plan = pantryFormFreeze({
    item: item ?? null,
    freezing: frozenNow && !inFreezer,
    frozenOn: frozenNow ? frozenOnISO : null,
    kind: frozenNow ? kind : null,
    estimate,
    freshTyped,
    expiryTyped,
    // Sem o congelador no banco nada aqui é congelado (frozenNow), e os dias nem são lidos.
    days: freezer.days ?? DEFAULT_FREEZE_DAYS,
  });
  const expiresText = expires ?? (plan.expires_on ? formatBRDate(plan.expires_on) : '');
  const typed = expires != null;

  const hint =
    frozenNow && !typed && plan.expiry_source === 'congelado' && kind && freezer.days
      ? frozenExpiryHint(kind, freezer.days)
      : (item && wasFrozen(item)) || frozenNow
        ? THAWED_EXPIRY_HINT
        : !item && !typed && estimate?.expiresOn
          ? 'Estimada pela categoria. Corrija se precisar.'
          : item?.product_id
            ? 'Se você corrigir, o produto aprende a validade para a próxima compra.'
            : 'Deixe em branco para itens sem validade.';

  function submit() {
    const qty = parseDecimal(quantity);
    if (!name.trim() || !qty || qty <= 0 || !purchasedISO) {
      notify('Confira os dados', 'Nome, quantidade e data da compra (dd/mm/aaaa) são obrigatórios.');
      return;
    }
    if ((expires != null && expiryTyped === undefined) || (freshText !== undefined && freshTyped === undefined)) {
      notify('Validade inválida', 'Use o formato dd/mm/aaaa ou deixe em branco.');
      return;
    }
    if (frozenNow) {
      const clock = deviceDayError(today, FREEZER_DAY_PURPOSE);
      if (clock) return notify(clock.title, clock.message);
      if (!frozenOnFits(frozenOnISO, { purchasedOn: purchasedISO, thawedOn: inFreezer ? null : thawedOn, today })) {
        notify(FROZEN_ON_INVALID_TITLE, FROZEN_ON_INVALID);
        return;
      }
    }
    save.mutate(
      {
        id: item?.id,
        productId: item?.product_id,
        copy: item ?? null,
        freezerAvailable: freezer.available === true,
        values: {
          name: name.trim(),
          category: effectiveCategory,
          quantity: qty,
          unit,
          purchased_on: purchasedISO,
          expires_on: plan.expires_on,
          expiry_source: plan.expiry_source,
          ...plan.freezer,
        },
      },
      {
        onSuccess: (rows) => {
          // Nada gravado: a compra mudou (ou saiu do congelador) em outro aparelho. A tela fica, e a despensa já é
          // buscada de novo.
          if (!rows.length) return notify(PANTRY_CHANGED_TITLE, PANTRY_ITEM_CHANGED);
          closeWindow('despensa/[id]');
        },
        onError: (err) => notify('Erro', errorMessage(err)),
      },
    );
  }

  /** O que a pessoa mudou nesta tela e ainda não salvou: descongelar perde. */
  const edited =
    Boolean(item) &&
    (name !== item?.name ||
      category !== item?.category ||
      quantity !== initialQuantity ||
      unit !== item?.unit ||
      purchased !== initialPurchased ||
      expires != null ||
      (frozenOnText != null && frozenOnISO !== item?.frozen_on));

  async function thawNow() {
    if (!item) return;
    const clock = deviceDayError(today, FREEZER_DAY_PURPOSE);
    if (clock) return notify(clock.title, clock.message);
    try {
      const notice = thawNotice(item.name, 1, await thaw.mutateAsync({ ids: [item.id], thawedOn: today }), today);
      notify(notice.title, notice.message);
      closeWindow('despensa/[id]');
    } catch (err) {
      notify('Erro', errorMessage(err));
    }
  }

  function onThaw() {
    if (edited) confirmAction(THAW_UNSAVED_TITLE, THAW_UNSAVED_MESSAGE, THAW_UNSAVED_CONFIRM, () => void thawNow(), false);
    else void thawNow();
  }

  const preview = inFreezer && item ? thawPreviewText([item], today) : null;

  return (
    <Screen edges={[]}>
      <TextField label="Item" value={name} onChangeText={setName} placeholder="Ex.: Leite integral" autoFocus={!item} />
      <Row>
        <CategoryIcon category={effectiveCategory} name={name} />
        <Chip label={getCategory(effectiveCategory).label} icon="tag-outline" onPress={() => setPickingCategory(true)} />
      </Row>
      <Row gap={space.md}>
        <View style={styles.flex}>
          <TextField label="Quantidade" value={quantity} onChangeText={setQuantity} keyboardType="decimal-pad" />
        </View>
        <View style={styles.flex}>
          <DateField label="Comprado em" value={purchased} onChangeText={setPurchased} />
        </View>
      </Row>
      <Row style={styles.wrap}>
        {UNITS.map((u) => (
          <Chip key={u} label={u} selected={unit === u} onPress={() => setUnit(u)} />
        ))}
      </Row>
      {inFreezer && item?.frozen_on ? <Text>{frozenFormLine(item.frozen_on, today)}</Text> : null}
      {!inFreezer && thawedOn ? <Text>{thawedFormLine(thawedOn, today)}</Text> : null}
      {freezerOn && !inFreezer && kind ? (
        <Row style={styles.wrap}>
          <Chip label={FROZEN_CHIP} icon="snowflake" toggle selected={freezing} onPress={toggleFreezing} />
        </Row>
      ) : null}
      {frozenNow ? <DateField label={FROZEN_ON_LABEL} value={frozenOnShown} onChangeText={setFrozenOnText} /> : null}
      <DateField label="Validade" value={expiresText} onChangeText={setExpires} hint={hint} />
      <Button title="Salvar" onPress={submit} loading={save.isPending} />
      {inFreezer ? (
        <View style={styles.gapXs}>
          <Button title={THAW_ACTION} icon="snowflake-off" variant="secondary" onPress={onThaw} loading={thaw.isPending} />
          {preview ? <Text variant="small">{preview}</Text> : null}
        </View>
      ) : null}
      {item?.product_id ? (
        <Text variant="small">Item ligado a um produto com histórico de preço.</Text>
      ) : null}

      <PickerModal
        visible={pickingCategory}
        title="Categoria"
        options={CATEGORIES.map((c) => ({ id: c.key, title: c.label, left: <CategoryIcon category={c.key} size={32} /> }))}
        onClose={() => setPickingCategory(false)}
        onSelect={(key) => {
          setCategory(key);
          setPickingCategory(false);
        }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  wrap: { flexWrap: 'wrap' },
  gapXs: { gap: space.xs },
});
