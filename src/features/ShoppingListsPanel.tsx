import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { useCreateList, useShoppingLists } from '@/data/market';
import type { ListKind } from '@/lib/types';
import { errorMessage } from '@/lib/supabase';
import { notify } from '@/ui/dialogs';
import {
  Button,
  Card,
  Chip,
  EmptyState,
  ErrorNotice,
  IconBadge,
  type IconName,
  ListCard,
  ListRow,
  Loading,
  Row,
  Text,
  TextField,
} from '@/ui/primitives';
import { space } from '@/ui/theme';

export const LIST_KINDS: { value: ListKind; label: string; icon: IconName }[] = [
  { value: 'mercado', label: 'Mercado', icon: 'cart-outline' },
  { value: 'farmacia', label: 'Farmácia', icon: 'pill' },
  { value: 'outros', label: 'Outros', icon: 'shopping-outline' },
];

export function ShoppingListsPanel() {
  const lists = useShoppingLists();
  const createList = useCreateList();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [kind, setKind] = useState<ListKind>('mercado');

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
  if (lists.isError) return <ErrorNotice error={lists.error} onRetry={() => lists.refetch()} />;

  return (
    <View style={styles.gap}>
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
        <Row>
          <Button title="Nova lista" icon="plus" onPress={() => setCreating(true)} style={styles.flex} />
          <Button title="Preços" icon="chart-line" variant="secondary" onPress={() => router.push('/precos')} style={styles.flex} />
        </Row>
      )}

      {lists.data.length === 0 && !creating ? (
        <EmptyState
          icon="cart-outline"
          title="Nenhuma lista ainda"
          message="Crie uma lista e toda a família vê e marca os itens em tempo real."
        />
      ) : (
        <ListCard>
          {lists.data.map((l) => (
            <ListRow
              key={l.id}
              left={<IconBadge icon={LIST_KINDS.find((k) => k.value === l.kind)?.icon ?? 'cart-outline'} tone="primary" />}
              title={l.name}
              subtitle={l.total === 0 ? 'Vazia' : `${l.pending} de ${l.total} ${l.total === 1 ? 'item' : 'itens'} pendentes`}
              onPress={() => router.push({ pathname: '/lista/[id]', params: { id: l.id } })}
            />
          ))}
        </ListCard>
      )}

      <ListCard>
        <ListRow
          left={<IconBadge icon="silverware-fork-knife" tone="info" />}
          title="Cardápio da semana"
          subtitle="Almoço e jantar; o Nuke monta a semana com o que tem em casa"
          onPress={() => router.push('/cardapio')}
        />
      </ListCard>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  gap: { gap: space.lg },
  wrap: { flexWrap: 'wrap' },
});
