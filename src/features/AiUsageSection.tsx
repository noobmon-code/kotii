import { useQuery } from '@tanstack/react-query';
import { StyleSheet, View } from 'react-native';

import { aiUsageRows } from '@/domain/aiUsage';
import { supabase, unwrap } from '@/lib/supabase';
import { Card, Section, Text } from '@/ui/primitives';
import { radius, space, useColors } from '@/ui/theme';

/** Uso da IA neste mês (limite por casa, conferido no servidor). */
export function AiUsageSection() {
  const c = useColors();
  const usage = useQuery({
    queryKey: ['aiUsage'],
    queryFn: async () => unwrap(await supabase.rpc('ai_usage_summary')) as { kind: string; used: number; lim: number }[],
  });
  if (!usage.data) return null;
  const rows = aiUsageRows(usage.data);

  return (
    <Section title="Uso da IA neste mês">
      <Card style={styles.gap}>
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
          Limite da casa para não passar do custo combinado. Volta a zero no dia 1º; ler nota pelo QR code não usa IA.
        </Text>
      </Card>
    </Section>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  gap: { gap: space.md },
  row: { gap: space.xs },
  header: { flexDirection: 'row', gap: space.sm },
  track: { height: 8, borderRadius: radius.pill, overflow: 'hidden' },
  bar: { height: 8, borderRadius: radius.pill },
});
