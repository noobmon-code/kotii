import { useMemo, useState } from 'react';
import { View } from 'react-native';

import { useLatestPrices, useStores } from '@/data/market';
import { useSharedPrices } from '@/data/sharedPrices';
import {
  describeSharedPrice,
  seenLabel,
  SHARED_PRICES_MORE,
  SHARED_PRICES_NOTICE,
  SHARED_PRICES_TITLE,
  SHARED_ROWS_SHOWN,
  sharedPriceLabel,
  sharedRowsByProduct,
  SHARING_ABOUT,
  SHARING_TITLE,
} from '@/domain/sharedPrices';
import { Button, Card, IconBadge, ListCard, ListRow, Section, Text } from '@/ui/primitives';

/**
 * "Visto em outras casas", na tela do produto: quanto ele custou em cada
 * mercado nas notas de outras casas, com o dia em que foi visto e o aviso de
 * que não é em tempo real. Só aparece com algo a mostrar. Sem os preços e os
 * mercados da própria casa carregados não dá para tirar o que é compra dela
 * mesma, então não mostra nada; e nunca vira erro na tela.
 */
export function SharedPricesSection({ productId }: { productId: string }) {
  const shared = useSharedPrices();
  const own = useLatestPrices();
  const stores = useStores();
  const [showAll, setShowAll] = useState(false);

  const rows = useMemo(
    () => (shared.data && own.data && stores.data ? (sharedRowsByProduct(shared.data, own.data, stores.data).get(productId) ?? []) : []),
    [shared.data, own.data, stores.data, productId],
  );
  if (!rows.length) return null;
  const shown = showAll ? rows : rows.slice(0, SHARED_ROWS_SHOWN);

  return (
    <Section title={SHARED_PRICES_TITLE}>
      <ListCard>
        {shown.map((row) => (
          // Para o leitor de tela, a linha inteira de uma vez: preço, mercado e dia.
          <View key={`${row.storeCnpj} ${row.unit}`} accessible accessibilityLabel={describeSharedPrice(row)}>
            <ListRow
              left={<IconBadge icon="store-outline" />}
              title={row.storeName}
              subtitle={seenLabel(row)}
              right={<Text variant="label">{sharedPriceLabel(row)}</Text>}
            />
          </View>
        ))}
      </ListCard>
      {rows.length > shown.length ? <Button title={SHARED_PRICES_MORE} variant="ghost" compact onPress={() => setShowAll(true)} /> : null}
      <Text variant="small">{SHARED_PRICES_NOTICE}</Text>
    </Section>
  );
}

/**
 * Aba Família: o que a casa compartilha. Só quando o compartilhamento existe
 * no banco (a função respondeu); antes da migração, nada. Não há chave para
 * desligar: vale para toda casa, pelos termos de uso.
 */
export function SharedPricesAbout() {
  const shared = useSharedPrices();
  if (!shared.data) return null;
  return (
    <Section title={SHARING_TITLE}>
      <Card>
        <Text variant="muted">{SHARING_ABOUT}</Text>
      </Card>
    </Section>
  );
}
