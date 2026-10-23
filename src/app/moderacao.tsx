import { useState } from 'react';
import { Linking, StyleSheet } from 'react-native';

import { useIsModerator, useLookupStoreNameAgain, useReviewStoreName, useStoreNamesForReview } from '@/data/storeModeration';
import {
  canLookupAgain,
  cnpjSearchUrl,
  COMPANY_NAMES_TITLE,
  companyNameOptions,
  decisionLine,
  legalNameLine,
  mapsUrl,
  MODERATION_ABOUT,
  MODERATION_EMPTY,
  MODERATION_NAME_LABEL,
  MODERATION_ONLY,
  nicknamesLine,
  receitaLine,
  REVIEW_GROUP_LABELS,
  reviewCounts,
  reviewGroup,
  reviewRows,
  reviewSubtitle,
  reviewTitle,
  suggestedName,
  type ReviewGroup,
  type StoreNameReview,
} from '@/domain/storeModeration';
import { cleanStoreName, storeNameError } from '@/domain/storeName';
import { notify } from '@/ui/dialogs';
import { Button, Card, Chip, EmptyState, ErrorNotice, Loading, Row, Screen, Segmented, Text, TextField } from '@/ui/primitives';
import { space } from '@/ui/theme';

const GROUPS: ReviewGroup[] = ['revisar', 'consultando', 'decididos'];

/**
 * Nomes dos mercados, só para a moderação (a entrada fica em Configurações): os CNPJs dos mercados das casas, em
 * três abas. Em cada um, o que as notas, a Receita e as casas dizem dele, e o nome padrão a escolher. O banco
 * confere a moderação de novo a cada chamada.
 */
export default function StoreNamesModerationScreen() {
  const moderator = useIsModerator();
  const review = useStoreNamesForReview(moderator.data === true);
  const [group, setGroup] = useState<ReviewGroup>('revisar');

  if (moderator.isPending) {
    return (
      <Screen>
        <Loading />
      </Screen>
    );
  }
  if (moderator.error) {
    return (
      <Screen>
        <ErrorNotice error={moderator.error} onRetry={() => void moderator.refetch()} />
      </Screen>
    );
  }
  if (!moderator.data) {
    return (
      <Screen>
        <Text variant="muted">{MODERATION_ONLY}</Text>
      </Screen>
    );
  }

  const rows = review.data ?? [];
  const counts = reviewCounts(rows);
  const shown = reviewRows(rows, group);
  let body;
  if (review.isPending) body = <Loading />;
  else if (review.error) body = <ErrorNotice error={review.error} onRetry={() => void review.refetch()} />;
  else if (!shown.length) body = <EmptyState icon="store-check-outline" title={MODERATION_EMPTY[group]} />;
  else body = shown.map((row) => <StoreNameCard key={row.cnpj} row={row} />);

  return (
    <Screen refreshing={review.isRefetching} onRefresh={() => void review.refetch()}>
      <Text variant="muted">{MODERATION_ABOUT}</Text>
      <Segmented
        options={GROUPS.map((value) => ({ value, label: `${REVIEW_GROUP_LABELS[value]} (${counts[value]})` }))}
        value={group}
        onChange={setGroup}
      />
      {body}
    </Screen>
  );
}

function openLink(url: string) {
  Linking.openURL(url).catch(() => notify('Não deu para abrir o link', url));
}

/**
 * Um CNPJ: o que se sabe dele, os links para achar a loja (o mapa do endereço e a busca do CNPJ) e o nome padrão.
 * Na aba "Para revisar" o campo já vem aberto, com o apelido que mais casas deram (ou o nome fantasia). Os nomes
 * padrão das outras lojas da empresa ficam embaixo, para um toque pôr no campo.
 */
function StoreNameCard({ row }: { row: StoreNameReview }) {
  const reviewName = useReviewStoreName();
  const lookup = useLookupStoreNameAgain();
  const [editing, setEditing] = useState(reviewGroup(row) === 'revisar');
  const [text, setText] = useState(() => suggestedName(row));
  const [tried, setTried] = useState(false);
  const error = storeNameError(text);
  const busy = reviewName.isPending || lookup.isPending;
  const title = reviewTitle(row);
  const map = mapsUrl(row);
  const companyNames = companyNameOptions(row);
  const lines = [
    row.note_name && row.note_name !== title ? `Na nota: ${row.note_name}` : null,
    row.address,
    receitaLine(row),
    legalNameLine(row),
    row.receita_activity ? `Atividade: ${row.receita_activity}` : null,
    nicknamesLine(row),
    decisionLine(row),
  ].filter((line): line is string => Boolean(line));

  /** Uma decisão por vez: o Enter do campo também chega aqui. O erro, o hook avisa. */
  function decide(name: string | null) {
    if (busy) return;
    reviewName.mutate({ cnpj: row.cnpj, name }, { onSuccess: () => setEditing(false) });
  }

  function onSave() {
    setTried(true);
    if (!error) decide(cleanStoreName(text));
  }

  function lookupAgain() {
    if (busy) return;
    lookup.mutate(row.cnpj);
  }

  return (
    <Card style={styles.card}>
      <Text variant="heading">{title}</Text>
      <Text variant="small">{reviewSubtitle(row)}</Text>
      {lines.map((line, index) => (
        <Text key={index} variant="muted">
          {line}
        </Text>
      ))}
      <Row style={styles.wrap}>
        {map ? <Button title="Ver no mapa" icon="map-search-outline" variant="ghost" compact onPress={() => openLink(map)} /> : null}
        <Button title="Buscar o CNPJ" icon="magnify" variant="ghost" compact onPress={() => openLink(cnpjSearchUrl(row))} />
      </Row>
      {editing ? (
        <>
          <TextField
            label={MODERATION_NAME_LABEL}
            value={text}
            onChangeText={setText}
            placeholder="Pão de Açúcar, Assaí, Bemais…"
            hint="Vale em todas as casas que não deram outro nome ao mercado."
            onSubmitEditing={onSave}
          />
          {tried && error ? (
            <Text variant="small" color="danger">
              {error}
            </Text>
          ) : null}
          {companyNames.length ? (
            <>
              <Text variant="label">{COMPANY_NAMES_TITLE}</Text>
              <Row style={styles.wrap}>
                {companyNames.map((option) => (
                  <Chip
                    key={option.name}
                    label={option.label}
                    selected={text === option.name}
                    accessibilityLabel={`Usar ${option.name}`}
                    onPress={() => setText(option.name)}
                  />
                ))}
              </Row>
            </>
          ) : null}
          <Button title="Salvar o nome padrão" icon="check" loading={reviewName.isPending} disabled={busy} onPress={onSave} />
          <Button title="Ficar com o nome da nota" variant="secondary" disabled={busy} onPress={() => decide(null)} />
        </>
      ) : (
        <Button title="Mudar o nome padrão" icon="pencil-outline" variant="secondary" onPress={() => setEditing(true)} />
      )}
      {canLookupAgain(row) ? (
        <Button
          title="Consultar a Receita de novo"
          icon="refresh"
          variant="ghost"
          compact
          loading={lookup.isPending}
          disabled={busy}
          onPress={lookupAgain}
        />
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: space.sm },
  wrap: { flexWrap: 'wrap' },
});
