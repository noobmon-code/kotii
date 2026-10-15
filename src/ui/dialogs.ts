import { Alert, Platform } from 'react-native';

// Alert do React Native não aparece na web; lá usamos os diálogos do navegador.

export function notify(title: string, message?: string) {
  if (Platform.OS === 'web') window.alert(message ? `${title}\n\n${message}` : title);
  else Alert.alert(title, message);
}

/**
 * O aviso que fala do que a tela mostra, chamado depois de o React desenhá-la: sai no quadro seguinte, que já a
 * mostra. Na web, só depois de esse quadro ser pintado: o alert trava a página como ela estava pintada, e o navegador
 * pode ainda não ter pintado o que o React acabou de desenhar.
 */
export function notifyAfterPaint(title: string, message?: string) {
  requestAnimationFrame(() => {
    if (Platform.OS === 'web') setTimeout(() => notify(title, message), 0);
    else notify(title, message);
  });
}

export function confirmAction(
  title: string,
  message: string,
  confirmLabel: string,
  onConfirm: () => void,
  destructive = true,
) {
  if (Platform.OS === 'web') {
    if (window.confirm(`${title}\n\n${message}`)) onConfirm();
    return;
  }
  Alert.alert(title, message, [
    { text: 'Cancelar', style: 'cancel' },
    { text: confirmLabel, style: destructive ? 'destructive' : 'default', onPress: onConfirm },
  ]);
}

/** Pergunta sim/não; resolve true para `yesLabel`. */
export function askYesNo(title: string, message: string, yesLabel: string, noLabel: string): Promise<boolean> {
  if (Platform.OS === 'web') return Promise.resolve(window.confirm(`${title}\n\n${message}`));
  return new Promise((resolve) => {
    Alert.alert(
      title,
      message,
      [
        { text: noLabel, style: 'cancel', onPress: () => resolve(false) },
        { text: yesLabel, onPress: () => resolve(true) },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    );
  });
}
