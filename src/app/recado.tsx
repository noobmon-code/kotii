import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Platform, StyleSheet, View } from 'react-native';

import { useSendAppFeedback } from '@/data/appFeedback';
import {
  FEEDBACK_DISCLOSURE,
  FEEDBACK_FORM_INTRO,
  FEEDBACK_FORM_KIND_LABEL,
  FEEDBACK_FORM_LABEL,
  FEEDBACK_FORM_PLACEHOLDER,
  FEEDBACK_FORM_SEND,
  FEEDBACK_KIND_LABELS,
  FEEDBACK_KINDS,
  FEEDBACK_SENT,
  feedbackCounter,
  feedbackLimitNotice,
  readFeedbackDraft,
  type FeedbackKind,
} from '@/domain/appFeedback';
import { Button, Card, Chip, Icon, Screen, Text, TextField } from '@/ui/primitives';
import { space } from '@/ui/theme';

/**
 * Mandar recado (de Configurações → Sobre o Kotii): um recado escrito pela própria pessoa, que vai direto para quem
 * faz o Kotii, sem IA no meio (o mesmo send_app_feedback do cartão do Nuke, data/appFeedback).
 */
export default function FeedbackScreen() {
  return (
    <Screen edges={[]}>
      <FeedbackForm />
    </Screen>
  );
}

/** O id da dica do campo do recado (o contador, ou por que "Enviar" está parado), para o navegador ligá-la a ele. */
const FEEDBACK_HINT_ID = 'feedback-hint';

/**
 * O recado escrito pela pessoa: o tipo (nenhum marcado; sem escolha vai como "outro"), o texto e "Enviar". O
 * rascunho fica só no estado desta tela: não vai para o aparelho nem para o cache. Um toque, um pedido; deu certo,
 * o campo e o tipo se limpam e a confirmação fica até a pessoa escrever de novo. O erro é avisado pelo hook.
 */
function FeedbackForm() {
  const send = useSendAppFeedback();
  const [kind, setKind] = useState<FeedbackKind | null>(null);
  const [text, setText] = useState('');
  const [sent, setSent] = useState(false);
  // Dois toques rápidos mandam um pedido só.
  const sending = useRef(false);

  const draft = readFeedbackDraft(kind, text);
  const counter = feedbackCounter(text);
  const limitNotice = feedbackLimitNotice(text);
  const busy = send.isPending;

  // O limite chega ao leitor de tela quando muda de estado (perto, passou, voltou), não a cada tecla: a dica do campo
  // só é lida quando o foco chega nele, e "Enviar" esmaecido sozinho não diz por quê. No aparelho, pelo anúncio; no
  // navegador (onde o anúncio não faz nada), pela região aria-live escondida embaixo do campo.
  const lastNotice = useRef<string | null>(null);
  useEffect(() => {
    if (Platform.OS !== 'web' && limitNotice && limitNotice !== lastNotice.current) {
      AccessibilityInfo.announceForAccessibility(limitNotice);
    }
    lastNotice.current = limitNotice;
  }, [limitNotice]);

  function submit() {
    if (sending.current || send.isPending || !draft.ok) return;
    sending.current = true;
    send.mutate(
      { kind: draft.kind, message: draft.message },
      {
        onSuccess: () => {
          setText('');
          setKind(null);
          setSent(true);
          // O campo esvazia: sem o anúncio, quem usa leitor de tela não sabe que foi. No navegador esta chamada
          // não faz nada (react-native-web 0.21): lá, quem fala é a região aria-live da confirmação.
          AccessibilityInfo.announceForAccessibility(FEEDBACK_SENT);
        },
        onSettled: () => {
          sending.current = false;
        },
      },
    );
  }

  return (
    <Card style={styles.card}>
      <Text variant="body">{FEEDBACK_FORM_INTRO}</Text>
      <Text variant="label">{FEEDBACK_FORM_KIND_LABEL}</Text>
      <View style={styles.chips}>
        {FEEDBACK_KINDS.map((option) => (
          <Chip
            key={option}
            label={FEEDBACK_KIND_LABELS[option]}
            selected={kind === option}
            toggle
            // Enquanto vai, o tipo fica como saiu.
            disabled={busy}
            // De novo no marcado, desmarca: sem tipo, o recado vai como "outro".
            onPress={() => setKind((before) => (before === option ? null : option))}
          />
        ))}
      </View>
      <TextField
        label={FEEDBACK_FORM_LABEL}
        placeholder={FEEDBACK_FORM_PLACEHOLDER}
        value={text}
        onChangeText={(value) => {
          setText(value);
          setSent(false);
        }}
        // Enquanto vai, o texto fica como saiu: o que se escrevesse agora sumiria com a limpeza do fim.
        editable={!busy}
        multiline
        autoCapitalize="sentences"
        // O rótulo e a dica desenhados não ficam ligados ao campo: o leitor de tela lê o nome e o contador (ou por
        // que "Enviar" está parado) com o campo, daqui no aparelho e pelo hintId (aria-describedby) no navegador.
        // Quando o limite muda de estado enquanto se escreve, quem avisa é o efeito acima.
        accessibilityLabel={FEEDBACK_FORM_LABEL}
        accessibilityHint={counter?.text}
        hint={counter?.text}
        hintColor={counter?.over ? 'danger' : undefined}
        hintId={FEEDBACK_HINT_ID}
      />
      {Platform.OS === 'web' ? (
        <View aria-live="polite" style={styles.offscreen} testID="feedback-limit-region">
          {limitNotice ? <Text variant="small">{limitNotice}</Text> : null}
        </View>
      ) : null}
      <Text variant="small">{FEEDBACK_DISCLOSURE}</Text>
      <View>
        <Button title={FEEDBACK_FORM_SEND} icon="send-outline" loading={busy} disabled={!draft.ok} onPress={submit} />
        {/* No navegador, a região aria-live fica sempre na página e só o que tem dentro muda: uma região que já
            entra com o texto quase nunca é lida (o VoiceOver do Safari fica quieto). No aparelho quem fala é o
            announceForAccessibility, sem região, para não ler duas vezes. */}
        <View aria-live={Platform.OS === 'web' ? 'polite' : undefined} testID="feedback-sent-region">
          {sent ? (
            <View style={styles.sent}>
              <Icon name="check-circle-outline" size={18} color="primary" />
              <Text variant="small" color="primary">
                {FEEDBACK_SENT}
              </Text>
            </View>
          ) : null}
        </View>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: space.md },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  sent: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginTop: space.md },
  // Só para o leitor de tela: o que se vê é a dica do campo.
  offscreen: { position: 'absolute', width: 1, height: 1, overflow: 'hidden' },
});
