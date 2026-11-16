// A barra lateral do computador (domain/desktop): no lugar da pílula de abas do rodapé, um vidro solto à esquerda
// com a marca, a casa aberta, as cinco áreas e o Nuke. Fica na tela também nas telas abertas por cima das abas (a
// lista, a nota, a tarefa), com a área de onde elas vêm acesa. Cada área é um link (abre em outra aba do navegador
// com ctrl/cmd ou o botão do meio) e volta para a aba como ela estava: a parte aberta dentro dela continua aberta,
// como na pílula do celular.

import { router, useGlobalSearchParams, useNavigationContainerRef, useSegments, type Href } from 'expo-router';
import { PlatformPressable } from 'expo-router/react-navigation';
import { StyleSheet, View } from 'react-native';

import {
  APP_AREAS,
  areaHref,
  areaOfSegments,
  onTabs,
  SIDEBAR_MARGIN,
  SIDEBAR_WIDTH,
  tabParams,
  type AppArea,
  type NavRoute,
} from '@/domain/desktop';
import { useHousehold } from '@/lib/auth';
import { Logo } from '@/ui/art';
import { NukeLive } from '@/ui/NukeLive';
import { Icon, Text } from '@/ui/primitives';
import { TAB_ACTIVE_TINT, TAB_ICONS, TabIcon } from '@/ui/TabBar';
import { fonts, radius, shadows, space, useColors, withAlpha } from '@/ui/theme';

/** O que o Nuke diz de si na barra, embaixo do nome. */
export const NUKE_ROLE = 'Assistente da casa';
export const NUKE_LABEL = 'Falar com o Nuke, o assistente da casa';

export function Sidebar() {
  const c = useColors();
  const segments = useSegments();
  // A barra é redesenhada a cada mudança do endereço (também a dos parâmetros de uma aba) e lê o estado da
  // navegação nessa hora: o link de cada área leva os parâmetros que a aba guarda.
  useGlobalSearchParams();
  const navigation = useNavigationContainerRef();
  const household = useHousehold();
  const routes = (navigation.isReady() ? navigation.getRootState()?.routes : undefined) as readonly NavRoute[] | undefined;
  const active = areaOfSegments(segments);
  const inTabs = onTabs(segments);
  const inNuke = segments[0] === 'nuke';
  const houses = household.data?.households ?? [];
  const houseName = household.data?.household.name;
  // O vidro afundado do link aberto, o mesmo da aba aberta na pílula: a cor da ação a 12%, sombra por dentro e um
  // fio de luz.
  const glass = {
    backgroundColor: withAlpha(c.primary, TAB_ACTIVE_TINT),
    boxShadow: `${shadows.inset}, inset -1px -1px 1px ${c.glassEdge}`,
  };
  // O realce do link sob o mouse: a cor da ação, bem fraca.
  const hover = { color: c.primary, hoverOpacity: 0.06, activeOpacity: 0.1 };

  function open(area: AppArea, href: Href) {
    // Já na aba: nada a fazer (a parte aberta dentro dela fica como está).
    if (inTabs && area === active) return;
    // Entre as abas, troca de aba; de uma tela por cima delas, fecha as telas até as abas (sem empilhar outras).
    if (inTabs) router.navigate(href);
    else router.dismissTo(href);
  }

  return (
    <View style={styles.wrap}>
      <View
        role="navigation"
        accessibilityLabel="Áreas do Kotii"
        style={[styles.panel, { backgroundColor: c.glassStrong, borderColor: c.glassBorder, boxShadow: shadows.float }]}>
        <View style={styles.top}>
          <Logo size={24} />
          {houseName ? (
            houses.length > 1 ? (
              <PlatformPressable
                href="/casas"
                accessibilityLabel={`Casa aberta: ${houseName}. Trocar de casa`}
                onPress={() => router.push('/casas')}
                pressOpacity={1}
                hoverEffect={hover}
                style={styles.house}>
                <Text variant="small" numberOfLines={1} style={styles.houseName}>
                  {houseName}
                </Text>
                <Icon name="chevron-down" size={16} color="textMuted" />
              </PlatformPressable>
            ) : (
              <Text variant="small" numberOfLines={1} style={styles.houseOnly}>
                {houseName}
              </Text>
            )
          ) : null}
        </View>

        <View style={styles.items}>
          {APP_AREAS.map((area) => {
            const focused = area.key === active;
            const color = focused ? c.primary : c.textMuted;
            const params = tabParams(routes, area.route);
            return (
              <PlatformPressable
                key={area.key}
                href={areaHref(area.href, params)}
                // O PlatformPressable diz "link": o leitor de tela ainda ouve qual é a página aberta.
                aria-current={focused ? 'page' : undefined}
                accessibilityLabel={area.label}
                testID={`sidebar-${area.key}`}
                onPress={() => open(area.key, { pathname: area.href, params })}
                pressOpacity={1}
                hoverEffect={focused ? undefined : hover}
                style={styles.item}>
                {focused ? <View testID="sidebar-active" style={[styles.active, glass]} /> : null}
                <TabIcon name={TAB_ICONS[area.route]} color={color} />
                <Text numberOfLines={1} style={[styles.label, focused && styles.labelActive, { color }]}>
                  {area.label}
                </Text>
              </PlatformPressable>
            );
          })}
        </View>

        <View style={styles.spacer} />

        <View style={[styles.divider, { backgroundColor: c.hairline }]} />
        <PlatformPressable
          href="/nuke"
          aria-current={inNuke ? 'page' : undefined}
          accessibilityLabel={NUKE_LABEL}
          testID="sidebar-nuke"
          // Com a conversa já aberta, o toque não abre outra por cima.
          onPress={() => (inNuke ? undefined : router.push('/nuke'))}
          pressOpacity={1}
          hoverEffect={inNuke ? undefined : hover}
          style={styles.nuke}>
          {inNuke ? <View style={[styles.active, styles.nukeActive, glass]} /> : null}
          {/* Parado enquanto a conversa está aberta (lá há outro Nuke, que se mexe). */}
          <NukeLive size={40} paused={inNuke} />
          <View style={styles.nukeText}>
            <Text numberOfLines={1} style={[styles.label, styles.labelActive]}>
              Nuke
            </Text>
            <Text variant="small" numberOfLines={1}>
              {NUKE_ROLE}
            </Text>
          </View>
        </PlatformPressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  // Solta das bordas, como a pílula do celular: a margem da esquerda, de cima e de baixo.
  wrap: { paddingLeft: SIDEBAR_MARGIN, paddingVertical: SIDEBAR_MARGIN },
  panel: {
    flex: 1,
    width: SIDEBAR_WIDTH,
    borderRadius: radius.lg,
    borderCurve: 'continuous',
    borderWidth: 1,
    padding: space.md,
    gap: space.md,
  },
  top: { gap: space.xs, paddingHorizontal: space.sm, paddingTop: space.sm, paddingBottom: space.xs },
  house: { flexDirection: 'row', alignItems: 'center', gap: space.xs, alignSelf: 'flex-start', borderRadius: radius.sm, paddingVertical: 2 },
  houseName: { flexShrink: 1 },
  houseOnly: { paddingVertical: 2 },
  items: { gap: space.xs },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    minHeight: 48,
    paddingHorizontal: space.md + 2,
    borderRadius: radius.pill,
    borderCurve: 'continuous',
  },
  // Atrás do ícone e do rótulo, do tamanho do link.
  active: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, borderRadius: radius.pill, borderCurve: 'continuous' },
  label: { fontFamily: fonts.bold, fontSize: 15, lineHeight: 20, flexShrink: 1 },
  labelActive: { fontFamily: fonts.heavy },
  spacer: { flex: 1 },
  divider: { height: 1, marginHorizontal: space.sm },
  nuke: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    padding: space.sm,
    borderRadius: radius.tile,
    borderCurve: 'continuous',
  },
  nukeActive: { borderRadius: radius.tile },
  nukeText: { flex: 1, minWidth: 0 },
});
