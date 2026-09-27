import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { usePeople } from '@/data/health';
import { DOCUMENTS_BUCKET, useDeleteDocument, useDocument, useSaveDocument } from '@/data/house';
import { formatBRDate, parseBRDate, todayISO } from '@/domain/dates';
import {
  describeDocumentStatus,
  DOCUMENT_KINDS,
  documentStatus,
  getDocumentKind,
  REMIND_OPTIONS,
  type DocumentKind,
} from '@/domain/documents';
import { openNewPerson, PersonChips } from '@/features/health/PersonChips';
import { PhotoStrip } from '@/features/PhotoStrip';
import { useDraftPhotos } from '@/features/useDraftPhotos';
import { usePhotoSheet } from '@/features/usePhotoSheet';
import { errorMessage } from '@/lib/supabase';
import type { HomeDocument, Person } from '@/lib/types';
import { confirmAction, notify } from '@/ui/dialogs';
import { Badge, Button, Chip, DateField, ErrorNotice, Loading, Row, Screen, Text, TextField } from '@/ui/primitives';
import { space } from '@/ui/theme';

export default function DocumentScreen() {
  const { id, pessoa } = useLocalSearchParams<{ id: string; pessoa?: string }>();
  const isNew = id === 'novo';
  const document = useDocument(isNew ? undefined : id);
  const people = usePeople();
  if ((!isNew && document.isPending) || people.isPending) return <Loading />;
  if (!isNew && document.isError) return <ErrorNotice error={document.error} onRetry={() => document.refetch()} />;
  if (people.isError) return <ErrorNotice error={people.error} onRetry={() => people.refetch()} />;
  return (
    <DocumentForm
      key={id}
      document={isNew ? undefined : document.data}
      people={people.data.filter((p) => p.kind === 'pessoa')}
      initialPersonId={pessoa || null}
    />
  );
}

function DocumentForm({
  document,
  people,
  initialPersonId,
}: {
  document?: HomeDocument;
  people: Person[];
  initialPersonId: string | null;
}) {
  const today = todayISO();
  const save = useSaveDocument();
  const remove = useDeleteDocument();
  const files = useDraftPhotos(DOCUMENTS_BUCKET, document?.file_paths ?? []);
  const [kind, setKind] = useState<DocumentKind>((document?.kind as DocumentKind) ?? 'rg');
  const [personId, setPersonId] = useState<string | null>(
    document ? document.person_id : (initialPersonId ?? (people.length === 1 ? people[0].id : null)),
  );
  const [title, setTitle] = useState(document?.title ?? '');
  const [number, setNumber] = useState(document?.number ?? '');
  const [issued, setIssued] = useState(document?.issued_on ? formatBRDate(document.issued_on) : '');
  const [expires, setExpires] = useState(document?.expires_on ? formatBRDate(document.expires_on) : '');
  const [remindDays, setRemindDays] = useState(document?.remind_days ?? getDocumentKind('rg').remindDays);
  const [notes, setNotes] = useState(document?.notes ?? '');
  const onError = (err: unknown) => notify('Erro', errorMessage(err));

  const photos = usePhotoSheet({
    title: 'Fotos do documento',
    message: 'Frente e verso, ou todas as páginas. Ficam só na conta da família.',
    onPhotos: (uris) => {
      files.add(uris);
    },
  });

  function chooseKind(next: DocumentKind) {
    const info = getDocumentKind(next);
    setKind(next);
    // Antecedência do aviso acompanha o tipo enquanto o documento é novo.
    if (!document) setRemindDays(info.remindDays);
    if (!info.personal && !document) setPersonId(null);
  }

  const kindInfo = getDocumentKind(kind);
  const personName = people.find((p) => p.id === personId)?.name;
  const defaultTitle = personName ? `${kindInfo.label} — ${personName}` : kindInfo.label;

  function submit() {
    const issuedISO = issued.trim() ? parseBRDate(issued) : null;
    const expiresISO = expires.trim() ? parseBRDate(expires) : null;
    if ((issued.trim() && !issuedISO) || (expires.trim() && !expiresISO)) {
      notify('Data inválida', 'Use dd/mm/aaaa.');
      return;
    }
    save.mutate(
      {
        id: document?.id,
        values: {
          person_id: personId,
          kind,
          title: title.trim() || defaultTitle,
          number: number.trim() || null,
          issued_on: issuedISO,
          expires_on: expiresISO,
          remind_days: remindDays,
          notes: notes.trim() || null,
          file_paths: files.paths,
        },
      },
      {
        onSuccess: () => {
          files.commit();
          router.back();
        },
        onError,
      },
    );
  }

  const expiresISO = expires.trim() ? parseBRDate(expires) : null;
  const status = expiresISO ? documentStatus(expiresISO, remindDays, today) : null;

  return (
    <Screen edges={[]} footer={<Button title="Salvar" onPress={submit} loading={save.isPending} disabled={files.uploading} />}>
      <Stack.Screen options={{ title: document ? document.title : 'Novo documento' }} />

      <View style={styles.group}>
        <Text variant="label">Tipo</Text>
        <Row style={styles.wrap}>
          {DOCUMENT_KINDS.map((k) => (
            <Chip key={k.key} label={k.label} icon={k.icon} selected={kind === k.key} onPress={() => chooseKind(k.key)} />
          ))}
        </Row>
      </View>

      <View style={styles.group}>
        <Text variant="label">De quem</Text>
        <PersonChips people={people} value={personId} onChange={setPersonId} allLabel="Da casa" onAdd={openNewPerson} />
      </View>

      <TextField label="Nome" value={title} onChangeText={setTitle} placeholder={defaultTitle} hint="Vazio usa o tipo e a pessoa." />
      <TextField label="Número" value={number} onChangeText={setNumber} autoCapitalize="characters" />

      <Row gap={space.md}>
        <View style={styles.flex}>
          <DateField label="Emissão" value={issued} onChangeText={setIssued} />
        </View>
        <View style={styles.flex}>
          <DateField label="Validade" value={expires} onChangeText={setExpires} placeholder="Não vence" />
        </View>
      </Row>
      {status ? (
        <Badge
          label={describeDocumentStatus(status, expiresISO)}
          tone={status.kind === 'vencido' ? 'danger' : status.kind === 'renovar' ? 'warning' : 'primary'}
        />
      ) : null}

      {expires.trim() ? (
        <View style={styles.group}>
          <Text variant="label">Avisar antes do vencimento</Text>
          <Row style={styles.wrap}>
            {REMIND_OPTIONS.map((days) => (
              <Chip key={days} label={`${days} dias`} selected={remindDays === days} onPress={() => setRemindDays(days)} />
            ))}
          </Row>
          <Text variant="small">O aviso aparece na tela Hoje para toda a família.</Text>
        </View>
      ) : null}

      <View style={styles.group}>
        <Text variant="label">Fotos</Text>
        <PhotoStrip bucket={DOCUMENTS_BUCKET} paths={files.paths} busy={files.uploading} onAdd={() => photos.open()} onRemove={files.remove} />
      </View>

      <TextField label="Observações" value={notes} onChangeText={setNotes} multiline placeholder="Onde fica o original, telefone da seguradora…" />

      {document ? (
        <Button
          title="Excluir documento"
          variant="danger"
          icon="trash-can-outline"
          onPress={() =>
            confirmAction('Excluir documento', `Excluir ${document.title} e as fotos?`, 'Excluir', () =>
              remove.mutate(
                { id: document.id, file_paths: [...document.file_paths, ...files.pending()] },
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

const styles = StyleSheet.create({
  flex: { flex: 1 },
  group: { gap: space.sm },
  wrap: { flexWrap: 'wrap' },
});
