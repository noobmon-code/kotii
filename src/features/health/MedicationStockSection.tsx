import { useState } from 'react';
import { StyleSheet } from 'react-native';

import { toSchedule, useRestockMedication } from '@/data/home';
import {
  describePrescription,
  describeStock,
  parseUnits,
  prescriptionStatus,
  restock,
  stockStatus,
  type StockCount,
  type StockForm,
} from '@/domain/medicationStock';
import { lastBoxUnits, rememberBoxUnits } from '@/lib/medicationBox';
import { errorMessage } from '@/lib/supabase';
import type { Medication } from '@/lib/types';
import { notify } from '@/ui/dialogs';
import { Button, Card, DateField, Row, Text, TextField } from '@/ui/primitives';
import { space } from '@/ui/theme';

/**
 * "Estoque e receita" do remédio: quanto tem, quanto cada dose usa, com
 * quantos dias avisar e até quando a receita vale. Os campos são texto do
 * formulário (quem salva é a tela, com readStockForm); "Comprei mais" grava
 * na hora e devolve a contagem nova por `onRestocked`.
 */
export function MedicationStockSection({
  medication,
  form,
  initial,
  today,
  onChange,
  onRestocked,
}: {
  /** O remédio salvo (sem ele, é um remédio novo: só os campos). */
  medication?: Medication;
  form: StockForm;
  /** Os campos como a tela abriu: as frases valem enquanto a pessoa não mexe neles. */
  initial: StockForm;
  today: string;
  onChange: (patch: Partial<StockForm>) => void;
  onRestocked: (count: StockCount) => void;
}) {
  const restockMutation = useRestockMedication();
  // null: fechado; texto: quantas unidades vieram na caixa.
  const [box, setBox] = useState<string | null>(null);
  const schedule = medication ? toSchedule(medication) : null;
  // As frases falam do que está salvo: com o número mudado e ainda não salvo, a do estoque some.
  const stockText = schedule && form.stock === initial.stock ? describeStock(stockStatus(schedule, today), today) : null;
  const prescriptionText =
    schedule && form.prescription === initial.prescription ? describePrescription(prescriptionStatus(schedule, today), today) : null;

  async function openBox() {
    if (!medication) return;
    // A última caixa deste remédio costuma ser igual à próxima.
    setBox((await lastBoxUnits(medication.id)) ?? '');
  }

  function addBox() {
    if (!medication || !schedule || box === null) return;
    const units = parseUnits(box);
    if (!units) {
      notify('Quantidade inválida', 'Informe quantas unidades vieram, como 30.');
      return;
    }
    const count = restock(schedule, today, units);
    restockMutation.mutate(
      { id: medication.id, count },
      {
        onSuccess: () => {
          rememberBoxUnits(medication.id, box.trim());
          setBox(null);
          onRestocked(count);
        },
        onError: (err) => notify('Não deu para registrar a compra', errorMessage(err)),
      },
    );
  }

  return (
    <Card style={styles.group}>
      <Text variant="heading">Estoque e receita</Text>
      <Text variant="muted">Opcional: para o Kotii avisar antes de a caixa acabar e de a receita vencer.</Text>
      <TextField
        label="Quanto tem agora"
        value={form.stock}
        onChangeText={(stock) => onChange({ stock })}
        keyboardType="decimal-pad"
        placeholder="Ex.: 30"
        hint="Em comprimidos, cápsulas ou doses. A partir de amanhã, o app desconta cada dose prevista. Vazio, ele não acompanha o estoque."
      />
      {stockText ? <Text variant="label">{stockText}</Text> : null}
      {medication ? (
        box === null ? (
          <Button title="Comprei mais" variant="secondary" icon="plus" onPress={openBox} />
        ) : (
          <>
            <TextField
              label="Quantas unidades vieram"
              value={box}
              onChangeText={setBox}
              keyboardType="decimal-pad"
              placeholder="Ex.: 30"
              hint="O app soma ao que ainda tem, pelas contas dele, e recomeça a conta de hoje."
              autoFocus
            />
            <Row>
              <Button title="Somar ao estoque" onPress={addBox} loading={restockMutation.isPending} style={styles.flex} />
              <Button title="Cancelar" variant="secondary" onPress={() => setBox(null)} disabled={restockMutation.isPending} />
            </Row>
          </>
        )
      ) : null}
      <TextField
        label="Cada dose usa"
        value={form.doseUnits}
        onChangeText={(doseUnits) => onChange({ doseUnits })}
        keyboardType="decimal-pad"
        hint="Quantas unidades por dose: 1, 2 ou 0,5 (meio comprimido)."
      />
      <TextField
        label="Avisar quando faltar"
        value={form.warnDays}
        onChangeText={(warnDays) => onChange({ warnDays })}
        keyboardType="number-pad"
        hint="Em dias, de 1 a 60."
      />
      <DateField
        label="Receita vale até"
        value={form.prescription}
        onChangeText={(prescription) => onChange({ prescription })}
        hint="Se o remédio precisa de receita. O app avisa 15 dias antes de ela vencer."
      />
      {prescriptionText ? <Text variant="label">{prescriptionText}</Text> : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  group: { gap: space.sm },
});
