import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { todayISO } from '@/domain/dates';
import { daySummary, describeSummary, houseClock, tipsDay } from '@/domain/weather';
import { Button, Card, Icon, IconBadge, Row, Text } from '@/ui/primitives';
import { space } from '@/ui/theme';

import { useHouseWeather } from './useHouseWeather';

/**
 * A frase do clima na tela Hoje: a dica mais importante do dia (de amanhã,
 * depois das 18h) e mais duas, se houver. Sem o bairro da casa, convida a
 * definir; sem previsão (carregando, sem internet e nada guardado), some.
 */
export function WeatherCard({ now }: { now: Date }) {
  const today = todayISO(now);
  const { location, forecast, tipsFor } = useHouseWeather(today);
  const open = () => router.push('/clima');

  if (location.data === null) {
    return (
      <Card style={styles.card}>
        <Row gap={space.md}>
          <IconBadge icon="weather-partly-cloudy" tone="info" />
          <View style={styles.flex}>
            <Text variant="label">Dicas do clima para a casa</Text>
            <Text variant="muted">Diga o bairro e o Kotii avisa quando é dia de lavar roupa, quando vai chover e mais.</Text>
          </View>
        </Row>
        <Button title="Definir o bairro" icon="map-marker-outline" variant="secondary" compact onPress={open} />
      </Card>
    );
  }
  if (!location.data || !forecast.data) return null;

  // O dia e a hora da casa: quem viaja vê as dicas do dia de lá.
  const clock = houseClock(forecast.data, now);
  const day = tipsDay(clock.date, clock.hour);
  const [top, ...more] = tipsFor(day);
  const summary = daySummary(forecast.data, day.date);

  return (
    <Pressable accessibilityRole="button" accessibilityHint="Abre o clima da casa" onPress={open}>
      <Card style={styles.card}>
        <Row gap={space.md} style={styles.top}>
          <IconBadge icon={top?.icon ?? 'weather-partly-cloudy'} tone="info" />
          <View style={styles.flex}>
            <Text variant="label">{top ? top.title : `${day.dayWord}: nada de especial no tempo`}</Text>
            <Text variant="muted">{top ? top.body : summary ? describeSummary(summary) : location.data.label}</Text>
          </View>
        </Row>
        {more.slice(0, 2).map((tip) => (
          <Row key={tip.key} gap={space.sm}>
            <Icon name={tip.icon} size={18} color="info" />
            <Text variant="small" style={styles.flex}>
              {tip.title}
            </Text>
          </Row>
        ))}
        <Row gap={space.xs}>
          <Icon name="map-marker-outline" size={14} color="textMuted" />
          <Text variant="small" style={styles.flex} numberOfLines={1}>
            {location.data.label}
          </Text>
          <Icon name="chevron-right" size={18} color="textMuted" />
        </Row>
      </Card>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { gap: space.md },
  flex: { flex: 1, gap: 2 },
  top: { alignItems: 'flex-start' },
});
