import type { Ref } from 'react';
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
 * (`expanded`). O leitor de tela lê a linha numa frase só. `ref` chega à linha tocável (no navegador, o elemento da
 * página): a caixa leva até ela a rolagem e o foco quando as teclas mudam o recado aberto.
 */
export function FeedbackRowView({
  row,
  selected,
  expanded,
  onPress,
  ref,
}: {
  row: FeedbackRow;
  selected?: boolean;
  expanded?: boolean;
  onPress: () => void;
  ref?: Ref<View>;
}) {
  const c = useColors();
  return (
    <Pressable
      ref={ref}
      accessibilityRole="button"
      accessibilityLabel={row.accessibilityLabel}
      accessibilityState={expanded === undefined ? { selected: Boolean(selected) } : { expanded }}
      // Na web o react-native-web não repassa o accessibilityState: só os aria-* chegam ao HTML. O aberto na janela
      // larga é o aria-current (o aria-selected não vale num botão).
      aria-expanded={expanded}
      {...webCurrent(expanded === undefined && Boolean(selected))}
      onPress={onPress}
      style={({ pressed }) => [styles.row, selected && { backgroundColor: c.primarySoft }, pressed && styles.pressed]}>
      <View style={styles.top}>
        <View style={[styles.dot, { backgroundColor: c.primary }, !row.isNew && styles.hidden]} />
        <Text variant={row.isNew ? 'rowTitle' : 'body'} numberOfLines={2} style={styles.title}>
          {row.title}
        </Text>
        <Text variant="small" style={styles.when}>
          {row.when}
        </Text>
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

/** O `aria-current` da linha aberta (os tipos do React Native não o conhecem; o react-native-web o passa ao HTML). */
function webCurrent(current: boolean): object {
  return current ? { 'aria-current': 'true' } : {};
}

const DOT = 8;

/** Onde começa o texto da linha (depois do ponto): o recado aberto embaixo da linha, no celular, alinha com ele. */
export const ROW_TEXT_INSET = space.md + DOT + space.sm;

const styles = StyleSheet.create({
  // minWidth 0: um link ou uma chave de nota sem espaço quebra dentro das duas linhas, e a data fica na tela.
  title: { flex: 1, minWidth: 0 },
  when: { flexShrink: 0 },
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
