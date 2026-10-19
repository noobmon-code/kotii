import { router, useNavigation } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet } from 'react-native';

import { TERMS_SECTIONS, TERMS_TITLE, termsVersionLabel } from '@/domain/terms';
import { Button, Card, Screen, Section, Text } from '@/ui/primitives';
import { space } from '@/ui/theme';

/**
 * Termos de uso e privacidade. Abre com ou sem conta (da tela de entrar, da aba Família e do cartão dos preços
 * compartilhados): não lê nada da casa nem do banco, só o texto de domain/terms.
 */
export default function TermsScreen() {
  const canGoBack = useCanGoBack();
  return (
    <Screen>
      {canGoBack ? null : (
        <Button title="Voltar" icon="arrow-left" variant="ghost" compact style={styles.back} onPress={() => router.replace('/')} />
      )}
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

/**
 * Se há para onde voltar. Não há quando os termos abrem direto pelo endereço, no navegador, nem quando uma guarda
 * do _layout muda com eles abertos (a conta entrou ou saiu): as telas da guarda desligada somem da pilha e os
 * termos ficam sozinhos nela. Sem isso, a pessoa ficaria presa aqui; o "Voltar" leva ao começo do app, que abre
 * a tela certa para o estado da conta.
 */
function useCanGoBack() {
  const navigation = useNavigation();
  const [canGoBack, setCanGoBack] = useState(() => router.canGoBack());
  useEffect(() => {
    return navigation.addListener('state', () => setCanGoBack(router.canGoBack()));
  }, [navigation]);
  return canGoBack;
}

const styles = StyleSheet.create({
  back: { alignSelf: 'flex-start' },
  card: { gap: space.md },
});
