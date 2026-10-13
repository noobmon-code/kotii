import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { useEquipmentList } from '@/data/house';
import { PROVIDERS_UNAVAILABLE, providerErrorMessage, useServiceJobs, useServiceProviders } from '@/data/providers';
import { groupProviders, jobLine, PROVIDER_SEARCH_MIN, searchProviders } from '@/domain/providers';
import { ProviderQuickActions } from '@/features/providers/ProviderContact';
import type { ServiceProvider } from '@/lib/types';
import {
  Button,
  EmptyState,
  ErrorNotice,
  Icon,
  IconBadge,
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

export default function ProvidersScreen() {
  const providers = useServiceProviders();
  // Sem os serviços (ou sem os aparelhos) a lista aparece do mesmo jeito, só sem o último serviço.
  const jobs = useServiceJobs();
  const equipment = useEquipmentList();
  const [query, setQuery] = useState('');

  const all = providers.data?.rows;
  const jobRows = jobs.data?.rows;
  const equipmentRows = equipment.data;
  const equipmentNames = useMemo(() => new Map((equipmentRows ?? []).map((e) => [e.id, e.name])), [equipmentRows]);
  const groups = useMemo(
    () => groupProviders(searchProviders(query, all ?? [], jobRows ?? [], equipmentNames), jobRows ?? []),
    [query, all, jobRows, equipmentNames],
  );

  if (providers.isPending) return <Loading />;
  if (providers.isError) {
    return <ErrorNotice error={new Error(providerErrorMessage(providers.error))} onRetry={() => providers.refetch()} />;
  }
  const refresh = () => {
    providers.refetch();
    jobs.refetch();
  };
  // O app chegou antes das tabelas no banco.
  if (providers.data.missing) {
    return (
      <Screen edges={[]} refreshing={providers.isRefetching} onRefresh={refresh}>
        <EmptyState icon="account-wrench-outline" title="Ainda não está disponível" message={PROVIDERS_UNAVAILABLE} mood="calm" />
      </Screen>
    );
  }

  const total = providers.data.rows.length;
  // Só diz que alguém não tem serviço quando os serviços chegaram.
  const noJobs = jobRows ? 'Nenhum serviço registrado' : null;
  return (
    <Screen edges={[]} refreshing={providers.isRefetching} onRefresh={refresh}>
      <Button
        title="Novo prestador"
        icon="plus"
        variant="secondary"
        onPress={() => router.push({ pathname: '/prestador/[id]', params: { id: 'novo' } })}
      />
      {total > PROVIDER_SEARCH_MIN ? (
        <TextField
          value={query}
          onChangeText={setQuery}
          placeholder="Buscar por nome, serviço ou conserto"
          accessibilityLabel="Buscar prestador"
          autoCorrect={false}
        />
      ) : null}
      {total === 0 ? (
        <EmptyState
          icon="account-wrench-outline"
          title="Nenhum prestador"
          message="Diarista, eletricista, encanador, a assistência da máquina de lavar… Guarde o contato e o que cada um já fez: a casa toda acha o telefone e lembra quanto foi cobrado."
        />
      ) : groups.length === 0 ? (
        <Text variant="muted">Nada encontrado para “{query.trim()}”.</Text>
      ) : (
        groups.map((group) => (
          <Section key={group.trade.key} title={group.trade.label}>
            <ListCard>
              {group.rows.map(({ provider, lastJob }) => (
                <ListRow
                  key={provider.id}
                  left={<IconBadge icon={group.trade.icon} tone="primary" />}
                  title={provider.name}
                  subtitle={
                    <ProviderSummary
                      provider={provider}
                      trade={group.trade.label}
                      lastJob={lastJob ? jobLine(lastJob, lastJob.equipment_id ? equipmentNames.get(lastJob.equipment_id) : null) : noJobs}
                    />
                  }
                  right={<ProviderQuickActions name={provider.name} phoneDigits={provider.phone_digits} />}
                  onPress={() => router.push({ pathname: '/prestador/[id]', params: { id: provider.id } })}
                />
              ))}
            </ListCard>
          </Section>
        ))
      )}
    </Screen>
  );
}

/** Embaixo do nome: o que faz, a marca de "recomendo" e o último serviço. */
function ProviderSummary({ provider, trade, lastJob }: { provider: ServiceProvider; trade: string; lastJob: string | null }) {
  return (
    <View>
      <Row gap={space.xs} style={styles.wrap}>
        <Text variant="small">{trade}</Text>
        {provider.recommended ? (
          <>
            <Icon name="thumb-up-outline" size={13} color="primary" />
            <Text variant="small" color="primary">
              Recomendo
            </Text>
          </>
        ) : (
          <Text variant="small">· Não recomendo</Text>
        )}
      </Row>
      {lastJob ? <Text variant="muted">{lastJob}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flexWrap: 'wrap' },
});
