import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { Children, Fragment, type ReactNode } from 'react';
import {
  ActivityIndicator,
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
import { MAX_WIDTH, radius, space, useColors, type Colors } from './theme';

export type { IconName };

// ---------------------------------------------------------------------------
// Texto

type TextVariant = 'title' | 'heading' | 'body' | 'label' | 'muted' | 'small';

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

const textStyles = StyleSheet.create({
  title: { fontSize: 28, lineHeight: 34, fontWeight: '700' },
  heading: { fontSize: 18, lineHeight: 24, fontWeight: '700' },
  body: { fontSize: 16, lineHeight: 22 },
  label: { fontSize: 15, lineHeight: 20, fontWeight: '600' },
  muted: { fontSize: 14, lineHeight: 20 },
  small: { fontSize: 12, lineHeight: 16 },
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
}: {
  children: ReactNode;
  scroll?: boolean;
  refreshing?: boolean;
  onRefresh?: () => void;
  edges?: Edge[];
  footer?: ReactNode;
}) {
  const c = useColors();
  const content = <View style={styles.content}>{children}</View>;
  return (
    <SafeAreaView edges={edges} style={[styles.screen, { backgroundColor: c.background }]}>
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
        <View style={[styles.footer, { borderTopColor: c.border, backgroundColor: c.background }]}>
          <View style={styles.footerInner}>{footer}</View>
        </View>
      ) : null}
    </SafeAreaView>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const c = useColors();
  return (
    <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.border }, style]}>{children}</View>
  );
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
    secondary: { bg: c.surface, fg: 'text', border: c.border },
    ghost: { bg: 'transparent', fg: 'primary', border: 'transparent' },
    danger: { bg: c.dangerSoft, fg: 'danger', border: c.dangerSoft },
  };
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
        { backgroundColor: p.bg, borderColor: p.border, opacity: inactive ? 0.55 : pressed ? 0.8 : 1 },
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
      style={({ pressed }) => [styles.iconButton, pressed && { opacity: 0.6 }]}>
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
          { backgroundColor: c.surface, borderColor: c.border, color: c.text },
          props.multiline && styles.inputMultiline,
          style,
        ]}
        {...props}
      />
      {hint ? <Text variant="small">{hint}</Text> : null}
    </View>
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
    <View style={[styles.segmented, { backgroundColor: c.surfaceAlt }]}>
      {options.map((o) => {
        const selected = o.value === value;
        return (
          <Pressable
            key={o.value}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            onPress={() => onChange(o.value)}
            style={[styles.segment, selected && { backgroundColor: c.surface, borderColor: c.border }]}>
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
        { backgroundColor: selected ? c.primarySoft : c.surface, borderColor: selected ? c.primary : c.border },
      ]}>
      {icon ? <Icon name={icon} size={16} color={selected ? 'primary' : 'textMuted'} /> : null}
      <Text variant="muted" color={selected ? 'primary' : 'text'}>
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

export function CategoryIcon({ category, size = 40 }: { category: string; size?: number }) {
  return <IconBadge icon={getCategory(category).icon} size={size} />;
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

/** Atalho quadrado com ícone e rótulo (ações rápidas). */
export function Tile({ icon, label, onPress }: { icon: IconName; label: string; onPress: () => void }) {
  const c = useColors();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [
        styles.tile,
        { backgroundColor: c.surface, borderColor: c.border },
        pressed && { backgroundColor: c.surfaceAlt },
      ]}>
      <IconBadge icon={icon} tone="primary" />
      <Text variant="small" color="text" style={styles.center} numberOfLines={2}>
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
}: {
  icon: IconName;
  title: string;
  message?: string;
  action?: ReactNode;
}) {
  return (
    <View style={styles.empty}>
      <IconBadge icon={icon} size={56} tone="primary" />
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
  footer: { borderTopWidth: StyleSheet.hairlineWidth, paddingHorizontal: space.lg, paddingVertical: space.md },
  footerInner: { width: '100%', maxWidth: MAX_WIDTH, alignSelf: 'center', gap: space.sm },
  card: { borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, padding: space.lg },
  section: { gap: space.md },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  row: { flexDirection: 'row', alignItems: 'center' },
  button: {
    minHeight: 48,
    borderRadius: radius.md,
    borderWidth: 1,
    paddingHorizontal: space.lg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
  },
  buttonCompact: { minHeight: 38, paddingHorizontal: space.md },
  iconButton: { padding: space.xs },
  check: {
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  field: { gap: space.xs },
  input: {
    minHeight: 48,
    borderRadius: radius.md,
    borderWidth: 1,
    paddingHorizontal: space.md,
    fontSize: 16,
  },
  inputMultiline: { minHeight: 88, paddingTop: space.md, textAlignVertical: 'top' },
  segmented: { flexDirection: 'row', borderRadius: radius.md, padding: 3 },
  segment: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: space.sm,
    borderRadius: radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'transparent',
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingHorizontal: space.md,
    paddingVertical: 6,
  },
  badge: { borderRadius: radius.pill, paddingHorizontal: space.sm, paddingVertical: 2, alignSelf: 'flex-start' },
  badgeText: { fontWeight: '600' },
  iconBadge: { borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  listRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.md },
  listCard: { paddingVertical: space.xs },
  divider: { height: StyleSheet.hairlineWidth },
  tile: {
    flex: 1,
    alignItems: 'center',
    gap: space.sm,
    paddingVertical: space.md,
    paddingHorizontal: space.sm,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
  },
  empty: { alignItems: 'center', gap: space.md, paddingVertical: space.xxl, paddingHorizontal: space.lg },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.md, padding: space.xxl },
});
