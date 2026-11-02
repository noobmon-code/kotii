// Onde fica a casa: a busca do bairro pelo CEP ou pela localização do celular, a mesma na tela do clima (que salva
// na hora) e ao criar uma casa (que guarda o lugar achado e só o salva depois de a casa existir). Textos e a regra
// do toque de criar em domain/housePlace.

import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Platform, StyleSheet, View } from 'react-native';

import { findPlaceByCep, findPlaceByDevice, type HouseholdLocation } from '@/data/weather';
import {
  CEP_INCOMPLETE,
  CEP_INCOMPLETE_TITLE,
  CEP_LOOKUP_FAILED_TITLE,
  cepFieldLabel,
  cepIncompleteOnCreate,
  cepLookupFailedMessage,
  cepUnreachableMessage,
  HOUSE_PLACE_CREATE_INTRO,
  HOUSE_PLACE_OPTIONAL,
  HOUSE_PLACE_PRIVACY,
  HOUSE_PLACE_REMOVE,
  PLACE_SEARCH_FAILED_TITLE,
  placeFoundAnnouncement,
  placeOnCreate,
  placeSourceLabel,
} from '@/domain/housePlace';
import { maskCep, normalizeCep } from '@/domain/weather';
import { isNetworkFailure } from '@/lib/networkErrors';
import { errorMessage } from '@/lib/supabase';
import { notify } from '@/ui/dialogs';
import { Button, Text, TextField } from '@/ui/primitives';
import { space } from '@/ui/theme';

type Source = HouseholdLocation['source'];

export interface PlaceSearch {
  /** O CEP do campo, com a máscara. */
  cep: string;
  setCep: (text: string) => void;
  /** A busca em andamento (pelo CEP ou pela localização), ou nenhuma. */
  searching: Source | null;
  find: (source: Source) => Promise<void>;
}

/**
 * A busca do bairro. `onFound` recebe o lugar achado (a tela do clima salva; quem cria a casa guarda); se ela falhar,
 * o aviso é o mesmo de uma busca que falhou e o CEP fica no campo. `shown` (quem cria a casa) diz se a busca ainda é
 * da tela à vista: quando não é mais, a falha não avisa nada.
 */
export function usePlaceSearch(onFound: (place: HouseholdLocation) => unknown, shown: () => boolean = () => true): PlaceSearch {
  const [cep, setCep] = useState('');
  const [searching, setSearching] = useState<Source | null>(null);

  async function find(source: Source) {
    const digits = normalizeCep(cep);
    if (source === 'cep' && !digits) {
      notify(CEP_INCOMPLETE_TITLE, CEP_INCOMPLETE);
      return;
    }
    setSearching(source);
    try {
      const found = source === 'cep' ? await findPlaceByCep(digits!) : await findPlaceByDevice();
      await onFound(found);
      // O campo fica travado durante a busca, então o que se apaga é o que havia antes dela (pela localização também:
      // um CEP deixado ali seria buscado no toque de criar e tomaria o lugar achado).
      setCep('');
    } catch (err) {
      if (shown()) notify(PLACE_SEARCH_FAILED_TITLE, errorMessage(err));
    } finally {
      setSearching(null);
    }
  }

  return { cep, setCep: (text) => setCep(maskCep(text)), searching, find };
}

/**
 * O campo do CEP, as duas buscas e o que fica guardado. Sem um contêiner: fica no espaçamento do cartão de fora.
 * `primary` (o padrão, na tela do clima, onde buscar é a ação da tela) faz "Buscar pelo CEP" o botão cheio; no
 * formulário de criar a casa a busca é opcional e o botão cheio é o de criar.
 */
export function PlaceSearchFields({
  search,
  label,
  disabled,
  primary = true,
}: {
  search: PlaceSearch;
  label: string;
  disabled?: boolean;
  primary?: boolean;
}) {
  const off = disabled || search.searching !== null;
  return (
    <>
      <TextField
        label={label}
        value={search.cep}
        onChangeText={search.setCep}
        placeholder="00000-000"
        keyboardType="number-pad"
        maxLength={9}
        // Travado durante a busca: o que fosse digitado nela seria apagado quando ela termina.
        editable={!off}
        onSubmitEditing={() => (off ? undefined : search.find('cep'))}
      />
      <Button
        title="Buscar pelo CEP"
        icon="magnify"
        variant={primary ? 'primary' : 'secondary'}
        loading={search.searching === 'cep'}
        disabled={off}
        onPress={() => search.find('cep')}
      />
      <Button
        title="Usar a localização do celular"
        icon="crosshairs-gps"
        variant="secondary"
        loading={search.searching === 'gps'}
        disabled={off}
        onPress={() => search.find('gps')}
      />
      <Text variant="small">{HOUSE_PLACE_PRIVACY}</Text>
    </>
  );
}

export type ResolvedPlace = { ok: true; place: HouseholdLocation | null } | { ok: false };

/**
 * O lugar de uma casa nova, antes de ela existir: o achado (com "Tirar o local" para pular) e, no toque de criar,
 * `resolve`, que busca antes o CEP digitado e ainda não buscado. `ok: false` quando o CEP falta números ou não foi
 * achado (a pessoa já foi avisada e nada deve ser criado). `resolving` é essa busca do toque de criar: a tela mostra o
 * andamento no botão de criar (o tocado) e trava o formulário, porque o toque já leu os campos.
 */
export function useNewHousePlace(active: boolean) {
  const [place, setPlace] = useState<HouseholdLocation | null>(null);
  const [resolving, setResolving] = useState(false);
  // Se a parte "Onde fica a casa" ainda está à vista (`active`: o formulário de criar, com a tela montada). Uma busca
  // pode durar mais que entrar com um código ou abrir outra casa; depois disso, o fim dela não avisa nem anuncia nada.
  const shown = useRef(active);
  useEffect(() => {
    shown.current = active;
    return () => {
      shown.current = false;
    };
  }, [active]);
  // A troca do texto pelo lugar achado não avisa o leitor de tela sozinha. Na web, `announceForAccessibility` não faz
  // nada (react-native-web): lá avisa a região viva em volta do lugar, em HousePlacePicker.
  const found = (next: HouseholdLocation) => {
    setPlace(next);
    if (Platform.OS !== 'web' && shown.current) AccessibilityInfo.announceForAccessibility(placeFoundAnnouncement(next.label));
  };
  const search = usePlaceSearch(found, () => shown.current);

  async function resolve(): Promise<ResolvedPlace> {
    const step = placeOnCreate(search.cep, place);
    if (step.kind === 'incomplete') {
      notify(CEP_INCOMPLETE_TITLE, cepIncompleteOnCreate(place?.label));
      return { ok: false };
    }
    if (step.kind === 'none') return { ok: true, place: null };
    if (step.kind === 'use') return { ok: true, place: step.place };
    setResolving(true);
    try {
      const next = await findPlaceByCep(step.cep);
      found(next);
      search.setCep('');
      return { ok: true, place: next };
    } catch (err) {
      // Uma falha que parece falta de internet pode ser só do serviço do CEP (bloqueado, ou fora do ar): o aviso ainda diz
      // que a casa não foi criada e como seguir sem o CEP, se a internet estiver funcionando.
      const reason = errorMessage(err);
      notify(CEP_LOOKUP_FAILED_TITLE, isNetworkFailure(err) ? cepUnreachableMessage(reason, place?.label) : cepLookupFailedMessage(reason, place?.label));
      return { ok: false };
    } finally {
      setResolving(false);
    }
  }

  return { place, search, resolving, resolve, remove: () => setPlace(null) };
}

/** A parte opcional "Onde fica a casa" do formulário de criar uma casa. */
export function HousePlacePicker({
  place,
  search,
  onRemove,
  disabled,
}: {
  place: HouseholdLocation | null;
  search: PlaceSearch;
  onRemove: () => void;
  disabled?: boolean;
}) {
  return (
    <View style={styles.picker}>
      <Text variant="label" accessibilityRole="header">
        Onde fica a casa (opcional)
      </Text>
      {/* Na web, a região viva lê o lugar achado (lá `announceForAccessibility` não faz nada); fica sempre montada,
          para a troca do convite pelo lugar ser o que ela anuncia. */}
      <View aria-live={Platform.OS === 'web' ? 'polite' : undefined}>
        {place ? (
          <View style={styles.found}>
            <Text variant="heading">{place.label}</Text>
            <Text variant="small">{placeSourceLabel(place.source)}</Text>
          </View>
        ) : (
          <Text variant="muted">{HOUSE_PLACE_CREATE_INTRO}</Text>
        )}
      </View>
      <PlaceSearchFields search={search} label={cepFieldLabel(place !== null)} disabled={disabled} primary={false} />
      {place ? (
        <Button
          title={HOUSE_PLACE_REMOVE}
          icon="close"
          variant="ghost"
          compact
          disabled={disabled || search.searching !== null}
          onPress={onRemove}
        />
      ) : null}
      <Text variant="small">{HOUSE_PLACE_OPTIONAL}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  picker: { gap: space.md },
  found: { gap: space.xs },
});
