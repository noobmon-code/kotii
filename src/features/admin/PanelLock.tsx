import { APP_DASHBOARD_FORBIDDEN } from '@/domain/appDashboard';
import { goBackOr } from '@/lib/navigation';
import { Button, EmptyState } from '@/ui/primitives';

/**
 * O cadeado do Painel do app: o servidor recusou (42501) porque a pessoa não está em app_admins. O mesmo para os
 * números e para os recados.
 */
export function PanelLock() {
  return (
    <EmptyState
      icon="lock-outline"
      tint="purple"
      title={APP_DASHBOARD_FORBIDDEN}
      // Aberta pelo endereço, no navegador, não há para onde voltar: o começo do app abre a tela certa.
      action={<Button title="Voltar" variant="secondary" onPress={() => goBackOr('/')} />}
    />
  );
}
