// Envio dos avisos do navegador (Web Push). A agenda e a escolha do que
// venceu ficam no banco (take_due_pushes); aqui só o envio para o serviço de
// push de cada navegador e a limpeza dos que deixaram de existir.

/** Um aviso vencido, como take_due_pushes devolve. */
export interface DuePush {
  push_id: string;
  subscription_id: string;
  endpoint: string;
  p256dh: string;
  auth_secret: string;
  title: string;
  body: string;
  data: Record<string, unknown> | null;
}

export interface BrowserSubscription {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

export interface PushSender {
  send(subscription: BrowserSubscription, payload: string): Promise<void>;
}

/** O serviço de push recusou (status HTTP). */
export class PushFailed extends Error {
  constructor(readonly status: number) {
    super(`push failed: ${status}`);
  }
}

/** Espelho de public.is_push_endpoint: só os serviços de push dos navegadores. */
const PUSH_ENDPOINT =
  /^https:\/\/(fcm\.googleapis\.com|android\.googleapis\.com|updates\.push\.services\.mozilla\.com|web\.push\.apple\.com|[a-z0-9-]+\.push\.apple\.com|[a-z0-9-]+\.notify\.windows\.com)\//;

export const isPushEndpoint = (endpoint: string) => endpoint.length <= 1000 && PUSH_ENDPOINT.test(endpoint);

/** Inscrição que não existe mais: sai do banco. */
export const isGone = (status: number) => status === 404 || status === 410;

/** Falha passageira do serviço de push: o aviso volta para a fila (dentro da mesma hora). */
export const isTransient = (status: number) => status === 429 || status >= 500;

/** O que o service worker recebe e mostra (public/sw.js). */
export function payloadOf(push: DuePush): string {
  const data = push.data ?? {};
  const tag = typeof data.reminder === 'string' ? data.reminder : typeof data.medicationId === 'string' ? `remedio:${data.medicationId}` : push.push_id;
  return JSON.stringify({ title: push.title, body: push.body, tag, url: '/' });
}

export interface SendResult {
  sent: number;
  failed: number;
  /** Inscrições a apagar. */
  gone: string[];
  /** Avisos resolvidos (entregues ou recusados de vez): saem da agenda ou andam para a próxima vez. */
  done: string[];
  /** Avisos que falharam por um instante: voltam para a fila. */
  retry: string[];
}

/** Envia todos, alguns ao mesmo tempo; falha de um não impede os outros. */
export async function sendAll(pushes: DuePush[], sender: PushSender, { concurrency = 10 } = {}): Promise<SendResult> {
  const result: SendResult = { sent: 0, failed: 0, gone: [], done: [], retry: [] };
  const gone = new Set<string>();
  let next = 0;
  async function worker() {
    while (next < pushes.length) {
      const push = pushes[next++];
      if (gone.has(push.subscription_id) || !isPushEndpoint(push.endpoint)) {
        if (!gone.has(push.subscription_id)) result.failed += 1;
        result.done.push(push.push_id);
        continue;
      }
      try {
        await sender.send({ endpoint: push.endpoint, keys: { p256dh: push.p256dh, auth: push.auth_secret } }, payloadOf(push));
        result.sent += 1;
        result.done.push(push.push_id);
      } catch (err) {
        result.failed += 1;
        const status = err instanceof PushFailed ? err.status : null;
        if (status !== null && isGone(status)) gone.add(push.subscription_id);
        else console.error('push failed', push.subscription_id, err instanceof Error ? err.message : err);
        // Sem resposta (rede) ou serviço fora: tenta de novo; recusa de vez (4xx): não.
        if (status === null || isTransient(status)) result.retry.push(push.push_id);
        else result.done.push(push.push_id);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, pushes.length) }, worker));
  result.gone = [...gone];
  return result;
}

/** Compara o segredo do agendamento sem vazar, pelo tempo, quanto dele bateu. */
export function sameSecret(given: string | null, expected: string): boolean {
  if (given === null || given.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= given.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}
