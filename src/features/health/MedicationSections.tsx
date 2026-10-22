import { router } from 'expo-router';
import { type ReactNode, useMemo, useRef } from 'react';
import { StyleSheet, View } from 'react-native';

import { toSchedule, toSchedules, useDoses, useMedications, useToggleDose } from '@/data/home';
import { useAddToPharmacyList, useShoppingLists } from '@/data/market';
import { todayISO } from '@/domain/dates';
import { currentTimeHHMM, describeCourse, describeFrequency, doseKey, dosesForDay } from '@/domain/medications';
import { onPharmacyList, refillBadge, refillRows, type RefillAlert, type RefillRow } from '@/domain/medicationStock';
import { normalizeSearch } from '@/domain/search';
import { errorMessage } from '@/lib/supabase';
import type { Medication } from '@/lib/types';
import { notify } from '@/ui/dialogs';
import { IconArt } from '@/ui/iconArt';
import { Badge, Button, CheckCircle, EmptyState, IconBadge, ListCard, ListRow, Row, Section, Text } from '@/ui/primitives';
import { fonts, space } from '@/ui/theme';

/**
 * Os remédios com a caixa acabando (pelas contas do app) ou a receita
 * vencendo: `rows`, um por linha, o mais urgente primeiro; `attention`, só os
 * que pedem atenção (sem os parados há mais de duas semanas: é o que a tela
 * Hoje lista e conta como pendência); e `badges`, o selo de cada um desses (o
 * aviso mais urgente) para as linhas das doses.
 */
export function useRefills(today: string): { rows: RefillRow[]; attention: RefillRow[]; badges: ReadonlyMap<string, RefillAlert> } {
  const { data } = useMedications();
  // As doses de hoje já marcadas entram na conta do estoque (toSchedule): marcar uma não muda as linhas.
  const { data: doses } = useDoses(today);
  return useMemo(() => {
    const rows = refillRows(toSchedules(data ?? [], today, doses), today);
    const attention = rows.filter((row) => row.attention);
    return { rows, attention, badges: new Map(attention.map((row) => [row.id, row.alerts[0]])) };
  }, [data, today, doses]);
}

/**
 * O texto de baixo da linha de uma dose (telas Hoje e Saúde): quem toma e a dose, o "atrasada" na cor de aviso (o
 * ícone da linha é sempre o mesmo, então a cor fica aqui) e, com a caixa acabando ou a receita vencendo, o selo do
 * remédio.
 */
export function DoseSubtitle({ parts, late, badge }: { parts: (string | null)[]; late: boolean; badge?: RefillAlert }) {
  const text = parts.filter(Boolean).join(' · ');
  const line: ReactNode =
    text || late ? (
      <Text variant="muted">
        {text}
        {text && late ? ' · ' : null}
        {late ? (
          <Text variant="muted" color="warning" style={styles.late}>
            atrasada
          </Text>
        ) : null}
      </Text>
    ) : null;
  if (!badge) return line;
  return (
    <View style={styles.refill}>
      {line}
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
  const slots = dosesForDay(toSchedules(medications.data, today, doses.data), today, taken);
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
              left={<IconArt name="capsula" />}
              title={`${slot.time} · ${slot.name}`}
              subtitle={<DoseSubtitle parts={[slot.personName, slot.dosage]} late={late} badge={badges.get(slot.medicationId)} />}
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
 * Hoje e Saúde). Com a caixa acabando ou acabada, o atalho para a lista da
 * farmácia (o que já está para comprar numa lista de farmácia aberta aparece
 * como "Na lista da farmácia"); a linha só da receita não tem esse atalho.
 * Com a caixa acabada pelas contas, a primeira ação é "Atualizar estoque": o
 * mais provável é a pessoa já ter comprado e não ter dito ao app.
 */
export function MedicationRefills({ rows }: { rows: RefillRow[] }) {
  const lists = useShoppingLists();
  const addToList = useAddToPharmacyList();
  // O botão fica dentro de uma linha que abre o remédio: desativado, o toque
  // passaria para a linha; por isso ele segue ativo. O toque repetido no mesmo
  // remédio é ignorado aqui, e o de outro remédio espera a vez: um pedido de
  // cada vez, para dois seguidos não criarem duas listas de farmácia.
  const adding = useRef(new Set<string>());
  const queue = useRef<Promise<unknown>>(Promise.resolve());
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
    if (adding.current.has(row.itemName)) return;
    adding.current.add(row.itemName);
    queue.current = queue.current
      // Sempre uma unidade: repetir o toque não pede outra caixa. O item com o nome de quem toma também conta
      // como já na lista (ver onPharmacyList): o banco confere os dois.
      .then(() =>
        addToList.mutateAsync({
          name: row.itemName,
          altName: row.personItemName,
          category: 'medicamentos',
          productId: null,
          quantity: 1,
          unit: 'un',
        }),
      )
      .then(
        // A lista vem do servidor: outra pessoa pode ter posto o mesmo remédio agora há pouco.
        (list) =>
          notify(
            list.added ? 'Adicionado à lista' : 'Já estava na lista',
            list.added ? `${row.itemName} foi para "${list.name}".` : `${row.itemName} já estava pendente em "${list.name}".`,
          ),
        (err) => notify('Erro', errorMessage(err)),
      )
      .finally(() => {
        adding.current.delete(row.itemName);
      });
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
                {row.stock ? (
                  <Row gap={space.md} style={styles.wrap}>
                    {row.stock === 'low' ? null : (
                      <Button
                        title="Atualizar estoque"
                        icon="pencil-outline"
                        variant="ghost"
                        compact
                        onPress={() => router.push({ pathname: '/remedio/[id]', params: { id: row.id, estoque: '1' } })}
                        style={styles.refillAction}
                      />
                    )}
                    {onPharmacyList(row, listed) ? (
                      <Badge label="Na lista da farmácia" tone="primary" />
                    ) : (
                      <Button
                        title="Pôr na lista da farmácia"
                        icon="cart-plus"
                        variant="ghost"
                        compact
                        onPress={() => add(row)}
                        style={styles.refillAction}
                      />
                    )}
                  </Row>
                ) : null}
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
  // Para o selo ser o mesmo das telas Hoje e Saúde (ver toSchedule).
  const doses = useDoses(today);
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
            const schedule = toSchedule(m, today, doses.data);
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
  late: { fontFamily: fonts.bold },
  // O botão começa na mesma linha do texto, sem o recuo dele.
  refillAction: { paddingHorizontal: 0 },
});
