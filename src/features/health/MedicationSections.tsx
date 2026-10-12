import { router } from 'expo-router';
import { type ReactNode, useMemo } from 'react';
import { StyleSheet, View } from 'react-native';

import { toSchedule, useDoses, useMedications, useToggleDose } from '@/data/home';
import { useAddToPharmacyList, useShoppingLists } from '@/data/market';
import { todayISO } from '@/domain/dates';
import { currentTimeHHMM, describeCourse, describeFrequency, doseKey, dosesForDay } from '@/domain/medications';
import { refillBadge, refillRows, type RefillAlert, type RefillRow } from '@/domain/medicationStock';
import { normalizeSearch } from '@/domain/search';
import { errorMessage } from '@/lib/supabase';
import type { Medication } from '@/lib/types';
import { notify } from '@/ui/dialogs';
import { Badge, Button, CheckCircle, EmptyState, IconBadge, ListCard, ListRow, Row, Section, Text } from '@/ui/primitives';
import { space } from '@/ui/theme';

/**
 * Os remédios com a caixa acabando (pelas contas do app) ou a receita
 * vencendo: `rows`, um por linha, o mais urgente primeiro, e `badges`, o selo
 * de cada um (o aviso mais urgente) para as linhas das doses.
 */
export function useRefills(today: string): { rows: RefillRow[]; badges: ReadonlyMap<string, RefillAlert> } {
  const { data } = useMedications();
  return useMemo(() => {
    const rows = refillRows((data ?? []).map(toSchedule), today);
    return { rows, badges: new Map(rows.map((row) => [row.id, row.alerts[0]])) };
  }, [data, today]);
}

/** O texto de baixo da linha de uma dose e, com a caixa acabando ou a receita vencendo, o selo do remédio. */
export function doseSubtitle(text: string, badge: RefillAlert | undefined): ReactNode {
  if (!badge) return text;
  return (
    <View style={styles.refill}>
      {text ? <Text variant="muted">{text}</Text> : null}
      <Badge label={badge.label} tone={badge.tone} />
    </View>
  );
}

export function MedicationsToday({ today }: { today: string }) {
  const medications = useMedications();
  const doses = useDoses(today);
  const toggle = useToggleDose(today);
  const { badges } = useRefills(today);

  if (!medications.data) return null;
  const taken = new Set((doses.data ?? []).map((d) => doseKey(d.medication_id, d.scheduled_on, d.scheduled_time)));
  const slots = dosesForDay(medications.data.map(toSchedule), today, taken);
  if (!slots.length) return null;
  const nowTime = currentTimeHHMM();

  return (
    <Section title="Remédios de hoje">
      <ListCard>
        {slots.map((slot) => {
          const key = doseKey(slot.medicationId, slot.date, slot.time);
          const isTaken = taken.has(key);
          const late = !isTaken && slot.time < nowTime;
          return (
            <ListRow
              key={key}
              left={<IconBadge icon="pill" tone={isTaken ? 'primary' : late ? 'warning' : 'info'} />}
              title={`${slot.time} · ${slot.name}`}
              subtitle={doseSubtitle(
                [slot.personName, slot.dosage, late ? 'atrasada' : null].filter(Boolean).join(' · '),
                badges.get(slot.medicationId),
              )}
              dimmed={isTaken}
              right={
                <CheckCircle
                  checked={isTaken}
                  label={`${slot.name} das ${slot.time}`}
                  onPress={() =>
                    toggle.mutate(
                      { medicationId: slot.medicationId, time: slot.time, taken: !isTaken },
                      { onError: (err) => notify('Erro', errorMessage(err)) },
                    )
                  }
                />
              }
            />
          );
        })}
      </ListCard>
    </Section>
  );
}

/**
 * Uma linha por remédio que está acabando ou com a receita vencendo (telas
 * Hoje e Saúde), com o atalho para a lista da farmácia. O que já está para
 * comprar numa lista de farmácia aberta aparece como "Na lista da farmácia".
 */
export function MedicationRefills({ rows }: { rows: RefillRow[] }) {
  const lists = useShoppingLists();
  const addToList = useAddToPharmacyList();
  const listed = useMemo(
    () =>
      new Set(
        (lists.data ?? [])
          .filter((list) => list.kind === 'farmacia')
          .flatMap((list) => list.items.filter((item) => !item.checked_at).map((item) => normalizeSearch(item.name))),
      ),
    [lists.data],
  );
  if (!rows.length) return null;

  function add(row: RefillRow) {
    addToList.mutate(
      { name: row.itemName, category: 'medicamentos', productId: null, quantity: 1, unit: 'un' },
      {
        // A lista vem do servidor: outra pessoa pode ter posto o mesmo remédio agora há pouco.
        onSuccess: (list) =>
          notify(
            list.added ? 'Adicionado à lista' : 'Já estava na lista',
            list.added ? `${row.itemName} foi para "${list.name}".` : `${row.itemName} já estava pendente em "${list.name}".`,
          ),
        onError: (err) => notify('Erro', errorMessage(err)),
      },
    );
  }

  return (
    <Section title="Remédios e receitas acabando">
      <ListCard>
        {rows.map((row) => (
          <ListRow
            key={row.id}
            left={<IconBadge icon="pill" tone={row.alerts[0].tone} />}
            title={row.title}
            subtitle={
              <View style={styles.refill}>
                <Row style={styles.wrap}>
                  {row.alerts.map((alert) => (
                    <Badge key={alert.about} label={alert.label} tone={alert.tone} />
                  ))}
                </Row>
                {listed.has(normalizeSearch(row.itemName)) ? (
                  <Badge label="Na lista da farmácia" tone="primary" />
                ) : (
                  <Button
                    title="Pôr na lista da farmácia"
                    icon="cart-plus"
                    variant="ghost"
                    compact
                    disabled={addToList.isPending}
                    onPress={() => add(row)}
                    style={styles.refillAction}
                  />
                )}
              </View>
            }
            onPress={() => router.push({ pathname: '/remedio/[id]', params: { id: row.id } })}
          />
        ))}
      </ListCard>
    </Section>
  );
}

/** Tratamentos em andamento (de uma pessoa, ou de todos). */
export function MedicationList({ medications, personId }: { medications: Medication[]; personId: string | null }) {
  const today = todayISO();
  return (
    <Section
      title="Remédios"
      action={
        <Button
          title="Remédio"
          icon="plus"
          variant="ghost"
          compact
          onPress={() => router.push({ pathname: '/remedio/[id]', params: { id: 'novo', pessoa: personId ?? '' } })}
        />
      }>
      {medications.length === 0 ? (
        personId ? (
          <Text variant="muted">Nenhum remédio em uso.</Text>
        ) : (
          <EmptyState
            icon="pill"
            title="Nenhum remédio cadastrado"
            message="Cadastre os remédios de cada pessoa com horários. Cada celular escolhe se quer receber o lembrete."
          />
        )
      ) : (
        <ListCard>
          {medications.map((m) => {
            const schedule = toSchedule(m);
            // Caixa acabando ou receita vencendo: o selo diz o mais urgente.
            const badge = refillBadge(schedule, today);
            return (
              <ListRow
                key={m.id}
                left={<IconBadge icon="pill" />}
                title={m.name}
                subtitle={[personId ? null : m.person_name, `${describeFrequency(schedule)}, ${m.times.join(', ')}`, describeCourse(schedule)]
                  .filter(Boolean)
                  .join(' · ')}
                right={badge ? <Badge label={badge.label} tone={badge.tone} /> : undefined}
                onPress={() => router.push({ pathname: '/remedio/[id]', params: { id: m.id } })}
              />
            );
          })}
        </ListCard>
      )}
    </Section>
  );
}

const styles = StyleSheet.create({
  wrap: { flexWrap: 'wrap' },
  refill: { gap: space.xs, alignItems: 'flex-start' },
  // O botão começa na mesma linha do texto, sem o recuo dele.
  refillAction: { paddingHorizontal: 0 },
});
