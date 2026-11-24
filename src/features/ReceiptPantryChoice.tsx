import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { formatBRDate, parseBRDate } from '@/domain/dates';
import { FROZEN_CHIP, FROZEN_QUESTION, frozenChipLabel, type FreezeDays } from '@/domain/freezer';
import { pantryChoiceLabel, receiptExpiryHint, type ResolvedItem } from '@/domain/receiptReview';
import { notify } from '@/ui/dialogs';
import { Chip, DateField, Row, Text } from '@/ui/primitives';

/**
 * O que a linha da nota faz na despensa: o chip "Vai para a despensa", a validade e, em carnes e peixes, "Congelou?"
 * com o "Congelei" (domain/freezer, receiptFreezeKind), e embaixo de onde veio a validade. Serve à linha da revisão
 * e à linha incluída depois numa nota confirmada: as regras são as de pantryEntry (domain/receiptReview). Sem
 * `onChangeExpiry` (o item que faltou numa nota confirmada), sem o campo da validade nem a frase de onde ela veio: a
 * data se corrige depois, na despensa.
 */
export function ReceiptPantryChoice({
  rawDescription,
  resolved,
  freezer,
  onTogglePantry,
  onChangeExpiry,
  onToggleFrozen,
}: {
  /** O texto impresso da linha: o leitor de tela diz de qual linha é cada campo. */
  rawDescription: string;
  resolved: Pick<ResolvedItem, 'pantry' | 'expiresOn' | 'expirySource' | 'frozen' | 'freezeKind'>;
  /** Os dias do congelador (useFreezer): null sem ele no banco, e aí não pergunta. */
  freezer: FreezeDays | null;
  onTogglePantry: () => void;
  onChangeExpiry?: (iso: string | null) => void;
  onToggleFrozen: (on: boolean) => void;
}) {
  const [expiryText, setExpiryText] = useState<string | null>(null);

  /** Grava a validade que ficou digitada no campo; false quando ela não dá para ler (e nada muda). */
  function commitExpiry(): boolean {
    if (expiryText == null || !onChangeExpiry) return true;
    if (!expiryText.trim()) {
      onChangeExpiry(null);
    } else {
      const iso = parseBRDate(expiryText);
      if (!iso) {
        notify('Data inválida', 'Use o formato dd/mm/aaaa.');
        return false;
      }
      onChangeExpiry(iso);
    }
    setExpiryText(null);
    return true;
  }

  // A data digitada e ainda não gravada vai antes: digitada antes de marcar, ela vira a validade de antes do
  // congelador; com "Congelei" marcado, é a do congelador (toggleFrozen).
  function toggleFrozen() {
    if (commitExpiry()) onToggleFrozen(!resolved.frozen);
  }

  const hint = onChangeExpiry ? receiptExpiryHint(resolved, freezer) : null;
  return (
    <>
      <Row style={styles.wrap}>
        <Chip label={pantryChoiceLabel(resolved.pantry)} icon="fridge-outline" selected={resolved.pantry} onPress={onTogglePantry} />
        {resolved.pantry && onChangeExpiry ? (
          <View style={styles.expiry}>
            <DateField
              value={expiryText ?? (resolved.expiresOn ? formatBRDate(resolved.expiresOn) : '')}
              placeholder="Validade"
              onChangeText={setExpiryText}
              onBlur={commitExpiry}
              onSubmitEditing={commitExpiry}
              accessibilityLabel={`Validade de ${rawDescription}`}
            />
          </View>
        ) : null}
      </Row>
      {resolved.pantry && resolved.freezeKind ? (
        <Row style={styles.wrap}>
          <Text variant="small">{FROZEN_QUESTION}</Text>
          <Chip
            label={FROZEN_CHIP}
            icon="snowflake"
            toggle
            selected={resolved.frozen}
            accessibilityLabel={frozenChipLabel(rawDescription)}
            onPress={toggleFrozen}
          />
        </Row>
      ) : null}
      {hint ? <Text variant="small">{hint}</Text> : null}
    </>
  );
}

// Os mesmos da linha da revisão (nota/[id].tsx), de onde o chip e a validade vieram.
const styles = StyleSheet.create({
  wrap: { flexWrap: 'wrap' },
  expiry: { width: 140 },
});
