import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { useCompleteChore, useSaveChore } from '@/data/home';
import { DOCUMENTS_BUCKET, useDeleteEquipment, useEquipment, useMaintenance, useSaveEquipment } from '@/data/house';
import { choreStatus, describeChoreStatus, describeRecurrence } from '@/domain/chores';
import { addMonths, formatBRDate, formatShortDate, parseBRDate, todayISO, toISODate } from '@/domain/dates';
import {
  describeWarranty,
  EQUIPMENT_CATEGORIES,
  firstMaintenanceDate,
  suggestMaintenance,
  WARRANTY_PRESETS,
  warrantyStatus,
  type MaintenanceSuggestion,
} from '@/domain/equipment';
import { parseDecimal } from '@/domain/money';
import { PhotoStrip } from '@/features/PhotoStrip';
import { useDraftPhotos } from '@/features/useDraftPhotos';
import { usePhotoSheet } from '@/features/usePhotoSheet';
import { useHousehold } from '@/lib/auth';
import { errorMessage } from '@/lib/supabase';
import type { Equipment } from '@/lib/types';
import { confirmAction, notify } from '@/ui/dialogs';
import {
  Badge,
  Button,
  CheckCircle,
  Chip,
  DateField,
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
import { space } from '@/ui/theme';

export default function EquipmentScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const isNew = id === 'novo';
  const equipment = useEquipment(isNew ? undefined : id);
  if (!isNew && equipment.isPending) return <Loading />;
  if (!isNew && equipment.isError) return <ErrorNotice error={equipment.error} onRetry={() => equipment.refetch()} />;
  return <EquipmentForm key={id} equipment={isNew ? undefined : equipment.data} />;
}

function EquipmentForm({ equipment }: { equipment?: Equipment }) {
  const today = todayISO();
  const save = useSaveEquipment();
  const remove = useDeleteEquipment();
  const files = useDraftPhotos(DOCUMENTS_BUCKET, equipment?.file_paths ?? []);
  const [name, setName] = useState(equipment?.name ?? '');
  const [category, setCategory] = useState(equipment?.category ?? 'eletrodomestico');
  const [brand, setBrand] = useState(equipment?.brand ?? '');
  const [model, setModel] = useState(equipment?.model ?? '');
  const [serial, setSerial] = useState(equipment?.serial_number ?? '');
  const [location, setLocation] = useState(equipment?.location ?? '');
  const [purchased, setPurchased] = useState(equipment?.purchased_on ? formatBRDate(equipment.purchased_on) : '');
  const [price, setPrice] = useState(
    equipment?.price != null ? equipment.price.toLocaleString('pt-BR', { minimumFractionDigits: 2 }) : '',
  );
  const [store, setStore] = useState(equipment?.store ?? '');
  const [warranty, setWarranty] = useState(equipment?.warranty_until ? formatBRDate(equipment.warranty_until) : '');
  const [notes, setNotes] = useState(equipment?.notes ?? '');
  const onError = (err: unknown) => notify('Erro', errorMessage(err));
  const orNull = (value: string) => value.trim() || null;

  const photos = usePhotoSheet({
    title: 'Fotos do aparelho',
    message: 'Nota de compra, certificado de garantia, manual ou a etiqueta com modelo e número de série.',
    onPhotos: (uris) => {
      files.add(uris);
    },
  });

  function applyWarranty(months: number) {
    const from = parseBRDate(purchased) ?? today;
    setWarranty(formatBRDate(addMonths(from, months)));
  }

  function submit() {
    const purchasedISO = purchased.trim() ? parseBRDate(purchased) : null;
    const warrantyISO = warranty.trim() ? parseBRDate(warranty) : null;
    const priceValue = price.trim() ? parseDecimal(price) : null;
    if (!name.trim()) {
      notify('Confira os dados', 'Dê um nome ao aparelho (ex.: Ar do quarto).');
      return;
    }
    if ((purchased.trim() && !purchasedISO) || (warranty.trim() && !warrantyISO)) {
      notify('Data inválida', 'Use dd/mm/aaaa.');
      return;
    }
    if (price.trim() && priceValue == null) {
      notify('Preço inválido', 'Use um valor como 1.299,90.');
      return;
    }
    save.mutate(
      {
        id: equipment?.id,
        values: {
          name: name.trim(),
          category,
          brand: orNull(brand),
          model: orNull(model),
          serial_number: orNull(serial),
          location: orNull(location),
          purchased_on: purchasedISO,
          price: priceValue,
          store: orNull(store),
          warranty_until: warrantyISO,
          notes: orNull(notes),
          file_paths: files.paths,
        },
      },
      {
        onSuccess: ({ id }) => {
          files.commit();
          // Aparelho novo: fica na tela para cadastrar as manutenções.
          if (equipment) router.back();
          else router.replace({ pathname: '/aparelho/[id]', params: { id } });
        },
        onError,
      },
    );
  }

  const status = equipment ? warrantyStatus(equipment.warranty_until, today) : null;

  return (
    <Screen
      edges={[]}
      footer={<Button title={equipment ? 'Salvar' : 'Salvar aparelho'} onPress={submit} loading={save.isPending} disabled={files.uploading} />}>
      <Stack.Screen options={{ title: equipment ? equipment.name : 'Novo aparelho' }} />

      {status && status.kind !== 'sem_garantia' ? (
        <Badge label={describeWarranty(status)} tone={status.kind === 'acabando' ? 'warning' : status.kind === 'vencida' ? 'neutral' : 'primary'} />
      ) : null}

      <TextField label="Nome" value={name} onChangeText={setName} placeholder="Ex.: Ar do quarto, Geladeira, Carro" autoFocus={!equipment} />
      <View style={styles.group}>
        <Text variant="label">Tipo</Text>
        <Row style={styles.wrap}>
          {EQUIPMENT_CATEGORIES.map((c) => (
            <Chip key={c.key} label={c.label} icon={c.icon} selected={category === c.key} onPress={() => setCategory(c.key)} />
          ))}
        </Row>
      </View>
      <Row gap={space.md}>
        <View style={styles.flex}>
          <TextField label="Marca" value={brand} onChangeText={setBrand} />
        </View>
        <View style={styles.flex}>
          <TextField label="Modelo" value={model} onChangeText={setModel} />
        </View>
      </Row>
      <Row gap={space.md}>
        <View style={styles.flex}>
          <TextField label="Onde fica" value={location} onChangeText={setLocation} placeholder="Ex.: Quarto do casal" />
        </View>
        <View style={styles.flex}>
          <TextField label="Nº de série" value={serial} onChangeText={setSerial} autoCapitalize="characters" />
        </View>
      </Row>

      <View style={styles.group}>
        <Text variant="label">Fotos</Text>
        <PhotoStrip bucket={DOCUMENTS_BUCKET} paths={files.paths} busy={files.uploading} onAdd={() => photos.open()} onRemove={files.remove} />
        <Text variant="small">Nota de compra, garantia, manual ou etiqueta: tudo à mão quando precisar da assistência.</Text>
      </View>

      <Section title="Compra e garantia">
        <Row gap={space.md}>
          <View style={styles.flex}>
            <DateField label="Comprado em" value={purchased} onChangeText={setPurchased} />
          </View>
          <View style={styles.flex}>
            <TextField label="Preço" value={price} onChangeText={setPrice} placeholder="0,00" keyboardType="decimal-pad" />
          </View>
        </Row>
        <TextField label="Loja" value={store} onChangeText={setStore} />
        <DateField label="Garantia até" value={warranty} onChangeText={setWarranty} />
        <Row style={styles.wrap}>
          {WARRANTY_PRESETS.map((months) => (
            <Chip key={months} label={months >= 12 ? `${months / 12} ano${months > 12 ? 's' : ''}` : `${months} meses`} onPress={() => applyWarranty(months)} />
          ))}
        </Row>
        <Text variant="small">Os atalhos contam a partir da data de compra (ou de hoje).</Text>
      </Section>

      <TextField label="Observações" value={notes} onChangeText={setNotes} multiline placeholder="Assistência técnica, telefone, peças usadas…" />

      {equipment ? <MaintenanceSection equipment={equipment} today={today} /> : (
        <Text variant="muted">Depois de salvar, cadastre as manutenções (o app sugere as mais comuns).</Text>
      )}

      {equipment ? (
        <Button
          title="Excluir aparelho"
          variant="danger"
          icon="trash-can-outline"
          onPress={() =>
            confirmAction('Excluir aparelho', `Excluir ${equipment.name}, as fotos e as manutenções?`, 'Excluir', () =>
              remove.mutate(
                { id: equipment.id, file_paths: [...equipment.file_paths, ...files.pending()] },
                {
                  onSuccess: () => {
                    files.commit();
                    router.back();
                  },
                  onError,
                },
              ),
            )
          }
        />
      ) : null}
      {photos.element}
    </Screen>
  );
}

function MaintenanceSection({ equipment, today }: { equipment: Equipment; today: string }) {
  const members = useHousehold().data?.members ?? [];
  const { chores, history } = useMaintenance(equipment.id);
  const saveChore = useSaveChore();
  const complete = useCompleteChore();
  const onError = (err: unknown) => notify('Erro', errorMessage(err));
  const list = chores.data ?? [];
  const suggestions = suggestMaintenance(equipment.name, equipment.category, list.map((c) => c.title));

  function addSuggestion(suggestion: MaintenanceSuggestion) {
    saveChore.mutate(
      {
        values: {
          title: suggestion.title,
          notes: null,
          recurrence: suggestion.recurrence,
          interval_count: suggestion.interval,
          due_on: firstMaintenanceDate(suggestion, today),
          assigned_to: null,
          equipment_id: equipment.id,
        },
      },
      { onError },
    );
  }

  return (
    <>
      <Section
        title="Manutenções"
        action={
          <Button
            title="Manutenção"
            icon="plus"
            variant="ghost"
            compact
            onPress={() => router.push({ pathname: '/tarefa/[id]', params: { id: 'nova', aparelho: equipment.id } })}
          />
        }>
        {chores.isError ? <ErrorNotice error={chores.error} onRetry={() => chores.refetch()} /> : null}
        {list.length ? (
          <ListCard>
            {list.map((chore) => {
              const status = choreStatus(chore.due_on, today);
              return (
                <ListRow
                  key={chore.id}
                  left={<IconBadge icon="wrench-outline" tone={!chore.active ? 'neutral' : status.kind === 'atrasada' ? 'danger' : 'primary'} />}
                  title={chore.title}
                  subtitle={[
                    describeRecurrence(chore.recurrence, chore.interval_count),
                    chore.active ? describeChoreStatus(status) : 'Encerrada',
                  ].join(' · ')}
                  dimmed={!chore.active}
                  onPress={() => router.push({ pathname: '/tarefa/[id]', params: { id: chore.id } })}
                  right={
                    chore.active ? (
                      <CheckCircle
                        checked={false}
                        label={`Registrar ${chore.title} feita hoje`}
                        onPress={() => complete.mutate({ id: chore.id, today, dueOn: chore.due_on }, { onError })}
                      />
                    ) : null
                  }
                />
              );
            })}
          </ListCard>
        ) : chores.isPending ? null : (
          <Text variant="muted">Nenhuma manutenção cadastrada.</Text>
        )}
        {suggestions.length ? (
          <View style={styles.group}>
            <Text variant="small">Sugestões para este aparelho:</Text>
            <Row style={styles.wrap}>
              {suggestions.map((s) => (
                <Chip
                  key={s.title}
                  icon="plus"
                  label={`${s.title} (${describeRecurrence(s.recurrence, s.interval).toLowerCase()})`}
                  onPress={() => addSuggestion(s)}
                />
              ))}
            </Row>
          </View>
        ) : null}
      </Section>

      {history.data?.length ? (
        <Section title="Histórico">
          <ListCard>
            {history.data.slice(0, 15).map((done) => (
              <ListRow
                key={done.id}
                left={<Badge label={formatShortDate(toISODate(new Date(done.completed_at)))} />}
                title={list.find((c) => c.id === done.chore_id)?.title ?? 'Manutenção'}
                subtitle={members.find((m) => m.user_id === done.completed_by)?.display_name}
              />
            ))}
          </ListCard>
        </Section>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  group: { gap: space.sm },
  wrap: { flexWrap: 'wrap' },
});
