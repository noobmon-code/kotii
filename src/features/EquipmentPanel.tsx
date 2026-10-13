import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { useChores } from '@/data/home';
import { useEquipmentList } from '@/data/house';
import { useServiceJobs, useServiceProviders } from '@/data/providers';
import { choreStatus, describeChoreStatus } from '@/domain/chores';
import { todayISO } from '@/domain/dates';
import { describeWarranty, getEquipmentCategory, warrantyStatus } from '@/domain/equipment';
import { lastServiceMention } from '@/domain/providers';
import type { ServiceJob } from '@/lib/types';
import { Badge, Button, EmptyState, ErrorNotice, IconBadge, ListCard, ListRow, Loading, Row } from '@/ui/primitives';
import { space } from '@/ui/theme';

/** Aparelhos e bens da casa com garantia e próxima manutenção, e a entrada dos prestadores. */
export function EquipmentPanel() {
  const today = todayISO();
  const equipment = useEquipmentList();
  const chores = useChores();
  // Se esta consulta falhar (ou o banco ainda não tiver a tabela), a lista segue sem o último serviço.
  const jobs = useServiceJobs();
  // O botão "Prestadores" só some quando o banco respondeu que ainda não tem as
  // tabelas (ele levaria a "Ainda não está disponível"). Enquanto a resposta
  // não chega, ou se a consulta falhar por outro motivo, o botão fica.
  const providers = useServiceProviders();
  const providersMissing = providers.data?.missing === true;

  if (equipment.isPending) return <Loading />;
  if (equipment.isError) return <ErrorNotice error={equipment.error} onRetry={() => equipment.refetch()} />;

  // Próxima manutenção de cada aparelho (tarefas ativas já vêm por data).
  const nextMaintenance = new Map<string, { title: string; due_on: string }>();
  for (const chore of chores.data ?? []) {
    if (chore.equipment_id && !nextMaintenance.has(chore.equipment_id)) nextMaintenance.set(chore.equipment_id, chore);
  }
  // Último conserto ou serviço de cada aparelho (já vêm do mais recente para o mais antigo).
  const lastService = new Map<string, ServiceJob>();
  for (const job of jobs.data?.rows ?? []) {
    if (job.equipment_id && !lastService.has(job.equipment_id)) lastService.set(job.equipment_id, job);
  }

  return (
    <View style={styles.gap}>
      <Row style={styles.actions}>
        <Button
          title="Novo aparelho"
          icon="plus"
          variant="secondary"
          style={styles.action}
          onPress={() => router.push({ pathname: '/aparelho/[id]', params: { id: 'novo' } })}
        />
        {providersMissing ? null : (
          <Button
            title="Prestadores"
            icon="account-wrench-outline"
            variant="secondary"
            style={styles.action}
            onPress={() => router.push('/prestadores')}
          />
        )}
      </Row>
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
            const details = [
              item.location,
              next && nextStatus ? `${next.title}: ${describeChoreStatus(nextStatus).toLowerCase()}` : null,
              warranty.kind === 'vigente' || warranty.kind === 'acabando' ? describeWarranty(warranty) : null,
            ].filter(Boolean);
            // O último serviço só entra quando a linha ainda não está cheia.
            const last = lastService.get(item.id);
            if (last && details.length < 3) details.push(lastServiceMention(last));
            return (
              <ListRow
                key={item.id}
                left={<IconBadge icon={category.icon} tone={nextStatus?.kind === 'atrasada' ? 'danger' : 'primary'} />}
                title={item.name}
                subtitle={details.join(' · ')}
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
  // Lado a lado quando cabem; em tela estreita, um embaixo do outro.
  actions: { flexWrap: 'wrap' },
  action: { flexGrow: 1 },
});
