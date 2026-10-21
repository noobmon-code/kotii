import { useQueryClient } from '@tanstack/react-query';
import { useRef, useState, type ReactNode } from 'react';
import { Platform } from 'react-native';

import { fetchBarcodeOwner, useBarcodes, useLinkBarcode } from '@/data/barcodes';
import { fetchProducts, useCreateProduct, useProducts } from '@/data/market';
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
  // `n` conta as aberturas: cada uma monta um leitor novo, que ainda não leu nada.
  | { kind: 'scan'; n: number }
  // Código novo: qual produto da casa é este?
  | { kind: 'pick'; gtin: string }
  // Produto novo para o código: falta a categoria.
  | { kind: 'create'; gtin: string; name: string };

export interface ProductBarcodeFlow {
  /** O banco já tem a tabela dos códigos. Sem ela (ou antes de saber), as telas não mostram o botão. */
  available: boolean;
  /** Um código ainda está sendo visto (falando com o banco): os botões de ler mostram que estão ocupados. */
  busy: boolean;
  /** Abre a câmera (ocupado, só avisa). */
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
  const queryClient = useQueryClient();
  const products = useProducts();
  const barcodes = useBarcodes();
  const link = useLinkBarcode();
  const createProduct = useCreateProduct();
  const [step, setStep] = useState<Step | null>(null);
  // No iOS, abrir um Modal enquanto o anterior ainda desce pode não mostrar o segundo (o mesmo do ActionSheet): o
  // passo que fechou fica montado, invisível, até o onDismiss dele, e o próximo espera por ele.
  const [leaving, setLeaving] = useState<Step | null>(null);
  const shown = useRef<Step | null>(null);
  const closing = useRef(false);
  const queued = useRef<Step | null>(null);
  // Um código de cada vez: a ref segura o toque duplo na hora, e `busy` redesenha os botões das telas.
  const running = useRef(false);
  const [busy, setBusy] = useState(false);
  const scans = useRef(0);

  const productById = (id: string | null | undefined) => (id ? products.data?.find((p) => p.id === id) : undefined);

  /** Fecha o passo aberto e abre o próximo (null: só fecha). No iOS, o próximo espera o anterior sumir. */
  function go(next: Step | null) {
    const wait = Platform.OS === 'ios' && (shown.current !== null || closing.current);
    if (wait && shown.current) {
      closing.current = true;
      setLeaving(shown.current);
    }
    if (wait) queued.current = next;
    shown.current = wait ? null : next;
    setStep(shown.current);
  }

  function dismissed() {
    closing.current = false;
    setLeaving(null);
    shown.current = queued.current;
    queued.current = null;
    setStep(shown.current);
  }

  /** O produto da casa; o que não está nos guardados (criado há pouco em outro aparelho) vem de uma busca nova. */
  async function findProduct(id: string): Promise<Product | undefined> {
    const known = productById(id);
    if (known) return known;
    // 'always': sem internet a busca falha e vira aviso, em vez de ficar parada segurando o botão.
    const fresh = await queryClient.fetchQuery({ queryKey: ['products'], queryFn: fetchProducts, staleTime: 0, networkMode: 'always' });
    return fresh.find((p) => p.id === id);
  }

  /** Liga o código ao produto, perguntando antes se ele era de outro, e segue com o produto. */
  async function linkAndGo(gtin: string, product: Product) {
    // Do banco, e não do guardado: outra pessoa da casa (ou uma nota confirmada) pode ter ligado o código há pouco.
    const next = barcodeLinkStep(product.id, await fetchBarcodeOwner(gtin));
    if (next.kind === 'same' && linkTo) {
      notify('Já estava ligado', `O código ${gtinLabel(gtin)} já é de "${product.name}".`);
      return;
    }
    if (next.kind === 'replace') {
      const from = await findProduct(next.from);
      const question = replaceBarcodeQuestion(gtin, from?.name ?? null, product.name);
      if (!(await askYesNo('Código de outro produto', question, 'Passar para este', 'Cancelar'))) return;
    }
    if (next.kind !== 'same') await link.mutateAsync({ gtin, productId: product.id });
    onProduct(product);
  }

  /** Roda um passo que fala com o banco; o erro vira um aviso. */
  async function run(task: () => Promise<void>) {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    try {
      await task();
    } catch (err) {
      notify('Não deu para usar o código', errorMessage(err));
    } finally {
      running.current = false;
      setBusy(false);
    }
  }

  function start() {
    // A câmera aberta agora leria um código que ficaria sem resposta: o anterior ainda está falando com o banco.
    if (running.current) notify('Ainda vendo o código anterior.');
    else go({ kind: 'scan', n: ++scans.current });
  }

  function onRead(gtin: string) {
    go(null);
    if (linkTo) return void run(() => linkAndGo(gtin, linkTo));
    void run(async () => {
      // O guardado no aparelho vale sem internet; o código que ele não conhece, ou de um produto que não está aqui
      // (juntado com outro, por exemplo), vai ao banco.
      const saved = productById(barcodes.data?.find((code) => code.gtin === gtin)?.product_id);
      if (saved) return onProduct(saved);
      const owner = await fetchBarcodeOwner(gtin);
      if (!owner) return go({ kind: 'pick', gtin });
      // O código é de um produto da casa: nunca "Código novo", que levaria a passá-lo para outro produto.
      const product = await findProduct(owner);
      if (product) onProduct(product);
      else
        notify(
          'Não deu para abrir o produto',
          `O código ${gtinLabel(gtin)} já é de um produto da casa, mas ele não carregou neste aparelho. Confira a internet e tente de novo.`,
        );
    });
  }

  function choose(gtin: string, product: Product) {
    go(null);
    void run(() => linkAndGo(gtin, product));
  }

  function create(gtin: string, name: string, category: string) {
    go(null);
    void run(async () => linkAndGo(gtin, await createProduct.mutateAsync({ name, category })));
  }

  // O passo aberto, ou o que acabou de fechar e ainda desce (no iOS): esse fica invisível até o onDismiss, que só
  // ele chama (o onDismiss é só do iOS, e lá todo passo que fecha passa por `leaving`).
  const scanning = step?.kind === 'scan' ? step : leaving?.kind === 'scan' ? leaving : null;
  const pick = step?.kind === 'pick' ? step : leaving?.kind === 'pick' ? leaving : null;
  const creating = step?.kind === 'create' ? step : leaving?.kind === 'create' ? leaving : null;
  // A categoria que o nome sugere vem primeiro.
  const guessed = creating ? guessCategory(creating.name) : null;
  const categories = guessed ? [getCategory(guessed), ...CATEGORIES.filter((cat) => cat.key !== guessed)] : CATEGORIES;

  const element = (
    <>
      {scanning ? (
        <ProductBarcodeScanner
          key={scanning.n}
          title={linkTo ? 'Ligar código de barras' : 'Ler código de barras'}
          visible={scanning === step}
          onDismiss={dismissed}
          onRead={onRead}
          onClose={() => go(null)}
        />
      ) : null}
      {pick ? (
        <PickerModal
          visible={pick === step}
          onDismiss={dismissed}
          title="Qual produto é este?"
          message={`Código novo: ${gtinLabel(pick.gtin)}. Escolha o produto ou crie um, e da próxima vez o Kotii já reconhece.`}
          placeholder="Buscar ou criar produto"
          options={(products.data ?? []).map((p) => ({
            id: p.id,
            title: p.name,
            subtitle: getCategory(p.category).label,
            left: <CategoryIcon category={p.category} name={p.name} size={32} />,
          }))}
          onClose={() => go(null)}
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
                onPress={() => go({ kind: 'create', gtin: pick.gtin, name: query })}
              />
            ) : null
          }
        />
      ) : null}
      {creating ? (
        <PickerModal
          visible={creating === step}
          onDismiss={dismissed}
          title="Categoria"
          message={`Escolha a categoria de "${creating.name}".`}
          options={categories.map((cat) => ({
            id: cat.key,
            title: cat.label,
            subtitle: cat.key === guessed && guessed !== 'outros' ? 'Pelo nome' : undefined,
            left: <CategoryIcon category={cat.key} size={32} />,
          }))}
          onClose={() => go(null)}
          onSelect={(category) => create(creating.gtin, creating.name, category)}
        />
      ) : null}
    </>
  );

  return { available: Array.isArray(barcodes.data), busy, start, element };
}
