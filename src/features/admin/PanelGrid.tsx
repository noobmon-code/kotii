import { Children, isValidElement, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { panelCellPercent } from '@/domain/panelLayout';
import { space } from '@/ui/theme';

/** O espaço entre as colunas da grade: o mesmo que separa as seções umas das outras. */
const GUTTER = space.xl;

/**
 * Uma seção da grade que ocupa mais de uma coluna (`span`, nunca mais que a linha inteira). Só vale dentro de um
 * PanelGrid; na coluna única do celular, é a seção como sempre.
 */
export function PanelCell({ children }: { span?: number; children: ReactNode }) {
  return <>{children}</>;
}

/**
 * A grade das seções do Painel do app na janela larga: `columns` colunas (de domain/panelLayout), cada filho numa
 * célula com a largura em porcentagem da linha (panelCellPercent) e o espaço entre as colunas no padding da
 * célula. Um filho PanelCell com `span` ocupa mais colunas. Com uma coluna (o celular), os filhos ficam soltos na
 * tela, um embaixo do outro, exatamente como eram antes da grade.
 */
export function PanelGrid({ columns, children }: { columns: number; children: ReactNode }) {
  if (columns <= 1) return <>{children}</>;
  return (
    <View style={styles.grid}>
      {Children.toArray(children).map((child, index) => {
        const span = isValidElement<{ span?: number }>(child) && child.type === PanelCell ? (child.props.span ?? 1) : 1;
        const key = isValidElement(child) && child.key !== null ? child.key : index;
        return (
          <View key={key} style={[styles.cell, { width: panelCellPercent(columns, span) }]}>
            {child}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', rowGap: space.xl, marginHorizontal: -GUTTER / 2 },
  cell: { paddingHorizontal: GUTTER / 2 },
});
