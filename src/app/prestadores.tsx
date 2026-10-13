import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';

import { useEquipmentList } from '@/data/house';
import { PROVIDERS_UNAVAILABLE, providerErrorMessage, useServiceJobs, useServiceProviders } from '@/data/providers';
import { emptySearchNote, groupProviders, jobLine, PROVIDER_SEARCH_MIN, searchProviders, type SearchGap } from '@/domain/providers';
import { ProviderQuickActions } from '@/features/providers/ProviderContact';
import type { ServiceProvider } from '@/lib/types';
import {
  Badge,
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
    // A busca também olha o nome dos aparelhos.
    equipment.refetch();
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
  // A busca só olha os serviços e os aparelhos que chegaram: sem eles, não achar ninguém não é "Nada encontrado".
  const searchGap: SearchGap | null = !jobRows
    ? { what: 'jobs', loading: jobs.isFetching }
    : !equipmentRows
      ? { what: 'equipment', loading: equipment.isFetching }
      : null;
  return (
    <Screen edges={[]} refreshing={providers.isRefetching} onRefresh={refresh}>
      <Button
        title="Novo prestador"
        icon="plus"
        variant="secondary"
        onPress={() => router.push({ pathname: '/prestador/[id]', params: { id: 'novo' } })}
      />
      {/* Com uma busca digitada o campo fica, mesmo que a lista encolha: sem ele não haveria como desfazer o filtro. */}
      {total > PROVIDER_SEARCH_MIN || query.trim() !== '' ? (
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
        <Text variant="muted">{emptySearchNote(query, searchGap, Platform.OS === 'web')}</Text>
      ) : (
        groups.map((group) => (
          <Section key={group.trade.key} title={group.trade.label}>
            <ListCard>
              {group.rows.map(({ provider, lastJob, jobCount }) => (
                <ListRow
                  key={provider.id}
                  left={<IconBadge icon={group.trade.icon} tone="primary" />}
                  title={provider.name}
                  subtitle={
                    <ProviderSummary
                      provider={provider}
                      trade={group.trade.label}
                      used={jobCount > 0}
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

/**
 * Embaixo do nome: o que faz, a marca de "recomendo" e o último serviço.
 * "Recomendo" já vem ligado em todo cadastro, então o que aparece é a exceção
 * ("Não recomendo"); o joinha fica só para quem a casa já chamou (`used`), e
 * não para o contato que um vizinho indicou e ninguém usou.
 */
function ProviderSummary({
  provider,
  trade,
  used,
  lastJob,
}: {
  provider: ServiceProvider;
  trade: string;
  used: boolean;
  lastJob: string | null;
}) {
  return (
    <View>
      <Row gap={space.xs} style={styles.wrap}>
        <Text variant="small">{trade}</Text>
        {!provider.recommended ? (
          <Badge label="Não recomendo" tone="warning" />
        ) : used ? (
          <View accessible accessibilityRole="image" accessibilityLabel="Recomendo">
            <Icon name="thumb-up-outline" size={13} color="primary" />
          </View>
        ) : null}
      </Row>
      {lastJob ? <Text variant="muted">{lastJob}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flexWrap: 'wrap' },
});
