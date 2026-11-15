import { StyleSheet, View } from 'react-native';

import { Logo } from '@/ui/art';
import { NukeLive, type NukeState } from '@/ui/NukeLive';
import { Card, Icon, Row, Text } from '@/ui/primitives';
import { space } from '@/ui/theme';

/** O topo de cada passo do começo: o Nuke com o humor do passo, o título (o cabeçalho da tela) e a frase. */
export function OnboardingHero({
  mood = 'idle',
  size = 112,
  logo = false,
  title,
  text,
}: {
  mood?: NukeState;
  size?: number;
  /** A marca "k" ao lado do nome, só nas boas-vindas. */
  logo?: boolean;
  title: string;
  text?: string;
}) {
  return (
    <View style={styles.hero}>
      <NukeLive size={size} state={mood} hop />
      {logo ? <Logo size={32} /> : null}
      <Text variant="title" accessibilityRole="header" style={styles.center}>
        {title}
      </Text>
      {text ? (
        <Text variant="muted" style={styles.center}>
          {text}
        </Text>
      ) : null}
    </View>
  );
}

/** O aviso da prévia, em cima de cada passo: o que é de mentira e o que é de verdade. */
export function PreviewNotice({ text }: { text: string }) {
  return (
    <Card>
      <Row style={styles.top}>
        <Icon name="eye-outline" color="primary" />
        <Text variant="small" style={styles.flex}>
          {text}
        </Text>
      </Row>
    </Card>
  );
}

const styles = StyleSheet.create({
  hero: { alignItems: 'center', gap: space.md, paddingTop: space.lg },
  center: { textAlign: 'center' },
  top: { alignItems: 'flex-start' },
  flex: { flex: 1 },
});
