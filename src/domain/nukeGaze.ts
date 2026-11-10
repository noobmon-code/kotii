// Para onde o Nuke olha na conversa: a tela mede onde ele e a mensagem estão, e daqui sai só a direção.
// Sem React nem medidas de tela: quem desenha (ui/NukeLive) decide quanto os olhos andam.

export interface Point {
  x: number;
  y: number;
}

/** Um retângulo na tela, como o `measureInWindow` devolve. */
export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * A direção do olhar: um vetor de tamanho 1 (ou zero, olhando para a frente), com x para a direita e y para
 * baixo, como na tela.
 */
export type Gaze = Point;

/** Por quanto tempo ele fica olhando para a resposta que deu, antes de voltar a olhar em volta. */
export const GAZE_HOLD_MS = 6000;
/** A mensagem de quem escreve ele só lê: olha um instante e vai pensar na resposta. */
export const GAZE_READ_MS = 1400;

/** Quanto dura o olhar para uma mensagem, por quem a escreveu. */
export const gazeHoldMs = (role: 'user' | 'assistant') => (role === 'user' ? GAZE_READ_MS : GAZE_HOLD_MS);

/** Mais perto do que isto (em pontos), não há para onde virar os olhos. */
const NEAR = 4;

const round = (value: number) => Math.round(value * 100) / 100 || 0;

export const centerOf = (box: Box): Point => ({ x: box.x + box.width / 2, y: box.y + box.height / 2 });

/**
 * A direção de `from` (o centro do Nuke) até `to` (o centro da mensagem), arredondada a centésimos para duas
 * medidas quase iguais darem o mesmo olhar. Medida que não é número, ou alvo em cima dele, não tem direção.
 */
export function gazeToward(from: Point, to: Point): Gaze | null {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const distance = Math.hypot(dx, dy);
  if (!Number.isFinite(distance) || distance < NEAR) return null;
  return { x: round(dx / distance), y: round(dy / distance) };
}

/**
 * O olhar do Nuke (o retângulo dele) para uma mensagem (o dela). Uma mensagem que ainda não foi desenhada
 * (largura ou altura zero) não tem para onde olhar.
 */
export function gazeAt(nuke: Box, message: Box): Gaze | null {
  if (!(nuke.width > 0 && nuke.height > 0 && message.width > 0 && message.height > 0)) return null;
  return gazeToward(centerOf(nuke), centerOf(message));
}

export const sameGaze = (a: Gaze | null, b: Gaze | null) => (a === null || b === null ? a === b : a.x === b.x && a.y === b.y);
