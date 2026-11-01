import { Platform, StyleSheet, type ImageStyle, type ViewStyle } from 'react-native';

// Segurar um cartão no navegador do iPhone (o Safari e o app posto na tela de início): sobre uma imagem, o Safari
// abre o menu dela (salvar, copiar, pré-visualizar) e cancela o toque, então o onLongPress nunca chega; sobre o
// texto, começa a selecionar. Estes estilos, só na web e só em quem pede (os itens da lista de compras), tiram o
// menu e a seleção do cartão e fazem a imagem não receber o toque, que fica com o Pressable em volta. Não é uma
// regra global: as outras imagens do app continuam com o menu de sempre.
//
// Como chega ao DOM (react-native-web 0.21): uma chave de estilo que ele não conhece passa como está e vira a
// propriedade CSS (WebkitTouchCallout vira -webkit-touch-callout, que os filhos herdam); userSelect ganha o prefixo
// -webkit- sozinho; pointerEvents 'none' vale também para os filhos, e o expo-image põe o estilo na View em volta
// da <img> (o `draggable` vai para a própria <img>). No aparelho nada disso existe: as funções não devolvem nada.

const styles = StyleSheet.create({
  holdable: { WebkitTouchCallout: 'none', userSelect: 'none' } as unknown as ViewStyle,
  underHold: { pointerEvents: 'none' } as unknown as ImageStyle,
});

/** O estilo do cartão que se segura, na web: sem o menu do Safari e sem selecionar o texto. */
export function webHoldable(): ViewStyle | undefined {
  return Platform.OS === 'web' ? styles.holdable : undefined;
}

/** A imagem dentro desse cartão, na web: não recebe o toque nem se arrasta. No aparelho, nada muda. */
export function webImageUnderHold(): { style?: ImageStyle; draggable?: boolean } {
  return Platform.OS === 'web' ? { style: styles.underHold, draggable: false } : {};
}
