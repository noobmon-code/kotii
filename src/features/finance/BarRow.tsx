import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Row, Text } from '@/ui/primitives';
import { useColors } from '@/ui/theme';

/**
 * Uma linha de barra horizontal, de uma cor só: nome, valor, parte do total
 * e a barra, na proporção da maior (`max`). Usada no resumo de gastos e no
 * mercado do mês; o toque escolhe a linha (quem usa filtra o que vem abaixo).
 */
export function BarRow({
  left,
  label,
  amount,
  share,
  value,
  max,
  selected = false,
  muted = false,
  note,
  accessibilityLabel,
  onPress,
}: {
  left: ReactNode;
  label: string;
  /** O valor por extenso ("R$ 180,00") e a parte ("22%"). */
  amount: string;
  share: string;
  /** O tamanho da barra: `value` sobre `max`, o maior da lista. */
  value: number;
  max: number;
  selected?: boolean;
  /** Outra linha está escolhida: esta fica em cinza. */
  muted?: boolean;
  /** Uma frase embaixo da barra. */
  note?: string;
  accessibilityLabel: string;
  onPress: () => void;
}) {
  const c = useColors();
  const width = max > 0 ? Math.max(1, (value / max) * 100) : 0;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      style={styles.barRow}>
      <Row>
        {left}
        <Text variant="body" style={styles.flex} numberOfLines={1}>
          {label}
        </Text>
        <Text variant="label">{amount}</Text>
        <Text variant="small" style={styles.share}>
          {share}
        </Text>
      </Row>
      <View
        style={[
          styles.bar,
          { width: `${width}%`, backgroundColor: muted ? c.textMuted : c.primary, opacity: muted ? 0.35 : 1 },
        ]}
      />
      {note ? <Text variant="small">{note}</Text> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  barRow: { gap: 6 },
  share: { width: 36, textAlign: 'right' },
  // Começa reta no eixo, ponta arredondada.
  bar: { height: 8, borderTopRightRadius: 4, borderBottomRightRadius: 4 },
});
