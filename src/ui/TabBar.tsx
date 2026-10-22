// Barra de abas "Hora dourada": uma pílula de vidro solta do rodapé, com a aba aberta num destaque redondo
// (ícone de linha e rótulo juntos). Feita à mão, porque o destaque da barra do navegador é um retângulo de
// cantos vivos, que vaza da curva da pílula. Como na barra padrão, cada aba é um link na web (abre em outra aba do
// navegador com ctrl/cmd ou o botão do meio) e, no iPhone, o leitor de tela diz a posição dela.

import type { BottomTabBarProps } from 'expo-router/js-tabs';
import { PlatformPressable, useLinkBuilder } from 'expo-router/react-navigation';
import { Platform, StyleSheet, View } from 'react-native';
import { type EdgeInsets } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';

import { Text } from './primitives';
import { TAB_ICON_BOX, TAB_ICON_PATHS, type TabIconName } from './tabIcons';
import { fonts, radius, shadows, space, useColors, withAlpha } from './theme';

/** Altura da pílula: o botão do Nuke fica logo acima dela. */
export const TAB_BAR_HEIGHT = 72;

/** A margem de baixo da pílula: a área segura, ou um respiro onde não há. */
export const tabBarBottomGap = (insets: Pick<EdgeInsets, 'bottom'>) => Math.max(insets.bottom, space.md);

// As medidas do lado: num celular de 360, cada aba tem (360 - 32 - 2 - 2 * 4) / 5 = 63,6 e o rótulo, 63,6 - 12 = 51,6,
// o bastante para "Finanças" (uns 45). Com a fonte grande do aparelho, o rótulo cresce só até 1,2x e encolhe até
// 85% para caber, em vez de ser cortado.
/** O recuo da barra, dos lados. */
export const TAB_BAR_PADDING = 4;
/** O recuo da pílula de cada aba (o destaque da aba aberta), dos lados. */
export const TAB_PILL_PADDING = 6;
export const TAB_LABEL_MAX_SCALE = 1.2;
export const TAB_LABEL_MIN_SCALE = 0.85;

/** A aba de cada rota, na ordem em que aparecem. */
export const TAB_ICONS: Record<string, TabIconName> = {
  index: 'sun',
  casa: 'home',
  financas: 'wallet',
  saude: 'heart',
  familia: 'users',
};

export function TabIcon({ name, color, size = TAB_ICON_BOX }: { name: TabIconName; color: string; size?: number }) {
  return (
    <Svg width={size} height={size} viewBox={`0 0 ${TAB_ICON_BOX} ${TAB_ICON_BOX}`} accessible={false}>
      <Path d={TAB_ICON_PATHS[name]} fill={color} />
    </Svg>
  );
}

export function TabBar({ state, descriptors, navigation, insets }: BottomTabBarProps) {
  const c = useColors();
  const { buildHref } = useLinkBuilder();
  return (
    <View
      accessibilityRole="tablist"
      style={[
        styles.bar,
        {
          backgroundColor: c.glassStrong,
          borderColor: c.glassBorder,
          marginBottom: tabBarBottomGap(insets),
          boxShadow: shadows.float,
        },
      ]}>
      {state.routes.map((route, index) => {
        const focused = state.index === index;
        const { options } = descriptors[route.key];
        const label = typeof options.tabBarLabel === 'string' ? options.tabBarLabel : (options.title ?? route.name);
        const color = focused ? c.primary : c.textMuted;
        const icon = TAB_ICONS[route.name];

        // Na web, o PlatformPressable só chama isto no clique simples: com tecla ou com o botão do meio, o link
        // fica com o navegador.
        const press = () => {
          const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
          if (!focused && !event.defaultPrevented) navigation.navigate(route.name, route.params);
        };
        const longPress = () => navigation.emit({ type: 'tabLongPress', target: route.key });

        return (
          <PlatformPressable
            key={route.key}
            href={buildHref(route.name, route.params)}
            // O PlatformPressable diz "link" (ou "botão"): o papel daqui vale por cima.
            role="tab"
            accessibilityRole="tab"
            accessibilityState={{ selected: focused }}
            accessibilityLabel={
              options.tabBarAccessibilityLabel ??
              (Platform.OS === 'ios' ? `${label}, aba, ${index + 1} de ${state.routes.length}` : label)
            }
            testID={options.tabBarButtonTestID}
            onPress={press}
            onLongPress={longPress}
            // Sem o esmaecer nem a onda do Android: o toque é o mesmo de antes do link.
            pressOpacity={1}
            pressColor="transparent"
            style={styles.item}>
            <View style={[styles.pill, focused && { backgroundColor: withAlpha(c.primary, 0.12) }]}>
              {icon ? <TabIcon name={icon} color={color} /> : null}
              <Text
                style={[styles.label, focused && styles.labelActive, { color }]}
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={TAB_LABEL_MIN_SCALE}
                maxFontSizeMultiplier={TAB_LABEL_MAX_SCALE}>
                {label}
              </Text>
            </View>
          </PlatformPressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    height: TAB_BAR_HEIGHT,
    marginHorizontal: space.lg,
    paddingHorizontal: TAB_BAR_PADDING,
    borderRadius: radius.pill,
    borderCurve: 'continuous',
    borderWidth: 1,
  },
  item: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  pill: {
    minWidth: 46,
    alignItems: 'center',
    gap: 2,
    paddingHorizontal: TAB_PILL_PADDING,
    paddingVertical: 8,
    borderRadius: radius.pill,
    borderCurve: 'continuous',
    overflow: 'hidden',
  },
  label: { fontFamily: fonts.bold, fontSize: 11, lineHeight: 15 },
  labelActive: { fontFamily: fonts.heavy },
});
