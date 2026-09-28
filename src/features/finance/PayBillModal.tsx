import { useState } from 'react';
import { Modal, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { usePayBill, useSetPaymentPayer } from '@/data/finance';
import { parseBoleto } from '@/domain/boleto';
import { formatBRDate, parseBRDate, todayISO } from '@/domain/dates';
import { parseDecimal } from '@/domain/money';
import { PayerChips } from '@/features/finance/PayerChips';
import { useAuth } from '@/lib/auth';
import { errorMessage } from '@/lib/supabase';
import type { Bill } from '@/lib/types';
import { Backdrop } from '@/ui/Backdrop';
import { notify } from '@/ui/dialogs';
import { Button, DateField, IconButton, Row, Text, TextField } from '@/ui/primitives';
import { MAX_WIDTH, space, useColors } from '@/ui/theme';

/** Confirma o pagamento do vencimento atual da conta (valor e data). Renderize só quando aberto. */
export function PayBillModal({ bill, onClose }: { bill: Bill; onClose: () => void }) {
  const c = useColors();
  const pay = usePayBill();
  const setPayer = useSetPaymentPayer();
  const me = useAuth().session?.user.id ?? null;
  const [paidBy, setPaidBy] = useState(me);
  // O boleto guardado traz o valor deste vencimento.
  const boletoAmount = bill.boleto ? (parseBoleto(bill.boleto, todayISO())?.amount ?? null) : null;
  const suggested = boletoAmount ?? bill.amount;
  const [amount, setAmount] = useState(suggested != null ? suggested.toLocaleString('pt-BR', { minimumFractionDigits: 2 }) : '');
  const [paidOn, setPaidOn] = useState(formatBRDate(todayISO()));

  function confirm() {
    const value = parseDecimal(amount);
    const paidISO = parseBRDate(paidOn);
    if (value == null) {
      notify('Informe o valor', 'Use um valor como 187,40.');
      return;
    }
    if (!paidISO) {
      notify('Data inválida', 'Use dd/mm/aaaa.');
      return;
    }
    pay.mutate(
      { bill, amount: value, paidOn: paidISO },
      {
        onSuccess: ({ paid }) => {
          // Outra pessoa da casa já tinha pago este vencimento.
          if (!paid) {
            notify('Já estava paga', `${bill.name} com vencimento em ${formatBRDate(bill.next_due_on)} já tinha sido paga.`);
          } else if (paidBy && paidBy !== me) {
            // O pagamento sai no nome de quem registrou; aqui vai para quem pagou de fato.
            // Promessa, e não callback do mutate: o modal fecha logo abaixo e o erro ainda precisa aparecer.
            setPayer
              .mutateAsync({ billId: bill.id, dueOn: bill.next_due_on, paidBy })
              .catch((err) => notify('Não deu para marcar quem pagou', errorMessage(err)));
          }
          onClose();
        },
        onError: (err) => notify('Erro', errorMessage(err)),
      },
    );
  }

  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={[styles.flex, { backgroundColor: c.background }]}>
        <Backdrop />
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Row>
            <Text variant="heading" style={styles.flex}>
              Pagar {bill.name}
            </Text>
            <IconButton icon="close" label="Fechar" onPress={onClose} />
          </Row>
          <Text variant="muted">Vencimento em {formatBRDate(bill.next_due_on)}</Text>
          <TextField
            label="Valor pago"
            value={amount}
            onChangeText={setAmount}
            keyboardType="decimal-pad"
            placeholder="0,00"
            autoFocus={suggested == null}
            hint={
              boletoAmount != null
                ? 'Valor do boleto guardado na conta.'
                : bill.amount == null
                  ? 'Esta conta varia: confira o valor no boleto.'
                  : undefined
            }
          />
          <DateField label="Pago em" value={paidOn} onChangeText={setPaidOn} />
          <PayerChips value={paidBy} onChange={setPaidBy} />
          <Button title="Confirmar pagamento" icon="check" onPress={confirm} loading={pay.isPending} />
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { width: '100%', maxWidth: MAX_WIDTH, alignSelf: 'center', padding: space.lg, gap: space.lg },
});
