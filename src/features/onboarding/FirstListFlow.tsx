import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { FIRST_LIST_CATALOG, FIRST_LIST_DONE, FIRST_LIST_SKIP, FIRST_LIST_TEXT } from '@/domain/onboarding';
import { useHousehold } from '@/lib/auth';
import { NukeLive } from '@/ui/NukeLive';
import { Button, Card, Row, Text } from '@/ui/primitives';
import { space } from '@/ui/theme';

import { InstallSheet, useInstallStep } from './InstallSheet';
import { InviteSheet } from './InviteSheet';

type Part = 'faixa' | 'convite' | 'instalar';

/**
 * A primeira lista, logo depois de criar a casa (a lista de mercado abre com `primeira=1`, e o catálogo de itens
 * comuns já aberto): uma faixa com o que fazer, "Pronto" (que chama a casa e, no navegador sem o app na tela de
 * início, oferece pôr lá) e "Agora não". No fim a pessoa fica na lista, com o que pôs nela (`onFinish` tira a faixa).
 */
export function FirstListFlow({ onCatalog, onFinish }: { onCatalog: () => void; onFinish: () => void }) {
  const house = useHousehold().data?.household;
  const installs = useInstallStep();
  const [part, setPart] = useState<Part>('faixa');

  return (
    <>
      <Card style={styles.card}>
        <Row style={styles.top}>
          <NukeLive size={44} state="talk" />
          <Text variant="body" style={styles.flex}>
            {FIRST_LIST_TEXT}
          </Text>
        </Row>
        <Row style={styles.actions}>
          <Button title={FIRST_LIST_CATALOG} icon="format-list-bulleted" variant="secondary" compact onPress={onCatalog} />
          <View style={styles.flex} />
          <Button title={FIRST_LIST_SKIP} variant="ghost" compact onPress={onFinish} />
          <Button title={FIRST_LIST_DONE} compact onPress={() => (house ? setPart('convite') : onFinish())} />
        </Row>
      </Card>
      {house ? (
        <InviteSheet
          visible={part === 'convite'}
          house={house}
          onClose={() => (installs ? setPart('instalar') : onFinish())}
        />
      ) : null}
      <InstallSheet visible={part === 'instalar'} onClose={onFinish} />
    </>
  );
}

const styles = StyleSheet.create({
  card: { gap: space.md },
  top: { gap: space.md, alignItems: 'center' },
  actions: { flexWrap: 'wrap', alignItems: 'center' },
  flex: { flex: 1 },
});
