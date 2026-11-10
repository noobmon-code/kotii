import { AgendaPanel } from '@/features/AgendaPanel';
import { Screen } from '@/ui/primitives';

/**
 * A agenda numa tela própria, aberta pela pílula "Ver a agenda" do topo da tela Hoje (e pelo endereço /agenda). A
 * mesma agenda é a parte Agenda da aba Casa, onde também se cria compromisso pelo dia escolhido.
 */
export default function AgendaScreen() {
  return (
    <Screen edges={[]}>
      <AgendaPanel />
    </Screen>
  );
}
