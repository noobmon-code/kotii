import { router } from 'expo-router';
import { StyleSheet } from 'react-native';

import { usePeople } from '@/data/health';
import { useDocuments } from '@/data/house';
import { todayISO } from '@/domain/dates';
import { describeDocumentStatus, documentStatus, getDocumentKind } from '@/domain/documents';
import type { HomeDocument } from '@/lib/types';
import { Badge, Button, EmptyState, ErrorNotice, IconBadge, ListCard, ListRow, Loading, Section, Text } from '@/ui/primitives';
import { space } from '@/ui/theme';

/** Documentos da família agrupados por dono: cada pessoa e a casa. */
export function DocumentsSection() {
  const today = todayISO();
  const documents = useDocuments();
  const people = usePeople();

  // Só agrupa com as duas listas carregadas: sem as pessoas, os documentos
  // pessoais sumiriam da tela.
  const groups: { key: string; title: string; items: HomeDocument[] }[] = [];
  if (documents.data && people.data) {
    for (const person of people.data) {
      const items = documents.data.filter((d) => d.person_id === person.id);
      if (items.length) groups.push({ key: person.id, title: person.name, items });
    }
    const known = new Set(people.data.map((p) => p.id));
    const others = documents.data.filter((d) => d.person_id && !known.has(d.person_id));
    if (others.length) groups.push({ key: 'outros', title: 'Outras pessoas', items: others });
    const household = documents.data.filter((d) => !d.person_id);
    if (household.length) groups.push({ key: 'casa', title: 'Da casa', items: household });
  }
  const failed = documents.isError ? documents : people.isError ? people : null;

  return (
    <Section
      title="Documentos"
      action={
        <Button
          title="Documento"
          icon="plus"
          variant="ghost"
          compact
          onPress={() => router.push({ pathname: '/documento/[id]', params: { id: 'novo' } })}
        />
      }>
      {failed ? <ErrorNotice error={failed.error} onRetry={() => failed.refetch()} /> : null}
      {!failed && (documents.isPending || people.isPending) ? <Loading /> : null}
      {documents.data && !documents.data.length ? (
        <EmptyState
          icon="folder-account-outline"
          title="Nenhum documento"
          message="RG, CNH, passaporte, seguro, contrato, IPTU… Foto e validade à mão, com aviso para renovar antes de vencer."
        />
      ) : null}
      {groups.map((group) => (
        <ListCard key={group.key}>
          <Text variant="label" style={styles.groupTitle}>
            {group.title}
          </Text>
          {group.items.map((doc) => {
            const status = documentStatus(doc.expires_on, doc.remind_days, today);
            const kind = getDocumentKind(doc.kind);
            const urgent = status.kind === 'vencido' || status.kind === 'renovar';
            return (
              <ListRow
                key={doc.id}
                left={<IconBadge icon={kind.icon} tone={status.kind === 'vencido' ? 'danger' : status.kind === 'renovar' ? 'warning' : 'neutral'} />}
                title={doc.title}
                subtitle={[doc.number, describeDocumentStatus(status, doc.expires_on)].filter(Boolean).join(' · ')}
                right={urgent ? <Badge label={status.kind === 'vencido' ? 'Vencido' : 'Renovar'} tone={status.kind === 'vencido' ? 'danger' : 'warning'} /> : null}
                onPress={() => router.push({ pathname: '/documento/[id]', params: { id: doc.id } })}
              />
            );
          })}
        </ListCard>
      ))}
    </Section>
  );
}

const styles = StyleSheet.create({
  groupTitle: { paddingVertical: space.sm },
});
