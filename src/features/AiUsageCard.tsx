import { useQuery } from '@tanstack/react-query';
import { useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { aiUsageRows, aiUsageSubtitle } from '@/domain/aiUsage';
import { FEATURES } from '@/lib/features';
import { supabase, unwrap } from '@/lib/supabase';
import { Icon, IconBadge, ListCard, ListRow, Text } from '@/ui/primitives';
import { radius, space, useColors } from '@/ui/theme';

/**
 * Uso da IA neste mês (limite por casa, conferido no servidor), em Configurações → Sobre o Kotii. Uma linha que abre
 * ao tocar, como o "Convidar": aberta, a aba deixaria de ser curta (a regra da aba: só a casa e o tema ficam abertos).
 * Fechada, ela já diz o limite que acabou ou está perto do fim (aiUsageSubtitle).
 */
export function AiUsageCard() {
  const c = useColors();
  const [open, setOpen] = useState(false);
  const usage = useQuery({
    queryKey: ['aiUsage'],
    queryFn: async () => unwrap(await supabase.rpc('ai_usage_summary')) as { kind: string; used: number; lim: number }[],
  });
  // A aba (Configurações) fica montada enquanto o Nuke, o cardápio e as leituras de foto (de
  // qualquer pessoa da casa) gastam o limite: confere de novo ao voltar a ela.
  const firstFocus = useRef(true);
  const { refetch } = usage;
  useFocusEffect(
    useCallback(() => {
      if (firstFocus.current) {
        firstFocus.current = false;
        return;
      }
      void refetch();
    }, [refetch]),
  );
  if (!usage.data) return null;
  // Sem Finanças (lib/features), sem a linha do consultor financeiro.
  const rows = aiUsageRows(usage.data, { finance: FEATURES.finance });
  const short = rows.some((row) => row.level !== 'ok');

  return (
    <ListCard>
      <ListRow
        left={<IconBadge icon="robot-outline" tone={short ? 'warning' : 'neutral'} />}
        title="Uso da IA neste mês"
        subtitle={aiUsageSubtitle(rows)}
        right={<Icon name={open ? 'chevron-up' : 'chevron-down'} color="textMuted" />}
        expanded={open}
        onPress={() => setOpen((value) => !value)}
      />
      {open ? (
        <View style={styles.detail}>
          {rows.map((row) => {
            const color = row.level === 'acabou' ? c.danger : row.level === 'perto' ? c.warning : c.primary;
            return (
              <View key={row.kind} style={styles.row}>
                <View style={styles.header}>
                  <Text variant="small" color="text" style={styles.flex}>
                    {row.label}
                  </Text>
                  <Text variant="small">
                    {row.used} de {row.limit}
                  </Text>
                </View>
                <View style={[styles.track, { backgroundColor: c.surfaceAlt }]}>
                  <View style={[styles.bar, { width: `${row.ratio * 100}%`, backgroundColor: color }]} />
                </View>
              </View>
            );
          })}
          <Text variant="small">
            Limite da casa para não passar do custo combinado. Volta a zero no dia 1º. A nota pelo QR code não usa IA, mas a
            busca na Sefaz também tem limite.
          </Text>
        </View>
      ) : null}
    </ListCard>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  detail: { gap: space.md, paddingVertical: space.md },
  row: { gap: space.xs },
  header: { flexDirection: 'row', gap: space.sm },
  track: { height: 8, borderRadius: radius.pill, overflow: 'hidden' },
  bar: { height: 8, borderRadius: radius.pill },
});
