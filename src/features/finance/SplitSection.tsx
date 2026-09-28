import { useState } from 'react';
import { Modal, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAddSettlement, useDeleteSettlement, useSaveSplitWeights, useSettlements, useSplitWeights } from '@/data/finance';
import type { Entry } from '@/domain/finance';
import { formatBRL, parseDecimal } from '@/domain/money';
import { splitMonth } from '@/domain/split';
import { useHousehold } from '@/lib/auth';
import { errorMessage } from '@/lib/supabase';
import { Backdrop } from '@/ui/Backdrop';
import { confirmAction, notify } from '@/ui/dialogs';
import { Badge, Button, Card, IconButton, Row, Section, Text, TextField } from '@/ui/primitives';
import { MAX_WIDTH, space, useColors } from '@/ui/theme';

/**
 * Divisão da casa no mês: quanto cada morador pagou, a parte de cada um e
 * quem passa quanto para quem. Só aparece com dois moradores ou mais.
 */
export function SplitSection({ entries, month, monthName }: { entries: Entry[]; month: string; monthName: string }) {
  const members = useHousehold().data?.members ?? [];
  const weights = useSplitWeights();
  const settlements = useSettlements(month);
  const addSettlement = useAddSettlement();
  const removeSettlement = useDeleteSettlement();
  const [editingWeights, setEditingWeights] = useState(false);

  if (members.length < 2 || !weights.data || !settlements.data) return null;

  const people = members.map((m) => ({ userId: m.user_id, name: m.display_name }));
  const nameOf = (id: string) => people.find((p) => p.userId === id)?.name ?? 'Alguém';
  const result = splitMonth({
    entries: entries.map((e) => ({ amount: e.amount, paidBy: e.paidBy ?? null })),
    members: people,
    weights: weights.data,
    settlements: settlements.data.map((s) => ({ from: s.from_user, to: s.to_user, amount: s.amount })),
  });
  const onError = (err: unknown) => notify('Erro', errorMessage(err));
  const equal = people.every((p) => (weights.data[p.userId] ?? 1) === (weights.data[people[0].userId] ?? 1));

  return (
    <Section
      title="Divisão da casa"
      action={<Button title="Como dividir" icon="scale-balance" variant="ghost" compact onPress={() => setEditingWeights(true)} />}>
      <Card style={styles.gap}>
        <Text variant="small">
          {equal ? 'Dividindo igual' : 'Dividindo por peso'} os gastos de {monthName} com quem pagou marcado.
        </Text>
        {result.rows.map((row) => (
          <Row key={row.userId}>
            <View style={styles.flex}>
              <Text variant="label">{row.name}</Text>
              <Text variant="small">
                Pagou {formatBRL(row.paid)} · parte {formatBRL(row.share)}
              </Text>
            </View>
            {Math.abs(row.balance) >= 0.01 ? (
              <Badge
                label={row.balance > 0 ? `recebe ${formatBRL(row.balance)}` : `deve ${formatBRL(-row.balance)}`}
                tone={row.balance > 0 ? 'primary' : 'warning'}
              />
            ) : (
              <Badge label="em dia" />
            )}
          </Row>
        ))}

        {result.transfers.map((t) => (
          <Row key={`${t.from}-${t.to}`} style={styles.transfer}>
            <Text variant="body" style={styles.flex}>
              {nameOf(t.from)} passa {formatBRL(t.amount)} para {nameOf(t.to)}
            </Text>
            <Button
              title="Acertei"
              icon="check"
              compact
              loading={addSettlement.isPending}
              onPress={() =>
                confirmAction(
                  'Registrar acerto',
                  `${nameOf(t.from)} passou ${formatBRL(t.amount)} para ${nameOf(t.to)} (Pix, dinheiro)?`,
                  'Registrar',
                  () => addSettlement.mutate({ month, from_user: t.from, to_user: t.to, amount: t.amount }, { onError }),
                  false,
                )
              }
            />
          </Row>
        ))}
        {!result.transfers.length && result.total > 0 ? <Text variant="muted">Tudo certo em {monthName}.</Text> : null}
        {result.unassigned > 0 ? (
          <Text variant="small">{formatBRL(result.unassigned)} sem quem pagou ficam de fora: marque no gasto, na conta ou na nota.</Text>
        ) : null}

        {settlements.data.map((s) => (
          <Row key={s.id}>
            <Text variant="small" style={styles.flex}>
              Acerto: {nameOf(s.from_user)} passou {formatBRL(s.amount)} para {nameOf(s.to_user)}
            </Text>
            <IconButton
              icon="undo-variant"
              label="Desfazer acerto"
              onPress={() =>
                confirmAction('Desfazer acerto', 'O valor volta a aparecer como devido.', 'Desfazer', () =>
                  removeSettlement.mutate(s.id, { onError }),
                )
              }
            />
          </Row>
        ))}
      </Card>

      {editingWeights ? (
        <WeightsModal people={people} weights={weights.data} onClose={() => setEditingWeights(false)} />
      ) : null}
    </Section>
  );
}

function WeightsModal({
  people,
  weights,
  onClose,
}: {
  people: { userId: string; name: string }[];
  weights: Record<string, number>;
  onClose: () => void;
}) {
  const c = useColors();
  const save = useSaveSplitWeights();
  const [values, setValues] = useState(() =>
    Object.fromEntries(people.map((p) => [p.userId, String(weights[p.userId] ?? 1).replace('.', ',')])),
  );

  function submit() {
    const parsed = Object.entries(values).map(([id, text]) => [id, parseDecimal(text)] as const);
    if (parsed.some(([, w]) => w == null || w <= 0 || w > 1000)) {
      notify('Peso inválido', 'Use números maiores que zero, como 1, 2 ou 1,5.');
      return;
    }
    save.mutate(Object.fromEntries(parsed) as Record<string, number>, {
      onSuccess: onClose,
      onError: (err) => notify('Erro', errorMessage(err)),
    });
  }

  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={[styles.flex, { backgroundColor: c.background }]}>
        <Backdrop />
        <ScrollView contentContainerStyle={styles.modal} keyboardShouldPersistTaps="handled">
          <Row>
            <Text variant="heading" style={styles.flex}>
              Como dividir
            </Text>
            <IconButton icon="close" label="Fechar" onPress={onClose} />
          </Row>
          <Text variant="muted">
            Peso igual para todos divide meio a meio. Quem tem peso 2 fica com o dobro da parte de quem tem 1 (por exemplo, pela
            renda de cada um).
          </Text>
          {people.map((p) => (
            <TextField
              key={p.userId}
              label={p.name}
              value={values[p.userId]}
              onChangeText={(text) => setValues((prev) => ({ ...prev, [p.userId]: text }))}
              keyboardType="decimal-pad"
            />
          ))}
          <Button
            title="Dividir igual"
            variant="secondary"
            onPress={() => setValues(Object.fromEntries(people.map((p) => [p.userId, '1'])))}
          />
          <Button title="Salvar" onPress={submit} loading={save.isPending} />
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  gap: { gap: space.md },
  transfer: { flexWrap: 'wrap' },
  modal: { width: '100%', maxWidth: MAX_WIDTH, alignSelf: 'center', padding: space.lg, gap: space.lg },
});
