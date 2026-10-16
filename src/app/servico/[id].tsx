import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
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
  expenseCopyGap,
  expenseCopyGapNote,
  expenseCopyNote,
  expenseCopySkippedNote,
  expenseDescription,
  getProviderTrade,
  readOnThisVisit,
  SERVICE_WARRANTY_PRESETS,
  serviceExpenseCategory,
  validateJob,
  type SourceRead,
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
  // Os dois lidos de novo ao abrir, mesmo com o guardado de segundos atrás: o ofício do prestador e o aparelho dizem
  // a categoria do gasto copiado, e podem ter mudado em outro celular. O formulário não espera estas leituras; só a
  // cópia para os gastos (ver JobForm).
  const providers = useServiceProviders({ fresh: true });
  const equipment = useEquipmentList({ fresh: true });
  const job = useServiceJob(isNew ? undefined : id);
  // O aparelho do serviço (ou o da tela de onde a pessoa veio) que a lista daqui não tem (ela pode ser de antes de
  // ele ser cadastrado) é buscado à parte: o serviço mostra o nome dele e o gasto sabe se é um veículo.
  const wanted = isNew ? aparelho : job.data?.equipment_id;
  const absent = wanted && equipment.data && !equipment.data.some((e) => e.id === wanted) ? wanted : undefined;
  const lone = useEquipment(absent, { fresh: true });
  // Quando ele passa a faltar depois de a tela abrir, a busca dele é outra (outro id) e não sai sozinha com um
  // guardado recente: pede aqui, junto da que já estiver a caminho.
  const { refetch: refetchLone } = lone;
  useEffect(() => {
    if (absent) void refetchLone({ cancelRefetch: false });
  }, [absent, refetchLone]);
  // O prestador, a mesma coisa: com ele fora da lista daqui, ela é buscada de novo, uma vez (não há busca de um só).
  const author = isNew ? prestador : job.data?.provider_id;
  const authorAbsent = Boolean(author && providers.data && !providers.data.missing && !providers.data.rows.some((p) => p.id === author));
  const { refetch: refetchProviders } = providers;
  useEffect(() => {
    if (authorAbsent) refetchProviders();
  }, [authorAbsent, author, refetchProviders]);
  // Excluído aqui: a busca volta sem ele antes de a tela fechar, e isso não é "não existe mais".
  const [deleted, setDeleted] = useState(false);
  // O formulário copia o serviço para os campos uma vez só, quando aparece. Por isso o serviço que já existe
  // espera a busca que esta tela pediu ao abrir (useServiceJob busca a cada abertura, mesmo com o guardado de
  // segundos atrás; sem internet ela fica parada e vale o guardado): o que está guardado pode ser de antes de
  // uma mudança, daqui ou de outro aparelho da casa, e salvar gravaria o de antes por cima. Depois que o
  // formulário apareceu, ele fica: outra busca (a do próprio Salvar, a de voltar ao app) não o tira da frente,
  // nem um erro dela.
  const [shownId, setShownId] = useState<string | null>(null);
  const formShown = shownId === id;
  const markShown = useCallback(() => setShownId(id), [id]);

  if (deleted || providers.isPending || equipment.isPending || (!isNew && (job.isPending || (!formShown && job.isFetching)))) {
    return <Loading />;
  }
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
  // pedir de novo, em vez de mandar cadastrar outra vez quem já está no banco. Com o formulário já aberto, quem
  // falta não o tira da frente: o cartão do gasto avisa e tem o "Tentar de novo" (ver JobForm).
  if (providers.isError && (list.rows.length === 0 || (!formShown && prestador && !list.rows.some((p) => p.id === prestador)))) {
    return <ErrorNotice error={new Error(providerErrorMessage(providers.error))} onRetry={() => providers.refetch()} />;
  }
  // Lista vazia de antes, e a nova ainda a caminho (ou parada, sem internet, até a conexão voltar): quem fez este
  // serviço pode estar chegando nela.
  if (list.rows.length === 0 && (providers.isFetching || providers.isPaused)) return <Loading />;
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
      // Para o cartão do gasto: como está, nesta visita, a leitura de onde vêm o prestador e o aparelho, e como pedir
      // de novo.
      sources={{
        provider: { read: readOnThisVisit(providers), retry: () => providers.refetch() },
        equipment: {
          read: readOnThisVisit(equipment),
          lone: absent ? { id: absent, read: readOnThisVisit(lone) } : null,
          retry: () => {
            equipment.refetch();
            if (absent) lone.refetch();
          },
        },
      }}
      onShown={markShown}
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
  sources,
  onShown,
  onDeleted,
}: {
  job?: ServiceJob;
  providers: ServiceProvider[];
  equipment: Equipment[];
  initialProviderId: string | null;
  initialEquipmentId: string | null;
  /**
   * As leituras de onde vêm o prestador e o aparelho, nesta visita, e como pedir de novo. `lone`: o aparelho buscado
   * à parte (o que a lista não tem), que vem dessa leitura e não da lista.
   */
  sources: {
    provider: { read: SourceRead; retry: () => void };
    equipment: { read: SourceRead; lone: { id: string; read: SourceRead } | null; retry: () => void };
  };
  /** O formulário apareceu (com o serviço copiado para os campos). */
  onShown: () => void;
  onDeleted: () => void;
}) {
  const c = useColors();
  const save = useSaveServiceJob();
  const remove = useDeleteServiceJob();
  const saveExpense = useSaveExpense();
  // O prestador e o aparelho ficam como vieram (do serviço, ou da tela de onde a
  // pessoa veio), mesmo que as listas daqui ainda não os tenham (elas podem ser
  // de antes de eles serem cadastrados): o serviço não troca de prestador por
  // conta própria, e o aparelho só sai quando a pessoa escolhe "Nenhum aparelho".
  // Se um deles foi mesmo apagado, salvar avisa (o banco recusa). Sem prestador
  // vindo de lugar nenhum (o serviço novo aberto de um aparelho), ninguém vem
  // escolhido, nem o único da casa: ele pode ser de outro ofício (o mecânico,
  // num conserto da geladeira), e o serviço e o gasto iriam para ele.
  const [providerId, setProviderId] = useState(job?.provider_id ?? initialProviderId ?? null);
  const [equipmentId, setEquipmentId] = useState(job ? job.equipment_id : initialEquipmentId);
  const [date, setDate] = useState(formatBRDate(job?.done_on ?? todayISO()));
  // A data com que o formulário abriu: outra data ali é algo que a pessoa escreveu (ver newProvider).
  const [openedDate] = useState(date);
  const [description, setDescription] = useState(job?.description ?? '');
  const [amount, setAmount] = useState(job?.amount != null ? job.amount.toLocaleString('pt-BR', { minimumFractionDigits: 2 }) : '');
  const [warranty, setWarranty] = useState(job?.warranty_until ? formatBRDate(job.warranty_until) : '');
  const [notes, setNotes] = useState(job?.notes ?? '');
  const [toExpenses, setToExpenses] = useState(false);
  const [picking, setPicking] = useState<'provider' | 'equipment' | null>(null);
  // Do toque em Salvar até fechar: um segundo toque não grava o serviço (nem o gasto) duas vezes.
  const [busy, setBusy] = useState(false);
  // A pessoa fechou a tela enquanto o Salvar gravava (arrastou para baixo, ou o voltar do Android): o que já
  // foi pedido termina, mas voltar depois fecharia a tela de baixo (a do prestador, a do aparelho).
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  // Avisa a tela: daqui em diante ela não troca o formulário por "carregando" nem pelo aviso de erro.
  useEffect(onShown, [onShown]);

  const provider = providers.find((p) => p.id === providerId);
  const trade = provider ? getProviderTrade(provider.trade) : null;
  const appliance = equipment.find((e) => e.id === equipmentId);
  // A mesma leitura de validateJob: "1.500" é mil e quinhentos.
  const offerExpense = canCopyToExpenses(amount.trim() ? parseMoney(amount) : null);
  // Moradia, ou Transporte quando é do mecânico ou num veículo: a linha do gasto e o gasto usam a mesma.
  const expenseCategory = serviceExpenseCategory(provider?.trade, appliance?.category);
  // O prestador ou o aparelho do serviço que não veio da leitura desta visita (fora das listas daqui, ou nelas só
  // pelo guardado): sem eles a categoria (e o nome no gasto) podia sair errada, e a cópia espera.
  const { lone } = sources.equipment;
  const expenseWait = expenseCopyGap(provider?.trade, {
    provider: { chosen: Boolean(providerId), found: Boolean(provider), read: sources.provider.read },
    equipment: {
      chosen: Boolean(equipmentId),
      found: Boolean(appliance),
      read: lone && lone.id === equipmentId ? lone.read : sources.equipment.read,
    },
  });
  const expenseGap = expenseWait?.gap ?? null;

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
    if (toExpenses && canCopyToExpenses(values.amount) && expenseGap) {
      notify('O serviço foi salvo, mas o gasto não', expenseCopySkippedNote(expenseGap));
    } else if (toExpenses && canCopyToExpenses(values.amount)) {
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
    // A tela já fechou enquanto gravava (ver mounted): voltar agora fecharia a de baixo.
    if (!mounted.current) return;
    goBackOr({ pathname: '/prestador/[id]', params: { id: values.provider_id } });
  }

  /**
   * "Novo prestador", na lista de quem fez: troca esta tela pelo cadastro, que depois abre um serviço novo com
   * quem foi cadastrado e o aparelho escolhido aqui (como na casa sem prestador nenhum). O que foi escrito neste
   * serviço não vai junto: com algo escrito, pergunta antes.
   */
  function newProvider() {
    const go = () => {
      setPicking(null);
      router.replace({ pathname: '/prestador/[id]', params: equipmentId ? { id: 'novo', aparelho: equipmentId } : { id: 'novo' } });
    };
    const typed = [description, amount, warranty, notes].some((text) => text.trim() !== '') || date !== openedDate;
    if (!typed) return go();
    confirmAction('Novo prestador', 'Cadastrar um prestador novo? O que você escreveu neste serviço não fica salvo.', 'Cadastrar', go);
  }

  return (
    <Screen edges={[]}>
      <Stack.Screen options={{ title: job ? 'Serviço' : 'Novo serviço' }} />

      <View style={styles.group}>
        <Text variant="label">Quem fez</Text>
        <ListCard>
          <ListRow
            left={<IconBadge icon={trade?.icon ?? 'account-wrench-outline'} tone={provider ? 'primary' : 'neutral'} />}
            // Escolhido, mas fora da lista que está aqui: sem o nome, e nunca "Escolher prestador".
            title={provider?.name ?? (providerId ? 'Prestador' : 'Escolher prestador')}
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
        <Card style={styles.group}>
          <Row>
            <View style={styles.flex}>
              <Text variant="label">Lançar também nos gastos da casa</Text>
              <Text variant="small">
                {expenseWait ? expenseCopyGapNote(expenseWait.gap, expenseWait.wait) : expenseCopyNote(Boolean(job), expenseCategory)}
              </Text>
            </View>
            <Switch
              value={toExpenses && !expenseGap}
              onValueChange={setToExpenses}
              disabled={Boolean(expenseGap)}
              trackColor={{ true: c.primary }}
              accessibilityLabel="Lançar também nos gastos da casa"
            />
          </Row>
          {/* Não chegou: dá para pedir de novo (sem internet, a busca recomeça sozinha quando ela volta). O prestador e o aparelho do serviço continuam os mesmos. */}
          {expenseWait?.wait === 'failed' ? (
            <Button title="Tentar de novo" variant="secondary" compact onPress={sources[expenseWait.gap].retry} />
          ) : null}
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
        // Quem fez pode não estar na lista. Só num serviço novo e fora do Salvar: trocar de tela deixaria para trás
        // o serviço aberto, ou o que está sendo gravado.
        extraActions={() =>
          !job && !busy ? <Button title="Novo prestador" icon="plus" variant="secondary" compact onPress={newProvider} /> : null
        }
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
