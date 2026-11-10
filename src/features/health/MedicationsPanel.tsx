import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { usePeople } from '@/data/health';
import { useMedications } from '@/data/home';
import { todayISO } from '@/domain/dates';
import { Button, ErrorNotice, Loading } from '@/ui/primitives';
import { space } from '@/ui/theme';
import { MedicationList, MedicationRefills, MedicationsToday, useRefills } from './MedicationSections';
import { PersonChips } from './PersonChips';
import { StaleNotice } from './StaleNotice';

/**
 * Saúde → Remédios: o item de uso diário da saúde, numa parte própria (antes, o fim de Cuidados). "Novo remédio" no
 * alto, as doses de hoje, os remédios e receitas acabando e os tratamentos em uso. A pessoa escolhida (?pessoa=, a
 * mesma de Cuidados e Planos) filtra as três seções, e o remédio novo já nasce dela.
 */
export function MedicationsPanel({ personId, onPersonChange }: { personId: string | null; onPersonChange: (id: string | null) => void }) {
  const today = todayISO();
  const people = usePeople();
  const medications = useMedications();
  const refills = useRefills(today);

  // Como em Cuidados: o erro inteiro só enquanto falta o dado da busca que falhou; com ele na tela, a atualização
  // que falha deixa o que já estava, com o aviso acima.
  const queries = [people, medications];
  const failed = queries.filter((q) => q.isError);
  const blocking = failed.find((q) => q.data === undefined);
  if (blocking) return <ErrorNotice error={blocking.error} onRetry={() => queries.forEach((q) => void q.refetch())} />;
  if (!people.data || !medications.data) return <Loading />;

  // Com uma pessoa só não há o que escolher: nem os selos, nem o filtro (que esconderia, sem o selo na tela para
  // dizer por quê, os remédios antigos que só guardam o nome de quem toma). A ficha que não existe mais vale "Todos".
  const choosing = people.data.length > 1;
  const person = choosing ? people.data.find((p) => p.id === personId) ?? null : null;
  const shown = person ? medications.data.filter((m) => m.person_id === person.id) : medications.data;
  // As linhas do estoque são contadas com todos os remédios da casa (o item da farmácia diz de quem é quando duas
  // pessoas usam o mesmo remédio): o filtro vem depois.
  const ids = new Set(shown.map((m) => m.id));
  const rows = person ? refills.rows.filter((row) => ids.has(row.id)) : refills.rows;

  return (
    <View style={styles.gap}>
      {failed.length ? <StaleNotice onRetry={() => failed.forEach((q) => void q.refetch())} /> : null}
      {choosing ? <PersonChips people={people.data} value={person?.id ?? null} onChange={onPersonChange} allLabel="Todos" /> : null}
      <Button
        title="Novo remédio"
        icon="plus"
        onPress={() => router.push({ pathname: '/remedio/[id]', params: { id: 'novo', pessoa: person?.id ?? '' } })}
      />
      <MedicationsToday today={today} personId={person?.id ?? null} />
      <MedicationRefills rows={rows} />
      <MedicationList medications={shown} personId={person?.id ?? null} />
    </View>
  );
}

const styles = StyleSheet.create({
  gap: { gap: space.xl },
});
