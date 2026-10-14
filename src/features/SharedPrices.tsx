import { useMemo, useState } from 'react';

import { useLatestPrices, useStores } from '@/data/market';
import { useSharedPrices, useSharedPricesAvailable } from '@/data/sharedPrices';
import {
  describeSharedPrice,
  seenLabel,
  SHARED_PRICES_MINE,
  SHARED_PRICES_MORE,
  SHARED_PRICES_NOTICE,
  SHARED_PRICES_OTHERS,
  SHARED_PRICES_TITLE,
  SHARED_ROWS_SHOWN,
  SHARED_ROWS_STEP,
  sharedPriceLabel,
  type SharedPriceRow,
  sharedRowsByProduct,
  sharedStoreLabel,
  SHARING_ABOUT,
  SHARING_TITLE,
} from '@/domain/sharedPrices';
import { settledData } from '@/lib/settledData';
import { Button, Card, IconBadge, ListCard, ListRow, Section, Text } from '@/ui/primitives';

/**
 * "Visto em outras casas", na tela do produto: quanto ele custou nas notas de
 * outras casas, primeiro nos mercados da própria casa (com o nome que ela
 * conhece) e depois em outros do estado, com o dia em que foi visto e o aviso
 * de que não é em tempo real. Só aparece com algo a mostrar, e só com os
 * preços e os mercados da casa em dia: durante uma busca nova (ou depois de
 * uma que falhou) o que ficou guardado é de antes, e a compra de agora
 * apareceria como de outra casa. Nunca vira erro na tela.
 */
export function SharedPricesSection({ productId }: { productId: string }) {
  const shared = useSharedPrices();
  const own = settledData(useLatestPrices());
  const stores = settledData(useStores());

  const rows = useMemo(
    () => (shared.data && own && stores ? (sharedRowsByProduct(shared.data, own, stores).get(productId) ?? []) : []),
    [shared.data, own, stores, productId],
  );
  if (!rows.length) return null;

  return (
    <Section title={SHARED_PRICES_TITLE}>
      <SharedPriceList title={SHARED_PRICES_MINE} rows={rows.filter((row) => row.mine)} />
      <SharedPriceList title={SHARED_PRICES_OTHERS} rows={rows.filter((row) => !row.mine)} />
      <Text variant="small">{SHARED_PRICES_NOTICE}</Text>
    </Section>
  );
}

/** Uma das duas listas, só quando tem linhas. "Ver mais" traz um tanto de cada vez: a lista nunca abre inteira de uma vez. */
function SharedPriceList({ title, rows }: { title: string; rows: SharedPriceRow[] }) {
  const [shown, setShown] = useState(SHARED_ROWS_SHOWN);
  if (!rows.length) return null;
  return (
    <>
      <Text variant="label">{title}</Text>
      <ListCard>
        {rows.slice(0, shown).map((row) => (
          <ListRow
            key={`${row.storeCnpj} ${row.unit}`}
            // Para o leitor de tela, a linha inteira de uma vez: preço, mercado e dia.
            accessibilityLabel={describeSharedPrice(row)}
            left={<IconBadge icon="store-outline" />}
            title={sharedStoreLabel(row)}
            subtitle={seenLabel(row)}
            right={<Text variant="label">{sharedPriceLabel(row)}</Text>}
          />
        ))}
      </ListCard>
      {rows.length > shown ? (
        <Button title={SHARED_PRICES_MORE} variant="ghost" compact onPress={() => setShown((count) => count + SHARED_ROWS_STEP)} />
      ) : null}
    </>
  );
}

/**
 * Aba Família: o que a casa compartilha. Só quando o banco responde que o
 * compartilhamento existe (uma pergunta de sim ou não, sem buscar os preços);
 * antes da migração, enquanto pergunta ou se a pergunta falhou, nada. Não há
 * chave para desligar: vale para toda casa, pelos termos de uso.
 */
export function SharedPricesAbout() {
  const available = useSharedPricesAvailable();
  if (available.data !== true) return null;
  return (
    <Section title={SHARING_TITLE}>
      <Card>
        <Text variant="muted">{SHARING_ABOUT}</Text>
      </Card>
    </Section>
  );
}
