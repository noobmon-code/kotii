import { StyleSheet, View } from 'react-native';

import { useHousehold } from '@/lib/auth';
import { Chip, Row, Text } from '@/ui/primitives';
import { space } from '@/ui/theme';

/** "Quem pagou" para a divisão de gastos; some quando a casa tem um morador só. */
export function PayerChips({ value, onChange }: { value: string | null; onChange: (userId: string) => void }) {
  const members = useHousehold().data?.members ?? [];
  if (members.length < 2) return null;
  return (
    <View style={styles.group}>
      <Text variant="label">Quem pagou</Text>
      <Row style={styles.wrap}>
        {members.map((m) => (
          <Chip key={m.user_id} label={m.display_name} icon="account-outline" selected={value === m.user_id} onPress={() => onChange(m.user_id)} />
        ))}
      </Row>
    </View>
  );
}

const styles = StyleSheet.create({
  group: { gap: space.sm },
  wrap: { flexWrap: 'wrap' },
});
