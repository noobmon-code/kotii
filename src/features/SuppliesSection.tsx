import { router } from 'expo-router';
import { useState } from 'react';
import { Modal, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAddToMarketList } from '@/data/market';
import { useRecordRefill, useSupplies } from '@/data/supplies';
import { formatBRDate, todayISO } from '@/domain/dates';
import {
  describeRefillSaved,
  describeSupply,
  forecastSupplies,
  getSupplyKind,
  parseRefillDate,
  supplyBadge,
  supplyForecast,
  supplyRowText,
  type SupplyForecast,
  type SupplyRow,
} from '@/domain/supplies';
import { REMINDER_PLACE, remindersSupported, remindersUnavailableReason } from '@/lib/reminders';
import { errorMessage } from '@/lib/supabase';
import type { Supply } from '@/lib/types';
import { ActionSheet, type SheetAction } from '@/ui/ActionSheet';
import { Backdrop } from '@/ui/Backdrop';
import { notify } from '@/ui/dialogs';
import {
  Badge,
  Button,
  DateField,
  ErrorNotice,
  Icon,
  IconBadge,
  IconButton,
  ListCard,
  ListRow,
  Row,
  Section,
  Text,
  type Tone,
} from '@/ui/primitives';
import { MAX_WIDTH, space, useColors } from '@/ui/theme';

export const SUPPLIES_TITLE = 'Gás, água e ração';

const onError = (err: unknown) => notify('Erro', errorMessage(err));

const openSupply = (id: string) => router.push({ pathname: '/reposicao/[id]', params: { id } });

/** A cor do ícone acompanha o selo; sem troca ou parado fica apagado. */
function iconTone(forecast: SupplyForecast): Tone {
  const badge = supplyBadge(forecast);
  if (badge) return badge.tone;
  return forecast.state === 'sem_troca' || forecast.state === 'parado' ? 'neutral' : 'primary';
}

/**
 * Anota uma troca e conta a previsão nova ("Anotado. Deve durar até 26/11.").
 * A mesma ação na Despensa e na tela Hoje.
 */
export function useRefill() {
  const record = useRecordRefill();
  return {
    isPending: record.isPending,
    record: (supply: Supply, date: string, onDone?: () => void) =>
      record.mutate(
        { supplyId: supply.id, date },
        {
          onSuccess: () => {
            const today = todayISO();
            // A previsão com a troca recém-anotada, sem esperar a lista voltar do servidor.
            const forecast = supplyForecast({ ...supply, refills: [...supply.refills, { refilled_on: date }] }, today);
            notify(supply.name, describeRefillSaved(forecast, today));
            onDone?.();
          },
          onError,
        },
      ),
  };
}

/**
 * Onde ligar o aviso por notificação. Ele vem desligado e é de cada aparelho,
 * e quem cuida da permissão é a lista dos avisos: aqui vai só o caminho, como
 * na tela do clima, sem chave e sem ler o que está ligado.
 */
export function SuppliesReminderHint() {
  if (!remindersSupported) return <Text variant="muted">{`${remindersUnavailableReason()} O aviso aparece na tela Hoje.`}</Text>;
  return (
    <>
      <Text variant="muted">{`Para receber a notificação, ligue “${SUPPLIES_TITLE}” nos avisos ${REMINDER_PLACE}.`}</Text>
      <Button title="Abrir os avisos" icon="bell-outline" variant="secondary" compact onPress={() => router.push('/familia')} />
    </>
  );
}

/**
 * Despensa: o que acaba sem nota fiscal, com a previsão de cada um. Fica acima
 * da despensa e não depende dela: quem põe as duas na tela é a aba Casa. Num
 * banco ainda sem as tabelas, não aparece.
 */
export function SuppliesSection() {
  const today = todayISO();
  const supplies = useSupplies();
  const addToMarketList = useAddToMarketList();
  const refill = useRefill();
  const [selected, setSelected] = useState<Supply | null>(null);
  const [dating, setDating] = useState<Supply | null>(null);

  if (!supplies.data) {
    // Carregando, nada: a despensa não espera por esta seção.
    if (!supplies.isError) return null;
    return (
      <Section title={SUPPLIES_TITLE}>
        <ErrorNotice error={supplies.error} onRetry={() => supplies.refetch()} />
      </Section>
    );
  }
  if (!supplies.data.available) return null;

  async function addToList(supply: Supply) {
    const category = getSupplyKind(supply.kind).listCategory;
    if (!category) return;
    try {
      const list = await addToMarketList.mutateAsync({ name: supply.name, category, productId: null, quantity: 1, unit: 'un' });
      notify(
        list.added ? 'Adicionado à lista' : 'Já estava na lista',
        list.added ? `${supply.name} foi para "${list.name}".` : `${supply.name} já estava pendente em "${list.name}".`,
      );
    } catch (err) {
      onError(err);
    }
  }

  function supplyActions(supply: Supply): SheetAction[] {
    return [
      { label: 'Troquei hoje', icon: 'check', onPress: () => refill.record(supply, today) },
      { label: 'Troquei outro dia…', icon: 'calendar-edit', onPress: () => setDating(supply) },
      // Gás e galão chegam por entrega: só o que se compra em loja vai para a lista.
      ...(getSupplyKind(supply.kind).listCategory
        ? [{ label: 'Pôr na lista de mercado', icon: 'cart-plus', onPress: () => addToList(supply) } satisfies SheetAction]
        : []),
      { label: 'Editar', icon: 'pencil-outline', onPress: () => openSupply(supply.id) },
    ];
  }

  const rows = forecastSupplies(supplies.data.supplies, today);

  // Nenhuma cadastrada: só um convite discreto, sem disputar com a despensa.
  if (!rows.length) {
    return (
      <ListCard>
        <ListRow
          left={<IconBadge icon="bell-ring-outline" tone="primary" />}
          title="Avisar antes de acabar o gás, a água, a ração…"
          right={<Icon name="chevron-right" color="textMuted" />}
          onPress={() => openSupply('novo')}
        />
      </ListCard>
    );
  }

  return (
    <Section
      title={SUPPLIES_TITLE}
      action={<Button title="Adicionar" icon="plus" variant="ghost" compact onPress={() => openSupply('novo')} />}>
      <ListCard>
        {rows.map(({ supply, forecast }) => {
          const badge = supplyBadge(forecast);
          return (
            <ListRow
              key={supply.id}
              left={<IconBadge icon={getSupplyKind(supply.kind).icon} tone={iconTone(forecast)} />}
              title={supply.name}
              subtitle={supplyRowText(forecast, today)}
              right={badge ? <Badge label={badge.label} tone={badge.tone} /> : null}
              onPress={() => setSelected(supply)}
            />
          );
        })}
      </ListCard>
      <SuppliesReminderHint />
      <ActionSheet
        visible={Boolean(selected)}
        onClose={() => setSelected(null)}
        title={selected?.name}
        // O telefone da entrega fica à mão na hora em que o gás acaba.
        message={selected?.notes ?? undefined}
        actions={selected ? supplyActions(selected) : []}
      />
      {dating ? <RefillDateModal supply={dating} onClose={() => setDating(null)} /> : null}
    </Section>
  );
}

/** "Troquei outro dia…": pergunta o dia da troca. Renderize só quando aberto. */
function RefillDateModal({ supply, onClose }: { supply: Supply; onClose: () => void }) {
  const c = useColors();
  const refill = useRefill();
  const [day, setDay] = useState(formatBRDate(todayISO()));

  function confirm() {
    const date = parseRefillDate(day, todayISO());
    if (!date.ok) {
      notify('Confira a data', date.message);
      return;
    }
    refill.record(supply, date.value, onClose);
  }

  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={[styles.flex, { backgroundColor: c.background }]}>
        <Backdrop />
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Row>
            <Text variant="heading" style={styles.flex}>
              {supply.name}
            </Text>
            <IconButton icon="close" label="Fechar" onPress={onClose} />
          </Row>
          <DateField label="Dia da troca" value={day} onChangeText={setDay} hint="Não pode ser depois de hoje." />
          <Button title="Anotar troca" icon="check" onPress={confirm} loading={refill.isPending} />
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

/**
 * Tela Hoje: uma linha por reposição que está acabando ou passou da data,
 * com o "Troquei" ali mesmo. Sem nenhuma, a seção não aparece.
 */
export function SuppliesTodaySection({ rows, today }: { rows: SupplyRow<Supply>[]; today: string }) {
  const refill = useRefill();
  if (!rows.length) return null;
  return (
    <Section title={SUPPLIES_TITLE}>
      <ListCard>
        {rows.map(({ supply, forecast }) => (
          <ListRow
            key={supply.id}
            left={<IconBadge icon={getSupplyKind(supply.kind).icon} tone={iconTone(forecast)} />}
            title={supply.name}
            subtitle={describeSupply(forecast, today)}
            right={
              <Button
                title="Troquei"
                // Com mais de uma linha, o leitor de tela diz de qual é cada botão.
                accessibilityLabel={`Anotar troca de ${supply.name}`}
                variant="secondary"
                compact
                disabled={refill.isPending}
                onPress={() => refill.record(supply, today)}
              />
            }
            onPress={() => router.push({ pathname: '/casa', params: { aba: 'despensa' } })}
          />
        ))}
      </ListCard>
    </Section>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { width: '100%', maxWidth: MAX_WIDTH, alignSelf: 'center', padding: space.lg, gap: space.lg },
});
