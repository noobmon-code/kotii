import { router } from 'expo-router';
import { useState } from 'react';

import { ActionSheet } from '@/ui/ActionSheet';
import { Button, type IconName } from '@/ui/primitives';

/** O que se cria pela Saúde. */
export type HealthNew = 'remedio' | 'consulta' | 'vacina' | 'exame';

const OPTIONS: Record<HealthNew, { label: string; icon: IconName; open: (pessoa: string | undefined) => void }> = {
  remedio: {
    label: 'Remédio',
    icon: 'pill',
    open: (pessoa) => router.push({ pathname: '/remedio/[id]', params: { id: 'novo', ...(pessoa === undefined ? {} : { pessoa }) } }),
  },
  consulta: {
    label: 'Consulta',
    icon: 'stethoscope',
    open: (pessoa) => router.push({ pathname: '/consulta/[id]', params: { id: 'nova', ...(pessoa === undefined ? {} : { pessoa }) } }),
  },
  vacina: {
    label: 'Vacina',
    icon: 'needle',
    open: (pessoa) => router.push({ pathname: '/vacina/[id]', params: { id: 'nova', ...(pessoa === undefined ? {} : { pessoa }) } }),
  },
  exame: {
    label: 'Exame',
    icon: 'test-tube',
    open: (pessoa) => router.push({ pathname: '/exame/[id]', params: { id: 'nova', ...(pessoa === undefined ? {} : { pessoa }) } }),
  },
};

/** "remédio, consulta, vacina ou exame": o que o botão cria, para o leitor de tela. */
const spoken = (kinds: HealthNew[]) => {
  const names = kinds.map((kind) => OPTIONS[kind].label.toLowerCase());
  return names.length > 1 ? `${names.slice(0, -1).join(', ')} ou ${names[names.length - 1]}` : names.join('');
};

/**
 * A ação principal das partes da Saúde que criam mais de uma coisa do mesmo peso (Resumo: remédio, consulta, vacina e
 * exame; Cuidados: consulta, vacina e exame): um botão primário no alto, "Adicionar", que pergunta o quê num menu de
 * baixo para cima. É o padrão de criar de todas as partes (um botão primário no alto; azulejo só na tela Hoje), sem
 * quatro botões disputando o alto da tela. O menu abre a tela nova só depois de fechar (no iPhone, ActionSheet).
 * `personId`: a pessoa escolhida no filtro, com quem o registro já nasce (undefined: o formulário pergunta; '' é
 * "Todos", como o ?pessoa= vazio).
 */
export function HealthAddButton({ kinds, personId, personName }: { kinds: HealthNew[]; personId?: string; personName?: string | null }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button title="Adicionar" icon="plus" accessibilityLabel={`Adicionar ${spoken(kinds)}`} onPress={() => setOpen(true)} />
      <ActionSheet
        visible={open}
        title="Adicionar"
        message={personName ? `Para ${personName}.` : undefined}
        actions={kinds.map((kind) => ({ label: OPTIONS[kind].label, icon: OPTIONS[kind].icon, onPress: () => OPTIONS[kind].open(personId) }))}
        onClose={() => setOpen(false)}
      />
    </>
  );
}
