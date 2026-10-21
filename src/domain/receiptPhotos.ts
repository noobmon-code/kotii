// Quantas fotos (ou prints da Sefaz) uma nota leva na leitura por IA. O limite
// é o mesmo da função parse-receipt (MAX_PHOTOS em extract.ts; um teste confere).
// Cada foto a mais custa tempo e IA, mas a nota comprida e os prints da página
// da Sefaz (o topo, os itens e o rodapé) precisam de mais que 4. A nota guarda
// a primeira em image_path e as outras em extra_image_paths, que o banco limita
// a 5 (outro teste confere): passar de 6 pede uma migração antes do deploy.

/** Até quantas fotos por nota. */
export const MAX_RECEIPT_PHOTOS = 6;

/** O limite da função publicada antes deste: ela recusa mais que isso com um "Imagem inválida." genérico. */
export const PREVIOUS_MAX_RECEIPT_PHOTOS = 4;

/** O código da função quando vêm mais fotos do que ela lê (a função de agora diz o limite na mensagem). */
export const TOO_MANY_PHOTOS = 'too_many_photos';

/**
 * A mensagem para a recusa da leitura quando foram mais fotos do que a função aceita. A função de agora diz o
 * limite dela (código TOO_MANY_PHOTOS) e a mensagem dela vale. A de antes (publicada antes do limite novo)
 * responde 400 sem código a mais de PREVIOUS_MAX_RECEIPT_PHOTOS fotos: aí a pessoa fica sabendo quantas mandar.
 * null: não foi por isso, vale a mensagem da função.
 */
export function tooManyPhotosMessage(sent: number, reply: { status: number | null; code: string | null }): string | null {
  if (reply.code !== null || reply.status !== 400 || sent <= PREVIOUS_MAX_RECEIPT_PHOTOS) return null;
  return `Por enquanto, a leitura aceita até ${PREVIOUS_MAX_RECEIPT_PHOTOS} fotos por nota. Mande de novo com até ${PREVIOUS_MAX_RECEIPT_PHOTOS}, escolhendo as que mostram os itens, o nome do mercado e a data.`;
}
