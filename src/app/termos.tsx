import { StyleSheet } from 'react-native';

import { TERMS_SECTIONS, TERMS_TITLE, termsVersionLabel } from '@/domain/terms';
import { Card, Screen, Section, Text } from '@/ui/primitives';
import { space } from '@/ui/theme';

/**
 * Termos de uso e privacidade. Abre com ou sem conta (da tela de entrar, da aba Família e do cartão dos preços
 * compartilhados): não lê nada da casa nem do banco, só o texto de domain/terms.
 */
export default function TermsScreen() {
  return (
    <Screen>
      <Text variant="heading" accessibilityRole="header">
        {TERMS_TITLE}
      </Text>
      <Text variant="muted">{termsVersionLabel()}</Text>
      {TERMS_SECTIONS.map((section) => (
        <Section key={section.title} title={section.title}>
          <Card style={styles.card}>
            {section.paragraphs.map((paragraph) => (
              <Text key={paragraph} variant="body">
                {paragraph}
              </Text>
            ))}
          </Card>
        </Section>
      ))}
      <Text variant="small">{termsVersionLabel()}</Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: { gap: space.md },
});
