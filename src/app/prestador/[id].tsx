import { onlineManager } from '@tanstack/react-query';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, Switch, View } from 'react-native';

import { useEquipmentList } from '@/data/house';
import {
  PROVIDERS_UNAVAILABLE,
  providerErrorMessage,
  useDeleteProvider,
  useProviderJobCount,
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
import { StaleNotice } from '@/features/health/StaleNotice';
import { ProviderContactButtons } from '@/features/providers/ProviderContact';
import { goBackOr } from '@/lib/navigation';
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
  // `aparelho`: a pessoa veio de um serviço novo com aparelho, e quem fez ainda não estava cadastrado (a casa sem
  // prestador nenhum, ou "Novo prestador" na lista de quem fez). Ele segue daqui até o serviço, que não fica sem ele.
  const { id, aparelho } = useLocalSearchParams<{ id: string; aparelho?: string }>();
  const isNew = id === 'novo';
  // O prestador que já existe é buscado de novo ao abrir, mesmo com a lista guardada ainda nova.
  const providers = useServiceProviders({ fresh: !isNew });
  // Excluído aqui: a lista volta sem ele antes de a tela fechar, e isso não é "não existe mais".
  const [deleted, setDeleted] = useState(false);
  // O formulário copia o prestador para os campos uma vez só, quando aparece. Por isso o que já existe espera a
  // busca que esta tela pediu ao abrir: a lista guardada pode ser de antes de uma mudança, daqui ou de outro
  // aparelho da casa, e salvar gravaria o de antes por cima. Depois que o formulário apareceu, ele fica: outra
  // busca (a do próprio Salvar, a de voltar ao app) não o tira da frente, nem um erro dela.
  const [shownId, setShownId] = useState<string | null>(null);
  const formShown = shownId === id;
  const markShown = useCallback(() => setShownId(id), [id]);
  if (providers.isPending || deleted || (!isNew && !formShown && providers.isFetching)) return <Loading />;
  // Aviso de erro só sem lista nenhuma: quando uma atualização em segundo plano
  // falha, a lista que já estava aqui continua valendo, e o formulário (com o
  // que foi digitado) não sai da frente da pessoa.
  const list = providers.data;
  if (!list) {
    return <ErrorNotice error={new Error(providerErrorMessage(providers.error))} onRetry={() => providers.refetch()} />;
  }
  // O app chegou antes das tabelas no banco.
  if (list.missing) {
    return (
      <Screen edges={[]}>
        <EmptyState icon="account-wrench-outline" title="Ainda não está disponível" message={PROVIDERS_UNAVAILABLE} mood="calm" />
      </Screen>
    );
  }
  const provider = isNew ? undefined : list.rows.find((p) => p.id === id);
  if (!isNew && !provider) {
    // A lista ainda pode estar chegando com ele (acabou de ser criado).
    if (providers.isFetching) return <Loading />;
    // A busca falhou: a lista daqui é a de antes, e ele pode existir (acabou de ser salvo). Não é "não existe mais".
    if (providers.isError) {
      return <ErrorNotice error={new Error(providerErrorMessage(providers.error))} onRetry={() => providers.refetch()} />;
    }
    // Sem internet a busca fica parada, e a lista daqui é a guardada: ele pode estar no banco (salvo em outro
    // celular). Quando a internet volta, a busca segue sozinha e o formulário abre.
    if (providers.isPaused) {
      return <ErrorNotice error={new Error('Sem internet: não deu para abrir este prestador.')} onRetry={() => providers.refetch()} />;
    }
    return <ErrorNotice error={new Error('Este prestador não existe mais.')} />;
  }
  return (
    <ProviderForm key={id} provider={provider} equipmentId={aparelho || null} onShown={markShown} onDeleted={() => setDeleted(true)} />
  );
}

function ProviderForm({
  provider,
  equipmentId,
  onShown,
  onDeleted,
}: {
  provider?: ServiceProvider;
  /** O aparelho do serviço que a pessoa veio registrar, se veio de um. */
  equipmentId: string | null;
  /** O formulário apareceu (com o prestador copiado para os campos). */
  onShown: () => void;
  onDeleted: () => void;
}) {
  const c = useColors();
  const save = useSaveProvider();
  const remove = useDeleteProvider();
  // Só para a pergunta de excluir dizer quantos serviços vão junto (ver useProviderJobCount): a lista guardada
  // pode ser de antes de um serviço registrado em outro celular, que iria embora sem aviso.
  const jobCount = useProviderJobCount(provider?.id);
  // Do toque em "Excluir prestador" até a pergunta: a busca do toque está a caminho.
  const [checking, setChecking] = useState(false);
  // A pessoa saiu da tela enquanto o toque buscava: a pergunta não aparece depois, em outra tela.
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const [name, setName] = useState(provider?.name ?? '');
  // Prestador novo começa sem ofício: a pessoa escolhe, em vez de ficar em "Outros" sem querer.
  const [trade, setTrade] = useState<string>(provider ? getProviderTrade(provider.trade).key : '');
  const [phone, setPhone] = useState(provider?.phone ?? '');
  const [notes, setNotes] = useState(provider?.notes ?? '');
  const [recommended, setRecommended] = useState(provider?.recommended ?? true);
  // Avisa a tela: daqui em diante ela não troca o formulário por "carregando".
  useEffect(onShown, [onShown]);

  function submit() {
    const result = validateProvider({ name, trade, phone, notes, recommended });
    if (!result.ok) return notify(result.title, result.message);
    save.mutate(
      { id: provider?.id, values: result.values },
      {
        onSuccess: ({ id }) => {
          if (provider) return goBackOr('/prestadores');
          // Veio de um serviço novo com aparelho: segue para o serviço, com quem fez e o aparelho
          // já escolhidos. Troca esta tela por ele: Voltar cai na tela de onde o serviço foi aberto.
          if (equipmentId) {
            return router.replace({ pathname: '/servico/[id]', params: { id: 'novo', prestador: id, aparelho: equipmentId } });
          }
          // Prestador novo: fica na tela para registrar o primeiro serviço.
          router.replace({ pathname: '/prestador/[id]', params: { id } });
        },
        onError: (err) => notify('Não deu para salvar', providerErrorMessage(err)),
      },
    );
  }

  async function askDelete(target: ServiceProvider) {
    // Sem saber quantos serviços são (a busca desta visita ainda anda, falhou ou está parada), a pergunta fala do
    // histórico todo, e o banco não confere número nenhum: a pessoa aceita apagar o que houver. Sabendo, busca de
    // novo na hora do toque, com a internet: com a tela aberta, outro celular pode ter registrado um serviço.
    let count = jobCount.known;
    if (count != null && onlineManager.isOnline()) {
      setChecking(true);
      count = await jobCount.recount();
      if (!mounted.current) return;
      setChecking(false);
    }
    confirmAction('Excluir prestador', deleteProviderWarning(target.name, count), 'Excluir', () =>
      // O banco confere o número da pergunta: um serviço registrado depois dela, em outro celular, recusa (e nada sai).
      remove.mutate(
        { id: target.id, expectedJobs: count },
        {
          onSuccess: () => {
            onDeleted();
            goBackOr('/prestadores');
          },
          onError: (err) => notify('Não deu para excluir', providerErrorMessage(err)),
        },
      ),
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
        <ProviderJobs provider={provider} equipmentId={equipmentId} />
      ) : (
        <Text variant="muted">
          {equipmentId ? 'Depois de salvar, o app abre o registro do serviço.' : 'Depois de salvar, registre aqui os serviços feitos.'}
        </Text>
      )}

      {provider ? (
        <Button
          title="Excluir prestador"
          variant="danger"
          icon="trash-can-outline"
          loading={checking || remove.isPending}
          onPress={() => void askDelete(provider)}
        />
      ) : null}
    </Screen>
  );
}

/** O histórico do que a pessoa já fez para a casa, do mais recente para o mais antigo. */
function ProviderJobs({ provider, equipmentId }: { provider: ServiceProvider; equipmentId: string | null }) {
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
          onPress={() =>
            router.push({
              pathname: '/servico/[id]',
              // Quem chegou aqui a partir de um aparelho continua com ele escolhido.
              params: equipmentId ? { id: 'novo', prestador: provider.id, aparelho: equipmentId } : { id: 'novo', prestador: provider.id },
            })
          }
        />
      }>
      {/* O aviso de erro só sem nada guardado; com o histórico de antes, ele continua aqui, com o aviso de que pode não estar em dia. */}
      {jobs.isError && jobs.data ? <StaleNotice onRetry={() => jobs.refetch()} /> : null}
      {jobs.isError && !jobs.data ? (
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
