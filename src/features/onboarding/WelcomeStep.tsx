import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import {
  INVITED_TEXT,
  INVITED_TITLE,
  WELCOME_CREATE,
  WELCOME_SIGN_IN,
  WELCOME_TITLE,
  welcomeLines,
} from '@/domain/onboarding';
import { TERMS_TITLE } from '@/domain/terms';
import { FEATURES } from '@/lib/features';
import { IconArt } from '@/ui/iconArt';
import { Button, Card, Row, Text } from '@/ui/primitives';
import { space } from '@/ui/theme';

import { OnboardingHero } from './OnboardingHero';

/**
 * As boas-vindas de quem nunca entrou neste aparelho: o que o Kotii faz, em três linhas com as artes dos atalhos da
 * Hoje, e as duas portas (criar a conta ou entrar). Quem chegou por um link de convite vê o convite no lugar do
 * título. Não pede nada.
 */
export function WelcomeStep({ invited, onCreate, onSignIn }: { invited: boolean; onCreate: () => void; onSignIn: () => void }) {
  return (
    <View style={styles.step}>
      <OnboardingHero
        mood={invited ? 'joy' : 'idle'}
        size={132}
        logo
        title={invited ? INVITED_TITLE : WELCOME_TITLE}
        text={invited ? INVITED_TEXT : undefined}
      />
      <Card style={styles.lines}>
        {welcomeLines(FEATURES.finance).map((line) => (
          <Row key={line.art} style={styles.line}>
            <IconArt name={line.art} scale={0.85} />
            <Text variant="body" style={styles.flex}>
              {line.text}
            </Text>
          </Row>
        ))}
      </Card>
      <Button title={WELCOME_CREATE} onPress={onCreate} />
      <Button title={WELCOME_SIGN_IN} variant="secondary" onPress={onSignIn} />
      <Button title={TERMS_TITLE} variant="ghost" compact onPress={() => router.push('/termos')} />
    </View>
  );
}

const styles = StyleSheet.create({
  step: { gap: space.lg },
  lines: { gap: space.md },
  line: { gap: space.md },
  flex: { flex: 1 },
});
