import { Pressable, StyleSheet, View } from 'react-native';

import type { FeedbackKind, FeedbackRow, FeedbackStatus } from '@/domain/appFeedback';
import { Badge, Icon, Text, type Tone } from '@/ui/primitives';
import { radius, space, useColors } from '@/ui/theme';

/** A cor do selo do tipo: o problema em vermelho, a sugestão em amarelo, o elogio em azul. */
export const FEEDBACK_KIND_TONES: Record<FeedbackKind, Tone> = {
  problema: 'danger',
  sugestao: 'warning',
  elogio: 'info',
  outro: 'neutral',
};

/** A cor do selo da situação: só o novo chama a atenção. */
export const FEEDBACK_STATUS_TONES: Record<FeedbackStatus, Tone> = {
  novo: 'primary',
  lido: 'neutral',
  resolvido: 'neutral',
  arquivado: 'neutral',
};

/**
 * Uma linha da caixa de recados (feedbackRow, de domain/appFeedback): o começo do recado, a data, os selos do
 * tipo e da situação, o e-mail e o sinal de nota. O recado ainda não aberto tem o ponto azul e o título mais
 * forte. Na janela larga, o aberto fica em destaque (`selected`); no celular, a linha abre o recado embaixo dela
 * (`expanded`). O leitor de tela lê a linha numa frase só.
 */
export function FeedbackRowView({
  row,
  selected,
  expanded,
  onPress,
}: {
  row: FeedbackRow;
  selected?: boolean;
  expanded?: boolean;
  onPress: () => void;
}) {
  const c = useColors();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={row.accessibilityLabel}
      accessibilityState={expanded === undefined ? { selected: Boolean(selected) } : { expanded }}
      onPress={onPress}
      style={({ pressed }) => [styles.row, selected && { backgroundColor: c.primarySoft }, pressed && styles.pressed]}>
      <View style={styles.top}>
        <View style={[styles.dot, { backgroundColor: c.primary }, !row.isNew && styles.hidden]} />
        <Text variant={row.isNew ? 'rowTitle' : 'body'} numberOfLines={2} style={styles.flex}>
          {row.title}
        </Text>
        <Text variant="small">{row.when}</Text>
      </View>
      <View style={styles.meta}>
        <Badge label={row.kindLabel} tone={FEEDBACK_KIND_TONES[row.kind]} />
        <Badge label={row.statusLabel} tone={FEEDBACK_STATUS_TONES[row.status]} />
        {row.hasNote ? <Icon name="note-text-outline" size={16} color="textMuted" /> : null}
        {row.email ? (
          <Text variant="small" numberOfLines={1} style={styles.shrink}>
            {row.email}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

const DOT = 8;

const styles = StyleSheet.create({
  flex: { flex: 1 },
  shrink: { flexShrink: 1 },
  row: { gap: space.xs, paddingVertical: space.md, paddingHorizontal: space.md, borderRadius: radius.sm },
  pressed: { opacity: 0.7 },
  top: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm },
  // O ponto fica no meio da primeira linha do título (22 de altura).
  dot: { width: DOT, height: DOT, borderRadius: DOT / 2, marginTop: (22 - DOT) / 2 },
  hidden: { opacity: 0 },
  // Embaixo do título, alinhado com ele (depois do ponto).
  meta: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.sm, paddingLeft: DOT + space.sm },
});
