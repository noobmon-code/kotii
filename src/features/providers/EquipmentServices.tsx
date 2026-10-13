import { router } from 'expo-router';

import { useEquipmentJobs, useServiceProviders } from '@/data/providers';
import { jobDetails } from '@/domain/providers';
import { Button, IconBadge, ListCard, ListRow, Section, Text } from '@/ui/primitives';

/**
 * Consertos e serviços feitos num aparelho, na tela dele: o que foi feito,
 * quando, quem fez, quanto custou e a garantia do serviço enquanto vale.
 *
 * A tela do aparelho existia antes destas tabelas: se a consulta falhar (ou o
 * banco ainda não as tiver), a seção fica sem serviços, nunca com um aviso de
 * erro no meio da tela.
 */
export function EquipmentServices({ equipmentId, today }: { equipmentId: string; today: string }) {
  const jobs = useEquipmentJobs(equipmentId);
  const providers = useServiceProviders();
  const providerName = (id: string) => providers.data?.rows.find((p) => p.id === id)?.name;
  const rows = jobs.data?.rows ?? [];

  return (
    <Section
      title="Consertos e serviços"
      action={
        <Button
          title="Registrar serviço"
          icon="plus"
          variant="ghost"
          compact
          onPress={() => router.push({ pathname: '/servico/[id]', params: { id: 'novo', aparelho: equipmentId } })}
        />
      }>
      {rows.length ? (
        <ListCard>
          {rows.map((job) => (
            <ListRow
              key={job.id}
              left={<IconBadge icon="toolbox-outline" tone="primary" />}
              title={job.description}
              subtitle={jobDetails(job, { who: providerName(job.provider_id), today })}
              onPress={() => router.push({ pathname: '/servico/[id]', params: { id: job.id } })}
            />
          ))}
        </ListCard>
      ) : jobs.isPending ? null : (
        <Text variant="muted">
          {jobs.isError ? 'Não deu para carregar os serviços agora.' : 'Nenhum conserto ou serviço registrado neste aparelho.'}
        </Text>
      )}
    </Section>
  );
}
