import {
  INSTALL_ACTION,
  INSTALL_IOS_OK,
  INSTALL_IOS_SIGN_IN,
  INSTALL_IOS_STEPS,
  INSTALL_IOS_WHY,
  INSTALL_PROMPT_TEXT,
  INSTALL_SKIP,
  INSTALL_TITLE,
} from '@/domain/onboarding';
import { useInstallApp } from '@/lib/install';
import { ActionSheet } from '@/ui/ActionSheet';
import { Text } from '@/ui/primitives';

/** Se o passo de pôr o Kotii na tela de início vale aqui: no navegador, ainda fora da tela de início. */
export function useInstallStep(): boolean {
  return useInstallApp().mode !== 'hidden';
}

/**
 * Pôr o Kotii na tela de início, no fim do começo: no Android e no computador, "Instalar" num toque (o convite do
 * navegador); no iPhone, o passo a passo do Safari e o aviso de entrar de novo pelo ícone (o app da tela de início
 * não vê a conta aberta no Safari). "Agora não" não esconde o cartão de instalar da Hoje.
 */
export function InstallSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { mode, install } = useInstallApp();
  if (mode === 'hidden') return null;
  if (mode === 'prompt') {
    return (
      <ActionSheet
        visible={visible}
        title={INSTALL_TITLE}
        message={INSTALL_PROMPT_TEXT}
        actions={[{ label: INSTALL_ACTION, icon: 'download', onPress: () => void install() }]}
        cancelLabel={INSTALL_SKIP}
        onClose={onClose}
      />
    );
  }
  return (
    <ActionSheet visible={visible} title={INSTALL_TITLE} actions={[]} cancelLabel={INSTALL_IOS_OK} onClose={onClose}>
      <Text variant="body">{INSTALL_IOS_STEPS}</Text>
      <Text variant="body">{INSTALL_IOS_SIGN_IN}</Text>
      <Text variant="muted">{INSTALL_IOS_WHY}</Text>
    </ActionSheet>
  );
}
