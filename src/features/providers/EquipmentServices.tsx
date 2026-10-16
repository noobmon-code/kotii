import { router } from 'expo-router';

import { useEquipmentJobs, useServiceProviders } from '@/data/providers';
import { jobDetails } from '@/domain/providers';
import { Button, IconBadge, ListCard, ListRow, Section, Text } from '@/ui/primitives';

import { ProviderQuickActions } from './ProviderContact';

/**
 * Consertos e serviços feitos num aparelho, na tela dele: o que foi feito,
 * quando, quem fez, quanto custou e a garantia do serviço enquanto vale. Na
 * linha, os atalhos de WhatsApp e de ligar de quem fez: o aparelho quebrou de
 * novo, e é daqui que a pessoa quer chamar quem consertou.
 *
 * A tela do aparelho existia antes destas tabelas: se a consulta falhar, a
 * seção fica sem serviços, nunca com um aviso de erro no meio da tela. Ela
 * some (o botão dela só levaria a "Ainda não está disponível") quando o banco
 * respondeu que não tem as tabelas: à busca dos serviços deste aparelho, ou,
 * enquanto ela não respondeu, à da lista de prestadores, que a aba Casa já
 * fez (assim ela não aparece nem enquanto a busca deste aparelho anda). Sem
 * nenhuma das duas respostas ainda, ela aparece.
 */
export function EquipmentServices({ equipmentId, today }: { equipmentId: string; today: string }) {
  const jobs = useEquipmentJobs(equipmentId);
  const providers = useServiceProviders();
  // A resposta deste aparelho, quando já veio, vale mais que a da lista guardada (que pode ser de antes da migração).
  if (jobs.data ? jobs.data.missing : providers.data?.missing) return null;
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
          {rows.map((job) => {
            // Sem a lista de prestadores (chegando, ou falhou), a linha fica sem o nome e sem os atalhos.
            const provider = providers.data?.rows.find((p) => p.id === job.provider_id);
            return (
              <ListRow
                key={job.id}
                left={<IconBadge icon="toolbox-outline" tone="primary" />}
                title={job.description}
                subtitle={jobDetails(job, { who: provider?.name, today })}
                right={provider ? <ProviderQuickActions name={provider.name} phoneDigits={provider.phone_digits} /> : null}
                onPress={() => router.push({ pathname: '/servico/[id]', params: { id: job.id } })}
              />
            );
          })}
        </ListCard>
      ) : jobs.isPending ? null : (
        <Text variant="muted">
          {jobs.isError ? 'Não deu para carregar os serviços agora.' : 'Nenhum conserto ou serviço registrado neste aparelho.'}
        </Text>
      )}
    </Section>
  );
}
