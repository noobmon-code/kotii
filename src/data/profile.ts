// O perfil da pessoa (domain/profile): a linha dela em profiles (só ela lê) e o salvar pela save_my_profile,
// que grava a linha e troca o nome em todas as casas dela numa chamada só. O app pode chegar antes da
// migração: sem a tabela, a leitura responde `available: false` e a tela mostra só o nome, com um aviso.
//
// Data de nascimento e telefone são só da pessoa: nada daqui vai para o resumo do Nuke, para o consultor ou
// para o cache guardado no aparelho (a chave 'profile' fica fora de PERSISTED, em lib/queryClient).

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { PROFILE_NOT_READY, profileErrorMessage, type ProfileValues } from '@/domain/profile';
import { useAuth, type HouseholdState } from '@/lib/auth';
import { errorMessage, supabase } from '@/lib/supabase';
import { notify } from '@/ui/dialogs';

import { isMissingFunction, isMissingTable } from './missingSchema';

/** A linha da pessoa em profiles. */
export interface MyProfile {
  birth_date: string | null;
  phone: string | null;
}

/** null em `profile`: a pessoa ainda não salvou nada. */
export type ProfileRead = { available: false } | { available: true; profile: MyProfile | null };

export const profileQueryKey = (userId: string | undefined) => ['profile', userId] as const;

export async function fetchMyProfile(userId: string): Promise<ProfileRead> {
  const { data, error } = await supabase.from('profiles').select('birth_date, phone').eq('user_id', userId).maybeSingle();
  if (error && isMissingTable(error, 'profiles')) return { available: false };
  if (error) throw error;
  return { available: true, profile: (data as MyProfile | null) ?? null };
}

export function useMyProfile() {
  const { session } = useAuth();
  const userId = session?.user.id;
  return useQuery({
    queryKey: profileQueryKey(userId),
    enabled: Boolean(userId),
    queryFn: () => fetchMyProfile(userId!),
  });
}

/** O que a save_my_profile devolve: o que ficou gravado. */
interface SavedProfile {
  name: string;
  birth_date: string | null;
  phone: string | null;
}

/** A frase de um erro ao salvar: as recusas do banco com as palavras da tela; sem a função, o aviso de ativação. */
export function saveProfileErrorMessage(error: unknown): string {
  if (isMissingFunction(error, 'save_my_profile') || isMissingTable(error, 'profiles')) return PROFILE_NOT_READY;
  const code = error && typeof error === 'object' ? (error as { code?: unknown }).code : undefined;
  return profileErrorMessage(code) ?? errorMessage(error);
}

/**
 * Salva o perfil: uma chamada. Depois, o nome novo entra já nas cópias que o mostram (a casa e os moradores,
 * na consulta da casa) e o perfil, na dele; só então elas são buscadas de novo.
 */
export function useSaveProfile() {
  const { session } = useAuth();
  const userId = session?.user.id;
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (values: ProfileValues): Promise<SavedProfile> => {
      const { data, error } = await supabase.rpc('save_my_profile', {
        p_name: values.name,
        p_birth_date: values.birthDate,
        p_phone: values.phone,
      });
      if (error) throw new Error(saveProfileErrorMessage(error));
      const saved = data as Partial<SavedProfile> | null;
      return {
        name: saved?.name ?? values.name,
        birth_date: saved?.birth_date ?? null,
        phone: saved?.phone ?? null,
      };
    },
    onSuccess: (saved) => {
      const read: ProfileRead = { available: true, profile: { birth_date: saved.birth_date, phone: saved.phone } };
      queryClient.setQueryData(profileQueryKey(userId), read);
      queryClient.setQueryData<HouseholdState | null>(['household', userId], (state) => (state ? renamed(state, userId, saved.name) : state));
      // Sem esperar: o perfil já está salvo, e a tela não fica presa a uma busca que demora.
      void queryClient.invalidateQueries({ queryKey: ['household'] });
      void queryClient.invalidateQueries({ queryKey: profileQueryKey(userId) });
    },
    // No hook: o aviso sai mesmo se a pessoa já fechou a tela.
    onError: (err) => {
      notify('Não deu para salvar o perfil', errorMessage(err));
    },
  });
}

/** A casa com o nome novo da pessoa: nela (`me`) e na lista de moradores. */
export function renamed(state: HouseholdState, userId: string | undefined, name: string): HouseholdState {
  if (!userId) return state;
  const rename = <M extends { user_id: string; display_name: string }>(m: M): M =>
    m.user_id === userId ? { ...m, display_name: name } : m;
  return { ...state, me: rename(state.me), members: state.members.map(rename) };
}
