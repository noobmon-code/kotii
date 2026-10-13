import * as Clipboard from 'expo-clipboard';
import { StyleSheet } from 'react-native';

import { telLink, whatsappLink } from '@/domain/providers';
import { openExternal } from '@/lib/openLink';
import { notify } from '@/ui/dialogs';
import { Button, IconButton, Row } from '@/ui/primitives';

async function openWhatsApp(link: string) {
  if (!(await openExternal(link))) notify('Não deu para abrir o WhatsApp', 'Copie o telefone e procure a conversa por ele.');
}

async function call(link: string) {
  if (!(await openExternal(link))) notify('Não deu para ligar', 'Este aparelho não faz ligações. Copie o telefone para ligar de outro.');
}

async function copyPhone(phone: string) {
  try {
    await Clipboard.setStringAsync(phone);
    notify('Telefone copiado', 'Cole no WhatsApp ou no telefone.');
  } catch {
    notify('Não deu para copiar', 'Selecione o telefone no campo e copie por lá.');
  }
}

/**
 * Atalhos da linha do prestador: WhatsApp e Ligar. Cada um só aparece quando
 * o telefone guardado serve para ele (`phone_digits`, ver domain/providers).
 */
export function ProviderQuickActions({ name, phoneDigits }: { name: string; phoneDigits: string | null }) {
  const whatsapp = whatsappLink(phoneDigits);
  const tel = telLink(phoneDigits);
  if (!whatsapp && !tel) return null;
  return (
    <Row>
      {whatsapp ? (
        <IconButton icon="whatsapp" color="primary" label={`Chamar ${name} no WhatsApp`} onPress={() => openWhatsApp(whatsapp)} />
      ) : null}
      {tel ? <IconButton icon="phone-outline" color="primary" label={`Ligar para ${name}`} onPress={() => call(tel)} /> : null}
    </Row>
  );
}

/** Os mesmos atalhos, com nome, na tela do prestador, mais o de copiar o telefone como foi digitado. */
export function ProviderContactButtons({ phone, phoneDigits }: { phone: string; phoneDigits: string | null }) {
  const whatsapp = whatsappLink(phoneDigits);
  const tel = telLink(phoneDigits);
  if (!phone.trim()) return null;
  return (
    <Row style={styles.wrap}>
      {whatsapp ? <Button title="WhatsApp" icon="whatsapp" variant="secondary" compact onPress={() => openWhatsApp(whatsapp)} /> : null}
      {tel ? <Button title="Ligar" icon="phone-outline" variant="secondary" compact onPress={() => call(tel)} /> : null}
      <Button title="Copiar telefone" icon="content-copy" variant="secondary" compact onPress={() => copyPhone(phone.trim())} />
    </Row>
  );
}

const styles = StyleSheet.create({
  wrap: { flexWrap: 'wrap' },
});
