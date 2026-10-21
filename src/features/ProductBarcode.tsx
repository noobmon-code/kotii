import { useRef, useState, type ReactNode } from 'react';

import { fetchBarcodeOwner, useBarcodes, useLinkBarcode } from '@/data/barcodes';
import { useCreateProduct, useProducts } from '@/data/market';
import { barcodeLinkStep, gtinLabel, productNamed, replaceBarcodeQuestion } from '@/domain/barcode';
import { CATEGORIES, getCategory } from '@/domain/categories';
import { guessCategory } from '@/domain/search';
import { errorMessage } from '@/lib/supabase';
import type { Product } from '@/lib/types';
import { askYesNo, notify } from '@/ui/dialogs';
import { PickerModal } from '@/ui/PickerModal';
import { Button, CategoryIcon } from '@/ui/primitives';

import { ProductBarcodeScanner } from './ProductBarcodeScanner';

type Step =
  | { kind: 'scan' }
  // Código novo: qual produto da casa é este?
  | { kind: 'pick'; gtin: string }
  // Produto novo para o código: falta a categoria.
  | { kind: 'create'; gtin: string; name: string };

export interface ProductBarcodeFlow {
  /** O banco já tem a tabela dos códigos. Sem ela (ou antes de saber), as telas não mostram o botão. */
  available: boolean;
  /** Abre a câmera. */
  start: () => void;
  /** O leitor e a escolha do produto: vai na tela. */
  element: ReactNode;
}

/**
 * Ler o código de barras de um produto e chegar ao produto da casa: o mesmo
 * caminho no Preços, na lista e na tela do produto.
 *
 * Sem `linkTo`, o código conhecido dá o produto dele, e o código novo pergunta
 * "Qual produto é este?" (um da casa, ou um produto novo com nome e
 * categoria): a casa aprende o código e segue com o produto. Com `linkTo`, o
 * código lido vai para esse produto. O código que era de outro produto só
 * troca depois de a pessoa confirmar; fechar qualquer passo não grava nada.
 */
export function useProductBarcode({ onProduct, linkTo }: { onProduct: (product: Product) => void; linkTo?: Product }): ProductBarcodeFlow {
  const products = useProducts();
  const barcodes = useBarcodes();
  const link = useLinkBarcode();
  const createProduct = useCreateProduct();
  const [step, setStep] = useState<Step | null>(null);
  // Um código de cada vez: enquanto um passo fala com o banco, outro toque não começa outro.
  const running = useRef(false);

  const productById = (id: string | null | undefined) => (id ? products.data?.find((p) => p.id === id) : undefined);

  /** Liga o código ao produto, perguntando antes se ele era de outro, e segue com o produto. */
  async function linkAndGo(gtin: string, product: Product) {
    // Do banco, e não do guardado: outra pessoa da casa (ou uma nota confirmada) pode ter ligado o código há pouco.
    const next = barcodeLinkStep(product.id, await fetchBarcodeOwner(gtin));
    if (next.kind === 'same' && linkTo) {
      notify('Já estava ligado', `O código ${gtinLabel(gtin)} já é de "${product.name}".`);
      return;
    }
    if (next.kind === 'replace') {
      const question = replaceBarcodeQuestion(gtin, productById(next.from)?.name ?? null, product.name);
      if (!(await askYesNo('Código de outro produto', question, 'Passar para este', 'Cancelar'))) return;
    }
    if (next.kind !== 'same') await link.mutateAsync({ gtin, productId: product.id });
    onProduct(product);
  }

  /** Roda um passo que fala com o banco; o erro vira um aviso. */
  async function run(task: () => Promise<void>) {
    if (running.current) return;
    running.current = true;
    try {
      await task();
    } catch (err) {
      notify('Não deu para usar o código', errorMessage(err));
    } finally {
      running.current = false;
    }
  }

  function onRead(gtin: string) {
    setStep(null);
    if (linkTo) return void run(() => linkAndGo(gtin, linkTo));
    void run(async () => {
      // O guardado no aparelho vale sem internet; só o código que ele não conhece vai ao banco.
      const saved = barcodes.data?.find((code) => code.gtin === gtin)?.product_id;
      const product = productById(saved ?? (await fetchBarcodeOwner(gtin)));
      if (product) onProduct(product);
      else setStep({ kind: 'pick', gtin });
    });
  }

  function choose(gtin: string, product: Product) {
    setStep(null);
    void run(() => linkAndGo(gtin, product));
  }

  function create(gtin: string, name: string, category: string) {
    setStep(null);
    void run(async () => linkAndGo(gtin, await createProduct.mutateAsync({ name, category })));
  }

  const pick = step?.kind === 'pick' ? step : null;
  const creating = step?.kind === 'create' ? step : null;
  // A categoria que o nome sugere vem primeiro.
  const guessed = creating ? guessCategory(creating.name) : null;
  const categories = guessed ? [getCategory(guessed), ...CATEGORIES.filter((cat) => cat.key !== guessed)] : CATEGORIES;

  const element = (
    <>
      {step?.kind === 'scan' ? (
        <ProductBarcodeScanner
          title={linkTo ? 'Ligar código de barras' : 'Ler código de barras'}
          onRead={onRead}
          onClose={() => setStep(null)}
        />
      ) : null}
      {pick ? (
        <PickerModal
          visible
          title="Qual produto é este?"
          message={`Código novo: ${gtinLabel(pick.gtin)}. Escolha o produto ou crie um, e da próxima vez o Kotii já reconhece.`}
          placeholder="Buscar ou criar produto"
          options={(products.data ?? []).map((p) => ({
            id: p.id,
            title: p.name,
            subtitle: getCategory(p.category).label,
            left: <CategoryIcon category={p.category} name={p.name} size={32} />,
          }))}
          onClose={() => setStep(null)}
          onSelect={(id) => {
            const product = productById(id);
            if (product) choose(pick.gtin, product);
          }}
          extraActions={(query) =>
            // O nome que já é de um produto está na lista: o banco não deixa criar outro igual.
            query && !productNamed(products.data ?? [], query) ? (
              <Button
                title={`Criar "${query}"`}
                icon="plus"
                variant="secondary"
                compact
                onPress={() => setStep({ kind: 'create', gtin: pick.gtin, name: query })}
              />
            ) : null
          }
        />
      ) : null}
      {creating ? (
        <PickerModal
          visible
          title="Categoria"
          message={`Do produto novo, "${creating.name}".`}
          options={categories.map((cat) => ({
            id: cat.key,
            title: cat.label,
            subtitle: cat.key === guessed && guessed !== 'outros' ? 'Pelo nome' : undefined,
            left: <CategoryIcon category={cat.key} size={32} />,
          }))}
          onClose={() => setStep(null)}
          onSelect={(category) => create(creating.gtin, creating.name, category)}
        />
      ) : null}
    </>
  );

  return { available: Array.isArray(barcodes.data), start: () => setStep({ kind: 'scan' }), element };
}
