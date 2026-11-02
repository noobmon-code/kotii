// O cartão grande com gradiente que leva a outra tela ("Hora dourada") e o botão redondo de vidro do topo de uma tela
// (a engrenagem das Configurações, na Família). As abas não têm mais o cartão de topo: a barra de abas já diz a aba.

import { Pressable, StyleSheet, View } from 'react-native';

import { GradientCard } from './gradient';
import { Orb } from './Orb';
import { Icon, type IconName, Text } from './primitives';
import { fonts, space, useColors, useGlow, useGradient, type GradientName, type Tint } from './theme';

// O brilho da seta combina com o gradiente do cartão.
const GLOW_TINT: Record<GradientName, Tint> = { pessego: 'orange', rosa: 'pink', salvia: 'green', caramelo: 'purple' };

/**
 * Botão redondo de vidro no topo da tela (a engrenagem das Configurações, no canto da Família). O toque tem 44 em
 * toda plataforma: a caixa do botão é de 44 em volta da orbe de 40 (o `hitSlop` não vale no navegador).
 */
export function HeaderButton({ icon, label, onPress }: { icon: IconName; label: string; onPress: () => void }) {
  const c = useColors();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [styles.headerButton, pressed && styles.pressed]}>
      <Orb size={40} glow={c.border}>
        <Icon name={icon} size={22} color="text" />
      </Orb>
    </Pressable>
  );
}

/** Cartão grande com gradiente que leva a outra tela: título, frase e uma seta numa orbe. */
export function FeatureCard({
  gradient,
  title,
  subtitle,
  onPress,
}: {
  gradient: GradientName;
  title: string;
  subtitle: string;
  onPress: () => void;
}) {
  const g = useGradient(gradient);
  const glow = useGlow(GLOW_TINT[gradient]);
  return (
    <Pressable
      accessibilityRole="button"
      // O rótulo toma o lugar dos textos de dentro: sem a frase, o leitor de tela não diz o que a tela tem.
      accessibilityLabel={`${title}. ${subtitle}`}
      onPress={onPress}
      style={({ pressed }) => pressed && styles.pressed}>
      <GradientCard gradient={gradient} style={styles.feature}>
        <View style={styles.text}>
          <Text variant="heading" style={styles.featureTitle}>
            {title}
          </Text>
          <Text style={[styles.featureSubtitle, { color: g.subtitle }]}>{subtitle}</Text>
        </View>
        <Orb size={44} glow={glow}>
          <Icon name="chevron-right" size={24} color="text" />
        </Orb>
      </GradientCard>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  headerButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  text: { flex: 1, gap: 2 },
  feature: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingVertical: space.lg + 2,
    paddingHorizontal: space.xl,
  },
  featureTitle: { fontSize: 17, lineHeight: 23 },
  featureSubtitle: { fontFamily: fonts.semibold, fontSize: 14, lineHeight: 19 },
  pressed: { transform: [{ scale: 0.98 }] },
});
