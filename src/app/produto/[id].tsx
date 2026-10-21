import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { useBarcodes, useUnlinkBarcode } from '@/data/barcodes';
import {
  ProductNameTakenError,
  useAddToPantryList,
  useLatestPrices,
  useProductPurchases,
  useProducts,
  useRenameProduct,
  useStorePrices,
  useStores,
} from '@/data/market';
import { gtinLabel } from '@/domain/barcode';
import { CATEGORIES, getCategory } from '@/domain/categories';
import { genericItem } from '@/domain/genericItem';
import { noStorePriceSentence } from '@/domain/priceHistory';
import { PRODUCT_CATEGORY_NOTE } from '@/domain/productCategory';
import { PRODUCT_NAME_TAKEN, productNameTakenHint } from '@/domain/productMerge';
import type { ProductName } from '@/domain/similarNames';
import {
  NO_SAVED_PRICES_ERROR,
  NO_SAVED_PRICES_OFFLINE,
  SAVED_PRICES_ERROR,
  SAVED_PRICES_OFFLINE,
  storePriceDetail,
  storePriceGroups,
  storePriceLabel,
  storePricesView,
} from '@/domain/storePrices';
import { StaleNotice } from '@/features/health/StaleNotice';
import { PriceHistorySection } from '@/features/market/PriceHistorySection';
import { MergeProductsModal } from '@/features/MergeProductsModal';
import { MergeSuggestionsCard } from '@/features/MergeSuggestionsCard';
import { useProductBarcode } from '@/features/ProductBarcode';
import { SharedPricesSection } from '@/features/SharedPrices';
import { errorMessage } from '@/lib/supabase';
import { confirmAction, notify } from '@/ui/dialogs';
import { PickerModal } from '@/ui/PickerModal';
import {
  Badge,
  Button,
  Card,
  CategoryIcon,
  Chip,
  ErrorNotice,
  IconBadge,
  IconButton,
  ListCard,
  ListRow,
  Loading,
  Row,
  Screen,
  Section,
  Text,
  TextField,
} from '@/ui/primitives';
import { space } from '@/ui/theme';

export default function ProductScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  // O produto e os mercados ficam guardados no aparelho (lib/queryClient, PERSISTED): sem internet, a tela abre.
  const products = useProducts();
  const stores = useStores();
  // As compras inteiras, as mesmas que a seção do histórico lê (a mesma busca, uma vez só): a nota sem mercado
  // não entra no "por mercado", e a frase de lá não pode dizer que não há nota nenhuma.
  const purchases = useProductPurchases(id);
  // O último preço de cada mercado, das mesmas compras (todas, não só as mais recentes).
  const fromHistory = useStorePrices(id);
  // Os últimos preços da casa, guardados no aparelho: o que a lista mostra sem internet, ou com a busca que falhou.
  const saved = useLatestPrices();
  const rename = useRenameProduct();
  const addToList = useAddToPantryList();
  const [name, setName] = useState<string | null>(null);
  const [pickingCategory, setPickingCategory] = useState(false);
  // Juntar: com outro produto escolhido na lista (true) ou com o que já tem o nome digitado.
  const [joining, setJoining] = useState<true | ProductName | null>(null);
  // O nome digitado já é de outro produto (null: não; `other` null: não deu para saber qual).
  const [nameTaken, setNameTaken] = useState<{ other: ProductName | null } | null>(null);
  // Os códigos de barras ligados a este produto; null sem a tabela no banco (aí nem o botão de ligar aparece).
  const barcodes = useBarcodes();
  const unlink = useUnlinkBarcode();
  const current = products.data?.find((p) => p.id === id);
  // O código lido vai para este produto; o que era de outro, só depois de a pessoa confirmar.
  const barcode = useProductBarcode({ linkTo: current, onProduct: () => undefined });

  // Sem internet e sem o produto ou os mercados no aparelho, a busca fica parada (e segue sozinha quando a
  // conexão volta): um aviso, em vez de girar sem fim. Com eles guardados, a tela abre com o que há.
  if ([products, stores].some((query) => query.data === undefined && query.fetchStatus === 'paused')) {
    return <ErrorNotice error={{ message: 'Sem internet: os preços deste produto aparecem quando a conexão voltar.' }} />;
  }
  // Uma atualização que falhou não troca o que já está na tela por um erro de tela cheia.
  if (products.data === undefined || stores.data === undefined) {
    const error = products.error ?? stores.error;
    return error ? <ErrorNotice error={error} /> : <Loading />;
  }
  const product = products.data.find((p) => p.id === id);
  if (!product) return <ErrorNotice error={{ message: 'Produto não encontrado.' }} />;

  const byStore = storePricesView(
    { data: fromHistory.data, paused: fromHistory.fetchStatus === 'paused', failed: fromHistory.isError },
    saved.data,
    product.id,
  );
  const storeName = (storeId: string) => stores.data.find((s) => s.id === storeId)?.name ?? 'Mercado';

  function save(category = product!.category) {
    const newName = (name ?? product!.name).trim();
    if (!newName) return;
    rename.mutate(
      { id: product!.id, name: newName, category },
      {
        onSuccess: () => setName(null),
        // Nome repetido: o aviso fica embaixo do campo, com o botão de juntar os dois.
        onError: (err) => (err instanceof ProductNameTakenError ? setNameTaken({ other: err.other }) : notify('Erro', errorMessage(err))),
      },
    );
  }

  function changeName(text: string) {
    setName(text);
    setNameTaken(null);
  }

  // Juntou: se o nome que ficou foi o do outro produto, este deixou de existir e a tela passa a ser a dele.
  function onMerged(keptId: string) {
    setJoining(null);
    setNameTaken(null);
    setName(null);
    if (keptId !== id) router.replace({ pathname: '/produto/[id]', params: { id: keptId } });
  }

  // O mesmo caminho do "Acabou" da despensa: a lista aberta mais nova em que o produto cabe (remédio na da
  // farmácia), sem repetir o que já está pendente nela.
  // O item vai sem a marca ("Leite desnatado"), com este produto como dica de preço: a marca se escolhe na hora, ou
  // em "Marca preferida" nos detalhes do item (domain/genericItem).
  async function putOnList() {
    try {
      const itemName = genericItem(product!.name, product!.category).name;
      const list = await addToList.mutateAsync({ name: itemName, category: product!.category, productId: product!.id, quantity: 1, unit: 'un' });
      notify(
        list.added ? 'Adicionado à lista' : 'Já estava na lista',
        list.added ? `${itemName} foi para "${list.name}".` : `${itemName} já estava pendente em "${list.name}".`,
      );
    } catch (err) {
      notify('Erro', errorMessage(err));
    }
  }

  // A nota ou outra pessoa da casa pode ter ligado o mesmo código a outro produto antes: só sai se ainda for deste.
  function unlinkCode(gtin: string) {
    confirmAction(
      'Desligar código',
      `O código ${gtinLabel(gtin)} deixa de abrir "${product!.name}". Dá para ligar de novo depois.`,
      'Desligar',
      () => unlink.mutate({ gtin, productId: product!.id }, { onError: (err) => notify('Erro', errorMessage(err)) }),
    );
  }

  const codes = (barcodes.data ?? []).filter((code) => code.product_id === product.id);
  const offline = byStore.source === 'saved-offline';
  const groups = byStore.prices ? storePriceGroups(byStore.prices) : undefined;
  const takenOther = nameTaken?.other ?? null;

  return (
    <Screen edges={[]}>
      <Stack.Screen options={{ title: product.name }} />
      <Card style={styles.gap}>
        <Row>
          <CategoryIcon category={product.category} name={product.name} size={48} />
          <Chip label={getCategory(product.category).label} icon="tag-outline" onPress={() => setPickingCategory(true)} />
        </Row>
        <TextField
          label="Nome do produto"
          value={name ?? product.name}
          onChangeText={changeName}
          onSubmitEditing={() => save()}
          hint={nameTaken ? (takenOther ? productNameTakenHint(takenOther.name) : PRODUCT_NAME_TAKEN) : undefined}
          hintColor="danger"
        />
        {takenOther ? <Button title="Juntar os dois" icon="call-merge" variant="secondary" compact onPress={() => setJoining(takenOther)} /> : null}
        {name != null && name !== product.name && !nameTaken ? (
          <Button title="Salvar nome" compact onPress={() => save()} loading={rename.isPending} />
        ) : null}
        {product.shelf_life_days ? (
          <Text variant="small">Validade aprendida: {product.shelf_life_days} dias após a compra.</Text>
        ) : null}
        {codes.map((code) => (
          <Row key={code.gtin}>
            <Text variant="small" style={styles.flex}>
              Código de barras: {gtinLabel(code.gtin)}
            </Text>
            <IconButton icon="close" label={`Desligar o código ${gtinLabel(code.gtin)}`} onPress={() => unlinkCode(code.gtin)} />
          </Row>
        ))}
        <Button title="Pôr na lista" icon="cart-plus" variant="secondary" compact onPress={putOnList} loading={addToList.isPending} />
        {barcode.available ? (
          <Button title="Ligar código de barras" icon="barcode-scan" variant="ghost" compact onPress={barcode.start} />
        ) : null}
      </Card>

      <MergeSuggestionsCard productId={product.id} onMerged={onMerged} />

      <Section title="Último preço por mercado">
        {groups === undefined ? (
          <Loading />
        ) : groups.length === 0 ? (
          // Sem o histórico, a frase de sempre diria "nenhum preço ainda" sobre o que só não se sabe agora.
          <Text variant="muted">
            {byStore.source === 'history' ? noStorePriceSentence(purchases.data) : offline ? NO_SAVED_PRICES_OFFLINE : NO_SAVED_PRICES_ERROR}
          </Text>
        ) : (
          <>
            {byStore.source !== 'history' ? <StaleNotice message={offline ? SAVED_PRICES_OFFLINE : SAVED_PRICES_ERROR} /> : null}
            {/* Uma lista por unidade (por kg, por unidade...): só se compara, e só leva "Mais barato", o que está na mesma. */}
            {groups.map((group) => (
              <View key={group.unit} style={styles.gapSm}>
                {groups.length > 1 ? <Text variant="label">{group.title}</Text> : null}
                <ListCard>
                  {group.prices.map((price, index) => (
                    <ListRow
                      key={price.storeId}
                      left={<IconBadge icon="store-outline" tone={index === 0 ? 'primary' : 'neutral'} />}
                      title={storeName(price.storeId)}
                      subtitle={storePriceDetail(price)}
                      right={
                        <Row>
                          {index === 0 && group.prices.length > 1 ? <Badge label="Mais barato" tone="primary" /> : null}
                          <Text variant="label">{storePriceLabel(price)}</Text>
                        </Row>
                      }
                    />
                  ))}
                </ListCard>
              </View>
            ))}
          </>
        )}
      </Section>

      <SharedPricesSection productId={product.id} />

      <PriceHistorySection productId={product.id} productName={product.name} />

      <Button title="Juntar com outro produto" icon="call-merge" variant="secondary" onPress={() => setJoining(true)} />

      {joining ? (
        <MergeProductsModal
          opened={product}
          other={joining === true ? undefined : joining}
          onClose={() => setJoining(null)}
          onMerged={onMerged}
        />
      ) : null}

      <PickerModal
        visible={pickingCategory}
        title="Categoria"
        // Mudar a categoria muda também os meses passados no Mercado do mês e em Finanças: a pessoa sabe antes.
        message={PRODUCT_CATEGORY_NOTE}
        options={CATEGORIES.map((cat) => ({ id: cat.key, title: cat.label, left: <CategoryIcon category={cat.key} size={32} /> }))}
        onClose={() => setPickingCategory(false)}
        onSelect={(category) => {
          setPickingCategory(false);
          save(category);
        }}
      />
      {barcode.element}
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  gap: { gap: space.md },
  gapSm: { gap: space.sm },
});
