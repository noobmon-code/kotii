import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Switch, View } from 'react-native';

import { useEquipmentList } from '@/data/house';
import {
  PROVIDERS_UNAVAILABLE,
  providerErrorMessage,
  useDeleteProvider,
  useProviderJobs,
  useSaveProvider,
  useServiceProviders,
} from '@/data/providers';
import { todayISO } from '@/domain/dates';
import {
  deleteProviderWarning,
  getProviderTrade,
  jobDetails,
  normalizePhone,
  phoneHint,
  PROVIDER_TRADES,
  validateProvider,
} from '@/domain/providers';
import { ProviderContactButtons } from '@/features/providers/ProviderContact';
import type { ServiceProvider } from '@/lib/types';
import { confirmAction, notify } from '@/ui/dialogs';
import {
  Button,
  Card,
  Chip,
  EmptyState,
  ErrorNotice,
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
import { space, useColors } from '@/ui/theme';

export default function ProviderScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const isNew = id === 'novo';
  const providers = useServiceProviders();
  // Excluído aqui: a lista volta sem ele antes de a tela fechar, e isso não é "não existe mais".
  const [deleted, setDeleted] = useState(false);
  if (providers.isPending || deleted) return <Loading />;
  if (providers.isError) {
    return <ErrorNotice error={new Error(providerErrorMessage(providers.error))} onRetry={() => providers.refetch()} />;
  }
  // O app chegou antes das tabelas no banco.
  if (providers.data.missing) {
    return (
      <Screen edges={[]}>
        <EmptyState icon="account-wrench-outline" title="Ainda não está disponível" message={PROVIDERS_UNAVAILABLE} mood="calm" />
      </Screen>
    );
  }
  const provider = isNew ? undefined : providers.data.rows.find((p) => p.id === id);
  if (!isNew && !provider) {
    // A lista ainda pode estar chegando com ele (acabou de ser criado).
    if (providers.isFetching) return <Loading />;
    return <ErrorNotice error={new Error('Este prestador não existe mais.')} />;
  }
  return <ProviderForm key={id} provider={provider} onDeleted={() => setDeleted(true)} />;
}

function ProviderForm({ provider, onDeleted }: { provider?: ServiceProvider; onDeleted: () => void }) {
  const c = useColors();
  const save = useSaveProvider();
  const remove = useDeleteProvider();
  // Só para o aviso de excluir dizer quantos serviços vão junto.
  const jobs = useProviderJobs(provider?.id);
  const [name, setName] = useState(provider?.name ?? '');
  // Prestador novo começa sem ofício: a pessoa escolhe, em vez de ficar em "Outros" sem querer.
  const [trade, setTrade] = useState<string>(provider ? getProviderTrade(provider.trade).key : '');
  const [phone, setPhone] = useState(provider?.phone ?? '');
  const [notes, setNotes] = useState(provider?.notes ?? '');
  const [recommended, setRecommended] = useState(provider?.recommended ?? true);

  function submit() {
    const result = validateProvider({ name, trade, phone, notes, recommended });
    if (!result.ok) return notify(result.title, result.message);
    save.mutate(
      { id: provider?.id, values: result.values },
      {
        onSuccess: ({ id }) => {
          // Prestador novo: fica na tela para registrar o primeiro serviço.
          if (provider) router.back();
          else router.replace({ pathname: '/prestador/[id]', params: { id } });
        },
        onError: (err) => notify('Não deu para salvar', providerErrorMessage(err)),
      },
    );
  }

  return (
    <Screen edges={[]} footer={<Button title={provider ? 'Salvar' : 'Salvar prestador'} onPress={submit} loading={save.isPending} />}>
      <Stack.Screen options={{ title: provider ? provider.name : 'Novo prestador' }} />

      <TextField label="Nome" value={name} onChangeText={setName} placeholder="Pessoa ou empresa" autoFocus={!provider} />
      <View style={styles.group}>
        <Text variant="label">O que faz</Text>
        <Row style={styles.wrap}>
          {PROVIDER_TRADES.map((t) => (
            <Chip key={t.key} label={t.label} icon={t.icon} selected={trade === t.key} onPress={() => setTrade(t.key)} />
          ))}
        </Row>
      </View>

      <View style={styles.group}>
        <TextField
          label="Telefone"
          value={phone}
          onChangeText={setPhone}
          placeholder="(11) 98765-4321"
          keyboardType="phone-pad"
          autoCorrect={false}
          hint={phoneHint(phone) ?? undefined}
        />
        <ProviderContactButtons phone={phone} phoneDigits={normalizePhone(phone)} />
      </View>

      <Card>
        <Row>
          <View style={styles.flex}>
            <Text variant="label">Recomendo</Text>
            <Text variant="small">Para a casa lembrar se vale chamar de novo.</Text>
          </View>
          <Switch
            value={recommended}
            onValueChange={setRecommended}
            trackColor={{ true: c.primary }}
            accessibilityLabel="Recomendo"
          />
        </Row>
      </Card>

      <TextField
        label="Observações"
        value={notes}
        onChangeText={setNotes}
        multiline
        placeholder="Ex.: só atende de manhã, cobra a visita"
      />

      {provider ? (
        <ProviderJobs provider={provider} />
      ) : (
        <Text variant="muted">Depois de salvar, registre aqui os serviços feitos.</Text>
      )}

      {provider ? (
        <Button
          title="Excluir prestador"
          variant="danger"
          icon="trash-can-outline"
          onPress={() =>
            confirmAction(
              'Excluir prestador',
              deleteProviderWarning(provider.name, jobs.data && !jobs.data.missing ? jobs.data.rows.length : null),
              'Excluir',
              () =>
                remove.mutate(provider.id, {
                  onSuccess: () => {
                    onDeleted();
                    router.back();
                  },
                  onError: (err) => notify('Não deu para excluir', providerErrorMessage(err)),
                }),
            )
          }
        />
      ) : null}
    </Screen>
  );
}

/** O histórico do que a pessoa já fez para a casa, do mais recente para o mais antigo. */
function ProviderJobs({ provider }: { provider: ServiceProvider }) {
  const today = todayISO();
  const jobs = useProviderJobs(provider.id);
  // Sem os aparelhos, o histórico aparece do mesmo jeito, só sem o nome deles.
  const equipment = useEquipmentList();
  const equipmentName = (id: string | null) => (id ? equipment.data?.find((e) => e.id === id)?.name : null);
  const rows = jobs.data?.rows ?? [];

  return (
    <Section
      title="Serviços feitos"
      action={
        <Button
          title="Novo serviço"
          icon="plus"
          variant="ghost"
          compact
          onPress={() => router.push({ pathname: '/servico/[id]', params: { id: 'novo', prestador: provider.id } })}
        />
      }>
      {jobs.isError ? (
        <ErrorNotice error={new Error(providerErrorMessage(jobs.error))} onRetry={() => jobs.refetch()} />
      ) : rows.length ? (
        <ListCard>
          {rows.map((job) => (
            <ListRow
              key={job.id}
              left={<IconBadge icon="toolbox-outline" tone="primary" />}
              title={job.description}
              subtitle={jobDetails(job, { who: equipmentName(job.equipment_id), today })}
              onPress={() => router.push({ pathname: '/servico/[id]', params: { id: job.id } })}
            />
          ))}
        </ListCard>
      ) : jobs.isPending ? null : (
        <Text variant="muted">Nenhum serviço registrado ainda.</Text>
      )}
    </Section>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  group: { gap: space.sm },
  wrap: { flexWrap: 'wrap' },
});
