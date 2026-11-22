import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { FIRST_LIST_CATALOG, FIRST_LIST_DONE, FIRST_LIST_SKIP, FIRST_LIST_TEXT } from '@/domain/onboarding';
import { useHousehold } from '@/lib/auth';
import { NukeLive } from '@/ui/NukeLive';
import { Button, Card, Row, Text } from '@/ui/primitives';
import { space } from '@/ui/theme';

import { InstallSheet, useInstallStep } from './InstallSheet';
import { InviteSheet } from './InviteSheet';

/** `fim`: a faixa já saiu da tela, e o último menu ainda desce (no iOS) antes do `onFinish`. */
type Part = 'faixa' | 'convite' | 'instalar' | 'fim';

/**
 * A primeira lista, logo depois de criar a casa (a lista de mercado abre com `primeira=1`, e o catálogo de itens
 * comuns já aberto): uma faixa com o que fazer, "Pronto" (que chama a casa e, no navegador sem o app na tela de
 * início, oferece pôr lá) e "Agora não". No fim a pessoa fica na lista, com o que pôs nela (`onFinish` tira a faixa).
 *
 * `onFinish` desmonta esta parte, e com ela o menu que estiver na tela. No iOS a escolha do menu (o WhatsApp, o menu de
 * compartilhar, copiar) só roda quando ele acaba de descer (ui/ActionSheet): por isso, depois de um menu, a faixa some
 * já (`fim`) e o `onFinish` espera o menu sair (`onClosed`), senão o convite escolhido nunca sairia.
 */
export function FirstListFlow({ onCatalog, onFinish }: { onCatalog: () => void; onFinish: () => void }) {
  const house = useHousehold().data?.household;
  const installs = useInstallStep();
  const [part, setPart] = useState<Part>('faixa');

  return (
    <>
      {part === 'fim' ? null : (
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
      )}
      {house ? (
        <InviteSheet
          visible={part === 'convite'}
          house={house}
          onClose={() => setPart(installs ? 'instalar' : 'fim')}
          onClosed={installs ? undefined : onFinish}
        />
      ) : null}
      <InstallSheet visible={part === 'instalar'} onClose={() => setPart('fim')} onClosed={onFinish} />
    </>
  );
}

const styles = StyleSheet.create({
  card: { gap: space.md },
  top: { gap: space.md, alignItems: 'center' },
  actions: { flexWrap: 'wrap', alignItems: 'center' },
  flex: { flex: 1 },
});
