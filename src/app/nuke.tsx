import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { router } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAskNuke, useNukeContext, useRunNukeAction } from '@/data/nuke';
import { todayISO } from '@/domain/dates';
import { describeAction, historyForApi, NUKE_SUGGESTIONS, type NukeAction, type NukeMessage } from '@/domain/nuke';
import {
  clearConversation,
  conversationEpoch,
  conversationOwner,
  newMessageId,
  setPending,
  updateConversation,
  useNukeConversation,
} from '@/features/nuke/conversation';
import { useAuth, useHousehold } from '@/lib/auth';
import { errorMessage } from '@/lib/supabase';
import { Backdrop } from '@/ui/Backdrop';
import { confirmAction, notify } from '@/ui/dialogs';
import { NukeAvatar } from '@/ui/NukeArt';
import { NukeLive } from '@/ui/NukeLive';
import { Button, Chip, IconButton, Row, Text, useGlassStyle } from '@/ui/primitives';
import { fonts, MAX_WIDTH, radius, space, useColors } from '@/ui/theme';

const ACTION_ICONS: Record<NukeAction['type'], keyof typeof MaterialCommunityIcons.glyphMap> = {
  add_to_list: 'cart-plus',
  create_chore: 'broom',
  add_expense: 'cash-plus',
  open_screen: 'arrow-top-right',
};

export default function NukeScreen() {
  const c = useColors();
  const glass = useGlassStyle();
  const { session } = useAuth();
  const household = useHousehold().data;
  const name = household?.me.display_name ?? '';
  // A conversa é desta pessoa nesta casa (cada casa tem a sua).
  const owner = session && household ? conversationOwner(session.user.id, household.household.id) : undefined;
  const today = todayISO();
  const snapshot = useNukeContext(today);
  const { messages, pending } = useNukeConversation(owner);
  const ask = useAskNuke();
  const runAction = useRunNukeAction();
  const [draft, setDraft] = useState('');
  const [running, setRunning] = useState<string | null>(null);
  // Reação do Nuke no topo: mexe a boca ao responder, se espanta com erro.
  const [reaction, setReaction] = useState<'talk' | 'joy' | 'oops' | null>(null);
  const reactionTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mounted = useRef(true);
  const scroll = useRef<ScrollView>(null);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (reactionTimer.current) clearTimeout(reactionTimer.current);
    };
  }, []);

  const react = useCallback((kind: 'talk' | 'joy' | 'oops') => {
    if (!mounted.current) return;
    if (reactionTimer.current) clearTimeout(reactionTimer.current);
    setReaction(kind);
    reactionTimer.current = setTimeout(() => setReaction(null), kind === 'talk' ? 1800 : 2200);
  }, []);

  const context = snapshot.status === 'ready' ? snapshot.context : null;
  const ready = Boolean(owner && context !== null);
  const busy = pending;

  // A resposta chegou (a pergunta saiu da espera com uma mensagem do Nuke no
  // fim): vale também para a pergunta feita antes de reabrir a tela. Conversa
  // apagada no meio não reage.
  const wasBusy = useRef(busy);
  useEffect(() => {
    const last = messages[messages.length - 1];
    if (wasBusy.current && !busy && last?.role === 'assistant') react(last.error ? 'oops' : 'talk');
    wasBusy.current = busy;
  }, [busy, messages, react]);

  function send(text: string) {
    const body = text.trim();
    if (!body || !owner || context === null || busy) return;
    const question: NukeMessage = { id: newMessageId(), role: 'user', text: body };
    const history = historyForApi([...messages, question]);
    updateConversation(owner, (m) => [...m, question]);
    setPending(owner, true);
    setDraft('');
    // mutateAsync: a resposta entra na conversa mesmo se a tela fechar antes,
    // mas não se a conversa for apagada enquanto isso.
    const since = conversationEpoch();
    ask
      .mutateAsync({ messages: history, context, today })
      .then((answer) => {
        updateConversation(
          owner,
          (m) => [...m, { id: newMessageId(), role: 'assistant', text: answer.reply, actions: answer.actions }],
          since,
        );
      })
      .catch((err) => {
        updateConversation(owner, (m) => [...m, { id: newMessageId(), role: 'assistant', text: errorMessage(err), error: true }], since);
      })
      .finally(() => setPending(owner, false, since));
  }

  async function run(message: NukeMessage, index: number, action: NukeAction) {
    if (!owner) return;
    const key = `${message.id}:${index}`;
    setRunning(key);
    try {
      const note = await runAction(action);
      updateConversation(owner, (m) =>
        m.map((msg) =>
          msg.id === message.id
            ? { ...msg, actions: msg.actions?.map((a, i) => (i === index ? { ...a, done: action.type !== 'open_screen', note } : a)) }
            : msg,
        ),
      );
      if (action.type !== 'open_screen') react('joy');
    } catch (err) {
      react('oops');
      notify('Não deu certo', errorMessage(err));
    } finally {
      setRunning(null);
    }
  }

  return (
    <SafeAreaView edges={['top', 'bottom']} style={[styles.flex, { backgroundColor: c.background }]}>
      <Backdrop />
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={[styles.header, { borderBottomColor: c.glassBorder }]}>
          <IconButton icon="close" label="Fechar" onPress={() => router.back()} />
          <Row style={styles.headerTitle}>
            <NukeLive size={30} state={busy ? 'think' : (reaction ?? 'idle')} />
            <View>
              <Text variant="heading">Nuke</Text>
              <Text variant="small">assistente da casa</Text>
            </View>
          </Row>
          <IconButton
            icon="broom"
            label="Começar outra conversa"
            onPress={() =>
              owner &&
              messages.length > 0 &&
              confirmAction('Nova conversa', 'Apagar esta conversa com o Nuke?', 'Apagar', () => clearConversation(owner))
            }
          />
        </View>

        <ScrollView
          ref={scroll}
          style={styles.flex}
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          onContentSizeChange={() => scroll.current?.scrollToEnd({ animated: true })}>
          {messages.length === 0 ? (
            <View style={styles.welcome}>
              <NukeLive size={132} hop />
              <Text variant="title" style={styles.center}>
                Oi{name ? `, ${name}` : ''}! Eu sou o Nuke.
              </Text>
              <Text variant="body" style={styles.center} color="textMuted">
                Sei o que tem na despensa, nas listas, nas contas e na agenda da casa. Pergunte, ou me peça para anotar algo.
              </Text>
              {ready ? (
                <View style={styles.suggestions}>
                  {NUKE_SUGGESTIONS.map((s) => (
                    <Chip key={s} label={s} onPress={() => send(s)} />
                  ))}
                </View>
              ) : null}
            </View>
          ) : null}

          {messages.map((message) =>
            message.role === 'user' ? (
              <View key={message.id} style={[styles.bubble, styles.mine, { backgroundColor: c.primary }]}>
                <Text variant="body" color="onPrimary">
                  {message.text}
                </Text>
              </View>
            ) : (
              <View key={message.id} style={styles.theirsRow}>
                <NukeAvatar size={28} mood={message.error ? 'oops' : 'idle'} />
                <View style={styles.theirsColumn}>
                  <View
                    style={[
                      styles.bubble,
                      styles.theirs,
                      message.error ? { backgroundColor: c.dangerSoft, borderColor: c.dangerSoft } : glass,
                    ]}>
                    <Text variant="body" color={message.error ? 'danger' : 'text'} selectable>
                      {message.text}
                    </Text>
                  </View>
                  {message.actions?.map((action, index) => (
                    <View key={index} style={[styles.action, glass]}>
                      <Row>
                        <View style={[styles.actionIcon, { backgroundColor: c.brandSoft }]}>
                          <MaterialCommunityIcons name={ACTION_ICONS[action.type]} size={18} color={c.brand} />
                        </View>
                        <View style={styles.flex}>
                          <Text variant="label">{action.label}</Text>
                          {describeAction(action) ? <Text variant="small">{describeAction(action)}</Text> : null}
                        </View>
                      </Row>
                      {action.done ? (
                        <Row>
                          <MaterialCommunityIcons name="check-circle" size={18} color={c.primary} />
                          <Text variant="small" color="primary" style={styles.flex}>
                            {action.note || 'Feito.'}
                          </Text>
                        </Row>
                      ) : (
                        <Button
                          title={action.type === 'open_screen' ? 'Abrir' : 'Fazer'}
                          compact
                          icon={action.type === 'open_screen' ? 'arrow-right' : 'check'}
                          loading={running === `${message.id}:${index}`}
                          disabled={running !== null}
                          onPress={() => run(message, index, action)}
                        />
                      )}
                    </View>
                  ))}
                </View>
              </View>
            ),
          )}

          {busy ? (
            <View style={styles.theirsRow}>
              <NukeLive size={28} state="think" />
              <View style={[styles.bubble, styles.theirs, glass]}>
                <Text variant="body" color="textMuted">
                  Pensando…
                </Text>
              </View>
            </View>
          ) : null}
        </ScrollView>

        {snapshot.status === 'error' ? (
          <View style={[styles.loadError, { backgroundColor: c.dangerSoft }]}>
            <Text variant="small" color="danger" style={styles.flex}>
              Não consegui carregar os dados da casa. Sem eles, o Nuke responderia errado.
            </Text>
            <Button title="Tentar de novo" compact variant="secondary" onPress={snapshot.retry} />
          </View>
        ) : null}

        <View style={[styles.composer, { borderTopColor: c.glassBorder, backgroundColor: c.glassStrong }]}>
          <View style={[styles.inputBox, { backgroundColor: c.glassStrong, borderColor: c.border }]}>
            <TextInput
              value={draft}
              onChangeText={setDraft}
              placeholder={ready ? 'Pergunte ao Nuke…' : snapshot.status === 'error' ? 'Sem os dados da casa agora' : 'Carregando a casa…'}
              placeholderTextColor={c.textMuted}
              multiline
              maxLength={2000}
              editable={ready}
              style={[styles.input, { color: c.text }]}
              accessibilityLabel="Mensagem para o Nuke"
              onSubmitEditing={() => send(draft)}
              submitBehavior="submit"
            />
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Enviar"
            disabled={!draft.trim() || !ready || busy}
            onPress={() => send(draft)}
            style={({ pressed }) => [
              styles.send,
              { backgroundColor: c.primary, opacity: !draft.trim() || !ready || busy ? 0.4 : 1 },
              pressed && styles.pressed,
            ]}>
            <MaterialCommunityIcons name="arrow-up" size={24} color={c.onPrimary} />
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { textAlign: 'center' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerTitle: { gap: space.sm },
  content: { width: '100%', maxWidth: MAX_WIDTH, alignSelf: 'center', padding: space.lg, gap: space.md, flexGrow: 1 },
  welcome: { alignItems: 'center', gap: space.md, paddingTop: space.xl, paddingHorizontal: space.sm },
  suggestions: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: space.sm, marginTop: space.sm },
  bubble: { paddingHorizontal: space.lg, paddingVertical: space.md, borderRadius: radius.lg, maxWidth: '86%' },
  mine: { alignSelf: 'flex-end', borderBottomRightRadius: 6 },
  theirsRow: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm },
  theirsColumn: { flex: 1, gap: space.sm },
  theirs: { alignSelf: 'flex-start', borderBottomLeftRadius: 6, borderWidth: 1, maxWidth: '100%' },
  action: { borderRadius: radius.lg, padding: space.md, gap: space.md },
  actionIcon: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  loadError: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.lg, paddingVertical: space.sm },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: space.sm,
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  inputBox: { flex: 1, borderRadius: radius.lg, borderWidth: 1.5, paddingHorizontal: space.lg, justifyContent: 'center' },
  input: { minHeight: 48, maxHeight: 120, paddingVertical: space.md, fontSize: 16, fontFamily: fonts.regular },
  send: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  pressed: { transform: [{ scale: 0.94 }] },
});
