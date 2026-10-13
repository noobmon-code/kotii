import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Switch, View } from 'react-native';

import { useSaveExpense } from '@/data/finance';
import { useEquipment, useEquipmentList } from '@/data/house';
import {
  PROVIDERS_UNAVAILABLE,
  providerErrorMessage,
  useDeleteServiceJob,
  useSaveServiceJob,
  useServiceJob,
  useServiceProviders,
} from '@/data/providers';
import { addMonths, formatBRDate, parseBRDate, todayISO } from '@/domain/dates';
import { getEquipmentCategory } from '@/domain/equipment';
import { parseMoney } from '@/domain/money';
import {
  canCopyToExpenses,
  EXPENSE_COPY_SKIPPED,
  expenseCopyNote,
  expenseDescription,
  getProviderTrade,
  SERVICE_WARRANTY_PRESETS,
  serviceExpenseCategory,
  validateJob,
} from '@/domain/providers';
import { goBackOr } from '@/lib/navigation';
import { errorMessage } from '@/lib/supabase';
import type { Equipment, ServiceJob, ServiceProvider } from '@/lib/types';
import { confirmAction, notify } from '@/ui/dialogs';
import { PickerModal } from '@/ui/PickerModal';
import {
  Button,
  Card,
  Chip,
  DateField,
  EmptyState,
  ErrorNotice,
  Icon,
  IconBadge,
  ListCard,
  ListRow,
  Loading,
  Row,
  Screen,
  Text,
  TextField,
} from '@/ui/primitives';
import { space, useColors } from '@/ui/theme';

/** Opção "nenhum" na escolha do aparelho. */
const NO_EQUIPMENT = 'nenhum';

export default function ServiceJobScreen() {
  // `prestador` ou `aparelho`: serviço novo aberto da tela de um deles, que já vem escolhido.
  const { id, prestador, aparelho } = useLocalSearchParams<{ id: string; prestador?: string; aparelho?: string }>();
  const isNew = id === 'novo';
  const providers = useServiceProviders();
  const equipment = useEquipmentList();
  const job = useServiceJob(isNew ? undefined : id);
  // O aparelho do serviço (ou o da tela de onde a pessoa veio) que a lista daqui não tem (ela pode ser de antes de
  // ele ser cadastrado) é buscado à parte: o serviço mostra o nome dele e o gasto sabe se é um veículo.
  const wanted = isNew ? aparelho : job.data?.equipment_id;
  const absent = wanted && equipment.data && !equipment.data.some((e) => e.id === wanted) ? wanted : undefined;
  const lone = useEquipment(absent);
  // Excluído aqui: a busca volta sem ele antes de a tela fechar, e isso não é "não existe mais".
  const [deleted, setDeleted] = useState(false);

  if (deleted || providers.isPending || equipment.isPending || (!isNew && job.isPending)) return <Loading />;
  // Aviso de erro só para o que não chegou nenhuma vez: quando uma atualização
  // em segundo plano falha, o que já estava aqui continua valendo, e o
  // formulário (com o que foi digitado) não sai da frente da pessoa.
  const list = providers.data;
  const appliances = equipment.data;
  if (!list) {
    return <ErrorNotice error={new Error(providerErrorMessage(providers.error))} onRetry={() => providers.refetch()} />;
  }
  if (!isNew && job.data === undefined) {
    return <ErrorNotice error={new Error(providerErrorMessage(job.error))} onRetry={() => job.refetch()} />;
  }
  // Uma lista de aparelhos de antes serve: o serviço não perde o aparelho que tem por ele não estar nela (ver JobForm).
  if (!appliances) return <ErrorNotice error={equipment.error} onRetry={() => equipment.refetch()} />;
  // O app chegou antes das tabelas no banco.
  if (list.missing) {
    return (
      <Screen edges={[]}>
        <EmptyState icon="account-wrench-outline" title="Ainda não está disponível" message={PROVIDERS_UNAVAILABLE} mood="calm" />
      </Screen>
    );
  }
  if (!isNew && !job.data) return <ErrorNotice error={new Error('Este serviço não existe mais.')} />;
  // A busca dos prestadores falhou e a lista de antes não tem quem acabou de ser salvo (ou não tem ninguém):
  // pedir de novo, em vez de mandar cadastrar outra vez quem já está no banco.
  if (providers.isError && (list.rows.length === 0 || (prestador && !list.rows.some((p) => p.id === prestador)))) {
    return <ErrorNotice error={new Error(providerErrorMessage(providers.error))} onRetry={() => providers.refetch()} />;
  }
  if (list.rows.length === 0) {
    return (
      <Screen edges={[]}>
        <Stack.Screen options={{ title: 'Novo serviço' }} />
        <EmptyState
          icon="account-wrench-outline"
          title="Quem fez o serviço?"
          message="Cadastre primeiro o prestador (nome e o que faz). Depois é só registrar aqui o que foi feito."
          action={
            <Button
              title="Novo prestador"
              icon="plus"
              // O aparelho de onde a pessoa veio vai junto: depois de salvar o prestador, o serviço abre com ele.
              onPress={() =>
                router.replace({ pathname: '/prestador/[id]', params: aparelho ? { id: 'novo', aparelho } : { id: 'novo' } })
              }
            />
          }
        />
      </Screen>
    );
  }
  return (
    <JobForm
      key={id}
      job={isNew ? undefined : (job.data ?? undefined)}
      providers={list.rows}
      equipment={lone.data && lone.data.id === absent ? [...appliances, lone.data] : appliances}
      initialProviderId={prestador || null}
      initialEquipmentId={aparelho || null}
      onDeleted={() => setDeleted(true)}
    />
  );
}

function JobForm({
  job,
  providers,
  equipment,
  initialProviderId,
  initialEquipmentId,
  onDeleted,
}: {
  job?: ServiceJob;
  providers: ServiceProvider[];
  equipment: Equipment[];
  initialProviderId: string | null;
  initialEquipmentId: string | null;
  onDeleted: () => void;
}) {
  const c = useColors();
  const save = useSaveServiceJob();
  const remove = useDeleteServiceJob();
  const saveExpense = useSaveExpense();
  const known = <T extends { id: string }>(list: T[], id: string | null | undefined) => (id && list.some((item) => item.id === id) ? id : null);
  const [providerId, setProviderId] = useState(
    job?.provider_id ?? known(providers, initialProviderId) ?? (providers.length === 1 ? providers[0].id : null),
  );
  // O aparelho fica como veio (do serviço, ou da tela do aparelho), mesmo que a
  // lista daqui ainda não o tenha (ela pode ser de antes de ele ser cadastrado):
  // só sai quando a pessoa escolhe "Nenhum aparelho". Se ele foi mesmo apagado,
  // salvar avisa (o banco recusa), em vez de o serviço perder o aparelho calado.
  const [equipmentId, setEquipmentId] = useState(job ? job.equipment_id : initialEquipmentId);
  const [date, setDate] = useState(formatBRDate(job?.done_on ?? todayISO()));
  const [description, setDescription] = useState(job?.description ?? '');
  const [amount, setAmount] = useState(job?.amount != null ? job.amount.toLocaleString('pt-BR', { minimumFractionDigits: 2 }) : '');
  const [warranty, setWarranty] = useState(job?.warranty_until ? formatBRDate(job.warranty_until) : '');
  const [notes, setNotes] = useState(job?.notes ?? '');
  const [toExpenses, setToExpenses] = useState(false);
  const [picking, setPicking] = useState<'provider' | 'equipment' | null>(null);
  // Do toque em Salvar até fechar: um segundo toque não grava o serviço (nem o gasto) duas vezes.
  const [busy, setBusy] = useState(false);

  const provider = providers.find((p) => p.id === providerId);
  const trade = provider ? getProviderTrade(provider.trade) : null;
  const appliance = equipment.find((e) => e.id === equipmentId);
  // A mesma leitura de validateJob: "1.500" é mil e quinhentos.
  const offerExpense = canCopyToExpenses(amount.trim() ? parseMoney(amount) : null);
  // Moradia, ou Transporte quando é do mecânico ou num veículo: a linha do gasto e o gasto usam a mesma.
  // Sem categoria (null): o aparelho do serviço não está entre os que a tela tem, e um carro entraria em Moradia.
  const expenseCategory = serviceExpenseCategory(provider?.trade, appliance?.category, Boolean(equipmentId) && !appliance);

  function applyWarranty(months: number) {
    setWarranty(formatBRDate(addMonths(parseBRDate(date) ?? todayISO(), months)));
  }

  async function submit() {
    const result = validateJob({ providerId, date, description, equipmentId, amount, warranty, notes });
    if (!result.ok) return notify(result.title, result.message);
    const { values } = result;
    setBusy(true);
    try {
      await save.mutateAsync({ id: job?.id, values });
    } catch (err) {
      setBusy(false);
      return notify('Não deu para salvar', providerErrorMessage(err));
    }
    // Cópia de uma vez só: o gasto nasce agora e não fica ligado ao serviço.
    if (toExpenses && canCopyToExpenses(values.amount) && !expenseCategory) {
      notify('O serviço foi salvo, mas o gasto não', EXPENSE_COPY_SKIPPED);
    } else if (toExpenses && canCopyToExpenses(values.amount) && expenseCategory) {
      try {
        await saveExpense.mutateAsync({
          values: {
            description: expenseDescription(values.description, provider?.name ?? ''),
            amount: values.amount,
            spent_on: values.done_on,
            category: expenseCategory,
            notes: null,
          },
        });
      } catch (err) {
        notify('O serviço foi salvo, mas o gasto não', `${errorMessage(err)} Lance o gasto em Finanças.`);
      }
    }
    goBackOr({ pathname: '/prestador/[id]', params: { id: values.provider_id } });
  }

  return (
    <Screen edges={[]}>
      <Stack.Screen options={{ title: job ? 'Serviço' : 'Novo serviço' }} />

      <View style={styles.group}>
        <Text variant="label">Quem fez</Text>
        <ListCard>
          <ListRow
            left={<IconBadge icon={trade?.icon ?? 'account-wrench-outline'} tone={provider ? 'primary' : 'neutral'} />}
            title={provider?.name ?? 'Escolher prestador'}
            subtitle={trade?.label}
            right={<Icon name="chevron-right" color="textMuted" />}
            onPress={() => setPicking('provider')}
          />
        </ListCard>
      </View>

      <TextField
        label="O que foi feito"
        value={description}
        onChangeText={setDescription}
        placeholder="Ex.: Trocou a resistência do chuveiro"
        autoFocus={!job && Boolean(providerId)}
      />
      <Row gap={space.md} style={styles.top}>
        <View style={styles.flex}>
          <DateField label="Data" value={date} onChangeText={setDate} />
        </View>
        <View style={styles.flex}>
          <TextField label="Valor (opcional)" value={amount} onChangeText={setAmount} keyboardType="decimal-pad" placeholder="0,00" />
        </View>
      </Row>
      {offerExpense ? (
        <Card>
          <Row>
            <View style={styles.flex}>
              <Text variant="label">Lançar também nos gastos da casa</Text>
              <Text variant="small">{expenseCopyNote(Boolean(job), expenseCategory)}</Text>
            </View>
            <Switch
              value={toExpenses && Boolean(expenseCategory)}
              onValueChange={setToExpenses}
              disabled={!expenseCategory}
              trackColor={{ true: c.primary }}
              accessibilityLabel="Lançar também nos gastos da casa"
            />
          </Row>
        </Card>
      ) : null}

      {/* Com um aparelho já escolhido a linha aparece mesmo sem lista: é por ela que se chega a "Nenhum aparelho". */}
      {equipment.length || equipmentId ? (
        <View style={styles.group}>
          <Text variant="label">Aparelho (opcional)</Text>
          <ListCard>
            <ListRow
              left={<IconBadge icon={appliance ? getEquipmentCategory(appliance.category).icon : 'tools'} tone={equipmentId ? 'primary' : 'neutral'} />}
              // Escolhido, mas fora da lista que está aqui: sem o nome, e nunca "Nenhum aparelho".
              title={appliance?.name ?? (equipmentId ? 'Aparelho' : 'Nenhum aparelho')}
              subtitle={appliance?.location ?? undefined}
              right={<Icon name="chevron-right" color="textMuted" />}
              onPress={() => setPicking('equipment')}
            />
          </ListCard>
        </View>
      ) : null}

      <View style={styles.group}>
        <DateField label="Garantia do serviço até (opcional)" value={warranty} onChangeText={setWarranty} />
        <Row style={styles.wrap}>
          {SERVICE_WARRANTY_PRESETS.map((preset) => (
            <Chip key={preset.months} label={preset.label} onPress={() => applyWarranty(preset.months)} />
          ))}
        </Row>
        <Text variant="small">Os atalhos contam a partir da data do serviço.</Text>
      </View>

      <TextField label="Observações" value={notes} onChangeText={setNotes} multiline placeholder="Peças trocadas, o que ficou combinado…" />
      <Button title="Salvar" onPress={submit} loading={busy} />
      {job ? (
        <Button
          title="Excluir serviço"
          variant="danger"
          icon="trash-can-outline"
          disabled={busy}
          onPress={() =>
            confirmAction('Excluir serviço', `Excluir "${job.description}"? Se ele foi lançado nos gastos, o gasto continua em Finanças.`, 'Excluir', () =>
              remove.mutate(job.id, {
                onSuccess: () => {
                  onDeleted();
                  goBackOr({ pathname: '/prestador/[id]', params: { id: job.provider_id } });
                },
                onError: (err) => notify('Não deu para excluir', providerErrorMessage(err)),
              }),
            )
          }
        />
      ) : null}

      <PickerModal
        visible={picking === 'provider'}
        title="Quem fez o serviço"
        placeholder="Buscar prestador"
        options={providers.map((p) => {
          const t = getProviderTrade(p.trade);
          return { id: p.id, title: p.name, subtitle: t.label, left: <IconBadge icon={t.icon} tone="primary" /> };
        })}
        onSelect={(selected) => {
          setProviderId(selected);
          setPicking(null);
        }}
        onClose={() => setPicking(null)}
      />
      <PickerModal
        visible={picking === 'equipment'}
        title="Em qual aparelho"
        placeholder="Buscar aparelho"
        options={[
          { id: NO_EQUIPMENT, title: 'Nenhum aparelho', left: <IconBadge icon="tools" /> },
          ...equipment.map((e) => ({
            id: e.id,
            title: e.name,
            subtitle: e.location ?? undefined,
            left: <IconBadge icon={getEquipmentCategory(e.category).icon} tone="primary" />,
          })),
        ]}
        onSelect={(selected) => {
          setEquipmentId(selected === NO_EQUIPMENT ? null : selected);
          setPicking(null);
        }}
        onClose={() => setPicking(null)}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  top: { alignItems: 'flex-start' },
  group: { gap: space.sm },
  wrap: { flexWrap: 'wrap' },
});
