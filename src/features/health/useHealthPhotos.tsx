import { useState } from 'react';

import { pickImages, type ScanSource } from '@/data/images';
import { MAX_HEALTH_PHOTOS } from '@/domain/health';
import { errorMessage } from '@/lib/supabase';
import { ActionSheet, type SheetAction } from '@/ui/ActionSheet';
import { askYesNo, notify } from '@/ui/dialogs';

/**
 * Fotos de um documento com várias páginas: pela câmera, uma de cada vez
 * perguntando se há outra página; pela galeria, várias de uma vez.
 */
export async function collectPages(source: ScanSource, limit = MAX_HEALTH_PHOTOS): Promise<string[]> {
  if (source === 'library') return pickImages('library', limit);
  const uris: string[] = [];
  while (uris.length < limit) {
    const [uri] = await pickImages('camera');
    if (!uri) break;
    uris.push(uri);
    if (uris.length >= limit) break;
    const more = await askYesNo(
      `${uris.length} ${uris.length === 1 ? 'página' : 'páginas'}`,
      'O documento tem outra página?',
      'Fotografar outra',
      'Não, continuar',
    );
    if (!more) break;
  }
  return uris;
}

/**
 * Menu "câmera / galeria / (digitar)" que entrega as fotos escolhidas.
 * `element` precisa ser renderizado pela tela.
 */
export function usePhotoSheet({
  title,
  message,
  onPhotos,
  manual,
}: {
  title: string;
  message?: string;
  onPhotos: (uris: string[]) => void;
  manual?: { label: string; onPress: () => void };
}) {
  const [visible, setVisible] = useState(false);
  const [limit, setLimit] = useState(MAX_HEALTH_PHOTOS);

  async function start(source: ScanSource) {
    try {
      const uris = await collectPages(source, limit);
      if (uris.length) onPhotos(uris);
    } catch (err) {
      notify('Não foi possível abrir a imagem', errorMessage(err));
    }
  }

  const actions: SheetAction[] = [
    { label: 'Tirar fotos', icon: 'camera-outline', onPress: () => start('camera') },
    { label: 'Escolher da galeria', icon: 'image-multiple-outline', onPress: () => start('library') },
  ];
  if (manual) actions.push({ label: manual.label, icon: 'pencil-outline', onPress: manual.onPress });

  return {
    open: (maxPhotos = MAX_HEALTH_PHOTOS) => {
      setLimit(maxPhotos);
      setVisible(true);
    },
    element: (
      <ActionSheet visible={visible} onClose={() => setVisible(false)} title={title} message={message} actions={actions} />
    ),
  };
}
