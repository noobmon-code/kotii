import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { useTermsNotice } from '@/data/terms';
import { TERMS_NOTICE_TEXT } from '@/domain/terms';
import { Button, Card, IconBadge, Row, Text } from '@/ui/primitives';
import { space } from '@/ui/theme';

/**
 * Na tela Hoje, para quem ainda não aceitou esta versão dos termos (data/terms): "Ler os termos" abre a tela
 * deles e "Entendi" grava o aceite, e o aviso não volta para esta versão. Só um aviso: o app segue igual.
 */
export function TermsNoticeCard() {
  const { notice, accept } = useTermsNotice();
  if (!notice) return null;
  const text = TERMS_NOTICE_TEXT[notice];
  return (
    <Card style={styles.card}>
      <Row style={styles.top}>
        <IconBadge icon="shield-account-outline" tone="primary" />
        <View style={styles.flex}>
          <Text variant="label">{text.title}</Text>
          <Text variant="small">{text.message}</Text>
        </View>
      </Row>
      <Row style={styles.actions}>
        <Button title="Ler os termos" variant="ghost" compact onPress={() => router.push('/termos')} />
        <Button title="Entendi" compact onPress={() => void accept()} />
      </Row>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: space.md },
  top: { gap: space.md, alignItems: 'flex-start' },
  flex: { flex: 1, gap: space.xs },
  actions: { justifyContent: 'flex-end' },
});
