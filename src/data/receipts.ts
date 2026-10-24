// Notas fiscais: leitura por foto (IA), revisão e confirmação.

import { FunctionsHttpError, type SupabaseClient } from '@supabase/supabase-js';
import { type QueryClient, useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type { ReceiptFingerprint } from '@/domain/duplicateReceipt';
import { NFCE_CAPTCHA_STATE, nfceItemsToDraft, nfceReceiptRow, nfceStoreCodes, type NfceItem, type NfceQr } from '@/domain/nfce';
import { RECEIPTS_PAGE } from '@/domain/receiptList';
import { MAX_RECEIPT_PHOTOS, tooManyPhotosMessage } from '@/domain/receiptPhotos';
import type { ConfirmItem } from '@/domain/receiptReview';
import { supabase, unwrap } from '@/lib/supabase';
import type { Receipt, ReceiptItem, Unit } from '@/lib/types';
import {
  FunctionError,
  functionErrorDetails,
  pickAllImages,
  removeImages,
  signedImageUrl,
  uploadImages,
  type ScanSource,
} from './images';
import { loadLearnedAbbreviations } from './learnedAbbreviations';
import { isMissingColumn, isMissingFunction } from './missingSchema';
import { withFreshProducts } from './productMerge';
import { readAll } from './readAll';

const RECEIPT_COLUMNS =
  'id, store_id, purchased_at, total, access_key, image_path, extra_image_paths, source, status, created_at, paid_by, store:stores(id, name)';
const ITEM_BASE_COLUMNS =
  'id, receipt_id, position, raw_description, suggested_name, suggested_category, product_id, quantity, unit, unit_price, total_price';
/**
 * As colunas dos itens que chegaram por migrações recentes: o item genérico da leitura por foto (generic_name) e
 * o código do produto na nota (store_code). O app pode ser publicado antes de cada uma: lendo ou gravando sem
 * a que falta, a nota fica como era.
 */
const OPTIONAL_ITEM_COLUMNS = ['generic_name', 'store_code'] as const;
type OptionalItemColumn = (typeof OPTIONAL_ITEM_COLUMNS)[number];

/** A coluna recente que o banco disse que não tem (uma por erro), ou undefined. */
const missingItemColumn = (error: unknown, columns: readonly OptionalItemColumn[]) =>
  columns.find((column) => isMissingColumn(error, column));

/** Uma nota da lista de Finanças > Notas: com quantos itens ela tem. */
export type ReceiptListRow = Receipt & { receipt_items: { count: number }[] };

const LIST_COLUMNS = `${RECEIPT_COLUMNS}, receipt_items(count)`;
/** Linhas por pedido dos rascunhos: o teto do servidor (max_rows padrão do Supabase). */
const DRAFTS_PAGE = 1000;
/** Rascunhos são poucos; passando disso a busca falha, em vez de esconder um. */
const MAX_DRAFTS = 5000;

/**
 * Todos os rascunhos da casa ("Para revisar"), do mais recente para o mais antigo: nenhum fica de fora por ser
 * antigo. Lidos inteiros, página por página pelo id (readAll); passando do que o app lê de uma vez, a busca
 * falha em vez de cortar a lista.
 */
export async function fetchDraftReceipts(): Promise<ReceiptListRow[]> {
  const rows = await readAll<ReceiptListRow>(
    (after) => {
      const query = supabase.from('receipts').select(LIST_COLUMNS, { count: 'exact' }).eq('status', 'draft');
      return (after ? query.gt('id', after) : query).order('id').limit(DRAFTS_PAGE);
    },
    MAX_DRAFTS,
    {
      tooMany: 'São mais notas para revisar do que o app consegue ler de uma vez.',
      incomplete: 'As notas para revisar não chegaram inteiras. Tente de novo.',
    },
  );
  return rows.sort((a, b) => Date.parse(b.purchased_at) - Date.parse(a.purchased_at) || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
}

export function useDraftReceipts() {
  return useQuery({ queryKey: ['receipts', 'drafts'], queryFn: fetchDraftReceipts });
}

/** Onde a página seguinte do histórico começa: logo depois desta nota, na ordem da compra (e do id, no empate). */
export interface ReceiptCursor {
  purchasedAt: string;
  id: string;
}

export interface ReceiptHistoryPage {
  rows: ReceiptListRow[];
  /** Quantas notas confirmadas ainda vêm depois desta página; null quando o servidor não contou. */
  remaining: number | null;
}

/**
 * Uma página do histórico: as notas confirmadas da mais recente para a mais antiga, as que vêm depois de
 * `after`. Pelo cursor (a data da compra e o id da última nota lida), não pela posição: uma nota nova ou
 * apagada entre duas páginas não pula nem repete nenhuma. O servidor conta quantas vêm dali em diante, e o
 * botão de ver mais diz quantas faltam.
 */
export async function fetchReceiptHistoryPage(after: ReceiptCursor | null): Promise<ReceiptHistoryPage> {
  const query = supabase.from('receipts').select(LIST_COLUMNS, { count: 'exact' }).eq('status', 'confirmed');
  // A data entre aspas: o horário traz ":" e "." (e o fuso, "+"), que o filtro "or" leria como separadores.
  const older = after
    ? query.or(`purchased_at.lt."${after.purchasedAt}",and(purchased_at.eq."${after.purchasedAt}",id.lt.${after.id})`)
    : query;
  const result = await older.order('purchased_at', { ascending: false }).order('id', { ascending: false }).limit(RECEIPTS_PAGE);
  const rows = (unwrap(result) ?? []) as unknown as ReceiptListRow[];
  if (result.count == null) return { rows, remaining: rows.length < RECEIPTS_PAGE ? 0 : null };
  // O servidor diz que há mais e não manda: melhor o erro do que um histórico que acaba antes da hora.
  if (rows.length === 0 && result.count > 0) throw new Error('O histórico de notas não chegou inteiro. Tente de novo.');
  return { rows, remaining: Math.max(0, result.count - rows.length) };
}

/** O cursor da página seguinte; undefined quando não há mais nota. */
export function nextReceiptCursor(page: ReceiptHistoryPage): ReceiptCursor | undefined {
  const last = page.rows[page.rows.length - 1];
  if (!last || page.remaining === 0) return undefined;
  return { purchasedAt: last.purchased_at, id: last.id };
}

/**
 * O histórico de Finanças > Notas, em páginas de RECEIPTS_PAGE notas confirmadas. A chave começa com
 * 'receipts': confirmar, mudar ou excluir uma nota já recarrega (as páginas já abertas vêm de novo, em ordem).
 */
export function useReceiptHistory() {
  return useInfiniteQuery({
    queryKey: ['receipts', 'history'],
    queryFn: ({ pageParam }) => fetchReceiptHistoryPage(pageParam),
    initialPageParam: null as ReceiptCursor | null,
    getNextPageParam: nextReceiptCursor,
  });
}

/**
 * Os itens da nota, na ordem impressa, com o item genérico da leitura por foto (generic_name) e o código do
 * produto na nota (store_code). Com o banco de antes de uma dessas colunas (o app publicado antes da migração),
 * lê de novo sem ela, uma de cada vez (o erro fala de uma só): a revisão fica como era.
 */
export async function fetchReceiptItems(receiptId: string, db: SupabaseClient = supabase): Promise<ReceiptItem[]> {
  const read = (columns: readonly string[]) =>
    db.from('receipt_items').select([ITEM_BASE_COLUMNS, ...columns].join(', ')).eq('receipt_id', receiptId).order('position');
  let columns: readonly OptionalItemColumn[] = OPTIONAL_ITEM_COLUMNS;
  for (;;) {
    const answer = await read(columns);
    const missing = missingItemColumn(answer.error, columns);
    if (!missing) return unwrap(answer) as unknown as ReceiptItem[];
    columns = columns.filter((column) => column !== missing);
  }
}

/**
 * Grava os itens de uma nota com as colunas recentes e, se o banco ainda não tem uma delas, grava de novo sem
 * ela (uma de cada vez): a nota não se perde por isso. Devolve o erro que sobrar (outra coluna, a RLS), ou null.
 */
export async function insertReceiptItems(rows: Record<string, unknown>[], db: SupabaseClient = supabase): Promise<unknown> {
  let batch = rows;
  let columns: readonly OptionalItemColumn[] = OPTIONAL_ITEM_COLUMNS;
  for (;;) {
    const { error } = await db.from('receipt_items').insert(batch);
    const missing = missingItemColumn(error, columns);
    if (!missing) return error;
    columns = columns.filter((column) => column !== missing);
    batch = batch.map(({ [missing]: _dropped, ...row }) => row);
  }
}

/**
 * O produto já aprendido para cada código da nota (match_store_codes): o daquele mercado (pelo CNPJ) e, sem
 * ele, o do código de barras. Sem CNPJ, só o código de barras. O banco de antes da função: nenhum código
 * aprendido, e a nota vem como antes (pelos apelidos).
 */
export async function fetchStoreCodeMatches(
  cnpj: string | null,
  codes: string[],
  db: SupabaseClient = supabase,
): Promise<{ code: string; product_id: string }[]> {
  if (!codes.length) return [];
  const result = await db.rpc('match_store_codes', { p_store_cnpj: cnpj, p_codes: codes });
  if (result.error && isMissingFunction(result.error, 'match_store_codes')) return [];
  return (unwrap(result) ?? []) as { code: string; product_id: string }[];
}

export function useReceipt(id: string) {
  return useQuery({
    queryKey: ['receipt', id],
    queryFn: async () => {
      const receipt = unwrap(
        await supabase.from('receipts').select(RECEIPT_COLUMNS).eq('id', id).single(),
      ) as unknown as Receipt;
      const items = await fetchReceiptItems(id);
      return { receipt, items };
    },
  });
}

/** Uma nota confirmada perto da data do rascunho, com o CNPJ do mercado: o que a revisão confere (domain/duplicateReceipt). */
export interface NearbyReceipt {
  id: string;
  store_id: string | null;
  purchased_at: string;
  total: number | null;
  store: { id: string; name: string; cnpj: string | null } | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;
/** Notas confirmadas da casa num mesmo dia são poucas; o teto só protege a busca. */
const NEARBY_LIMIT = 50;

/**
 * As notas confirmadas da casa até um dia antes ou depois do instante (a RLS só mostra as da casa aberta): o mesmo
 * dia de São Paulo cabe nessa janela qualquer que seja a hora. O resto da conta é do domínio.
 */
export async function fetchConfirmedNear(purchasedAt: string): Promise<ReceiptFingerprint[]> {
  const at = Date.parse(purchasedAt);
  if (Number.isNaN(at)) return [];
  const result = await supabase
    .from('receipts')
    .select('id, store_id, purchased_at, total, store:stores(id, name, cnpj)')
    .eq('status', 'confirmed')
    .gte('purchased_at', new Date(at - DAY_MS).toISOString())
    .lte('purchased_at', new Date(at + DAY_MS).toISOString())
    .limit(NEARBY_LIMIT);
  return ((unwrap(result) ?? []) as unknown as NearbyReceipt[]).map((row) => ({
    id: row.id,
    storeId: row.store_id,
    storeCnpj: row.store?.cnpj ?? null,
    storeName: row.store?.name ?? null,
    purchasedAt: row.purchased_at,
    total: row.total,
  }));
}

/**
 * As confirmadas perto do rascunho em revisão. A chave começa com 'receipts': confirmar ou excluir uma nota refaz a
 * busca. Sem a busca (erro), a revisão segue sem o aviso.
 */
export function useConfirmedNear(purchasedAt: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: ['receipts', 'confirmedNear', purchasedAt],
    enabled: enabled && Boolean(purchasedAt),
    queryFn: () => fetchConfirmedNear(purchasedAt!),
  });
}

/**
 * De quando é a nota guardada (a leitura mais recente que chegou do banco), vista na hora da chamada e não no
 * render: a tela da nota marca com isso a leitura que ficou atrás de uma gravação dela.
 */
export function useReceiptReadAt(id: string) {
  const queryClient = useQueryClient();
  return () => queryClient.getQueryState(['receipt', id])?.dataUpdatedAt ?? 0;
}

function useInvalidateReceipt(id?: string) {
  const queryClient = useQueryClient();
  return () => {
    queryClient.invalidateQueries({ queryKey: ['receipts'] });
    // Mercado, data, total e quem pagou mudam o resumo de gastos.
    queryClient.invalidateQueries({ queryKey: ['spending'] });
    if (id) queryClient.invalidateQueries({ queryKey: ['receipt', id] });
  };
}

// ---------------------------------------------------------------------------
// Leitura por foto

export type { ScanSource } from './images';

/** Nota comprida (ou os prints da Sefaz) vai em partes: até MAX_RECEIPT_PHOTOS fotos por nota. */
export { MAX_RECEIPT_PHOTOS };

/**
 * Abre câmera (uma foto) ou galeria (até `limit`, em ordem); vazio se o usuário desistir. No navegador a galeria
 * pode trazer mais que `limit`: vem tudo, e quem chama recusa, em vez de cortar sem avisar (a ordem dos arquivos
 * ali não é garantida, e o rodapé com a data podia ser o que ficava de fora).
 */
export async function pickReceiptImages(source: ScanSource, limit = 1): Promise<string[]> {
  return pickAllImages(source, limit);
}

export interface ReceiptPhotos {
  /** Fotos em ordem, de cima para baixo. */
  uris: string[];
  /**
   * Chave de acesso já conhecida (do QR code, quando a Sefaz pediu o "não sou
   * robô"): a nota lida guarda essa chave, e ler o QR de novo abre esta nota.
   */
  accessKey?: string | null;
}

/**
 * Fotos da nota -> upload -> leitura por IA -> rascunho de nota. Devolve o
 * id da nota para a tela de revisão (ou o da nota que já tinha essa chave).
 */
export async function scanReceiptPhotos(
  householdId: string | undefined,
  { uris, accessKey }: ReceiptPhotos,
): Promise<{ receipt_id: string; duplicate: boolean }> {
  if (!householdId) throw new Error('Família não carregada.');
  // Falha no envio de uma parte apaga as que já subiram.
  const sent = uris.slice(0, MAX_RECEIPT_PHOTOS);
  const paths = await uploadImages('receipts', householdId, sent);
  const removeAll = () => removeImages('receipts', paths).catch(() => undefined);

  const { data, error } = await supabase.functions.invoke<{ receipt_id: string; duplicate: boolean }>('parse-receipt', {
    body: accessKey ? { image_paths: paths, access_key: accessKey } : { image_paths: paths },
  });
  if (error || !data) {
    // A função respondeu com erro: nenhuma nota foi criada com essas
    // fotos, então elas saem do storage. Em falha de rede o resultado é
    // incerto (a nota pode ter sido salva) e as fotos ficam.
    if (error instanceof FunctionsHttpError) await removeAll();
    const { message, code } = await functionErrorDetails(error, 'Não foi possível ler a nota. Tente novamente.');
    // A função de antes do limite novo recusa as fotos a mais sem dizer por quê: a pessoa fica sabendo quantas mandar.
    const status = error instanceof FunctionsHttpError ? ((error.context as Response | undefined)?.status ?? null) : null;
    throw new Error(tooManyPhotosMessage(sent.length, { status, code }) ?? message);
  }
  // Nota que já estava no app (mesma chave): as fotos novas sobram.
  if (data.duplicate) await removeAll();
  return data;
}

export function useScanReceipt(householdId: string | undefined) {
  const invalidate = useInvalidateReceipt();
  return useMutation({
    mutationFn: (photos: ReceiptPhotos) => scanReceiptPhotos(householdId, photos),
    onSuccess: invalidate,
  });
}

// ---------------------------------------------------------------------------
// Leitura pelo QR code (consulta pública da Sefaz, sem IA)

interface NfcePageResult {
  store: { name: string | null; cnpj: string | null; address: string | null };
  /** Hora local da nota, sem fuso. */
  issuedAtLocal: string | null;
  total: number | null;
  items: NfceItem[];
  /** A leitura que a função gravou no servidor (receipt_reads); ausente na função de antes, nula se não deu para gravar. */
  readId?: string | null;
}

/** Mesmo nome de loja, sem caixa nem espaços nas pontas (num ILIKE, "%", "_" e "*" seriam curingas). */
const sameStoreName = (a: string, b: string) => a.trim().toLocaleLowerCase('pt-BR') === b.trim().toLocaleLowerCase('pt-BR');

const STORE_PAGE = 1000;

/**
 * A loja sem CNPJ com este nome, página a página (a API devolve até 1000 linhas por pedido). Vale também o nome
 * impresso da loja que a casa renomeou; o banco antes da coluna só tem o nome.
 */
async function findUnnamedStore(name: string): Promise<{ id: string } | null> {
  let columns = 'id, name, printed_name';
  for (let from = 0; ; from += STORE_PAGE) {
    const read = () => supabase.from('stores').select(columns).is('cnpj', null).order('id').range(from, from + STORE_PAGE - 1);
    let result = await read();
    if (result.error && columns.includes('printed_name') && isMissingColumn(result.error, 'printed_name')) {
      columns = 'id, name';
      result = await read();
    }
    const page = unwrap(result) as unknown as { id: string; name: string; printed_name?: string | null }[];
    const found = page.find((s) => sameStoreName(s.name, name) || (s.printed_name != null && sameStoreName(s.printed_name, name)));
    if (found) return found;
    if (page.length < STORE_PAGE) return null;
  }
}

/** Mercado pelo CNPJ (ou nome), criando se ainda não existe, como na leitura por foto. */
async function findOrCreateStore(store: { name: string | null; cnpj: string | null; address: string | null }) {
  if (!store.name && !store.cnpj) return null;
  const existing = store.cnpj
    ? (unwrap(await supabase.from('stores').select('id').eq('cnpj', store.cnpj).limit(1).maybeSingle()) as { id: string } | null)
    : await findUnnamedStore(store.name!);
  if (existing) return existing.id;
  const created = unwrap(
    await supabase
      .from('stores')
      .insert({ name: store.name ?? `CNPJ ${store.cnpj}`, cnpj: store.cnpj, address: store.address })
      .select('id')
      .single(),
  ) as { id: string };
  return created.id;
}

/**
 * Busca a nota na Sefaz (função `nfce`). Se falhar, o erro (FunctionError)
 * traz o código da função: com 'captcha', a tela leva para a foto da nota.
 */
export async function fetchNfcePage(url: string): Promise<NfcePageResult> {
  const { data, error } = await supabase.functions.invoke<NfcePageResult>('nfce', { body: { url } });
  if (error || !data) {
    const { message, code } = await functionErrorDetails(error, 'Não deu para buscar a nota na Sefaz agora.');
    throw new FunctionError(message, code);
  }
  return data;
}

/**
 * QR code da nota -> itens da Sefaz (função `nfce`) -> rascunho de nota,
 * com produtos já conhecidos pelos apelidos e categoria pelas palavras.
 * Nota já importada (mesma chave, também pela foto) abre a existente.
 * `skipSefaz`: o estado da nota pediu o "não sou robô" há pouco
 * (domain/captchaStates). A nota que a casa ainda não tem nem vai à Sefaz:
 * falha com NFCE_CAPTCHA_STATE, que leva à nota pendente.
 */
export function useImportNfce() {
  const invalidate = useInvalidateReceipt();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ skipSefaz, ...qr }: NfceQr & { skipSefaz?: boolean }): Promise<{ receipt_id: string; duplicate: boolean }> => {
      const dup = unwrap(
        await supabase.from('receipts').select('id, source, status, receipt_items(count)').eq('access_key', qr.accessKey).maybeSingle(),
      ) as { id: string; source: string; status: string; receipt_items: { count: number }[] } | null;
      if (dup) {
        // Rascunho do QR code sem itens é uma importação que parou no meio (o
        // app fechou entre gravar a nota e os itens): apaga e importa de novo.
        // O de foto fica: tem a foto e pode ser completado à mão.
        const unfinished = dup.source === 'qrcode' && dup.status === 'draft' && (dup.receipt_items[0]?.count ?? 0) === 0;
        if (!unfinished) return { receipt_id: dup.id, duplicate: true };
        unwrap(await supabase.from('receipts').delete().eq('id', dup.id));
      }
      if (skipSefaz) throw new FunctionError('A Sefaz deste estado está pedindo a verificação de que você não é robô.', NFCE_CAPTCHA_STATE);
      if (!qr.url) throw new Error('Só com a chave não dá para ver os itens: leia o QR code da nota ou tire uma foto dela.');

      const page = await fetchNfcePage(qr.url);
      // O mercado da nota: o CNPJ da página e, sem ele, o da chave. É o da loja da nota, com que a confirmação
      // ensina os códigos.
      const cnpj = page.store.cnpj ?? qr.cnpj;

      // Primeiro o código do produto já aprendido (do mercado, depois o de barras), depois a descrição.
      const codeRows = await fetchStoreCodeMatches(cnpj, nfceStoreCodes(page.items));
      const descriptions = page.items.map((item) => item.description.trim().replace(/\s+/g, ' '));
      const aliasRows = unwrap(await supabase.rpc('match_aliases', { p_descriptions: descriptions })) as
        | { description: string; product_id: string }[]
        | null;
      const productIds = [...new Set([...(aliasRows ?? []), ...codeRows].map((row) => row.product_id))];
      const products = productIds.length
        ? (unwrap(await supabase.from('products').select('id, category').in('id', productIds)) as { id: string; category: string }[])
        : [];
      const categoryOf = new Map(products.map((p) => [p.id, p.category]));
      const known = (productId: string) => ({ productId, category: categoryOf.get(productId) ?? 'outros' });
      const aliases = new Map((aliasRows ?? []).map((row) => [row.description, known(row.product_id)]));
      const codes = new Map(codeRows.map((row) => [row.code, known(row.product_id)]));
      // O nome sugerido de cada item, com as abreviações que a casa já ensinou; sem elas, só a tabela fixa.
      const learned = await loadLearnedAbbreviations(queryClient);

      const storeId = await findOrCreateStore({ ...page.store, cnpj });
      // Com o id da leitura do servidor, quando a função devolveu um: é o que deixa a nota compartilhar preço.
      const receipt = await insertNfceReceipt(nfceReceiptRow(page, qr, storeId));
      const items = nfceItemsToDraft(page.items, aliases, codes, learned).map((item) => ({ ...item, receipt_id: receipt.id }));
      // Com o código de cada linha; o banco de antes da coluna recebe as linhas sem ele.
      const itemsError = await insertReceiptItems(items);
      if (itemsError) {
        await supabase.from('receipts').delete().eq('id', receipt.id);
        throw itemsError;
      }
      return { receipt_id: receipt.id, duplicate: false };
    },
    onSuccess: invalidate,
  });
}

/**
 * Grava o rascunho da nota do QR code. A leitura do servidor leva a casa junto
 * (chave estrangeira com household_id): se a pessoa trocou de casa entre a
 * leitura e a gravação, o banco recusa o read_id (23503) e a nota é gravada de
 * novo sem ele. Ela não se perde por isso, só não compartilha preço.
 */
export async function insertNfceReceipt(row: ReturnType<typeof nfceReceiptRow>): Promise<{ id: string }> {
  const first = await supabase.from('receipts').insert(row).select('id').single();
  if (first.error && 'read_id' in row && (first.error as { code?: string }).code === '23503') {
    const { read_id: _refused, ...withoutRead } = row;
    return unwrap(await supabase.from('receipts').insert(withoutRead).select('id').single()) as { id: string };
  }
  return unwrap(first) as { id: string };
}

export function useCreateManualReceipt() {
  const invalidate = useInvalidateReceipt();
  return useMutation({
    mutationFn: async () =>
      unwrap(await supabase.from('receipts').insert({ source: 'manual' }).select('id').single()) as { id: string },
    onSuccess: invalidate,
  });
}

// ---------------------------------------------------------------------------
// Revisão

export function useUpdateReceipt(id: string) {
  const invalidate = useInvalidateReceipt(id);
  return useMutation({
    mutationFn: async (patch: Partial<Pick<Receipt, 'store_id' | 'purchased_at' | 'paid_by'>>) =>
      unwrap(await supabase.from('receipts').update(patch).eq('id', id)),
    onSuccess: invalidate,
  });
}

/**
 * O total da nota, que só a revisão deixa corrigir: a gravação só acha a nota
 * enquanto ela é rascunho. Confirmada em outro aparelho, nada é gravado, e a
 * nota relida (a tela vira a da nota confirmada) é o aviso. É uma gravação à
 * parte da de data e de quem pagou, com o próprio "salvando": uma em andamento
 * não segura a outra.
 */
export function useSetReceiptTotal(id: string) {
  const invalidate = useInvalidateReceipt(id);
  return useMutation({
    // Pede a linha de volta: a nota confirmada em outro aparelho não é achada (o filtro é o rascunho), e o banco
    // não reclama. Quem chamou precisa saber que nada foi gravado, para não seguir como se a nota fosse rascunho.
    mutationFn: async (total: number | null): Promise<{ saved: boolean }> => {
      const rows = unwrap(await supabase.from('receipts').update({ total }).eq('id', id).eq('status', 'draft').select('id')) as { id: string }[] | null;
      return { saved: Boolean(rows?.length) };
    },
    onSuccess: invalidate,
  });
}

/** O mercado escolhido na nota: um da casa, ou um novo, criado com o nome digitado. */
export type StoreChoice = { id: string } | { name: string };

async function storeIdFor(store: StoreChoice): Promise<string> {
  if ('id' in store) return store.id;
  const created = unwrap(await supabase.from('stores').insert({ name: store.name }).select('id').single()) as { id: string };
  return created.id;
}

/**
 * O mercado novo é criado antes de a nota gravar. Se a nota falhar depois, o mercado já existe: os mercados da
 * casa são buscados de novo mesmo assim, para o seletor mostrá-lo e a pessoa escolhê-lo em vez de criar outro
 * com o mesmo nome.
 */
function refreshCreatedStore(queryClient: QueryClient, store: StoreChoice) {
  if ('name' in store) queryClient.invalidateQueries({ queryKey: ['stores'] });
}

export function useSetReceiptStore(receiptId: string) {
  const invalidate = useInvalidateReceipt(receiptId);
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (store: StoreChoice) => {
      const storeId = await storeIdFor(store);
      unwrap(await supabase.from('receipts').update({ store_id: storeId }).eq('id', receiptId));
    },
    onSuccess: invalidate,
    onSettled: (_data, _error, store) => refreshCreatedStore(queryClient, store),
  });
}

export interface ItemValues {
  raw_description: string;
  quantity: number;
  unit: Unit;
  unit_price: number;
  total_price: number;
}

export function useSaveReceiptItem(receiptId: string) {
  const invalidate = useInvalidateReceipt(receiptId);
  return useMutation({
    // Devolve o id do item. O do item novo é o banco que dá, e a tela precisa dele antes de a nota voltar: o zero
    // digitado de propósito é "deixar sem valor", e o item novo não pode perguntar pelo valor quando aparecer.
    mutationFn: async ({ id, values, position }: { id?: string; values: ItemValues; position?: number }): Promise<{ id: string }> => {
      if (id) {
        unwrap(await supabase.from('receipt_items').update(values).eq('id', id));
        return { id };
      }
      return unwrap(
        await supabase
          .from('receipt_items')
          .insert({ ...values, receipt_id: receiptId, position: position ?? 0 })
          .select('id')
          .single(),
      ) as { id: string };
    },
    onSuccess: invalidate,
  });
}

export function useDeleteReceiptItem(receiptId: string) {
  const invalidate = useInvalidateReceipt(receiptId);
  return useMutation({
    mutationFn: async (id: string) => unwrap(await supabase.from('receipt_items').delete().eq('id', id)),
    onSuccess: invalidate,
  });
}

export function useConfirmReceipt(receiptId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    // Um produto da nota pode ter sido juntado com outro em outro aparelho, com esta revisão aberta: os
    // produtos e a nota são buscados de novo, os dois, antes de a gravação terminar. Só com os produtos de
    // agora e a nota de antes, o item desse produto pareceria um produto novo, e confirmar o criaria de novo.
    mutationFn: (items: ConfirmItem[]) =>
      withFreshProducts(queryClient, ['products', 'receipt'], async () =>
        unwrap(await supabase.rpc('confirm_receipt', { p_receipt_id: receiptId, p_items: items })),
      ),
    onSuccess: () => {
      for (const key of [
        'receipts',
        'receipt',
        'products',
        'latestPrices',
        'priceHistory',
        'pantry',
        'spending',
        'purchaseRecords',
        'lists',
        'listItems',
        'listLinks',
        // A nota ensina apelidos novos, e é por eles que os preços de outras casas chegam aos produtos desta.
        'sharedPrices',
        // Os mesmos apelidos ensinam as abreviações dos mercados da casa (domain/learnedAbbreviations).
        'productAliases',
        // A leitura do QR code pode ter criado o mercado, e é pelo nome dele que a casa reconhece "os seus mercados".
        'stores',
        // A nota ensina os códigos de barras das linhas (product_barcodes), que a câmera lê depois.
        'productBarcodes',
      ]) {
        queryClient.invalidateQueries({ queryKey: [key] });
      }
    },
  });
}

/**
 * O que mostra os itens de uma nota já confirmada: comparativo, histórico de preço, gastos, compras recentes e os
 * preços de outras casas (a compra da casa esconde a linha de fora daquele mercado, e a casa sem nota confirmada
 * nenhuma não vê preço de fora).
 */
const CONFIRMED_ITEM_KEYS = ['receipts', 'latestPrices', 'priceHistory', 'spending', 'purchaseRecords', 'sharedPrices'];

/** Uma correção da nota já confirmada, uma por vez: a data da compra, o mercado ou o total. */
export type ReceiptCorrection = { purchased_at: string } | { store: StoreChoice } | { total: number | null };

/**
 * Corrigir a nota já confirmada (domain/receiptEdit). Vale para a casa: a data
 * põe a nota no mês certo dos gastos e do Mercado do mês, e o mercado e a data
 * mudam o histórico de preço e o comparativo; os preços que a nota deu para
 * outras casas não mudam (o gatilho de shared_prices só dispara na passagem de
 * rascunho para confirmada, e a leitura do servidor some nela). A gravação só
 * acha a nota confirmada e pede a linha de volta: `saved` falso é a nota
 * excluída em outro aparelho. A linha gravada vai para a nota guardada antes de
 * a busca nova chegar, para o campo que fecha mostrar o que foi gravado.
 */
export function useCorrectReceipt(receiptId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (change: ReceiptCorrection): Promise<{ saved: boolean; receipt: Receipt | null }> => {
      const patch = 'store' in change ? { store_id: await storeIdFor(change.store) } : change;
      const rows = unwrap(
        await supabase.from('receipts').update(patch).eq('id', receiptId).eq('status', 'confirmed').select(RECEIPT_COLUMNS),
      ) as unknown as Receipt[] | null;
      const receipt = rows?.[0] ?? null;
      return { saved: Boolean(receipt), receipt };
    },
    onSuccess: ({ receipt }, change) => {
      const key = ['receipt', receiptId];
      if (receipt) {
        // Os itens guardados continuam os da leitura de antes, e a data dela também: a tela da nota sabe por ela
        // se a nota em tela ficou atrás de um valor de item gravado.
        queryClient.setQueryData<{ receipt: Receipt; items: ReceiptItem[] }>(key, (data) => data && { ...data, receipt }, {
          updatedAt: queryClient.getQueryState(key)?.dataUpdatedAt,
        });
      }
      for (const name of CONFIRMED_ITEM_KEYS) {
        queryClient.invalidateQueries({ queryKey: [name] });
      }
      queryClient.invalidateQueries({ queryKey: key });
    },
    // O mercado criado aqui entra na lista dos mercados da casa, também quando a nota não gravou.
    onSettled: (_data, _error, change) => {
      if ('store' in change) refreshCreatedStore(queryClient, change.store);
    },
  });
}

export function useDeleteReceipt(receiptId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (imagePaths: string[]) => {
      unwrap(await supabase.from('receipts').delete().eq('id', receiptId));
      if (imagePaths.length) await supabase.storage.from('receipts').remove(imagePaths);
    },
    onSuccess: () => {
      for (const key of CONFIRMED_ITEM_KEYS) {
        queryClient.invalidateQueries({ queryKey: [key] });
      }
    },
  });
}

/**
 * Dar valor ao item que ficou sem (total zerado): o caminho de "Usar R$ …",
 * na revisão e na nota confirmada, e o único conserto que a nota confirmada
 * aceita. A descrição não vai no pedido, e o filtro do total zerado deixa
 * quieto o item que já ganhou valor em outro aparelho: `filled` diz se o item
 * foi gravado, para a tela avisar em vez de sumir calada com o valor
 * escolhido. Na nota confirmada esse item já conta nos preços e nos gastos:
 * salvar atualiza o mesmo que excluir a nota (na revisão a nota pode ter sido
 * confirmada em outro aparelho, e refazer essas buscas não custa).
 */
export function useFillReceiptItemValue(receiptId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    // Só o preço e o total. A quantidade e a unidade ficam como estão: na nota confirmada elas já foram para a
    // despensa (confirm_receipt copia as duas para o item de lá), e mudá-las aqui deixaria as duas telas em
    // desacordo.
    mutationFn: async ({ id, values }: { id: string; values: Pick<ItemValues, 'unit_price' | 'total_price'> }): Promise<{ filled: boolean }> => {
      const { unit_price, total_price } = values;
      const rows = unwrap(
        await supabase
          .from('receipt_items')
          .update({ unit_price, total_price })
          .eq('id', id)
          .eq('receipt_id', receiptId)
          .eq('total_price', 0)
          .select('id'),
      ) as { id: string }[] | null;
      return { filled: Boolean(rows?.length) };
    },
    onSuccess: () => {
      for (const key of CONFIRMED_ITEM_KEYS) {
        queryClient.invalidateQueries({ queryKey: [key] });
      }
      queryClient.invalidateQueries({ queryKey: ['receipt', receiptId] });
    },
  });
}

export function receiptImageUrl(path: string): Promise<string | null> {
  return signedImageUrl('receipts', path);
}
