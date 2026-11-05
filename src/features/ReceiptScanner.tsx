import { router } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';

import { MAX_RECEIPT_PHOTOS, pickReceiptImages, useCreateManualReceipt, useScanReceipt, type ScanSource } from '@/data/receipts';
import { useHouseholdId } from '@/lib/auth';
import { watchPickerReturn } from '@/lib/pickerReturn';
import { errorMessage } from '@/lib/supabase';
import { ActionSheet } from '@/ui/ActionSheet';
import { BusyOverlay } from '@/ui/BusyOverlay';
import { notify } from '@/ui/dialogs';

/**
 * Fluxo "nota -> revisão". `open()` mostra as opções (QR code, câmera,
 * galeria, manual), em Finanças → Notas e no Mercado do mês; `element`
 * precisa ser renderizado pela tela. `readPhotos(source, chave)` lê pela foto
 * (a chave, quando já se conhece pelo QR code); `startManual()` cria a nota
 * digitada. `replace`: a revisão toma o lugar da tela atual (a do QR).
 * `active`: um jeito pela foto ou digitado está em andamento (a câmera do
 * sistema ou a galeria abertas, partes da foto esperando, a leitura ou a
 * criação a caminho); a tela do QR desliga a câmera dela enquanto isso. No
 * navegador, o seletor fechado sem nada pode nunca avisar (sem o evento
 * `cancel`, antes do Safari 16.4): a página de volta sem arquivo também conta
 * como fechado (lib/pickerReturn), para a câmera do QR não ficar desligada.
 * Com o seletor aberto, outra abertura é ignorada (o toque duplo: o navegador
 * não abre dois, e a abertura nova descartaria as fotos da primeira).
 * `dropPick()`: a nota veio por outro caminho (o QR); o que o seletor ainda
 * devolver tarde não é lido. A tela que sai também não lê mais nada.
 */
export function useReceiptScanner({ replace = false }: { replace?: boolean } = {}) {
  const householdId = useHouseholdId();
  const scan = useScanReceipt(householdId);
  const manual = useCreateManualReceipt();
  const [sheetOpen, setSheetOpen] = useState(false);
  // Nota comprida pela câmera: partes já fotografadas, esperando a próxima ou a leitura.
  const [parts, setParts] = useState<string[]>([]);
  // A câmera do sistema ou a galeria abertas, até a pessoa voltar delas (no navegador, até o seletor de arquivos fechar).
  const [picking, setPicking] = useState(false);
  // Cada abertura do seletor tem um número: só a mais nova mexe em `picking` e lê o que voltou.
  const pickRun = useRef(0);
  // A abertura ainda aberta (até a promessa do seletor terminar ou o vigia dar a página como de volta): enquanto
  // isso, outra é ignorada.
  const openRun = useRef<number | null>(null);
  // O vigia da volta à página (no navegador), da abertura de agora.
  const stopWatching = useRef<(() => void) | null>(null);
  // O que o seletor ainda devolver não vale mais: a nota veio por outro caminho, ou a tela saiu.
  const forgetPick = useCallback(() => {
    pickRun.current++;
    openRun.current = null;
    stopWatching.current?.();
    stopWatching.current = null;
  }, []);
  const dropPick = useCallback(() => {
    forgetPick();
    setPicking(false);
  }, [forgetPick]);
  // A tela saiu: a foto que chegar depois não é enviada (sem a tela, ninguém abriria a revisão dela).
  useEffect(() => forgetPick, [forgetPick]);
  // Dois toques rápidos em "Digitar" criariam duas notas vazias.
  const creating = useRef(false);
  // Chave da nota que está sendo fotografada, quando veio do QR code.
  const accessKey = useRef<string | null>(null);

  const read = useCallback(
    (uris: string[]) => {
      setParts([]);
      // Só agora (câmera já fechada) aparece a tela de espera.
      scan.mutate(
        { uris, accessKey: accessKey.current },
        {
          onSuccess: ({ receipt_id, duplicate }) => {
            const review = { pathname: '/nota/[id]', params: { id: receipt_id } } as const;
            if (replace) router.replace(review);
            else router.push(review);
            if (duplicate) notify('Nota já importada', 'Esta nota já estava no app — abrimos a existente.');
          },
          onError: (err) => notify('Não foi possível ler a nota', errorMessage(err)),
        },
      );
    },
    [scan, replace],
  );

  const start = useCallback(
    async (source: ScanSource, taken: string[] = []) => {
      // O segundo toque com o seletor ainda abrindo: o navegador não abre outro (o Chrome o enfileira, o Safari o
      // ignora), e esta abertura nova descartaria o que a primeira trouxer.
      if (openRun.current !== null) return;
      const run = ++pickRun.current;
      openRun.current = run;
      setPicking(true);
      stopWatching.current?.();
      stopWatching.current =
        Platform.OS === 'web'
          ? watchPickerReturn(() => {
              if (pickRun.current !== run) return;
              // A página voltou sem arquivo: o seletor conta como fechado, e outro toque já abre um novo.
              openRun.current = null;
              setPicking(false);
            })
          : null;
      const settled = () => {
        if (pickRun.current !== run) return false;
        openRun.current = null;
        stopWatching.current?.();
        stopWatching.current = null;
        setPicking(false);
        return true;
      };
      let uris: string[];
      try {
        uris = await pickReceiptImages(source, source === 'library' ? MAX_RECEIPT_PHOTOS : 1);
      } catch (err) {
        if (settled()) notify('Não foi possível abrir a imagem', errorMessage(err));
        return;
      }
      // Uma abertura mais nova tomou o lugar desta, a nota veio pelo QR ou a tela saiu: o que esta trouxe (tarde) não
      // vale mais.
      if (!settled()) return;
      // Já dada como fechada pelo vigia, mas com um arquivo que chegou depois: lido como sempre.
      if (source === 'library') {
        // No navegador a galeria não tem limite: com imagens demais, nada é lido (cortar podia deixar o rodapé de fora).
        if (uris.length > MAX_RECEIPT_PHOTOS) {
          notify(
            'Imagens demais',
            `Escolha até ${MAX_RECEIPT_PHOTOS} imagens da mesma nota, sem deixar de fora o topo (com o mercado) e o rodapé (com a data).`,
          );
          return;
        }
        if (uris.length) read(uris);
        return;
      }
      const next = [...taken, ...uris];
      if (!next.length) return;
      // Pela câmera, uma parte de cada vez: a pessoa diz se a nota continua.
      if (next.length >= MAX_RECEIPT_PHOTOS) read(next);
      else setParts(next);
    },
    [read],
  );

  const readPhotos = useCallback(
    (source: ScanSource, key: string | null = null) => {
      // Com o seletor aberto, a chave de agora é a da abertura que já está lá.
      if (openRun.current !== null) return;
      accessKey.current = key;
      void start(source);
    },
    [start],
  );

  const startManual = useCallback(() => {
    if (creating.current) return;
    creating.current = true;
    manual.mutate(undefined, {
      onSuccess: ({ id }) => {
        const review = { pathname: '/nota/[id]', params: { id } } as const;
        if (replace) router.replace(review);
        else router.push(review);
      },
      onError: (err) => notify('Erro', errorMessage(err)),
      onSettled: () => {
        creating.current = false;
      },
    });
  }, [manual, replace]);

  const element = (
    <>
      <ActionSheet
        visible={sheetOpen}
        onClose={() => setSheetOpen(false)}
        title="Adicionar nota fiscal"
        message="Pelo QR code, os itens vêm direto da Sefaz; pela foto, a IA lê a nota. Você revisa antes de salvar."
        actions={[
          { label: 'Ler o QR code da nota', icon: 'qrcode-scan', onPress: () => router.push('/nota/qrcode') },
          { label: 'Tirar foto da nota', icon: 'camera-outline', onPress: () => readPhotos('camera') },
          { label: `Escolher da galeria (até ${MAX_RECEIPT_PHOTOS} fotos)`, icon: 'image-outline', onPress: () => readPhotos('library') },
          { label: 'Digitar manualmente', icon: 'pencil-outline', onPress: startManual },
        ]}
      />
      <ActionSheet
        visible={parts.length > 0}
        onClose={() => setParts([])}
        title={parts.length === 1 ? 'Foto tirada' : `${parts.length} partes tiradas`}
        message="Nota comprida? Fotografe o resto de cima para baixo, deixando um pedaço repetido entre as fotos: a leitura junta tudo numa nota só."
        actions={[
          { label: parts.length === 1 ? 'Ler a nota' : `Ler a nota (${parts.length} fotos)`, icon: 'check', onPress: () => read(parts) },
          { label: 'Fotografar a próxima parte', icon: 'camera-plus-outline', onPress: () => start('camera', parts) },
        ]}
      />
      <BusyOverlay
        visible={scan.isPending}
        title="Lendo a nota…"
        message="Identificando mercado, itens e preços. Notas longas podem levar até um minuto."
      />
    </>
  );

  return {
    open: () => setSheetOpen(true),
    readPhotos,
    startManual,
    dropPick,
    element,
    busy: scan.isPending || manual.isPending,
    active: picking || parts.length > 0 || scan.isPending || manual.isPending,
  };
}
