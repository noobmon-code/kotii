import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { useChores } from '@/data/home';
import { useEquipmentList } from '@/data/house';
import { choreStatus, describeChoreStatus } from '@/domain/chores';
import { todayISO } from '@/domain/dates';
import { describeWarranty, getEquipmentCategory, warrantyStatus } from '@/domain/equipment';
import { Badge, Button, EmptyState, ErrorNotice, IconBadge, ListCard, ListRow, Loading } from '@/ui/primitives';
import { space } from '@/ui/theme';

/** Aparelhos e bens da casa com garantia e próxima manutenção. */
export function EquipmentPanel() {
  const today = todayISO();
  const equipment = useEquipmentList();
  const chores = useChores();

  if (equipment.isPending) return <Loading />;
  if (equipment.isError) return <ErrorNotice error={equipment.error} onRetry={() => equipment.refetch()} />;

  // Próxima manutenção de cada aparelho (tarefas ativas já vêm por data).
  const nextMaintenance = new Map<string, { title: string; due_on: string }>();
  for (const chore of chores.data ?? []) {
    if (chore.equipment_id && !nextMaintenance.has(chore.equipment_id)) nextMaintenance.set(chore.equipment_id, chore);
  }

  return (
    <View style={styles.gap}>
      <Button
        title="Novo aparelho"
        icon="plus"
        variant="secondary"
        onPress={() => router.push({ pathname: '/aparelho/[id]', params: { id: 'novo' } })}
      />
      {equipment.data.length === 0 ? (
        <EmptyState
          icon="tools"
          title="Nenhum aparelho"
          message="Ar-condicionado, geladeira, carro, caixa d'água… Guarde nota e garantia, e o app lembra das manutenções (limpar filtro, trocar refil, revisão)."
        />
      ) : (
        <ListCard>
          {equipment.data.map((item) => {
            const category = getEquipmentCategory(item.category);
            const warranty = warrantyStatus(item.warranty_until, today);
            const next = nextMaintenance.get(item.id);
            const nextStatus = next ? choreStatus(next.due_on, today) : null;
            return (
              <ListRow
                key={item.id}
                left={<IconBadge icon={category.icon} tone={nextStatus?.kind === 'atrasada' ? 'danger' : 'primary'} />}
                title={item.name}
                subtitle={[
                  item.location,
                  next && nextStatus ? `${next.title}: ${describeChoreStatus(nextStatus).toLowerCase()}` : null,
                  warranty.kind === 'vigente' || warranty.kind === 'acabando' ? describeWarranty(warranty) : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
                right={
                  warranty.kind === 'acabando' ? (
                    <Badge label="Garantia acabando" tone="warning" />
                  ) : nextStatus?.kind === 'atrasada' ? (
                    <Badge label="Manutenção atrasada" tone="danger" />
                  ) : null
                }
                onPress={() => router.push({ pathname: '/aparelho/[id]', params: { id: item.id } })}
              />
            );
          })}
        </ListCard>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  gap: { gap: space.lg },
});
