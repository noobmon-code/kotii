import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { Image } from 'expo-image';
import { Children, Fragment, isValidElement, useState, type ReactNode, type RefObject } from 'react';
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
  useColorScheme,
} from 'react-native';
import { SafeAreaView, type Edge } from 'react-native-safe-area-context';

import { getCategory, type IconName } from '@/domain/categories';
import { formatBRDate, maskBRDate, parseBRDate } from '@/domain/dates';
import { matchItemArt } from '@/domain/itemArt';
import { Backdrop } from './Backdrop';
import { CATEGORY_ART } from './categoryArt';
import { GradientFill } from './gradient';
import { ITEM_ART } from './itemArt';
import { Orb } from './Orb';
import { fonts, MAX_WIDTH, radius, shadows, space, useColors, useGlow, useScheme, useTint, withAlpha, type Colors, type Tint } from './theme';

export type { IconName };

// ---------------------------------------------------------------------------
// Texto

type TextVariant = 'display' | 'title' | 'heading' | 'body' | 'rowTitle' | 'label' | 'muted' | 'small';

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
  rowTitle: { fontFamily: fonts.bold, fontSize: 16, lineHeight: 22 },
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
  scrollRef,
}: {
  children: ReactNode;
  scroll?: boolean;
  refreshing?: boolean;
  onRefresh?: () => void;
  edges?: Edge[];
  footer?: ReactNode;
  /** Tela com o botão do Nuke por cima: sobra espaço no fim para ele não cobrir nada. */
  fab?: boolean;
  /**
   * Para a tela rolar sozinha até um ponto: abrir já numa parte dela (o `y` de um filho direto, em onLayout, é a
   * posição a rolar) ou voltar ao começo de uma lista que acabou de mudar.
   */
  scrollRef?: RefObject<ScrollView | null>;
}) {
  const c = useColors();
  // Sem a rolagem da tela, o conteúdo ocupa só a altura dela (flex 1, e não só flexGrow): no navegador, com o
  // flexShrink 0 e a base auto do react-native-web, ele cresceria até a altura da lista que tem dentro, e a lista
  // (que rola sozinha) não teria uma altura para rolar.
  const content = <View style={[styles.content, !scroll && styles.flex, fab && styles.contentWithFab]}>{children}</View>;
  return (
    <SafeAreaView edges={edges} style={[styles.screen, { backgroundColor: c.background }]}>
      <Backdrop />
      {scroll ? (
        <ScrollView
          ref={scrollRef}
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
          {/* O divisor começa onde o texto começa: depois do ícone da linha, quando ela tem um. */}
          {index > 0 ? (
            <View
              style={[
                styles.divider,
                { backgroundColor: c.hairline },
                isValidElement<{ left?: ReactNode }>(row) && row.props.left ? styles.dividerInset : null,
              ]}
            />
          ) : null}
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
        <Text variant="label" style={[styles.sectionTitle, styles.flex]} accessibilityRole="header">
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
  accessibilityLabel,
}: {
  title: string;
  onPress: () => void;
  variant?: ButtonVariant;
  icon?: IconName;
  loading?: boolean;
  disabled?: boolean;
  compact?: boolean;
  style?: StyleProp<ViewStyle>;
  /** O que o leitor de tela diz no lugar do título, quando o título sozinho não basta ("Troquei" em cada linha de uma lista, vários "Juntar" na mesma tela). */
  accessibilityLabel?: string;
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
      accessibilityLabel={accessibilityLabel}
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
        { borderColor: checked ? c.primary : withAlpha(c.textMuted, 0.5), backgroundColor: checked ? c.primary : 'transparent' },
      ]}>
      {checked ? <Icon name="check" size={16} color="onPrimary" /> : null}
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// Formulário

export function TextField({
  label,
  hint,
  hintColor,
  style,
  ...props
}: TextInputProps & { label?: string; hint?: string; hintColor?: keyof Colors }) {
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
      {hint ? (
        <Text variant="small" color={hintColor}>
          {hint}
        </Text>
      ) : null}
    </View>
  );
}

interface DateFieldProps {
  value?: string;
  onChangeText: (text: string) => void;
  label?: string;
  hint?: string;
  /** Sem data (ex.: "Não vence"); no navegador aparece embaixo, com o campo vazio. */
  placeholder?: string;
  onBlur?: () => void;
  onSubmitEditing?: () => void;
  accessibilityLabel?: string;
  autoFocus?: boolean;
}

/**
 * Campo de data dd/mm/aaaa. O valor é sempre o texto dd/mm/aaaa (ou vazio);
 * quem salva converte com parseBRDate.
 * - No app: barras que aparecem sozinhas enquanto digita (maskBRDate). No
 *   iPhone o teclado tem números e barra; no Android, o numérico não tem
 *   barra, mas a máscara completa o zero quando dá.
 * - No navegador: o campo de data do próprio navegador, com as barras já no
 *   lugar (no celular, abre o calendário). Uma máscara que reescreve o texto
 *   se perde com teclados que compõem o texto antes de entregar.
 */
export function DateField({ value = '', onChangeText, onBlur, onSubmitEditing, placeholder, ...props }: DateFieldProps) {
  if (Platform.OS === 'web') {
    return (
      <WebDateField
        value={value}
        onChangeText={onChangeText}
        onBlur={onBlur}
        onSubmitEditing={onSubmitEditing}
        placeholder={placeholder}
        {...props}
      />
    );
  }
  return (
    <TextField
      placeholder={placeholder ?? 'dd/mm/aaaa'}
      keyboardType={Platform.OS === 'ios' ? 'numbers-and-punctuation' : 'number-pad'}
      maxLength={10}
      autoCorrect={false}
      {...props}
      value={value}
      onBlur={onBlur ? () => onBlur() : undefined}
      onSubmitEditing={onSubmitEditing ? () => onSubmitEditing() : undefined}
      onChangeText={(text) => onChangeText(maskBRDate(text, value))}
    />
  );
}

function WebDateField({
  value = '',
  onChangeText,
  label,
  hint,
  placeholder,
  onBlur,
  onSubmitEditing,
  accessibilityLabel,
  autoFocus,
}: DateFieldProps) {
  const c = useColors();
  const dark = useColorScheme() === 'dark';
  // O navegador fala AAAA-MM-DD. O campo mostra o que o navegador informou,
  // sem ida e volta pelo texto dd/mm/aaaa: no meio da digitação o ano passa
  // por 0002, 0020… e reescrever o campo apagaria tudo. Só uma data vinda de
  // fora (ex.: o boleto preenche o vencimento) substitui o que está nele.
  const [iso, setIso] = useState(() => parseBRDate(value) ?? '');
  const [emitted, setEmitted] = useState(value);
  if (value !== emitted) {
    setEmitted(value);
    setIso(parseBRDate(value) ?? '');
  }
  const change = (next: string) => {
    const text = next ? formatBRDate(next) : '';
    setIso(next);
    setEmitted(text);
    onChangeText(text);
  };
  return (
    <View style={styles.field}>
      {label ? <Text variant="label">{label}</Text> : placeholder ? <Text variant="small">{placeholder}</Text> : null}
      <input
        type="date"
        value={iso}
        autoFocus={autoFocus}
        min="1900-01-01"
        max="2100-12-31"
        aria-label={accessibilityLabel ?? label ?? placeholder}
        onChange={(event) => change(event.target.value)}
        onBlur={() => onBlur?.()}
        onKeyDown={(event) => {
          if (event.key === 'Enter') onSubmitEditing?.();
        }}
        style={{
          boxSizing: 'border-box',
          width: '100%',
          minHeight: 52,
          borderRadius: radius.md,
          borderWidth: 1.5,
          borderStyle: 'solid',
          borderColor: c.border,
          backgroundColor: c.glassStrong,
          color: c.text,
          paddingLeft: space.lg,
          paddingRight: space.lg,
          fontSize: 16,
          fontFamily: fonts.regular,
          // Calendário e ícone no tema do app.
          colorScheme: dark ? 'dark' : 'light',
        }}
      />
      {hint ? <Text variant="small">{hint}</Text> : label && placeholder && !iso ? <Text variant="small">{placeholder}</Text> : null}
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
  // O item aberto é um cartão branco; à noite, um cinza um pouco mais claro que o fundo.
  const selectedBg = useScheme() === 'dark' ? c.surfaceAlt : c.surface;
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
            style={[styles.segment, selected && { backgroundColor: selectedBg }, selected && styles.segmentSelected]}>
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
  accessibilityLabel,
}: {
  label: string;
  selected?: boolean;
  onPress?: () => void;
  icon?: IconName;
  /** O que o leitor de tela diz do selo; sem ele, lê o rótulo. Para o selo que tira um filtro dizer que tira. */
  accessibilityLabel?: string;
}) {
  const c = useColors();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={accessibilityLabel}
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

export function IconBadge({ icon, tone = 'neutral', size = 44 }: { icon: IconName; tone?: Tone; size?: number }) {
  const c = useColors();
  const glows = {
    neutral: useGlow('orange'),
    primary: useGlow('blue'),
    danger: useGlow('pink'),
    warning: useGlow('yellow'),
    info: useGlow('purple'),
  };
  const fg: Record<Tone, keyof Colors> = {
    neutral: 'text',
    primary: 'primary',
    danger: 'danger',
    warning: 'warning',
    info: 'info',
  };
  return (
    <Orb size={size} glow={tone === 'neutral' ? c.border : glows[tone]}>
      <Icon name={icon} size={Math.round(size * 0.5)} color={fg[tone]} />
    </Orb>
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
  const glow = useGlow(art.tint);
  const itemKey = name ? matchItemArt(name, category) : null;
  // Na orbe o desenho fica um pouco menor que ela, para o vidro aparecer em volta.
  const imageSize = backdrop ? Math.round(size * 0.8) : size;
  const image = (
    <Image
      source={itemKey ? ITEM_ART[itemKey] : art.image}
      style={{ width: imageSize, height: imageSize, opacity: dimmed ? 0.45 : 1 }}
      contentFit="contain"
      accessible={false}
    />
  );
  if (!backdrop) return image;
  return (
    <Orb size={size} glow={glow}>
      {image}
    </Orb>
  );
}

/**
 * Linha de lista. `expanded` (true ou false) é para a linha que abre e fecha
 * um conteúdo logo abaixo: o leitor de tela anuncia um botão e se está aberto.
 */
export function ListRow({
  left,
  title,
  subtitle,
  right,
  onPress,
  onLongPress,
  dimmed,
  accessibilityLabel,
  expanded,
}: {
  left?: ReactNode;
  title: string;
  subtitle?: ReactNode;
  right?: ReactNode;
  onPress?: () => void;
  onLongPress?: () => void;
  dimmed?: boolean;
  /** O que o leitor de tela diz da linha inteira; sem ele, lê os textos na ordem em que aparecem. */
  accessibilityLabel?: string;
  expanded?: boolean;
}) {
  const c = useColors();
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole={expanded === undefined ? undefined : 'button'}
      aria-expanded={expanded}
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
        <Text variant="rowTitle" numberOfLines={2} style={dimmed && styles.strike}>
          {title}
        </Text>
        {typeof subtitle === 'string' ? <Text variant="muted">{subtitle}</Text> : subtitle}
      </View>
      {right}
    </Pressable>
  );
}

/**
 * Atalho de vidro com um ícone numa orbe e o rótulo embaixo (ações rápidas). A
 * cor aparece como um brilho no canto de cima, não como fundo.
 */
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
  const glow = useGlow(tint);
  const dark = useScheme() === 'dark';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [styles.tile, glass, pressed && styles.pressed]}>
      <View style={styles.tileWash} pointerEvents="none">
        <GradientFill from={glow} to={glow} fromOpacity={dark ? 0.28 : 0.5} toOpacity={0} />
      </View>
      <Orb size={48} glow={glow}>
        <MaterialCommunityIcons name={icon} size={24} color={t.art} />
      </Orb>
      <Text variant="label" style={styles.tileLabel} numberOfLines={2}>
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
}: {
  icon: IconName;
  title: string;
  message?: string;
  action?: ReactNode;
  tint?: Tint;
}) {
  const t = useTint(tint);
  const glow = useGlow(tint);
  return (
    <View style={styles.empty}>
      <View accessibilityLabel={title}>
        <Orb size={104} glow={glow}>
          <MaterialCommunityIcons name={icon} size={46} color={t.art} />
        </Orb>
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
  card: { borderRadius: radius.lg, borderCurve: 'continuous', padding: space.lg + 2 },
  pressed: { transform: [{ scale: 0.97 }] },
  section: { gap: space.sm },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.xs },
  sectionTitle: { fontFamily: fonts.heavy, fontSize: 13, lineHeight: 18 },
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
    shadowColor: '#784028',
    shadowOpacity: 0.1,
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
  listRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: 10, borderRadius: radius.sm },
  listCard: { paddingVertical: 6, paddingHorizontal: space.lg },
  divider: { height: 1 },
  // Ícone de 44 + o espaço entre ele e o texto: o divisor começa onde o texto começa.
  dividerInset: { marginLeft: 44 + space.md },
  tile: {
    flex: 1,
    alignItems: 'center',
    gap: 10,
    paddingTop: space.lg,
    paddingBottom: space.md,
    paddingHorizontal: space.sm,
    borderRadius: radius.tile,
    borderCurve: 'continuous',
    borderWidth: 1,
    overflow: 'hidden',
  },
  tileWash: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 },
  tileLabel: { textAlign: 'center', fontFamily: fonts.heavy, fontSize: 14, lineHeight: 18 },
  empty: { alignItems: 'center', gap: space.md, paddingVertical: space.xl, paddingHorizontal: space.lg },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.md, padding: space.xxl },
});
