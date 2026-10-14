import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { REFILLS_PER_SUPPLY, SUPPLY_GONE, useDeleteRefill, useDeleteSupply, useSaveSupply, useSupplies } from '@/data/supplies';
import { formatBRDate, todayISO } from '@/domain/dates';
import {
  describeRefill,
  getSupplyKind,
  parseSupplyStart,
  refillHistory,
  SUPPLY_DAYS_MAX,
  SUPPLY_KINDS,
  SUPPLY_NAME_MAX,
  SUPPLY_NOTES_MAX,
  supplyForecast,
  supplyRowText,
  validateSupply,
  type SupplyKind,
  type SupplyStart,
} from '@/domain/supplies';
import { SuppliesReminderHint } from '@/features/SuppliesSection';
import { errorMessage } from '@/lib/supabase';
import type { Supply } from '@/lib/types';
import { confirmAction, notify } from '@/ui/dialogs';
import {
  Button,
  Card,
  Chip,
  DateField,
  ErrorNotice,
  IconButton,
  ListCard,
  ListRow,
  Loading,
  Row,
  Screen,
  Section,
  Text,
  TextField,
} from '@/ui/primitives';
import { space } from '@/ui/theme';

export default function SupplyScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const isNew = id === 'novo';
  // A lista já traz cada reposição com as trocas: a tela não busca de novo.
  const supplies = useSupplies();

  if (isNew) return <SupplyForm />;
  if (supplies.isPending) return <Loading />;
  if (!supplies.data) return <ErrorNotice error={supplies.error} onRetry={() => supplies.refetch()} />;
  const supply = supplies.data.supplies.find((s) => s.id === id);
  if (!supply) {
    return (
      <Screen edges={[]}>
        <Text variant="muted">{SUPPLY_GONE}</Text>
      </Screen>
    );
  }
  return <SupplyForm supply={supply} />;
}

const STARTS: { value: SupplyStart; label: string }[] = [
  { value: 'hoje', label: 'Hoje' },
  { value: 'outro', label: 'Outro dia' },
  { value: 'nao_sei', label: 'Não sei' },
];

function SupplyForm({ supply }: { supply?: Supply }) {
  const today = todayISO();
  const save = useSaveSupply();
  const remove = useDeleteSupply();
  const removeRefill = useDeleteRefill();
  const [kind, setKind] = useState<SupplyKind>(getSupplyKind(supply?.kind ?? 'gas').key);
  // null = nome não tocado nesta tela: acompanha o tipo escolhido.
  const [name, setName] = useState<string | null>(supply ? supply.name : null);
  const [typicalDays, setTypicalDays] = useState(supply?.typical_days ? String(supply.typical_days) : '');
  const [notes, setNotes] = useState(supply?.notes ?? '');
  // Nada vem escolhido: "Hoje" de saída daria como novo um botijão que já está pela metade.
  const [start, setStart] = useState<SupplyStart | null>(null);
  const [startDay, setStartDay] = useState('');

  const kindInfo = getSupplyKind(kind);
  const nameText = name ?? (kind === 'outros' ? '' : kindInfo.label);
  const onError = (err: unknown) => notify('Erro', errorMessage(err));

  function submit() {
    const checked = validateSupply({ name: nameText, kind, typicalDays, notes });
    if (!checked.ok) {
      notify('Confira os dados', checked.message);
      return;
    }
    // Só ao criar: quando começou o atual vira a primeira troca (sem escolha ou "Não sei", nenhuma).
    const started = supply ? ({ ok: true, value: null } as const) : parseSupplyStart(start, startDay, today);
    if (!started.ok) {
      notify('Confira a data', started.message);
      return;
    }
    save.mutate({ id: supply?.id, values: checked.value, startedOn: started.value }, { onSuccess: () => router.back(), onError });
  }

  return (
    <Screen edges={[]}>
      <Stack.Screen options={{ title: supply ? 'Editar reposição' : 'Nova reposição' }} />
      <View style={styles.group}>
        <Text variant="label">O que é?</Text>
        <Row style={styles.wrap}>
          {SUPPLY_KINDS.map((k) => (
            <Chip key={k.key} label={k.label} icon={k.icon} selected={kind === k.key} onPress={() => setKind(k.key)} />
          ))}
        </Row>
      </View>
      <TextField
        label="Nome"
        value={nameText}
        onChangeText={setName}
        placeholder="Ex.: Ração da Mel"
        maxLength={SUPPLY_NAME_MAX}
      />
      <TextField
        label="Dura quantos dias?"
        value={typicalDays}
        onChangeText={setTypicalDays}
        keyboardType="number-pad"
        maxLength={String(SUPPLY_DAYS_MAX).length}
        placeholder={kindInfo.typicalDays ? `Ex.: ${kindInfo.typicalDays}` : 'Se souber'}
        // A estimativa pesa só no começo: entra na conta junto com as trocas até a casa ter três intervalos (quatro trocas).
        hint={
          kindInfo.typicalDays
            ? `Em branco, o Kotii começa com uns ${kindInfo.typicalDays} dias. A cada troca anotada a conta se ajusta à sua casa; depois de quatro, vale só o que acontece nela.`
            : 'Em branco, a previsão aparece depois de duas trocas anotadas.'
        }
      />
      <TextField
        label="Observações"
        value={notes}
        onChangeText={setNotes}
        placeholder="Ex.: Disk gás: 3333-0000"
        maxLength={SUPPLY_NOTES_MAX}
        multiline
      />

      {supply ? null : (
        <View style={styles.group}>
          <Text variant="label">Quando começou o atual?</Text>
          <Text variant="small">Se o atual já está em uso há um tempo, escolha o dia: “Hoje” é só para o que começou hoje.</Text>
          <Row style={styles.wrap}>
            {STARTS.map((s) => (
              <Chip key={s.value} label={s.label} selected={start === s.value} onPress={() => setStart(s.value)} />
            ))}
          </Row>
          {start === 'outro' ? (
            <DateField value={startDay} onChangeText={setStartDay} accessibilityLabel="Dia em que começou o atual" hint="Não pode ser depois de hoje." />
          ) : null}
          {start === 'nao_sei' ? (
            <Text variant="small">{'Sem problema: toque em "Troquei hoje" quando começar um novo.'}</Text>
          ) : null}
        </View>
      )}

      {/* O aviso por notificação vem desligado: quem cadastra precisa saber onde ligar. */}
      <Card style={styles.card}>
        <Text variant="label">Aviso por notificação</Text>
        <SuppliesReminderHint />
      </Card>

      <Button title="Salvar" onPress={submit} loading={save.isPending} />

      {supply ? (
        <>
          <RefillHistory supply={supply} today={today} onDelete={(id) => removeRefill.mutate(id, { onError })} />
          <Button
            title="Excluir"
            variant="danger"
            icon="trash-can-outline"
            onPress={() =>
              confirmAction('Excluir', `Excluir "${supply.name}"? O histórico de trocas vai junto.`, 'Excluir', () =>
                remove.mutate(supply.id, { onSuccess: () => router.back(), onError }),
              )
            }
          />
        </>
      ) : null}
    </Screen>
  );
}

/** As trocas anotadas, da mais nova para a mais antiga, com quanto cada uma durou. */
function RefillHistory({ supply, today, onDelete }: { supply: Supply; today: string; onDelete: (id: string) => void }) {
  const lines = refillHistory(supply.refills);
  return (
    <Section title="Trocas">
      <Text variant="muted">{supplyRowText(supplyForecast(supply, today), today)}</Text>
      {lines.length ? (
        <ListCard>
          {lines.map((line) => {
            const day = formatBRDate(line.refill.refilled_on);
            return (
              <ListRow
                key={line.refill.id}
                title={describeRefill(line, today)}
                right={
                  <IconButton
                    icon="trash-can-outline"
                    label={`Apagar a troca de ${day}`}
                    onPress={() =>
                      confirmAction('Apagar troca', `Apagar a troca de ${day}? A previsão é refeita sem ela.`, 'Apagar', () =>
                        onDelete(line.refill.id),
                      )
                    }
                  />
                }
              />
            );
          })}
        </ListCard>
      ) : null}
      {lines.length >= REFILLS_PER_SUPPLY ? <Text variant="small">Aparecem as {REFILLS_PER_SUPPLY} trocas mais recentes.</Text> : null}
    </Section>
  );
}

const styles = StyleSheet.create({
  group: { gap: space.sm },
  wrap: { flexWrap: 'wrap' },
  card: { gap: space.md },
});
