// O título da tela Hoje: "Boa noite," numa linha e o nome na de baixo, cada um numa linha só. O nome inteiro se couber
// ao lado do desenho do clima (encolhendo até 26); senão o primeiro nome, encolhendo até 22 (a conta da largura está em
// domain/greeting). A largura é a do próprio título, medida; antes da primeira medida, a conta pela janela.

import { useState } from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';

import { fitSize, greeting, greetingName } from '@/domain/greeting';
import { skyTextWidth } from '@/features/SkyHeader';
import { Text } from '@/ui/primitives';
import { fonts } from '@/ui/theme';

const SIZE = 30;
const MIN_SIZE = 22;
const LINE_RATIO = 35 / 30;
const LETTER_SPACING = -0.3;

export function TodayGreeting({ now, displayName }: { now: Date; displayName: string }) {
  const { width, fontScale } = useWindowDimensions();
  const [measured, setMeasured] = useState<number | null>(null);
  const hello = greeting(now);
  const full = displayName.trim().replace(/\s+/g, ' ');
  // Com a letra do sistema maior, o texto cresce na mesma proporção: a conta é feita como se a largura fosse menor.
  const available = (measured ?? skyTextWidth(width)) / (fontScale || 1);
  const name = greetingName(full, available, { size: SIZE, min: MIN_SIZE, letterSpacing: LETTER_SPACING });
  // "Boa tarde," também cabe numa linha (tela estreita ou letra do sistema grande).
  const helloSize = fitSize(`${hello},`, available, SIZE, MIN_SIZE, LETTER_SPACING) ?? MIN_SIZE;
  return (
    // O leitor de tela lê o título uma vez, com o nome inteiro, mesmo quando a tela mostra só o primeiro.
    <View
      accessible
      accessibilityRole="header"
      accessibilityLabel={full ? `${hello}, ${full}` : hello}
      onLayout={(e) => setMeasured(e.nativeEvent.layout.width)}>
      <Text
        testID="today-greeting-hello"
        numberOfLines={1}
        style={[styles.greeting, { fontSize: helloSize, lineHeight: Math.round(helloSize * LINE_RATIO) }]}>
        {hello},
      </Text>
      {name.text ? (
        <Text
          testID="today-greeting-name"
          numberOfLines={1}
          style={[styles.greeting, { fontSize: name.fontSize, lineHeight: Math.round(name.fontSize * LINE_RATIO) }]}>
          {name.text}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  greeting: { fontFamily: fonts.heavy, fontSize: SIZE, lineHeight: 35, letterSpacing: LETTER_SPACING },
});
