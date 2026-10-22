// Topo das telas "Hora dourada": um cartão grande com o gradiente da tela, a
// linha pequena de cima, o título, uma frase de apoio e, do lado, uma cena
// feita de ícones de vidro (sem rosto: só o Nuke tem rosto).

import type { ReactNode } from 'react';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { Pressable, StyleSheet, View } from 'react-native';

import { GradientCard } from './gradient';
import { Orb } from './Orb';
import { CategoryIcon, Icon, type IconName, Text } from './primitives';
import { fonts, radius, space, useColors, useGlow, useGradient, useTint, type GradientName, type Tint } from './theme';

// O brilho da seta combina com o gradiente do cartão.
const GLOW_TINT: Record<GradientName, Tint> = { pessego: 'orange', rosa: 'pink', salvia: 'green', caramelo: 'purple' };

export function ScreenHeader({
  gradient,
  eyebrow,
  title,
  subtitle,
  art,
  action,
}: {
  gradient: GradientName;
  eyebrow: string;
  title: string;
  subtitle?: string;
  art?: ReactNode;
  /** Um botão no canto de cima à direita (o HeaderButton), por cima da cena. */
  action?: ReactNode;
}) {
  const g = useGradient(gradient);
  return (
    <GradientCard gradient={gradient} style={styles.header}>
      <View style={styles.text}>
        <Text style={[styles.eyebrow, { color: g.eyebrow }]}>{eyebrow}</Text>
        <Text variant="title" accessibilityRole="header" style={styles.title}>
          {title}
        </Text>
        {subtitle ? <Text style={[styles.subtitle, { color: g.subtitle }]}>{subtitle}</Text> : null}
      </View>
      {art}
      {action ? <View style={styles.action}>{action}</View> : null}
    </GradientCard>
  );
}

/** Botão redondo de vidro no topo da tela (a engrenagem das Configurações, na Família). O toque tem 44. */
export function HeaderButton({ icon, label, onPress }: { icon: IconName; label: string; onPress: () => void }) {
  const c = useColors();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={2}
      onPress={onPress}
      style={({ pressed }) => pressed && styles.pressed}>
      <Orb size={40} glow={c.border}>
        <Icon name={icon} size={22} color="text" />
      </Orb>
    </Pressable>
  );
}

/**
 * Três ícones de vidro que se sobrepõem, o do meio maior: a cena do topo.
 * Cada um é uma categoria de produto, com o desenho dela.
 */
export function HeaderArt({ categories }: { categories: readonly [string, string, string] }) {
  const [left, middle, right] = categories;
  return (
    <View style={styles.art} accessible={false} importantForAccessibility="no-hide-descendants" pointerEvents="none">
      <View style={styles.artLeft}>
        <CategoryIcon category={left} size={46} />
      </View>
      <View style={styles.artRight}>
        <CategoryIcon category={right} size={46} />
      </View>
      <View style={styles.artMiddle}>
        <CategoryIcon category={middle} size={66} />
      </View>
    </View>
  );
}

function IconOrb({ icon, tint, size }: { icon: IconName; tint: Tint; size: number }) {
  const glow = useGlow(tint);
  const t = useTint(tint);
  return (
    <Orb size={size} glow={glow}>
      <MaterialCommunityIcons name={icon} size={Math.round(size * 0.5)} color={t.art} />
    </Orb>
  );
}

/** A mesma cena de três orbes, com ícones no lugar das ilustrações de produto: telas sem uma categoria que as represente. */
export function HeaderIcons({
  icons,
  tints,
}: {
  icons: readonly [IconName, IconName, IconName];
  tints: readonly [Tint, Tint, Tint];
}) {
  return (
    <View style={styles.art} accessible={false} importantForAccessibility="no-hide-descendants" pointerEvents="none">
      <View style={styles.artLeft}>
        <IconOrb icon={icons[0]} tint={tints[0]} size={46} />
      </View>
      <View style={styles.artRight}>
        <IconOrb icon={icons[2]} tint={tints[2]} size={46} />
      </View>
      <View style={styles.artMiddle}>
        <IconOrb icon={icons[1]} tint={tints[1]} size={66} />
      </View>
    </View>
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
      <GradientCard gradient={gradient} borderRadius={radius.lg} style={styles.feature}>
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
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    minHeight: 148,
    paddingVertical: space.xl,
    paddingHorizontal: space.xl,
  },
  text: { flex: 1, gap: 2 },
  eyebrow: { fontFamily: fonts.bold, fontSize: 13, lineHeight: 18 },
  title: { fontSize: 30, lineHeight: 36 },
  subtitle: { fontFamily: fonts.semibold, fontSize: 15, lineHeight: 21, marginTop: space.xs },
  art: { width: 104, height: 100 },
  artLeft: { position: 'absolute', left: 0, top: 0 },
  artRight: { position: 'absolute', right: 0, bottom: 0 },
  artMiddle: { position: 'absolute', left: 22, top: 18 },
  // No canto, longe da cena: as orbes dela começam a 24 da borda de cima e a 40 da direita.
  action: { position: 'absolute', top: space.sm + 2, right: space.sm + 2 },
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
