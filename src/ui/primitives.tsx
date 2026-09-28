import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { Image } from 'expo-image';
import { Children, Fragment, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text as RNText,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type TextProps as RNTextProps,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView, type Edge } from 'react-native-safe-area-context';

import { getCategory, type IconName } from '@/domain/categories';
import { maskBRDate } from '@/domain/dates';
import { matchItemArt } from '@/domain/itemArt';
import { Mascot, Spot, type Mood } from './art';
import { Backdrop } from './Backdrop';
import { CATEGORY_ART } from './categoryArt';
import { ITEM_ART } from './itemArt';
import { fonts, MAX_WIDTH, radius, shadows, space, useColors, useTint, type Colors, type Tint } from './theme';

export type { IconName };

// ---------------------------------------------------------------------------
// Texto

type TextVariant = 'display' | 'title' | 'heading' | 'body' | 'label' | 'muted' | 'small';

export function Text({
  variant = 'body',
  color,
  style,
  ...rest
}: RNTextProps & { variant?: TextVariant; color?: keyof Colors }) {
  const c = useColors();
  const defaultColor = variant === 'muted' || variant === 'small' ? c.textMuted : c.text;
  return <RNText style={[textStyles[variant], { color: color ? c[color] : defaultColor }, style]} {...rest} />;
}

// Nunito tem um arquivo por peso: o peso vem da família, não de fontWeight.
const textStyles = StyleSheet.create({
  display: { fontFamily: fonts.heavy, fontSize: 34, lineHeight: 40, letterSpacing: -0.6 },
  title: { fontFamily: fonts.heavy, fontSize: 28, lineHeight: 34, letterSpacing: -0.4 },
  heading: { fontFamily: fonts.heavy, fontSize: 20, lineHeight: 26, letterSpacing: -0.2 },
  body: { fontFamily: fonts.regular, fontSize: 16, lineHeight: 23 },
  label: { fontFamily: fonts.bold, fontSize: 15, lineHeight: 20 },
  muted: { fontFamily: fonts.regular, fontSize: 14, lineHeight: 20 },
  small: { fontFamily: fonts.semibold, fontSize: 12.5, lineHeight: 17 },
});

export function Icon({ name, size = 22, color }: { name: IconName; size?: number; color?: keyof Colors }) {
  const c = useColors();
  return <MaterialCommunityIcons name={name} size={size} color={c[color ?? 'text']} />;
}

// ---------------------------------------------------------------------------
// Layout

export function Screen({
  children,
  scroll = true,
  refreshing,
  onRefresh,
  edges = ['top'],
  footer,
  fab,
}: {
  children: ReactNode;
  scroll?: boolean;
  refreshing?: boolean;
  onRefresh?: () => void;
  edges?: Edge[];
  footer?: ReactNode;
  /** Tela com o botão do Nuke por cima: sobra espaço no fim para ele não cobrir nada. */
  fab?: boolean;
}) {
  const c = useColors();
  const content = <View style={[styles.content, fab && styles.contentWithFab]}>{children}</View>;
  return (
    <SafeAreaView edges={edges} style={[styles.screen, { backgroundColor: c.background }]}>
      <Backdrop />
      {scroll ? (
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.scrollContent}
          refreshControl={
            onRefresh ? <RefreshControl refreshing={Boolean(refreshing)} onRefresh={onRefresh} /> : undefined
          }>
          {content}
        </ScrollView>
      ) : (
        content
      )}
      {footer ? (
        <View style={[styles.footer, { borderTopColor: c.glassBorder, backgroundColor: c.glassStrong }]}>
          <View style={styles.footerInner}>{footer}</View>
        </View>
      ) : null}
    </SafeAreaView>
  );
}

/**
 * Vidro: fundo claro translúcido, borda de luz (mais forte em cima e à
 * esquerda, de onde vem a luz) e sombra suave.
 */
export function useGlassStyle(): ViewStyle {
  return glassStyle(useColors());
}

const glassStyles = new Map<Colors, ViewStyle>();
/** Um objeto por tema: as telas passam o mesmo estilo a cada render. */
function glassStyle(c: Colors): ViewStyle {
  let style = glassStyles.get(c);
  if (!style) {
    style = {
      backgroundColor: c.glass,
      borderWidth: 1,
      borderColor: c.glassEdge,
      borderTopColor: c.glassBorder,
      borderLeftColor: c.glassBorder,
      boxShadow: shadows.glass,
    };
    glassStyles.set(c, style);
  }
  return style;
}

export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const glass = useGlassStyle();
  return <View style={[styles.card, glass, style]}>{children}</View>;
}

/** Card de linhas (ListRow) com divisor só entre elas. */
export function ListCard({ children }: { children: ReactNode }) {
  const c = useColors();
  const rows = Children.toArray(children);
  return (
    <Card style={styles.listCard}>
      {rows.map((row, index) => (
        <Fragment key={index}>
          {index > 0 ? <View style={[styles.divider, { backgroundColor: c.border }]} /> : null}
          {row}
        </Fragment>
      ))}
    </Card>
  );
}

export function Section({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <Text variant="heading" style={styles.flex}>
          {title}
        </Text>
        {action}
      </View>
      {children}
    </View>
  );
}

/** Título das abas: nome da tela com um personagem da cor da seção. */
export function PageTitle({ title, subtitle, tint }: { title: string; subtitle?: string; tint: Tint }) {
  const t = useTint(tint);
  return (
    <View style={styles.pageTitle}>
      <View style={styles.flex}>
        <Text variant="title">{title}</Text>
        {subtitle ? <Text variant="muted">{subtitle}</Text> : null}
      </View>
      <View style={[styles.pageTitleArt, { backgroundColor: t.bg }]}>
        <Mascot size={40} color={t.art} shape="bean" />
      </View>
    </View>
  );
}

export function Row({ children, gap = space.sm, style }: { children: ReactNode; gap?: number; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.row, { gap }, style]}>{children}</View>;
}

// ---------------------------------------------------------------------------
// Ações

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

export function Button({
  title,
  onPress,
  variant = 'primary',
  icon,
  loading,
  disabled,
  compact,
  style,
}: {
  title: string;
  onPress: () => void;
  variant?: ButtonVariant;
  icon?: IconName;
  loading?: boolean;
  disabled?: boolean;
  compact?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const c = useColors();
  const palette: Record<ButtonVariant, { bg: string; fg: keyof Colors; border: string }> = {
    primary: { bg: c.primary, fg: 'onPrimary', border: c.primary },
    secondary: { bg: c.glassStrong, fg: 'text', border: c.glassBorder },
    ghost: { bg: 'transparent', fg: 'primary', border: 'transparent' },
    danger: { bg: c.dangerSoft, fg: 'danger', border: c.dangerSoft },
  };
  // Aperto: o botão encolhe um pouco, como no toque de uma bolinha.
  const p = palette[variant];
  const inactive = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: inactive, busy: loading }}
      onPress={onPress}
      disabled={inactive}
      style={({ pressed }) => [
        styles.button,
        compact && styles.buttonCompact,
        { backgroundColor: p.bg, borderColor: p.border, opacity: inactive ? 0.55 : 1 },
        variant === 'primary' && !inactive && { boxShadow: shadows.primary },
        variant === 'secondary' && { boxShadow: shadows.glass },
        pressed && !inactive && styles.pressed,
        style,
      ]}>
      {loading ? (
        <ActivityIndicator color={c[p.fg]} />
      ) : (
        <>
          {icon ? <Icon name={icon} size={compact ? 18 : 20} color={p.fg} /> : null}
          <Text variant="label" color={p.fg}>
            {title}
          </Text>
        </>
      )}
    </Pressable>
  );
}

export function IconButton({
  icon,
  onPress,
  label,
  color = 'textMuted',
}: {
  icon: IconName;
  onPress: () => void;
  label: string;
  color?: keyof Colors;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={8}
      onPress={onPress}
      style={({ pressed }) => [styles.iconButton, pressed && { opacity: 0.6 }, pressed && styles.pressed]}>
      <Icon name={icon} size={22} color={color} />
    </Pressable>
  );
}

export function CheckCircle({ checked, onPress, label }: { checked: boolean; onPress: () => void; label: string }) {
  const c = useColors();
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      accessibilityLabel={label}
      hitSlop={10}
      onPress={onPress}
      style={[
        styles.check,
        { borderColor: checked ? c.primary : c.border, backgroundColor: checked ? c.primary : 'transparent' },
      ]}>
      {checked ? <Icon name="check" size={16} color="onPrimary" /> : null}
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// Formulário

export function TextField({ label, hint, style, ...props }: TextInputProps & { label?: string; hint?: string }) {
  const c = useColors();
  return (
    <View style={styles.field}>
      {label ? <Text variant="label">{label}</Text> : null}
      <TextInput
        placeholderTextColor={c.textMuted}
        style={[
          styles.input,
          { backgroundColor: c.glassStrong, borderColor: c.border, color: c.text },
          props.multiline && styles.inputMultiline,
          style,
        ]}
        {...props}
      />
      {hint ? <Text variant="small">{hint}</Text> : null}
    </View>
  );
}

/**
 * Campo de data dd/mm/aaaa: barras que aparecem sozinhas enquanto digita
 * (maskBRDate). No iPhone o teclado tem números e barra; no Android, o
 * numérico não tem barra, mas a máscara completa o zero quando dá. O valor
 * continua sendo o texto; quem salva converte com parseBRDate.
 */
export function DateField({
  value = '',
  onChangeText,
  ...props
}: Omit<TextInputProps, 'value' | 'onChangeText'> & {
  value?: string;
  onChangeText: (text: string) => void;
  label?: string;
  hint?: string;
}) {
  return (
    <TextField
      placeholder="dd/mm/aaaa"
      keyboardType={Platform.OS === 'ios' ? 'numbers-and-punctuation' : 'number-pad'}
      maxLength={10}
      autoCorrect={false}
      {...props}
      value={value}
      onChangeText={(text) => onChangeText(maskBRDate(text, value))}
    />
  );
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  const c = useColors();
  return (
    <View style={[styles.segmented, { backgroundColor: c.glass, borderColor: c.glassBorder }]}>
      {options.map((o) => {
        const selected = o.value === value;
        return (
          <Pressable
            key={o.value}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            onPress={() => onChange(o.value)}
            style={[styles.segment, selected && { backgroundColor: c.surface }, selected && styles.segmentSelected]}>
            <Text variant="label" color={selected ? 'text' : 'textMuted'} numberOfLines={1}>
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function Chip({
  label,
  selected,
  onPress,
  icon,
}: {
  label: string;
  selected?: boolean;
  onPress?: () => void;
  icon?: IconName;
}) {
  const c = useColors();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={[
        styles.chip,
        { backgroundColor: selected ? c.primary : c.glassStrong, borderColor: selected ? c.primary : c.border },
      ]}>
      {icon ? <Icon name={icon} size={16} color={selected ? 'onPrimary' : 'textMuted'} /> : null}
      <Text variant="label" color={selected ? 'onPrimary' : 'text'} style={styles.chipText}>
        {label}
      </Text>
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// Exibição

export type Tone = 'neutral' | 'primary' | 'danger' | 'warning' | 'info';

export function Badge({ label, tone = 'neutral' }: { label: string; tone?: Tone }) {
  const c = useColors();
  const map: Record<Tone, [string, keyof Colors]> = {
    neutral: [c.surfaceAlt, 'textMuted'],
    primary: [c.primarySoft, 'primary'],
    danger: [c.dangerSoft, 'danger'],
    warning: [c.warningSoft, 'warning'],
    info: [c.infoSoft, 'info'],
  };
  const [bg, fg] = map[tone];
  return (
    <View style={[styles.badge, { backgroundColor: bg }]}>
      <Text variant="small" color={fg} style={styles.badgeText}>
        {label}
      </Text>
    </View>
  );
}

export function IconBadge({ icon, tone = 'neutral', size = 40 }: { icon: IconName; tone?: Tone; size?: number }) {
  const c = useColors();
  const map: Record<Tone, [string, keyof Colors]> = {
    neutral: [c.surfaceAlt, 'text'],
    primary: [c.primarySoft, 'primary'],
    danger: [c.dangerSoft, 'danger'],
    warning: [c.warningSoft, 'warning'],
    info: [c.infoSoft, 'info'],
  };
  const [bg, fg] = map[tone];
  return (
    <View style={[styles.iconBadge, { width: size, height: size, backgroundColor: bg }]}>
      <Icon name={icon} size={size * 0.55} color={fg} />
    </View>
  );
}

/** Tom pastel da categoria: o mesmo do círculo do CategoryIcon, para fundos de cartão. */
export function useCategoryTint(category: string) {
  return useTint(CATEGORY_ART[getCategory(category).key].tint);
}

/**
 * Ilustração sobre um círculo pastel da categoria (categoria desconhecida vira
 * "outros"). Com `name`, itens conhecidos (banana, arroz, leite…) ganham o
 * desenho próprio. `backdrop={false}` tira o círculo, para quem já pinta o
 * fundo com useCategoryTint; `dimmed` esmaece (item já no carrinho).
 */
export function CategoryIcon({
  category,
  name,
  size = 40,
  backdrop = true,
  dimmed = false,
}: {
  category: string;
  name?: string;
  size?: number;
  backdrop?: boolean;
  dimmed?: boolean;
}) {
  const art = CATEGORY_ART[getCategory(category).key];
  const tint = useTint(art.tint);
  const itemKey = name ? matchItemArt(name, category) : null;
  const image = (
    <Image
      source={itemKey ? ITEM_ART[itemKey] : art.image}
      style={{ width: size, height: size, opacity: dimmed ? 0.45 : 1 }}
      contentFit="contain"
      accessible={false}
    />
  );
  if (!backdrop) return image;
  return <View style={[styles.iconBadge, { width: size, height: size, backgroundColor: tint.bg }]}>{image}</View>;
}

export function ListRow({
  left,
  title,
  subtitle,
  right,
  onPress,
  onLongPress,
  dimmed,
}: {
  left?: ReactNode;
  title: string;
  subtitle?: ReactNode;
  right?: ReactNode;
  onPress?: () => void;
  onLongPress?: () => void;
  dimmed?: boolean;
}) {
  const c = useColors();
  return (
    <Pressable
      disabled={!onPress && !onLongPress}
      onPress={onPress}
      onLongPress={onLongPress}
      style={({ pressed }) => [
        styles.listRow,
        pressed && { backgroundColor: c.surfaceAlt },
        dimmed && { opacity: 0.5 },
      ]}>
      {left}
      <View style={styles.flex}>
        <Text variant="body" numberOfLines={2} style={dimmed && styles.strike}>
          {title}
        </Text>
        {typeof subtitle === 'string' ? <Text variant="muted">{subtitle}</Text> : subtitle}
      </View>
      {right}
    </Pressable>
  );
}

/** Atalho colorido com ícone e rótulo (ações rápidas). */
export function Tile({
  icon,
  label,
  onPress,
  tint = 'orange',
}: {
  icon: IconName;
  label: string;
  onPress: () => void;
  tint?: Tint;
}) {
  const glass = useGlassStyle();
  const t = useTint(tint);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [styles.tile, glass, { backgroundColor: t.bg }, pressed && styles.pressed]}>
      <View style={[styles.tileIcon, { backgroundColor: t.art }]}>
        <MaterialCommunityIcons name={icon} size={24} color="#FFFFFF" />
      </View>
      <Text variant="label" style={styles.center} numberOfLines={2}>
        {label}
      </Text>
    </Pressable>
  );
}

export function EmptyState({
  icon,
  title,
  message,
  action,
  tint = 'orange',
  mood = 'happy',
}: {
  icon: IconName;
  title: string;
  message?: string;
  action?: ReactNode;
  tint?: Tint;
  mood?: Mood;
}) {
  return (
    <View style={styles.empty}>
      <View accessibilityLabel={title}>
        <Spot tint={tint} mood={mood} size={124} />
        <View style={styles.emptyBadge}>
          <IconBadge icon={icon} size={36} tone="primary" />
        </View>
      </View>
      <Text variant="heading" style={styles.center}>
        {title}
      </Text>
      {message ? (
        <Text variant="muted" style={styles.center}>
          {message}
        </Text>
      ) : null}
      {action}
    </View>
  );
}

export function Loading({ label }: { label?: string }) {
  const c = useColors();
  return (
    <View style={styles.loading}>
      <ActivityIndicator color={c.primary} size="large" />
      {label ? <Text variant="muted">{label}</Text> : null}
    </View>
  );
}

export function ErrorNotice({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const message =
    error && typeof error === 'object' && 'message' in error ? String(error.message) : 'Algo deu errado.';
  return (
    <Card style={styles.gap}>
      <Row>
        <Icon name="alert-circle-outline" color="danger" />
        <Text variant="body" style={styles.flex}>
          {message}
        </Text>
      </Row>
      {onRetry ? <Button title="Tentar de novo" variant="secondary" compact onPress={onRetry} /> : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { textAlign: 'center' },
  strike: { textDecorationLine: 'line-through' },
  gap: { gap: space.md },
  screen: { flex: 1 },
  scrollContent: { flexGrow: 1 },
  content: {
    flexGrow: 1,
    width: '100%',
    maxWidth: MAX_WIDTH,
    alignSelf: 'center',
    padding: space.lg,
    gap: space.xl,
  },
  contentWithFab: { paddingBottom: 96 },
  footer: { borderTopWidth: StyleSheet.hairlineWidth, paddingHorizontal: space.lg, paddingVertical: space.md },
  footerInner: { width: '100%', maxWidth: MAX_WIDTH, alignSelf: 'center', gap: space.sm },
  card: { borderRadius: radius.lg, padding: space.lg + 2 },
  pageTitle: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  pageTitleArt: { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center' },
  pressed: { transform: [{ scale: 0.97 }] },
  section: { gap: space.md },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  row: { flexDirection: 'row', alignItems: 'center' },
  button: {
    minHeight: 52,
    borderRadius: radius.pill,
    borderWidth: 1.5,
    paddingHorizontal: space.lg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
  },
  buttonCompact: { minHeight: 40, paddingHorizontal: space.lg },
  iconButton: { padding: space.xs, borderRadius: radius.pill },
  check: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  field: { gap: space.xs },
  input: {
    minHeight: 52,
    borderRadius: radius.md,
    borderWidth: 1.5,
    paddingHorizontal: space.lg,
    fontSize: 16,
    fontFamily: fonts.regular,
  },
  inputMultiline: { minHeight: 88, paddingTop: space.md, textAlignVertical: 'top' },
  segmented: { flexDirection: 'row', borderRadius: radius.pill, padding: 4, borderWidth: 1 },
  segment: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: space.sm + 2,
    borderRadius: radius.pill,
  },
  segmentSelected: {
    shadowColor: '#2B2A3A',
    shadowOpacity: 0.08,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingHorizontal: space.md + 2,
    paddingVertical: 7,
  },
  chipText: { fontSize: 14 },
  badge: { borderRadius: radius.pill, paddingHorizontal: space.sm, paddingVertical: 2, alignSelf: 'flex-start' },
  badgeText: { fontFamily: fonts.bold },
  iconBadge: { borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  listRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.md },
  listCard: { paddingVertical: space.xs },
  divider: { height: StyleSheet.hairlineWidth },
  tile: {
    flex: 1,
    alignItems: 'center',
    gap: space.sm,
    paddingTop: space.lg,
    paddingBottom: space.md,
    paddingHorizontal: space.sm,
    borderRadius: radius.lg,
    borderWidth: 1,
  },
  tileIcon: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  empty: { alignItems: 'center', gap: space.md, paddingVertical: space.xl, paddingHorizontal: space.lg },
  emptyBadge: { position: 'absolute', right: -4, bottom: 0 },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.md, padding: space.xxl },
});
