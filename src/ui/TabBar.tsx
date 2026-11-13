// Barra de abas "Hora dourada": uma pílula de vidro solta do rodapé, com a aba aberta num círculo de vidro
// (ícone de linha e rótulo juntos), como a "Aba" ativa do kit do Figma. Feita à mão, porque o destaque da barra
// do navegador é um retângulo de cantos vivos, que vaza da curva da pílula. Como na barra padrão, cada aba é um link na web (abre em outra aba do
// navegador com ctrl/cmd ou o botão do meio) e, no iPhone, o leitor de tela diz a posição dela.

import type { BottomTabBarProps } from 'expo-router/js-tabs';
import { PlatformPressable, useLinkBuilder } from 'expo-router/react-navigation';
import { Platform, StyleSheet, View } from 'react-native';
import { type EdgeInsets } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';

import { Text } from './primitives';
import {
  isStrokeTabIcon,
  TAB_ICON_BOX,
  TAB_ICON_PATHS,
  TAB_STROKE_GRID,
  TAB_STROKE_ICONS,
  TAB_STROKE_WIDTH,
  type TabIconName,
} from './tabIcons';
import { fonts, radius, shadows, space, useColors, withAlpha } from './theme';

/** Altura da pílula: o botão do Nuke fica logo acima dela. */
export const TAB_BAR_HEIGHT = 72;

/** A margem de baixo da pílula: a área segura, ou um respiro onde não há. */
export const tabBarBottomGap = (insets: Pick<EdgeInsets, 'bottom'>) => Math.max(insets.bottom, space.md);

// As medidas do lado, com as seis abas (Finanças ligada, lib/features): num celular de 360, cada aba tem
// (360 - 32 - 2 - 2 * 4) / 6 = 53 e o rótulo, 53 - 4 = 49, o bastante para "Compras", o rótulo mais largo (46,6 em
// Nunito 11 ExtraBold), e para "Finanças" (45,2), sem encolher nem cortar, também no navegador, que não encolhe o
// texto. O círculo da aba aberta (TAB_ACTIVE_SIZE, 55) passa 1 de cada lado da aba, por trás das vizinhas, e o rótulo
// largo passa um pouco da curva dele embaixo, como no kit. "Configurações" (74,8) não cabe: na barra a aba é
// "Ajustes", e "Configurações" fica como título da tela. Com a fonte grande do aparelho, o rótulo cresce só até 1,2x
// e encolhe até 85% para caber, em vez de ser cortado. Sem Finanças são cinco abas, de 63,6, com folga.
/** O recuo da barra, dos lados. */
export const TAB_BAR_PADDING = 4;
/**
 * O recuo do rótulo de cada aba, dos lados: só o bastante para dois rótulos vizinhos não se tocarem. Era 6 quando o
 * destaque era uma pílula em volta do rótulo; com o círculo solto por trás, 6 de cada lado só tirava espaço do
 * rótulo, e com seis abas "Compras" e "Finanças" não cabiam num celular de 360 a 393.
 */
export const TAB_PILL_PADDING = 2;
/**
 * O destaque da aba aberta: um círculo de 55, sempre redondo. Um rótulo mais largo que ele ("Compras") passa um
 * pouco da borda, como no kit, em vez de esticar o círculo ou ser cortado.
 */
export const TAB_ACTIVE_SIZE = 55;
/** O azul do destaque: a cor de ação a 12%. */
export const TAB_ACTIVE_TINT = 0.12;
export const TAB_LABEL_MAX_SCALE = 1.2;
export const TAB_LABEL_MIN_SCALE = 0.85;

/** O ícone de cada rota, na ordem em que as abas aparecem (Finanças só com a chave ligada, lib/features). */
export const TAB_ICONS: Record<string, TabIconName> = {
  index: 'sun',
  compras: 'cart',
  casa: 'home',
  financas: 'wallet',
  saude: 'heart',
  configuracoes: 'gear',
};

export function TabIcon({ name, color, size = TAB_ICON_BOX }: { name: TabIconName; color: string; size?: number }) {
  // Os de traço (desenhados à mão, ui/tabIcons) vêm no quadro de 24 e o viewBox os reduz ao tamanho da barra, como
  // os do Figma já vieram reduzidos: a linha fica da mesma grossura nos dois.
  if (isStrokeTabIcon(name)) {
    return (
      <Svg width={size} height={size} viewBox={`0 0 ${TAB_STROKE_GRID} ${TAB_STROKE_GRID}`} accessible={false}>
        {TAB_STROKE_ICONS[name].map((d) => (
          <Path
            key={d}
            d={d}
            fill="none"
            stroke={color}
            strokeWidth={TAB_STROKE_WIDTH}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ))}
      </Svg>
    );
  }
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
            // Na web, só o aria-selected chega ao HTML (o accessibilityState não vira atributo).
            aria-selected={focused}
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
            <View style={styles.pill}>
              {focused ? (
                // O vidro: uma sombra leve por dentro, em cima à esquerda, e um fio de luz do lado oposto.
                <View
                  testID="tab-active"
                  style={[
                    styles.active,
                    {
                      backgroundColor: withAlpha(c.primary, TAB_ACTIVE_TINT),
                      boxShadow: `${shadows.inset}, inset -1px -1px 1px ${c.glassEdge}`,
                    },
                  ]}
                />
              ) : null}
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
    minWidth: TAB_ACTIVE_SIZE,
    minHeight: TAB_ACTIVE_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    paddingHorizontal: TAB_PILL_PADDING,
    paddingVertical: 8,
  },
  // No meio da aba, atrás do ícone e do rótulo, e fora da conta do espaço deles.
  active: {
    position: 'absolute',
    left: '50%',
    top: '50%',
    width: TAB_ACTIVE_SIZE,
    height: TAB_ACTIVE_SIZE,
    marginLeft: -TAB_ACTIVE_SIZE / 2,
    marginTop: -TAB_ACTIVE_SIZE / 2,
    borderRadius: TAB_ACTIVE_SIZE / 2,
  },
  label: { fontFamily: fonts.bold, fontSize: 11, lineHeight: 15 },
  labelActive: { fontFamily: fonts.heavy },
});
