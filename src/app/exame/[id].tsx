import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import {
  readHealthDocument,
  useDeleteExam,
  useExam,
  usePeople,
  useSaveExam,
} from '@/data/health';
import { formatBRDate, parseBRDate } from '@/domain/dates';
import {
  EXAM_STATUS,
  flagLabel,
  MAX_HEALTH_PHOTOS,
  RESULT_FLAGS,
  type ExamReading,
  type ExamResult,
  type ResultFlag,
} from '@/domain/health';
import { FieldsModal, orNull } from '@/features/health/FieldsModal';
import { openNewPerson, PersonChips } from '@/features/health/PersonChips';
import { PhotoStrip } from '@/features/PhotoStrip';
import { useDraftPhotos } from '@/features/useDraftPhotos';
import { usePhotoSheet } from '@/features/usePhotoSheet';
import { errorMessage } from '@/lib/supabase';
import type { Exam, Person } from '@/lib/types';
import { BusyOverlay } from '@/ui/BusyOverlay';
import { askYesNo, confirmAction, notify } from '@/ui/dialogs';
import {
  Badge,
  Button,
  Chip,
  ErrorNotice,
  ListCard,
  ListRow,
  Loading,
  Row,
  Screen,
  Section,
  Segmented,
  Text,
  TextField,
} from '@/ui/primitives';
import { space } from '@/ui/theme';

export default function ExamScreen() {
  const { id, pessoa } = useLocalSearchParams<{ id: string; pessoa?: string }>();
  const isNew = id === 'nova';
  const exam = useExam(isNew ? undefined : id);
  const people = usePeople();
  if ((!isNew && exam.isPending) || people.isPending) return <Loading />;
  if (!isNew && exam.isError) return <ErrorNotice error={exam.error} onRetry={() => exam.refetch()} />;
  if (people.isError) return <ErrorNotice error={people.error} onRetry={() => people.refetch()} />;
  return <ExamForm exam={isNew ? undefined : exam.data} people={people.data} initialPersonId={pessoa || null} />;
}

type ResultField = 'name' | 'value' | 'unit' | 'reference';

function ExamForm({ exam, people, initialPersonId }: { exam?: Exam; people: Person[]; initialPersonId: string | null }) {
  const save = useSaveExam();
  const remove = useDeleteExam();
  const [personId, setPersonId] = useState(exam?.person_id ?? initialPersonId ?? (people.length === 1 ? people[0].id : null));
  const [title, setTitle] = useState(exam?.title ?? '');
  const [status, setStatus] = useState<Exam['status']>(exam?.status ?? 'realizado');
  const [date, setDate] = useState(exam?.exam_date ? formatBRDate(exam.exam_date) : '');
  const [requestedBy, setRequestedBy] = useState(exam?.requested_by ?? '');
  const [lab, setLab] = useState(exam?.lab ?? '');
  const [notes, setNotes] = useState(exam?.notes ?? '');
  const [results, setResults] = useState<ExamResult[]>(exam?.results ?? []);
  const files = useDraftPhotos('health', exam?.file_paths ?? []);
  const paths = files.paths;
  const [reading, setReading] = useState(false);
  const [editing, setEditing] = useState<{ index: number | null; flag: ResultFlag | null } | null>(null);

  const photos = usePhotoSheet({
    title: 'Fotos do exame',
    message: 'Pedido médico ou laudo, todas as páginas.',
    onPhotos: async (uris) => {
      const next = await files.add(uris);
      if (!next) return;
      const read = await askYesNo('Fotos adicionadas', 'Ler o documento com IA e preencher os campos?', 'Ler agora', 'Depois');
      if (read) await readWithAI(next);
    },
  });

  async function readWithAI(photoPaths = paths) {
    setReading(true);
    let reading: ExamReading;
    try {
      reading = await readHealthDocument<ExamReading>('exam', photoPaths.slice(0, MAX_HEALTH_PHOTOS));
    } catch (err) {
      notify('Não deu para ler com IA', errorMessage(err));
      return;
    } finally {
      // A tela de espera sai antes de qualquer pergunta sobre o resultado.
      setReading(false);
    }
    await apply(reading);
  }

  async function apply(reading: ExamReading) {
    if (reading.title && !title.trim()) setTitle(reading.title);
    if (reading.exam_date && !date.trim()) setDate(formatBRDate(reading.exam_date));
    if (reading.lab && !lab.trim()) setLab(reading.lab);
    if (reading.requested_by && !requestedBy.trim()) setRequestedBy(reading.requested_by);
    if (reading.kind === 'pedido') {
      if (!exam) setStatus('pedido');
      if (reading.requested_exams.length && !notes.trim()) setNotes(`Exames pedidos:\n${reading.requested_exams.map((e) => `• ${e}`).join('\n')}`);
    } else {
      setStatus('realizado');
    }
    // A leitura cobre todas as fotos: substitui a lista (somar duplicaria
    // resultados em uma releitura). Com resultados já na tela, pergunta antes.
    let replaced = false;
    if (reading.results.length) {
      replaced =
        !results.length ||
        (await askYesNo(
          'Substituir resultados?',
          `A leitura trouxe ${reading.results.length} resultados. Trocar os ${results.length} que já estão aqui por eles?`,
          'Substituir',
          'Manter os atuais',
        ));
      if (replaced) setResults(reading.results);
    }
    notify(
      'Leitura concluída',
      replaced
        ? `${reading.results.length} resultados transcritos. Confira com o laudo antes de salvar.`
        : 'Campos preenchidos. Confira antes de salvar.',
    );
  }

  function submit() {
    const dateISO = date.trim() ? parseBRDate(date) : null;
    if (!personId || !title.trim()) {
      notify('Confira os dados', 'Escolha para quem é e informe o exame.');
      return;
    }
    if (date.trim() && !dateISO) {
      notify('Data inválida', 'Use dd/mm/aaaa.');
      return;
    }
    save.mutate(
      {
        id: exam?.id,
        values: {
          person_id: personId,
          title: title.trim(),
          status,
          exam_date: dateISO,
          requested_by: orNull(requestedBy),
          lab: orNull(lab),
          notes: orNull(notes),
          file_paths: paths,
          results,
        },
      },
      {
        onSuccess: () => {
          files.commit();
          router.back();
        },
        onError: (err) => notify('Erro', errorMessage(err)),
      },
    );
  }

  const editingResult = editing?.index != null ? results[editing.index] : null;

  return (
    <Screen
      edges={[]}
      footer={<Button title="Salvar exame" onPress={submit} loading={save.isPending} disabled={files.uploading || reading} />}>
      <Stack.Screen options={{ title: exam ? exam.title : 'Novo exame' }} />
      <View style={styles.group}>
        <Text variant="label">Para quem</Text>
        <PersonChips people={people} value={personId} onChange={setPersonId} onAdd={openNewPerson} />
      </View>

      <View style={styles.group}>
        <Text variant="label">Fotos do pedido ou laudo</Text>
        <PhotoStrip
          bucket="health"
          paths={paths}
          busy={files.uploading}
          onAdd={paths.length < MAX_HEALTH_PHOTOS ? () => photos.open(MAX_HEALTH_PHOTOS - paths.length) : undefined}
          onRemove={files.remove}
        />
        {paths.length ? (
          <Button title="Ler com IA" icon="text-recognition" variant="secondary" compact loading={reading} onPress={() => readWithAI()} />
        ) : (
          <Text variant="small">A IA transcreve nome, data e resultados. Ela não interpreta os valores.</Text>
        )}
      </View>

      <TextField label="Exame" value={title} onChangeText={setTitle} placeholder="Ex.: Hemograma, Ultrassom de abdome" />
      <Segmented value={status} onChange={setStatus} options={EXAM_STATUS} />
      <Row gap={space.md}>
        <View style={styles.flex}>
          <TextField label="Data" value={date} onChangeText={setDate} placeholder="dd/mm/aaaa" keyboardType="numbers-and-punctuation" />
        </View>
        <View style={styles.flex}>
          <TextField label="Laboratório" value={lab} onChangeText={setLab} />
        </View>
      </Row>
      <TextField label="Pedido por" value={requestedBy} onChangeText={setRequestedBy} placeholder="Médico solicitante" />
      <TextField label="Observações" value={notes} onChangeText={setNotes} multiline />

      <Section
        title="Resultados"
        action={
          <Button title="Resultado" icon="plus" variant="ghost" compact onPress={() => setEditing({ index: null, flag: null })} />
        }>
        {results.length === 0 ? (
          <Text variant="muted">Nenhum resultado. Leia o laudo com IA ou adicione à mão.</Text>
        ) : (
          <ListCard>
            {results.map((r, index) => (
              <ListRow
                key={`${index}-${r.name}`}
                title={r.name}
                subtitle={[
                  [r.value, r.unit].filter(Boolean).join(' '),
                  r.reference ? `ref. ${r.reference}` : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
                right={r.flag ? <Badge label={flagLabel(r.flag)!} tone="warning" /> : null}
                onPress={() => setEditing({ index, flag: r.flag })}
              />
            ))}
          </ListCard>
        )}
      </Section>

      {exam ? (
        <Button
          title="Apagar exame"
          variant="danger"
          icon="trash-can-outline"
          onPress={() =>
            confirmAction('Apagar exame', `Apagar ${exam.title} e as fotos?`, 'Apagar', () =>
              remove.mutate(
                { id: exam.id, file_paths: [...exam.file_paths, ...files.pending()] },
                {
                  onSuccess: () => {
                    files.commit();
                    router.back();
                  },
                  onError: (err) => notify('Erro', errorMessage(err)),
                },
              ),
            )
          }
        />
      ) : null}

      {editing ? (
        <FieldsModal<ResultField>
          title={editingResult ? 'Resultado' : 'Novo resultado'}
          initial={editingResult ?? {}}
          fields={[
            { key: 'name', label: 'Item', placeholder: 'Ex.: Hemoglobina', required: true },
            { key: 'value', label: 'Resultado', placeholder: 'Ex.: 13,2 ou Não reagente', required: true },
            { key: 'unit', label: 'Unidade', placeholder: 'Ex.: g/dL' },
            { key: 'reference', label: 'Valores de referência', placeholder: 'Como impresso no laudo' },
          ]}
          onClose={() => setEditing(null)}
          onSave={(values) => {
            const row: ExamResult = {
              name: values.name.trim(),
              value: values.value.trim(),
              unit: orNull(values.unit),
              reference: orNull(values.reference),
              flag: editing.flag,
            };
            setResults((current) =>
              editing.index == null ? [...current, row] : current.map((r, i) => (i === editing.index ? row : r)),
            );
            setEditing(null);
          }}
          onDelete={
            editing.index != null
              ? () => {
                  setResults((current) => current.filter((_, i) => i !== editing.index));
                  setEditing(null);
                }
              : undefined
          }>
          <View style={styles.group}>
            <Text variant="label">Marcado no laudo como</Text>
            <Row style={styles.wrap}>
              {RESULT_FLAGS.map((f) => (
                <Chip
                  key={f.value}
                  label={f.label}
                  selected={editing.flag === f.value}
                  onPress={() => setEditing({ ...editing, flag: editing.flag === f.value ? null : f.value })}
                />
              ))}
            </Row>
          </View>
        </FieldsModal>
      ) : null}
      {photos.element}
      <BusyOverlay visible={reading} title="Lendo o exame…" message="Transcrevendo o que está impresso. Pode levar até um minuto." />
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  group: { gap: space.sm },
  wrap: { flexWrap: 'wrap' },
});
