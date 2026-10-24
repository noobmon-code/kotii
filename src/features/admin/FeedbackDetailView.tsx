import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import type { FeedbackChange } from '@/data/appFeedback';
import {
  FEEDBACK_NOTE_LABEL,
  FEEDBACK_NOTE_PLACEHOLDER,
  FEEDBACK_NOTE_SAVE,
  FEEDBACK_REPLY,
  feedbackDetail,
  feedbackNoteChanged,
  feedbackNoteError,
  feedbackNoteToSave,
  type FeedbackItem,
  type FeedbackStatus,
} from '@/domain/appFeedback';
import { openExternal } from '@/lib/openLink';
import { notify } from '@/ui/dialogs';
import { Badge, Button, Text, TextField } from '@/ui/primitives';
import { radius, space, useColors } from '@/ui/theme';

import { FEEDBACK_KIND_TONES, FEEDBACK_STATUS_TONES } from './FeedbackRowView';

/**
 * Um recado aberto (feedbackDetail, de domain/appFeedback): o tipo e a situação, quando chegou, o aparelho e a
 * versão, o e-mail (que dá para copiar) com "Responder por e-mail", o recado inteiro (que dá para copiar), os
 * botões de situação e a nota de quem mantém o app. `onWrite` grava pela useSetAppFeedback (o aviso de erro sai
 * de lá) e nunca falha; `busy`: alguma mudança em recados está no ar, e os botões esperam. Quem usa monta um por
 * recado (`key` com o id): a nota começa com a guardada.
 */
export function FeedbackDetailView({
  item,
  busy,
  onWrite,
}: {
  item: FeedbackItem;
  busy: boolean;
  onWrite: (change: Omit<FeedbackChange, 'id'>) => Promise<void>;
}) {
  const c = useColors();
  const detail = feedbackDetail(item);
  const [draft, setDraft] = useState(item.note ?? '');
  // O botão tocado gira até a resposta: a situação que ele grava, ou a nota.
  const [pending, setPending] = useState<FeedbackStatus | 'note' | null>(null);
  const noteError = feedbackNoteError(draft);
  const noteChanged = feedbackNoteChanged(item.note, draft);

  const write = (key: FeedbackStatus | 'note', change: Omit<FeedbackChange, 'id'>) => {
    setPending(key);
    void onWrite(change).finally(() => setPending(null));
  };

  const reply = async () => {
    if (!detail.replyUrl) return;
    const opened = await openExternal(detail.replyUrl);
    if (!opened) notify('Não deu para abrir o e-mail', `Escreva para ${detail.email}.`);
  };

  return (
    <View style={styles.detail}>
      <View accessible accessibilityLabel={detail.accessibilityLabel} style={styles.header}>
        <View style={styles.badges}>
          <Badge label={detail.kindLabel} tone={FEEDBACK_KIND_TONES[detail.kind]} />
          <Badge label={detail.statusLabel} tone={FEEDBACK_STATUS_TONES[detail.status]} />
        </View>
        <Text variant="small">Mandado em {detail.sentAt}</Text>
        {detail.changed ? <Text variant="small">{detail.changed}</Text> : null}
        {detail.device ? <Text variant="small">{detail.device}</Text> : null}
      </View>

      <View style={styles.block}>
        {detail.email ? (
          <>
            <Text variant="label" selectable>
              {detail.email}
            </Text>
            <Button title={FEEDBACK_REPLY} icon="email-outline" variant="secondary" compact style={styles.start} onPress={() => void reply()} />
          </>
        ) : (
          <Text variant="muted">{detail.noEmail}</Text>
        )}
      </View>

      <View style={[styles.message, { backgroundColor: c.surfaceAlt }]}>
        <Text variant="body" selectable>
          {detail.message}
        </Text>
      </View>

      <View style={styles.actions}>
        {detail.actions.map((action, index) => (
          <Button
            key={action.status}
            title={action.label}
            compact
            variant={index === 0 ? 'primary' : 'secondary'}
            loading={pending === action.status}
            disabled={busy}
            onPress={() => write(action.status, { status: action.status })}
          />
        ))}
      </View>

      <View style={styles.block}>
        <TextField
          label={FEEDBACK_NOTE_LABEL}
          placeholder={FEEDBACK_NOTE_PLACEHOLDER}
          value={draft}
          onChangeText={setDraft}
          multiline
          hint={noteError ?? undefined}
          hintColor={noteError ? 'danger' : undefined}
          accessibilityLabel={FEEDBACK_NOTE_LABEL}
        />
        <Button
          title={FEEDBACK_NOTE_SAVE}
          compact
          variant="secondary"
          icon="content-save-outline"
          style={styles.start}
          loading={pending === 'note'}
          disabled={busy || !noteChanged || noteError !== null}
          onPress={() => write('note', { note: feedbackNoteToSave(draft) })}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  detail: { gap: space.lg },
  header: { gap: space.xs },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  block: { gap: space.sm },
  start: { alignSelf: 'flex-start' },
  message: { borderRadius: radius.md, padding: space.lg },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
});
