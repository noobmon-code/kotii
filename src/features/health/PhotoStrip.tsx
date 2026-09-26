import { useQuery } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { healthImageUrl } from '@/data/health';
import { Icon, IconButton, Row, Text } from '@/ui/primitives';
import { radius, space, useColors } from '@/ui/theme';

const THUMB = 84;

function usePhotoUrl(path: string | null) {
  return useQuery({
    queryKey: ['healthImage', path],
    enabled: Boolean(path),
    // A URL assinada vale 10 minutos.
    staleTime: 8 * 60_000,
    queryFn: async () => healthImageUrl(path!),
  });
}

/** Miniaturas das fotos de um documento; toque abre em tela cheia. */
export function PhotoStrip({
  paths,
  onAdd,
  onRemove,
  busy,
}: {
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
          <Thumb key={path} path={path} onPress={() => setOpen(index)} />
        ))}
        {onAdd ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Adicionar fotos"
            onPress={onAdd}
            disabled={busy}
            style={[styles.thumb, styles.add, { borderColor: c.border, backgroundColor: c.surface }]}>
            {busy ? <ActivityIndicator color={c.primary} /> : <Icon name="camera-plus-outline" color="primary" />}
            <Text variant="small">{busy ? 'Enviando' : 'Fotos'}</Text>
          </Pressable>
        ) : null}
      </ScrollView>
      <Viewer
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

function Thumb({ path, onPress }: { path: string; onPress: () => void }) {
  const c = useColors();
  const url = usePhotoUrl(path);
  return (
    <Pressable accessibilityRole="imagebutton" accessibilityLabel="Ver foto" onPress={onPress}>
      <View style={[styles.thumb, { backgroundColor: c.surfaceAlt, borderColor: c.border }]}>
        {url.data ? <Image source={{ uri: url.data }} style={StyleSheet.absoluteFill} contentFit="cover" /> : null}
      </View>
    </Pressable>
  );
}

function Viewer({
  path,
  title,
  onClose,
  onRemove,
}: {
  path: string | null;
  title: string;
  onClose: () => void;
  onRemove?: () => void;
}) {
  const c = useColors();
  const url = usePhotoUrl(path);
  return (
    <Modal visible={Boolean(path)} animationType="fade" onRequestClose={onClose}>
      <SafeAreaView style={[styles.flex, { backgroundColor: c.background }]}>
        <Row style={styles.header}>
          <Text variant="heading" style={styles.flex}>
            {title}
          </Text>
          {onRemove ? <IconButton icon="trash-can-outline" label="Remover foto" color="danger" onPress={onRemove} /> : null}
          <IconButton icon="close" label="Fechar" onPress={onClose} />
        </Row>
        {path && url.data ? <Image source={{ uri: url.data }} style={styles.flex} contentFit="contain" /> : null}
      </SafeAreaView>
    </Modal>
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
