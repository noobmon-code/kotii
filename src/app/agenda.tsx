import { router, type Href } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { useBills } from '@/data/finance';
import { useAppointments, usePeople, useVaccines } from '@/data/health';
import { useChores } from '@/data/home';
import { useDocuments, useEquipmentList } from '@/data/house';
import { buildAgenda, monthGrid, type AgendaEvent, type AgendaKind } from '@/domain/agenda';
import { todayISO } from '@/domain/dates';
import { monthLabel, shiftMonth } from '@/domain/finance';
import { Card, ErrorNotice, Icon, IconButton, ListCard, ListRow, Loading, Row, Screen, Text, type IconName } from '@/ui/primitives';
import { radius, space, useColors, useTint, type Tint } from '@/ui/theme';

const KINDS: Record<AgendaKind, { label: string; icon: IconName; tint: Tint; href: (id: string) => Href }> = {
  consulta: { label: 'Consulta', icon: 'stethoscope', tint: 'pink', href: (id) => ({ pathname: '/consulta/[id]', params: { id } }) },
  vacina: { label: 'Vacina', icon: 'needle', tint: 'purple', href: (id) => ({ pathname: '/vacina/[id]', params: { id } }) },
  conta: { label: 'Conta', icon: 'cash', tint: 'green', href: (id) => ({ pathname: '/conta/[id]', params: { id } }) },
  tarefa: { label: 'Tarefa', icon: 'broom', tint: 'blue', href: (id) => ({ pathname: '/tarefa/[id]', params: { id } }) },
  manutencao: { label: 'Manutenção', icon: 'wrench-outline', tint: 'orange', href: (id) => ({ pathname: '/tarefa/[id]', params: { id } }) },
  documento: { label: 'Documento', icon: 'card-account-details-outline', tint: 'yellow', href: (id) => ({ pathname: '/documento/[id]', params: { id } }) },
  garantia: { label: 'Garantia', icon: 'shield-check-outline', tint: 'orange', href: (id) => ({ pathname: '/aparelho/[id]', params: { id } }) },
};

const WEEKDAY_INITIALS = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'];

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

function dayLabel(date: string, today: string): string {
  const [y, m, d] = date.split('-').map(Number);
  const label = new Date(y, m - 1, d).toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });
  return date === today ? `Hoje, ${label.split(', ').slice(1).join(', ')}` : capitalize(label);
}

export default function AgendaScreen() {
  const c = useColors();
  const today = todayISO();
  const [month, setMonth] = useState(today.slice(0, 7));
  const [selected, setSelected] = useState(today);

  const appointments = useAppointments();
  const vaccines = useVaccines();
  const people = usePeople();
  const bills = useBills();
  const chores = useChores();
  const documents = useDocuments();
  const equipment = useEquipmentList();
  const queries = [appointments, vaccines, people, bills, chores, documents, equipment];

  const weeks = monthGrid(month);
  const from = weeks[0][0].date;
  const to = weeks[weeks.length - 1][6].date;

  // O React Compiler memoriza: só recalcula quando dados ou mês mudam.
  const personName = (id: string | null) => people.data?.find((p) => p.id === id)?.name ?? null;
  const events = buildAgenda({
    from,
    to,
    today,
    appointments: (appointments.data ?? []).map((a) => ({ ...a, person: personName(a.person_id) })),
    vaccines: (vaccines.data ?? []).map((v) => ({ ...v, person: personName(v.person_id) })),
    bills: bills.data ?? [],
    chores: chores.data ?? [],
    documents: documents.data ?? [],
    equipment: equipment.data ?? [],
  });
  const byDay = new Map<string, AgendaEvent[]>();
  for (const event of events) byDay.set(event.date, [...(byDay.get(event.date) ?? []), event]);

  const failed = queries.find((q) => q.isError);
  if (failed) return <ErrorNotice error={failed.error} onRetry={() => queries.forEach((q) => q.refetch())} />;
  if (queries.some((q) => q.isPending)) return <Loading />;

  function goToMonth(delta: number) {
    const next = shiftMonth(month, delta);
    setMonth(next);
    setSelected(next === today.slice(0, 7) ? today : `${next}-01`);
  }

  const dayEvents = byDay.get(selected) ?? [];

  return (
    <Screen edges={[]}>
      <Card style={styles.calendar}>
        <Row style={styles.monthRow}>
          <IconButton icon="chevron-left" label="Mês anterior" onPress={() => goToMonth(-1)} />
          <Text variant="heading" style={styles.monthLabel}>
            {capitalize(monthLabel(month))}
          </Text>
          <IconButton icon="chevron-right" label="Próximo mês" onPress={() => goToMonth(1)} />
        </Row>
        <View style={styles.week}>
          {WEEKDAY_INITIALS.map((letter, i) => (
            <Text key={i} variant="small" style={styles.weekday}>
              {letter}
            </Text>
          ))}
        </View>
        {weeks.map((week) => (
          <View key={week[0].date} style={styles.week}>
            {week.map(({ date, inMonth }) => (
              <DayCell
                key={date}
                date={date}
                inMonth={inMonth}
                isToday={date === today}
                selected={date === selected}
                kinds={[...new Set((byDay.get(date) ?? []).map((e) => e.kind))]}
                onPress={() => {
                  setSelected(date);
                  if (!inMonth) setMonth(date.slice(0, 7));
                }}
              />
            ))}
          </View>
        ))}
        {month !== today.slice(0, 7) || selected !== today ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              setMonth(today.slice(0, 7));
              setSelected(today);
            }}
            style={styles.todayLink}>
            <Text variant="label" color="primary">
              Voltar para hoje
            </Text>
          </Pressable>
        ) : null}
      </Card>

      <Text variant="heading">{dayLabel(selected, today)}</Text>
      {dayEvents.length ? (
        <ListCard>
          {dayEvents.map((event) => (
            <ListRow
              key={event.key}
              left={<KindBadge kind={event.kind} />}
              title={event.time ? `${event.time} · ${event.title}` : event.title}
              subtitle={[KINDS[event.kind].label, event.detail].filter(Boolean).join(' · ')}
              dimmed={event.planned}
              onPress={() => router.push(KINDS[event.kind].href(event.id))}
            />
          ))}
        </ListCard>
      ) : (
        <Card>
          <Row>
            <Icon name="calendar-blank-outline" color="textMuted" />
            <Text variant="muted" style={styles.flex}>
              Nada marcado neste dia.
            </Text>
          </Row>
        </Card>
      )}
      <Text variant="small" style={[styles.center, { color: c.textMuted }]}>
        Contas e tarefas que se repetem aparecem apagadas nas próximas datas: é a previsão.
      </Text>
    </Screen>
  );
}

function KindBadge({ kind }: { kind: AgendaKind }) {
  const tint = useTint(KINDS[kind].tint);
  return (
    <View style={[styles.badge, { backgroundColor: tint.bg }]}>
      <Icon name={KINDS[kind].icon} size={20} color="text" />
    </View>
  );
}

function DayCell({
  date,
  inMonth,
  isToday,
  selected,
  kinds,
  onPress,
}: {
  date: string;
  inMonth: boolean;
  isToday: boolean;
  selected: boolean;
  kinds: AgendaKind[];
  onPress: () => void;
}) {
  const c = useColors();
  const day = Number(date.slice(8, 10));
  const [y, m] = date.split('-').map(Number);
  const spoken = new Date(y, m - 1, day).toLocaleDateString('pt-BR', { day: 'numeric', month: 'long' });
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={`${spoken}${kinds.length ? `, ${kinds.length} ${kinds.length === 1 ? 'tipo de compromisso' : 'tipos de compromisso'}` : ''}`}
      onPress={onPress}
      style={styles.cell}>
      <View
        style={[
          styles.dayCircle,
          selected && { backgroundColor: c.primary },
          !selected && isToday && { borderColor: c.primary, borderWidth: 2 },
        ]}>
        <Text variant="label" color={selected ? 'onPrimary' : inMonth ? 'text' : 'textMuted'} style={!inMonth && styles.outside}>
          {day}
        </Text>
      </View>
      <View style={styles.dots}>
        {kinds.slice(0, 3).map((kind) => (
          <Dot key={kind} kind={kind} />
        ))}
      </View>
    </Pressable>
  );
}

function Dot({ kind }: { kind: AgendaKind }) {
  const tint = useTint(KINDS[kind].tint);
  return <View style={[styles.dot, { backgroundColor: tint.art }]} />;
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { textAlign: 'center' },
  calendar: { gap: space.xs },
  monthRow: { justifyContent: 'space-between' },
  monthLabel: { flex: 1, textAlign: 'center' },
  week: { flexDirection: 'row' },
  weekday: { flex: 1, textAlign: 'center', paddingVertical: space.xs },
  cell: { flex: 1, alignItems: 'center', paddingVertical: 2, minHeight: 50 },
  dayCircle: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  outside: { opacity: 0.5 },
  dots: { flexDirection: 'row', gap: 3, height: 8, alignItems: 'center' },
  dot: { width: 6, height: 6, borderRadius: 3 },
  todayLink: { alignSelf: 'center', paddingVertical: space.sm },
  badge: { width: 40, height: 40, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
});
