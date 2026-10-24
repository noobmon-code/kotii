// Abre um link fora do app: a conversa no WhatsApp (https://wa.me/…), o
// discador do telefone (tel:…) ou um e-mail pronto (mailto:…).

import * as Linking from 'expo-linking';
import { Platform } from 'react-native';

/**
 * Abre o link com o app que cuida dele e devolve false se não deu (aparelho
 * que não faz ligação, por exemplo). Sem `canOpenURL` antes: para `tel:` ele
 * só responde com o esquema declarado no iOS (LSApplicationQueriesSchemes) e
 * a consulta no manifesto do Android; o `openURL` já rejeita quando ninguém
 * abre o link.
 *
 * No navegador, o `openURL` do expo-linking troca o endereço da própria aba:
 * o Kotii sairia da tela para dar lugar ao WhatsApp. Por isso o link https
 * abre em outra aba, e o `mailto:` também (com um serviço de e-mail da web,
 * como o Gmail, cuidando do mailto, o e-mail tomaria a aba do app); o `tel:`
 * segue pelo `openURL`, que só chama o discador.
 */
export async function openExternal(url: string): Promise<boolean> {
  try {
    if (Platform.OS === 'web' && /^(https?|mailto):/i.test(url)) {
      window.open(url, '_blank', 'noopener,noreferrer');
      return true;
    }
    await Linking.openURL(url);
    return true;
  } catch {
    return false;
  }
}
