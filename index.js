// Entrada do app ("main" no package.json), no lugar de `expo-router/entry`:
// https://docs.expo.dev/router/installation/#custom-entry-point-to-initialize-and-load-side-effects
// Só importa efeitos, na ordem; nada de componentes aqui.

// O `expo-router/entry` pede que este venha primeiro (Fast Refresh na web); segue valendo aqui.
import '@expo/metro-runtime';

// Antes do router: ele guarda o endereço da página ao carregar e depois o regrava. O link do e-mail
// de recuperação de senha (tokens no fragmento) é lido e tirado do endereço antes disso.
import './src/lib/recoveryLinkBoot';

// Por último, como a documentação pede: registra o app pelo Expo Router.
import 'expo-router/entry';
