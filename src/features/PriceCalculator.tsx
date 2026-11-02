import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Modal, Platform, Pressable, ScrollView, StyleSheet, View, type ColorValue } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  ADD_OPTION,
  addOption,
  CALCULATOR_INTRO,
  CALCULATOR_UNITS,
  canRemoveOption,
  CHEAPEST_BADGE,
  CLEAR_CALCULATOR,
  CLOSE_CALCULATOR,
  comparePrices,
  initialOptions,
  MAX_OPTIONS,
  optionHint,
  optionLabel,
  optionLine,
  PRICE_CALCULATOR_LABEL,
  PRICE_FIELD,
  PRICE_PLACEHOLDER,
  priceFieldSpoken,
  QUANTITY_FIELD,
  QUANTITY_PLACEHOLDER,
  quantityFieldSpoken,
  removeOption,
  removeOptionSpoken,
  unitChipSpoken,
  unitGroupSpoken,
  type CalcOption,
} from '@/domain/priceCalculator';
import type { Unit } from '@/lib/types';
import { Backdrop } from '@/ui/Backdrop';
import { Badge, Button, Card, IconButton, Row, Text, TextField } from '@/ui/primitives';
import { MAX_WIDTH, radius, space, useColors } from '@/ui/theme';

/** A pausa na digitação antes de o leitor de tela falar o resultado novo. */
export const ANNOUNCE_DELAY_MS = 1000;

/** O ícone no canto de cima à direita da lista (headerRight). O toque tem 44. */
export function PriceCalculatorButton({ onPress, tintColor }: { onPress: () => void; tintColor?: ColorValue }) {
  const c = useColors();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={PRICE_CALCULATOR_LABEL}
      onPress={onPress}
      style={({ pressed }) => [styles.headerButton, pressed && styles.pressed]}>
      <MaterialCommunityIcons name="calculator-variant-outline" size={24} color={tintColor ?? c.primary} />
    </Pressable>
  );
}

/**
 * Comparar embalagens na gôndola: o preço por kg, litro ou unidade de cada
 * opção, a mais barata em destaque. As regras e as frases são de
 * domain/priceCalculator. Nada é guardado: renderize só quando aberta, e
 * fechar esquece o que foi digitado.
 */
export function PriceCalculator({ onClose }: { onClose: () => void }) {
  const c = useColors();
  const [options, setOptions] = useState<CalcOption[]>(initialOptions);
  const result = comparePrices(options);
  const announcement = result.announcement;
  const highlighted = new Set(result.cheapest);

  // O que o leitor de tela fala sozinho só muda depois de uma pausa na digitação, para não falar a cada número (o
  // texto na tela muda na hora). No Android quem fala é o próprio cartão do resultado, região viva com esse rótulo (um
  // elemento só: o leitor não passa duas vezes pelo resultado); no navegador, uma região viva escondida; o iPhone não
  // tem região viva, e quem fala é o announceForAccessibility.
  const [spoken, setSpoken] = useState(announcement);
  useEffect(() => {
    if (announcement === spoken) return;
    const timer = setTimeout(() => setSpoken(announcement), ANNOUNCE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [announcement, spoken]);
  // Ao abrir, o resultado ainda é o pedido de preencher: não há o que anunciar.
  const opened = useRef<string | null>(spoken);
  useEffect(() => {
    if (Platform.OS !== 'ios' || spoken === opened.current) return;
    opened.current = null;
    AccessibilityInfo.announceForAccessibility(spoken);
  }, [spoken]);

  const change = (index: number, patch: Partial<CalcOption>) =>
    setOptions((prev) => prev.map((option, i) => (i === index ? { ...option, ...patch } : option)));

  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={[styles.flex, { backgroundColor: c.background }]}>
        <Backdrop />
        {/* O teclado numérico do iPhone não tem tecla para fechar: arrastar fecha, e a lista sobe acima dele. */}
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          automaticallyAdjustKeyboardInsets>
          <Row>
            <Text variant="heading" accessibilityRole="header" style={styles.flex}>
              {PRICE_CALCULATOR_LABEL}
            </Text>
            <IconButton icon="close" label={CLOSE_CALCULATOR} onPress={onClose} />
          </Row>
          <Text variant="muted">{CALCULATOR_INTRO}</Text>

          {options.map((option, index) => {
            const label = optionLabel(index);
            const cheapest = highlighted.has(index);
            const line = optionLine(option, index);
            const hint = optionHint(option, index);
            return (
              <Card
                key={index}
                style={[styles.gap, cheapest && { borderWidth: 2, borderColor: c.primary, borderTopColor: c.primary, borderLeftColor: c.primary }]}>
                <Row>
                  <Text variant="label" style={styles.flex}>
                    {label}
                  </Text>
                  {cheapest ? <Badge label={CHEAPEST_BADGE} tone="primary" /> : null}
                  {canRemoveOption(index) ? (
                    <IconButton
                      icon="trash-can-outline"
                      label={removeOptionSpoken(index)}
                      onPress={() => setOptions((prev) => removeOption(prev, index))}
                    />
                  ) : null}
                </Row>
                {/* Quanto mais barata, junto do destaque: o resultado, no fim, fica embaixo do teclado enquanto se digita. */}
                {result.cheapestSentences[index] ? <Text variant="body">{result.cheapestSentences[index]}</Text> : null}
                <Row style={styles.fields}>
                  <View style={styles.flex}>
                    <TextField
                      label={PRICE_FIELD}
                      accessibilityLabel={priceFieldSpoken(index)}
                      value={option.price}
                      onChangeText={(price) => change(index, { price })}
                      placeholder={PRICE_PLACEHOLDER}
                      keyboardType="decimal-pad"
                      hint={hint?.field === 'price' ? hint.text : undefined}
                      accessibilityHint={hint?.field === 'price' ? hint.text : undefined}
                      hintColor="danger"
                    />
                  </View>
                  <View style={styles.flex}>
                    <TextField
                      label={QUANTITY_FIELD}
                      accessibilityLabel={quantityFieldSpoken(index)}
                      value={option.quantity}
                      onChangeText={(quantity) => change(index, { quantity })}
                      placeholder={QUANTITY_PLACEHOLDER}
                      keyboardType="decimal-pad"
                      hint={hint?.field === 'quantity' ? hint.text : undefined}
                      accessibilityHint={hint?.field === 'quantity' ? hint.text : undefined}
                      hintColor="danger"
                    />
                  </View>
                </Row>
                <View style={styles.units} accessibilityRole="radiogroup" accessibilityLabel={unitGroupSpoken(index)}>
                  {CALCULATOR_UNITS.map((unit) => (
                    <UnitChip
                      key={unit}
                      unit={unit}
                      selected={option.unit === unit}
                      index={index}
                      onPress={() => change(index, { unit })}
                    />
                  ))}
                </View>
                {line ? (
                  <Text variant={cheapest ? 'label' : 'muted'} color={cheapest ? 'primary' : undefined}>
                    {line}
                  </Text>
                ) : null}
              </Card>
            );
          })}

          {options.length < MAX_OPTIONS ? (
            <Button title={ADD_OPTION} icon="plus" variant="secondary" compact style={styles.touch} onPress={() => setOptions(addOption)} />
          ) : null}

          {/* O resultado muda enquanto a pessoa digita. No celular é um elemento só: no iPhone, com o texto de agora;
              no Android é a região viva, com o rótulo depois da pausa. No navegador não é região viva, e o leitor lê
              os textos dele. */}
          <Card style={styles.gap}>
            <View
              accessible={Platform.OS !== 'web'}
              accessibilityLabel={Platform.OS === 'web' ? undefined : Platform.OS === 'android' ? spoken : announcement}
              aria-live={Platform.OS === 'android' ? 'polite' : undefined}
              style={styles.gap}>
              {result.sentences.map((sentence) => (
                <Text key={sentence} variant="body">
                  {sentence}
                </Text>
              ))}
              {result.ranking.map((row) => (
                <Text key={row.index} variant={highlighted.has(row.index) ? 'label' : 'muted'}>
                  {row.text}
                </Text>
              ))}
            </View>
            {/* No navegador quem fala sozinho, depois da pausa, é uma região viva escondida, pelo texto. */}
            {Platform.OS === 'web' ? (
              <View aria-live="polite" style={styles.visuallyHidden}>
                <Text>{spoken}</Text>
              </View>
            ) : null}
          </Card>

          <Button title={CLEAR_CALCULATOR} variant="ghost" icon="eraser" onPress={() => setOptions(initialOptions())} />
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

/** O chip da unidade, com o toque de 44 (o Chip do app é mais baixo). */
function UnitChip({ unit, selected, index, onPress }: { unit: Unit; selected: boolean; index: number; onPress: () => void }) {
  const c = useColors();
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      accessibilityLabel={unitChipSpoken(unit, index)}
      onPress={onPress}
      style={[
        styles.unit,
        { backgroundColor: selected ? c.primary : c.glassStrong, borderColor: selected ? c.primary : c.border },
      ]}>
      <Text variant="label" color={selected ? 'onPrimary' : 'text'}>
        {unit}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  gap: { gap: space.sm },
  content: { width: '100%', maxWidth: MAX_WIDTH, alignSelf: 'center', padding: space.lg, gap: space.lg },
  fields: { alignItems: 'flex-start' },
  units: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  unit: {
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingHorizontal: space.md,
  },
  touch: { minHeight: 44 },
  // Fora da vista, mas lido pelo leitor de tela do navegador.
  visuallyHidden: { position: 'absolute', width: 1, height: 1, margin: -1, overflow: 'hidden' },
  headerButton: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  pressed: { opacity: 0.6 },
});
