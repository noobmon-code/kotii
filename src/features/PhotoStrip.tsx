import { useQuery } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { signedImageUrl } from '@/data/images';
import { Icon, IconButton, Row, Text } from '@/ui/primitives';
import { SheetModal } from '@/ui/SheetModal';
import { radius, space, useColors } from '@/ui/theme';

const THUMB = 84;

function usePhotoUrl(bucket: string, path: string | null) {
  return useQuery({
    queryKey: ['photoUrl', bucket, path],
    enabled: Boolean(path),
    // A URL assinada vale 10 minutos.
    staleTime: 8 * 60_000,
    queryFn: async () => signedImageUrl(bucket, path!),
  });
}

/** Miniaturas das fotos de um documento; toque abre em tela cheia (no computador, numa caixa grande no meio da janela). */
export function PhotoStrip({
  bucket,
  paths,
  onAdd,
  onRemove,
  busy,
}: {
  /** Bucket privado onde as fotos estão ("health", "documents"). */
  bucket: string;
  paths: string[];
  onAdd?: () => void;
  onRemove?: (path: string) => void;
  busy?: boolean;
}) {
  const c = useColors();
  const [open, setOpen] = useState<number | null>(null);
  return (
    <>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.strip}>
        {paths.map((path, index) => (
          <Thumb key={path} bucket={bucket} path={path} onPress={() => setOpen(index)} />
        ))}
        {onAdd ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Adicionar fotos"
            onPress={onAdd}
            disabled={busy}
            style={[styles.thumb, styles.add, { borderColor: c.border, backgroundColor: c.glassStrong }]}>
            {busy ? <ActivityIndicator color={c.primary} /> : <Icon name="camera-plus-outline" color="primary" />}
            <Text variant="small">{busy ? 'Enviando' : 'Fotos'}</Text>
          </Pressable>
        ) : null}
      </ScrollView>
      <Viewer
        bucket={bucket}
        path={open === null ? null : paths[open] ?? null}
        title={open === null ? '' : `Foto ${open + 1} de ${paths.length}`}
        onClose={() => setOpen(null)}
        onRemove={
          onRemove && open !== null
            ? () => {
                onRemove(paths[open]);
                setOpen(null);
              }
            : undefined
        }
      />
    </>
  );
}

function Thumb({ bucket, path, onPress }: { bucket: string; path: string; onPress: () => void }) {
  const c = useColors();
  const url = usePhotoUrl(bucket, path);
  return (
    <Pressable accessibilityRole="imagebutton" accessibilityLabel="Ver foto" onPress={onPress}>
      <View style={[styles.thumb, { backgroundColor: c.surfaceAlt, borderColor: c.border }]}>
        {url.data ? <Image source={{ uri: url.data }} style={StyleSheet.absoluteFill} contentFit="cover" /> : null}
      </View>
    </Pressable>
  );
}

function Viewer({
  bucket,
  path,
  title,
  onClose,
  onRemove,
}: {
  bucket: string;
  path: string | null;
  title: string;
  onClose: () => void;
  onRemove?: () => void;
}) {
  const url = usePhotoUrl(bucket, path);
  return (
    // Fecha pelo X e, no navegador, pelo Esc (e pelo voltar do Android).
    <SheetModal visible={Boolean(path)} photo onClose={onClose}>
      <Row style={styles.header}>
        <Text variant="heading" style={styles.flex}>
          {title}
        </Text>
        {onRemove ? <IconButton icon="trash-can-outline" label="Remover foto" color="danger" onPress={onRemove} /> : null}
        <IconButton icon="close" label="Fechar" onPress={onClose} />
      </Row>
      {path && url.data ? <Image source={{ uri: url.data }} style={styles.flex} contentFit="contain" /> : null}
    </SheetModal>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  strip: { gap: space.sm },
  thumb: {
    width: THUMB,
    height: THUMB,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  add: { alignItems: 'center', justifyContent: 'center', gap: space.xs, borderStyle: 'dashed', borderWidth: 1 },
  header: { padding: space.lg },
});
