import { useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useProducts } from '@/data/market';
import { isMergeUnanswered, isProductGone, mergeErrorNotice, useMergeProducts } from '@/data/productMerge';
import { getCategory } from '@/domain/categories';
import {
  choiceLabel,
  defaultKeep,
  factsLine,
  isProductRenamed,
  MERGE_DONE_TITLE,
  MERGE_PRODUCT_GONE,
  mergeResult,
  mergeSummary,
  mergeWarnings,
  NAME_GOES,
  NAME_STAYS,
  similarProducts,
  type MergeSide,
} from '@/domain/productMerge';
import { normalizeSearch } from '@/domain/search';
import type { ProductName } from '@/domain/similarNames';
import { Backdrop } from '@/ui/Backdrop';
import { confirmAction, notify } from '@/ui/dialogs';
import {
  Badge,
  Button,
  CategoryIcon,
  ErrorNotice,
  Icon,
  IconButton,
  ListCard,
  ListRow,
  Loading,
  Row,
  Text,
  TextField,
  useGlassStyle,
} from '@/ui/primitives';
import { MAX_WIDTH, radius, space, useColors } from '@/ui/theme';

import { useMergeFacts } from './useProductMerge';

/**
 * Juntar dois produtos: a pessoa escolhe o outro produto (se a tela ainda não
 * sabe qual é), vê o que o app sabe de cada um, escolhe o nome que fica e
 * confirma. Um modal só, com os dois passos dentro: abrir um modal enquanto
 * outro fecha falha no iOS. Renderize só quando aberto. `opened` e `other`
 * dizem quais são os dois; o que a confirmação mostra deles (nome e categoria
 * também) ela lê do banco.
 */
export function MergeProductsModal({
  opened,
  other,
  onClose,
  onMerged,
}: {
  /** O produto de onde a pessoa partiu: no empate de compras, é o nome dele que fica. */
  opened: ProductName;
  /** O outro produto, quando já se sabe (a sugestão); sem ele, a pessoa escolhe. */
  other?: ProductName;
  onClose: () => void;
  /** Juntou: `keptId` é o produto que ficou. */
  onMerged: (keptId: string) => void;
}) {
  const c = useColors();
  const [picked, setPicked] = useState<ProductName | null>(other ?? null);
  // Enquanto o banco junta, a tela não fecha: o que vem depois (o aviso e ir para o produto que ficou) é dela.
  const [joining, setJoining] = useState(false);
  const close = () => (joining ? undefined : onClose());
  return (
    <Modal visible animationType="slide" onRequestClose={close}>
      <SafeAreaView style={[styles.flex, { backgroundColor: c.background }]}>
        <Backdrop />
        {picked ? (
          <ConfirmStep
            openedId={opened.id}
            otherId={picked.id}
            // Quem escolheu na lista pode voltar a ela; a sugestão já veio com o par.
            onPickAnother={other ? undefined : () => setPicked(null)}
            onJoining={setJoining}
            onClose={close}
            // Um dos dois já não existe (outra pessoa da casa juntou): não há o que confirmar. Quem escolheu na
            // lista volta a ela, já sem o produto que sumiu; a sugestão fecha. Sem passar por `close`, que não
            // fecha enquanto o pedido ainda conta como em andamento.
            onGone={other ? onClose : () => setPicked(null)}
            onMerged={onMerged}
          />
        ) : (
          <PickStep opened={opened} onPick={setPicked} onClose={onClose} />
        )}
      </SafeAreaView>
    </Modal>
  );
}

function Header({ title, onClose }: { title: string; onClose: () => void }) {
  return (
    <Row>
      <Text variant="heading" style={styles.flex}>
        {title}
      </Text>
      <IconButton icon="close" label="Fechar" onPress={onClose} />
    </Row>
  );
}

/** Os outros produtos da casa, com busca: sem nada digitado, os de nome parecido vêm primeiro. */
function PickStep({ opened, onPick, onClose }: { opened: ProductName; onPick: (product: ProductName) => void; onClose: () => void }) {
  const products = useProducts();
  const [query, setQuery] = useState('');
  const others = useMemo(() => (products.data ?? []).filter((product) => product.id !== opened.id), [products.data, opened.id]);
  const similar = useMemo(() => similarProducts(opened, others), [opened, others]);
  const q = normalizeSearch(query);
  const suggested = q ? [] : similar;
  // O que já está nos parecidos não se repete na lista.
  const shown = new Set(suggested.map((product) => product.id));
  const listed = others.filter((product) => !shown.has(product.id) && (!q || normalizeSearch(product.name).includes(q)));
  const row = (product: ProductName) => (
    <ListRow
      key={product.id}
      left={<CategoryIcon category={product.category} name={product.name} size={32} />}
      title={product.name}
      subtitle={getCategory(product.category).label}
      onPress={() => onPick(product)}
    />
  );
  return (
    <View style={styles.pick}>
      <Header title="Juntar com qual produto?" onClose={onClose} />
      <Text variant="muted">{`Escolha o produto que é a mesma coisa que "${opened.name}".`}</Text>
      <TextField value={query} onChangeText={setQuery} placeholder="Buscar produto" autoCorrect={false} />
      {products.isPending ? (
        <Loading />
      ) : products.error && !products.data ? (
        <ErrorNotice error={products.error} onRetry={() => products.refetch()} />
      ) : (
        <FlatList
          data={listed}
          keyExtractor={(product) => product.id}
          keyboardShouldPersistTaps="handled"
          ListHeaderComponent={
            suggested.length ? (
              <View style={styles.suggestions}>
                <Text variant="small">Nomes parecidos</Text>
                <ListCard>{suggested.map(row)}</ListCard>
              </View>
            ) : null
          }
          renderItem={({ item }) => row(item)}
          ListEmptyComponent={
            suggested.length ? null : <Text variant="muted">{others.length ? 'Nada encontrado.' : 'A casa ainda não tem outro produto.'}</Text>
          }
        />
      )}
    </View>
  );
}

/**
 * A confirmação. As props só dizem quais são os dois produtos: o nome, a
 * categoria e o que o app sabe de cada um vêm da leitura feita com ela aberta
 * (`useMergeFacts`), e é com isso que ela monta os dois lados, o nome que
 * fica por padrão, os avisos, a frase e o que manda ao banco.
 */
function ConfirmStep({
  openedId,
  otherId,
  onPickAnother,
  onJoining,
  onClose,
  onGone,
  onMerged,
}: {
  /** O produto de onde a pessoa partiu. */
  openedId: string;
  otherId: string;
  onPickAnother?: () => void;
  onJoining: (joining: boolean) => void;
  onClose: () => void;
  /** Um dos dois produtos não existe mais: sai da confirmação. */
  onGone: () => void;
  onMerged: (keptId: string) => void;
}) {
  const c = useColors();
  const { read, gone: missing, error, refetch } = useMergeFacts(openedId, otherId);
  const merge = useMergeProducts();
  // null: a pessoa ainda não escolheu, vale o padrão (o de mais compras).
  const [chosen, setChosen] = useState<string | null>(null);
  // O pedido de juntar já saiu. Trava no toque: dois toques no botão vermelho abrem dois diálogos (no iPhone os
  // dois ficam na tela), e cada um guarda o `join` do mesmo render, onde `merge.isPending` ainda é falso.
  const sent = useRef(false);
  // A leitura veio sem um dos dois: outra pessoa da casa juntou ou apagou, e não há o que confirmar. O mesmo
  // aviso e a mesma saída de quando é o banco que responde isso ao juntar. Uma vez só.
  const left = useRef(false);
  useEffect(() => {
    if (!missing || left.current) return;
    left.current = true;
    notify('Erro', MERGE_PRODUCT_GONE);
    onGone();
  }, [missing, onGone]);

  const opened = read?.products[openedId];
  const other = read?.products[otherId];
  if (!read || !opened || !other) {
    return (
      <View style={styles.content}>
        <Header title="Juntar produtos" onClose={onClose} />
        {error ? <ErrorNotice error={error} onRetry={refetch} /> : <Loading />}
      </View>
    );
  }

  const { facts } = read;
  const keepId = chosen ?? defaultKeep(opened.id, other.id, { [opened.id]: facts[opened.id].purchases, [other.id]: facts[other.id].purchases });
  const [keep, gone] = keepId === opened.id ? [opened, other] : [other, opened];
  const side = (product: ProductName): MergeSide => ({ name: product.name, facts: facts[product.id] });
  const warnings = mergeWarnings(side(opened), side(other));
  const summary = mergeSummary(side(gone), keep.name);

  const join = () => {
    if (sent.current) return;
    sent.current = true;
    onJoining(true);
    merge.mutate(
      // Os nomes que estão na tela vão junto: o banco recusa se um deles já não for o do produto.
      { keepId: keep.id, mergeId: gone.id, keepName: keep.name, mergeName: gone.name },
      {
        onSettled: () => onJoining(false),
        onSuccess: (moved) => {
          // A trava continua: juntou, e um segundo diálogo ainda aberto não pode mandar de novo.
          notify(MERGE_DONE_TITLE, mergeResult(gone.name, keep.name, moved));
          onMerged(keep.id);
        },
        onError: (failure) => {
          sent.current = false;
          const { title, message } = mergeErrorNotice(failure);
          notify(title, message);
          if (isProductGone(failure)) onGone();
          // Um dos dois mudou de nome em outro aparelho e nada foi juntado: a confirmação continua aberta e lê
          // os dois de novo, para mostrar os nomes de agora. O pedido que ficou sem resposta também: o banco
          // pode ter juntado, e a tela não fica mostrando os dois como antes (se um sumiu, ela avisa e sai).
          else if (isProductRenamed(failure) || isMergeUnanswered(failure)) refetch();
        },
      },
    );
  };

  return (
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Header title="Juntar produtos" onClose={onClose} />
      <Text variant="muted">
        Os dois viram um produto só, com as compras e os preços dos dois. Escolha o nome que fica: a categoria e a validade aprendida
        ficam as dele.
      </Text>
      <View style={styles.gap} accessibilityRole="radiogroup" accessibilityLabel="Nome que fica">
        {[opened, other].map((product) => (
          <ProductChoice
            key={product.id}
            product={product}
            line={factsLine(facts[product.id])}
            selected={product.id === keep.id}
            disabled={merge.isPending}
            onPress={() => setChosen(product.id)}
          />
        ))}
      </View>
      {warnings.map((warning) => (
        <View key={warning} style={[styles.warning, { backgroundColor: c.warningSoft }]} accessibilityRole="alert">
          <Icon name="alert-outline" size={20} color="warning" />
          <Text variant="body" style={styles.flex}>
            {warning}
          </Text>
        </View>
      ))}
      <Text variant="body">{summary}</Text>
      <Button
        title="Juntar produtos"
        variant="danger"
        icon="call-merge"
        loading={merge.isPending}
        onPress={() => confirmAction('Juntar produtos', summary, 'Juntar', join)}
      />
      {onPickAnother ? <Button title="Escolher outro produto" variant="secondary" disabled={merge.isPending} onPress={onPickAnother} /> : null}
      <Button title="Cancelar" variant="secondary" disabled={merge.isPending} onPress={onClose} />
    </ScrollView>
  );
}

/** Um dos dois produtos, com o que o app sabe dele; o toque escolhe o nome que fica. */
function ProductChoice({
  product,
  line,
  selected,
  disabled,
  onPress,
}: {
  product: ProductName;
  line: string;
  selected: boolean;
  disabled: boolean;
  onPress: () => void;
}) {
  const c = useColors();
  const glass = useGlassStyle();
  return (
    <Pressable
      accessibilityRole="radio"
      // Marcado: no celular o estado basta; na web só o aria-checked chega ao navegador (o react-native-web não
      // repassa accessibilityState).
      accessibilityState={{ checked: selected, disabled }}
      aria-checked={selected}
      accessibilityLabel={choiceLabel(product.name, line, selected)}
      disabled={disabled}
      onPress={onPress}
      style={[styles.choice, glass, selected && { borderColor: c.primary, borderTopColor: c.primary, borderLeftColor: c.primary }]}>
      <Icon name={selected ? 'radiobox-marked' : 'radiobox-blank'} color={selected ? 'primary' : 'textMuted'} />
      <CategoryIcon category={product.category} name={product.name} size={40} />
      <View style={styles.choiceText}>
        <Text variant="label">{product.name}</Text>
        <Text variant="muted">{line}</Text>
        <Badge label={selected ? NAME_STAYS : NAME_GOES} tone={selected ? 'primary' : 'neutral'} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  gap: { gap: space.md },
  content: { width: '100%', maxWidth: MAX_WIDTH, alignSelf: 'center', padding: space.lg, gap: space.lg },
  pick: { flex: 1, width: '100%', maxWidth: MAX_WIDTH, alignSelf: 'center', padding: space.lg, gap: space.md },
  suggestions: { gap: space.sm, paddingBottom: space.md },
  choice: { flexDirection: 'row', alignItems: 'center', gap: space.md, borderRadius: radius.lg, padding: space.lg },
  choiceText: { flex: 1, gap: space.xs },
  warning: { flexDirection: 'row', alignItems: 'center', gap: space.sm, borderRadius: radius.md, padding: space.md },
});
