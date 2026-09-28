import { useState, type ReactNode } from 'react';
import { Modal, ScrollView, StyleSheet, type KeyboardTypeOptions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Backdrop } from '@/ui/Backdrop';
import { Button, DateField, IconButton, Row, Text, TextField } from '@/ui/primitives';
import { MAX_WIDTH, space, useColors } from '@/ui/theme';

export interface FieldSpec<K extends string> {
  key: K;
  label: string;
  placeholder?: string;
  hint?: string;
  multiline?: boolean;
  keyboardType?: KeyboardTypeOptions;
  required?: boolean;
  /** Data dd/mm/aaaa, com máscara enquanto digita. */
  date?: boolean;
}

/**
 * Formulário simples em tela cheia para editar um pedaço de um plano
 * (exercício, refeição, alimento, resultado). Renderize só quando aberto.
 */
export function FieldsModal<K extends string>({
  title,
  fields,
  initial,
  onSave,
  onDelete,
  onClose,
  children,
  saving = false,
}: {
  title: string;
  fields: FieldSpec<K>[];
  initial: Partial<Record<K, string | null>>;
  onSave: (values: Record<K, string>) => void;
  onDelete?: () => void;
  onClose: () => void;
  /** Conteúdo extra abaixo dos campos (ex.: dias da semana). */
  children?: ReactNode;
  /** Gravando: o Salvar fica travado para um segundo toque não mandar de novo. */
  saving?: boolean;
}) {
  const c = useColors();
  const [values, setValues] = useState(
    () => Object.fromEntries(fields.map((f) => [f.key, initial[f.key] ?? ''])) as Record<K, string>,
  );
  const missing = fields.some((f) => f.required && !values[f.key].trim());

  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={[styles.flex, { backgroundColor: c.background }]}>
        <Backdrop />
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Row>
            <Text variant="heading" style={styles.flex}>
              {title}
            </Text>
            <IconButton icon="close" label="Fechar" onPress={onClose} />
          </Row>
          {fields.map((field, index) => {
            const onChangeText = (text: string) => setValues((prev) => ({ ...prev, [field.key]: text }));
            return field.date ? (
              <DateField
                key={field.key}
                label={field.label}
                value={values[field.key]}
                onChangeText={onChangeText}
                placeholder={field.placeholder}
                hint={field.hint}
                autoFocus={index === 0 && !initial[field.key]}
              />
            ) : (
              <TextField
                key={field.key}
                label={field.label}
                value={values[field.key]}
                onChangeText={onChangeText}
                placeholder={field.placeholder}
                hint={field.hint}
                multiline={field.multiline}
                keyboardType={field.keyboardType}
                autoFocus={index === 0 && !initial[field.key]}
              />
            );
          })}
          {children}
          <Button title="Salvar" disabled={missing || saving} loading={saving} onPress={() => onSave(values)} />
          {onDelete ? <Button title="Remover" variant="danger" icon="trash-can-outline" onPress={onDelete} /> : null}
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

/** "" -> null, com espaços aparados. */
export function orNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { width: '100%', maxWidth: MAX_WIDTH, alignSelf: 'center', padding: space.lg, gap: space.lg },
});
