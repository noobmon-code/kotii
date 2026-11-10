import { router } from 'expo-router';
import { cloneElement, type ReactElement, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { useCompleteChore, useToggleDose } from '@/data/home';
import { describeBudget } from '@/domain/budget';
import { choreTurnLabel, rotationOf, rotationPeople, type ChoreRotations } from '@/domain/choreRotation';
import { describeChoreStatus } from '@/domain/chores';
import { describeDocumentStatus, getDocumentKind } from '@/domain/documents';
import { describeWarranty, getEquipmentCategory } from '@/domain/equipment';
import { getFinanceCategory } from '@/domain/finance';
import { doseKey } from '@/domain/medications';
import { MEALS, type MenuItem } from '@/domain/menu';
import { describeExpiry } from '@/domain/pantry';
import { describeRestock, type RestockItem } from '@/domain/restock';
import { seeAllLabel, SUGGESTION_TITLES, TODAY_BLOCK_TITLES, type TodayBlockContent, type TodayItem } from '@/domain/today';
import { announceCompletion } from '@/features/ChoresPanel';
import { BillRow } from '@/features/finance/BillsPanel';
import { useHealthRows } from '@/features/health/HealthTodaySections';
import { DoseSubtitle, useRefillRows } from '@/features/health/MedicationSections';
import type { useHealthOverview } from '@/features/health/useHealthOverview';
import { pendingReceiptListRow } from '@/features/PendingReceiptCard';
import { useSupplyTodayRows } from '@/features/SuppliesSection';
import { errorMessage } from '@/lib/supabase';
import type { Bill, Equipment, ListKind, Member } from '@/lib/types';
import { notify } from '@/ui/dialogs';
import { IconArt } from '@/ui/iconArt';
import {
  AddCircle,
  Badge,
  Button,
  CategoryIcon,
  CheckCircle,
  IconBadge,
  LinkButton,
  ListCard,
  ListRow,
  Section,
  Text,
} from '@/ui/primitives';
import { space } from '@/ui/theme';

type Overview = ReturnType<typeof useHealthOverview>;

const onError = (err: unknown) => notify('Erro', errorMessage(err));

export interface TodayRowContext {
  today: string;
  /** A saúde da casa (os nomes das pessoas e as linhas de consulta, vacina, treino e plano). */
  health: Overview;
  members: Member[];
  /** As ordens do rodízio; sem elas, a tarefa mostra o responsável de sempre. */
  rotations: ChoreRotations | undefined;
  /** Os aparelhos, para a tarefa dizer de qual é. */
  equipment: Equipment[];
  /** Os mercados que a casa conhece pelo CNPJ (as notas pendentes da Sefaz dizem de onde são). */
  storeNames: Readonly<Record<string, string>>;
  /** Com Finanças ligada: as contas acima do normal e o "pagar" de cada uma. */
  billsAbove: ReadonlyMap<string, unknown>;
  onPay: (bill: Bill) => void;
}

/**
 * A linha de cada coisa dos blocos da tela Hoje, com o texto e a ação de sempre (marcar a dose, concluir a tarefa,
 * "Troquei", "Pôr na lista da farmácia", abrir a coisa). Cada linha é um `ListRow`, para o cartão de linhas pôr o
 * divisor depois do ícone; a chave leva o assunto (os ids de assuntos diferentes não se cruzam no mesmo cartão).
 */
export function useTodayRow(context: TodayRowContext): (item: TodayItem) => ReactElement {
  const { today, health, members, rotations, equipment, storeNames, billsAbove, onPay } = context;
  const toggleDose = useToggleDose(today);
  const completeChore = useCompleteChore();
  const healthRows = useHealthRows(health, today);
  const refillRow = useRefillRows();
  const supplyRow = useSupplyTodayRows(today);
  const equipmentName = (id: string | null) => (id ? equipment.find((e) => e.id === id)?.name : undefined);

  function row(item: TodayItem): ReactElement {
    switch (item.kind) {
      case 'dose': {
        const d = item.data;
        return (
          <ListRow
            key={doseKey(d.medicationId, d.date, d.time)}
            left={<IconArt name="capsula" />}
            title={`${d.time} · ${d.name}`}
            // Sem o selo de caixa acabando: a linha do remédio acabando, num dos blocos, já diz (uma vez por remédio).
            subtitle={<DoseSubtitle parts={[d.personName, d.dosage]} late={item.placement.urgency === 'atrasado'} />}
            right={
              <CheckCircle
                checked={false}
                label={`Marcar ${d.name} das ${d.time} como tomado`}
                onPress={() => toggleDose.mutate({ medicationId: d.medicationId, time: d.time, taken: true }, { onError })}
              />
            }
          />
        );
      }
      case 'refill':
        return refillRow(item.data);
      case 'appointment':
        return item.data.overdue ? healthRows.toConfirm(item.data.appointment) : healthRows.appointment(item.data.appointment);
      case 'vaccine':
        return healthRows.vaccine(item.data);
      case 'workout':
        return healthRows.workout(item.data);
      case 'plan':
        return healthRows.draft(item.data);
      case 'event': {
        const entry = item.data;
        return (
          <ListRow
            key={entry.key}
            left={<IconBadge icon={entry.kind === 'aniversario' ? 'cake-variant-outline' : 'calendar-star'} tone="info" />}
            title={entry.title}
            subtitle={entry.subtitle}
            onPress={() =>
              router.push(
                entry.kind === 'aniversario'
                  ? { pathname: '/pessoa/[id]', params: { id: entry.id } }
                  : { pathname: '/compromisso/[id]', params: { id: entry.id, dia: entry.date } },
              )
            }
          />
        );
      }
      case 'chore': {
        const { chore, status } = item.data;
        const assignee = choreTurnLabel(chore, rotationOf(rotations, chore.id), members, health.people);
        return (
          <ListRow
            key={chore.id}
            left={<IconBadge icon="broom" tone={status.kind === 'atrasada' ? 'danger' : 'primary'} />}
            title={chore.title}
            subtitle={[describeChoreStatus(status), equipmentName(chore.equipment_id), assignee].filter(Boolean).join(' · ')}
            onPress={() => router.push({ pathname: '/tarefa/[id]', params: { id: chore.id } })}
            right={
              <CheckCircle
                checked={false}
                label={`Concluir ${chore.title}`}
                onPress={() =>
                  completeChore.mutate(
                    { id: chore.id, today, dueOn: chore.due_on },
                    { onSuccess: (result) => announceCompletion(result, rotationPeople(members, health.people), chore), onError },
                  )
                }
              />
            }
          />
        );
      }
      case 'bill':
        return <BillRow key={item.data.id} bill={item.data} today={today} onPay={onPay} aboveUsual={billsAbove.has(item.data.id)} />;
      case 'budget': {
        const line = item.data;
        return (
          <ListRow
            key={line.category}
            left={<IconBadge icon={getFinanceCategory(line.category).icon} tone={line.status === 'estourou' ? 'danger' : 'warning'} />}
            title={`${getFinanceCategory(line.category).label}: ${line.status === 'estourou' ? 'passou do limite' : 'perto do limite'}`}
            subtitle={describeBudget(line)}
            onPress={() => router.push({ pathname: '/financas', params: { aba: 'resumo' } })}
          />
        );
      }
      case 'pantry': {
        const { item: pantryItem, status } = item.data;
        return (
          <ListRow
            key={pantryItem.id}
            left={<CategoryIcon category={pantryItem.category} name={pantryItem.name} />}
            title={pantryItem.name}
            right={<Badge label={describeExpiry(status)} tone={status.kind === 'vencido' ? 'danger' : 'warning'} />}
            onPress={() => router.push({ pathname: '/despensa/[id]', params: { id: pantryItem.id } })}
          />
        );
      }
      case 'supply':
        return supplyRow(item.data);
      case 'document': {
        const { document, status } = item.data;
        return (
          <ListRow
            key={document.id}
            left={<IconBadge icon={getDocumentKind(document.kind).icon} tone={status.kind === 'vencido' ? 'danger' : 'warning'} />}
            title={document.title}
            subtitle={describeDocumentStatus(status, document.expires_on)}
            right={<Badge label={status.kind === 'vencido' ? 'Vencido' : 'Renovar'} tone={status.kind === 'vencido' ? 'danger' : 'warning'} />}
            onPress={() => router.push({ pathname: '/documento/[id]', params: { id: document.id } })}
          />
        );
      }
      case 'warranty': {
        const { item: appliance, status } = item.data;
        return (
          <ListRow
            key={appliance.id}
            left={<IconBadge icon={getEquipmentCategory(appliance.category).icon} tone="warning" />}
            title={appliance.name}
            subtitle={`${describeWarranty(status)} · teste tudo e acione a assistência se precisar`}
            onPress={() => router.push({ pathname: '/aparelho/[id]', params: { id: appliance.id } })}
          />
        );
      }
      case 'pendingReceipt':
        return pendingReceiptListRow(item.data, storeNames);
      case 'receipt': {
        const receipt = item.data;
        return (
          <ListRow
            key={receipt.id}
            left={<IconBadge icon="receipt-text-outline" tone="info" />}
            title={receipt.store?.name ?? 'Nota sem mercado'}
            subtitle="Confira os itens para entrar no comparativo"
            right={<Badge label="Revisar" tone="info" />}
            onPress={() => router.push({ pathname: '/nota/[id]', params: { id: receipt.id } })}
          />
        );
      }
    }
  }

  return (item) => {
    const element = row(item);
    return cloneElement(element, { key: `${item.kind}:${element.key}` });
  };
}

/**
 * Um bloco de pendências ("Agora", "Em breve"): as linhas num cartão só, o mais urgente primeiro, e o "Ver todos" do
 * que passou do teto (a despensa). Sem nada, o bloco não aparece.
 */
export function TodayBlock({
  title,
  block,
  row,
}: {
  title: string;
  block: TodayBlockContent<TodayItem>;
  row: (item: TodayItem) => ReactElement;
}) {
  if (!block.items.length) return null;
  return (
    <Section title={title}>
      <ListCard>
        {block.items.map(row)}
        {block.cut.map((cut) => (
          <Button
            key={`ver-todos:${cut.kind}`}
            title={seeAllLabel(cut)}
            variant="ghost"
            onPress={() => router.push({ pathname: '/compras', params: { aba: 'despensa' } })}
          />
        ))}
      </ListCard>
    </Section>
  );
}

/** Um grupo de "Sugestões": o nome dele (também para quem navega pelos títulos), a ação dele e as linhas. */
function SuggestionGroup({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <View style={styles.group}>
      <View style={styles.groupHeader}>
        <Text variant="label" accessibilityRole="header" style={styles.groupTitle}>
          {title}
        </Text>
        {action}
      </View>
      {children}
    </View>
  );
}

/**
 * "Sugestões": o que acabou pelas contas do app ("Acho que acabou", com "Pôr na lista"), o cardápio de hoje e as
 * listas abertas com algo para comprar. Não são pendências: não entram na conta do topo nem seguram o "Tudo em dia".
 */
export function TodaySuggestions({
  restock,
  adding,
  onRestock,
  menu,
  lists,
}: {
  restock: RestockItem[];
  /** Uma inclusão por vez: os botões ficam desativados enquanto isso. */
  adding: boolean;
  /** Põe na lista de mercado; `open` abre a lista depois ("Pôr tudo na lista"). */
  onRestock: (items: RestockItem[], open: boolean) => void;
  menu: MenuItem[];
  lists: { id: string; name: string; kind: ListKind; pending: number }[];
}) {
  const meals = MEALS.flatMap(({ key, label }) => {
    const item = menu.find((i) => i.meal === key);
    return item ? [{ key, label, dish: item.dish }] : [];
  });
  if (!restock.length && !meals.length && !lists.length) return null;
  return (
    <Section title={TODAY_BLOCK_TITLES.sugestoes}>
      <View style={styles.groups}>
        {restock.length ? (
          <SuggestionGroup
            title={SUGGESTION_TITLES.restock}
            action={<LinkButton title="Pôr tudo na lista" disabled={adding} onPress={() => onRestock(restock, true)} />}>
            <ListCard>
              {restock.map((item) => (
                <ListRow
                  key={item.name}
                  left={<CategoryIcon category={item.category} name={item.name} />}
                  title={item.name}
                  subtitle={describeRestock(item)}
                  right={<AddCircle label={`Pôr ${item.name} na lista`} disabled={adding} onPress={() => onRestock([item], false)} />}
                  onPress={adding ? undefined : () => onRestock([item], false)}
                />
              ))}
            </ListCard>
          </SuggestionGroup>
        ) : null}

        {meals.length ? (
          <SuggestionGroup title={SUGGESTION_TITLES.menu}>
            <ListCard>
              {meals.map((meal) => (
                <ListRow
                  key={meal.key}
                  left={<IconBadge icon="silverware-fork-knife" tone="info" />}
                  title={meal.dish}
                  subtitle={meal.label}
                  onPress={() => router.push('/cardapio')}
                />
              ))}
            </ListCard>
          </SuggestionGroup>
        ) : null}

        {lists.length ? (
          <SuggestionGroup title={SUGGESTION_TITLES.lists}>
            <ListCard>
              {lists.map((l) => (
                <ListRow
                  key={l.id}
                  left={<IconBadge icon={l.kind === 'farmacia' ? 'pill' : 'cart-outline'} tone="primary" />}
                  title={l.name}
                  subtitle={`${l.pending} ${l.pending === 1 ? 'item pendente' : 'itens pendentes'}`}
                  onPress={() => router.push({ pathname: '/lista/[id]', params: { id: l.id } })}
                />
              ))}
            </ListCard>
          </SuggestionGroup>
        ) : null}
      </View>
    </Section>
  );
}

const styles = StyleSheet.create({
  groups: { gap: space.lg },
  group: { gap: space.sm },
  groupHeader: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  groupTitle: { flex: 1, paddingHorizontal: space.xs },
});
