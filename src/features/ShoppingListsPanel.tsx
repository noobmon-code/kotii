import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { useArchivedLists, useCreateList, useReopenList, useShoppingLists } from '@/data/market';
import { formatShortDate, toISODate } from '@/domain/dates';
import { StaleNotice } from '@/features/health/StaleNotice';
import { isNetworkFailure } from '@/lib/networkErrors';
import type { ListKind } from '@/lib/types';
import { errorMessage } from '@/lib/supabase';
import { notify } from '@/ui/dialogs';
import {
  Button,
  Card,
  CategoryIcon,
  Chip,
  EmptyState,
  ErrorNotice,
  Icon,
  type IconName,
  ListCard,
  ListRow,
  Loading,
  Row,
  Section,
  Text,
  TextField,
} from '@/ui/primitives';
import { space } from '@/ui/theme';

export const LIST_KINDS: { value: ListKind; label: string; icon: IconName }[] = [
  { value: 'mercado', label: 'Mercado', icon: 'cart-outline' },
  { value: 'farmacia', label: 'Farmácia', icon: 'pill' },
  { value: 'outros', label: 'Outros', icon: 'shopping-outline' },
];

/** O desenho de cada tipo de lista: a categoria de produto que melhor a representa. */
const KIND_ART: Record<ListKind, string> = { mercado: 'hortifruti', farmacia: 'medicamentos', outros: 'outros' };

/** As listas na tela são as guardadas: a busca não chegou ao servidor. */
const LISTS_OFFLINE = 'Sem internet agora. Mostrando as listas como estavam da última vez.';

export function ShoppingListsPanel() {
  const lists = useShoppingLists();
  const createList = useCreateList();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [kind, setKind] = useState<ListKind>('mercado');
  // As arquivadas: uma entrada discreta, só quando há alguma; abertas, cada uma com "Reabrir".
  const archived = useArchivedLists();
  const reopen = useReopenList();
  const [showArchived, setShowArchived] = useState(false);

  function create() {
    const trimmed = name.trim() || LIST_KINDS.find((k) => k.value === kind)!.label;
    createList.mutate(
      { name: trimmed, kind },
      {
        onSuccess: ({ id }) => {
          setCreating(false);
          setName('');
          router.push({ pathname: '/lista/[id]', params: { id } });
        },
        onError: (err) => notify('Erro', errorMessage(err)),
      },
    );
  }

  if (lists.isPending) return <Loading />;
  // O erro só toma o lugar das listas quando não há nenhuma para mostrar: com as guardadas, a busca que falhou
  // (voltar ao app com sinal fraco) as deixa na tela, com um aviso em cima.
  if (!lists.data) return <ErrorNotice error={lists.error} onRetry={() => lists.refetch()} />;

  return (
    <View style={styles.gap}>
      {lists.isError ? (
        <StaleNotice message={isNetworkFailure(lists.error) ? LISTS_OFFLINE : undefined} onRetry={() => lists.refetch()} />
      ) : null}
      {/* A ação principal da parte é um botão primário no alto (os atalhos de azulejo ficam só na tela Hoje); o
          formulário toma o lugar dele enquanto está aberto. Preços e Cardápio são outras telas, não criar: botões
          secundários logo abaixo. */}
      {creating ? (
        <Card style={styles.gap}>
          <Text variant="heading">Nova lista</Text>
          <Row style={styles.wrap}>
            {LIST_KINDS.map((k) => (
              <Chip key={k.value} label={k.label} icon={k.icon} selected={kind === k.value} onPress={() => setKind(k.value)} />
            ))}
          </Row>
          <TextField value={name} onChangeText={setName} placeholder="Nome (ex.: Compras do mês)" onSubmitEditing={create} />
          <Row>
            <Button title="Cancelar" variant="secondary" onPress={() => setCreating(false)} style={styles.flex} />
            <Button title="Criar" onPress={create} loading={createList.isPending} style={styles.flex} />
          </Row>
        </Card>
      ) : (
        <Button title="Nova lista" icon="plus" onPress={() => setCreating(true)} />
      )}
      <Row style={styles.links}>
        <Button title="Preços" icon="chart-line" variant="secondary" style={styles.link} onPress={() => router.push('/precos')} />
        <Button
          title="Cardápio"
          accessibilityLabel="Cardápio da semana"
          icon="silverware-fork-knife"
          variant="secondary"
          style={styles.link}
          onPress={() => router.push('/cardapio')}
        />
      </Row>

      {lists.data.length === 0 && !creating ? (
        // Todas arquivadas: a casa já teve listas.
        archived.data?.length ? (
          <EmptyState icon="cart-outline" title="Nenhuma lista aberta" message="Crie uma lista nova ou reabra uma das arquivadas." />
        ) : (
          <EmptyState
            icon="cart-outline"
            title="Nenhuma lista ainda"
            message="Crie uma lista e toda a família vê e marca os itens em tempo real."
          />
        )
      ) : lists.data.length ? (
        <Section title="Suas listas">
          <ListCard>
            {lists.data.map((l) => (
              <ListRow
                key={l.id}
                left={<CategoryIcon category={KIND_ART[l.kind] ?? 'outros'} size={44} />}
                title={l.name}
                subtitle={l.total === 0 ? 'Vazia' : `${l.pending} de ${l.total} ${l.total === 1 ? 'item' : 'itens'} pendentes`}
                right={<Icon name="chevron-right" color="textMuted" />}
                onPress={() => router.push({ pathname: '/lista/[id]', params: { id: l.id } })}
              />
            ))}
          </ListCard>
        </Section>
      ) : null}

      {archived.data?.length ? (
        <View style={styles.gapSm}>
          <Button
            title={showArchived ? 'Esconder as arquivadas' : 'Listas arquivadas'}
            icon="archive-outline"
            variant="ghost"
            compact
            onPress={() => setShowArchived((open) => !open)}
          />
          {showArchived ? (
            <ListCard>
              {archived.data.map((l) => (
                <ListRow
                  key={l.id}
                  left={<CategoryIcon category={KIND_ART[l.kind] ?? 'outros'} size={36} />}
                  title={l.name}
                  subtitle={l.archived_at ? `Arquivada em ${formatShortDate(toISODate(new Date(l.archived_at)))}` : undefined}
                  right={
                    <Button
                      title="Reabrir"
                      accessibilityLabel={`Reabrir a lista ${l.name}`}
                      variant="secondary"
                      compact
                      loading={reopen.isPending && reopen.variables === l.id}
                      onPress={() => reopen.mutate(l.id, { onError: (err) => notify('Não deu para reabrir a lista', errorMessage(err)) })}
                    />
                  }
                  onPress={() => router.push({ pathname: '/lista/[id]', params: { id: l.id } })}
                />
              ))}
            </ListCard>
          ) : null}
        </View>
      ) : null}

    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  gap: { gap: space.lg },
  gapSm: { gap: space.sm },
  wrap: { flexWrap: 'wrap' },
  // Lado a lado num celular de 360 ("Cardápio da semana" inteiro não caberia ao lado de "Preços"); se não couber, um
  // embaixo do outro.
  links: { flexWrap: 'wrap' },
  link: { flexGrow: 1 },
});
