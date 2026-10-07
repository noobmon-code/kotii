// POST (pg_cron, a cada minuto com aviso vencido; ver request_push_send) ->
// { sent, failed, gone, retry }
//
// Reserva no banco os avisos do navegador que venceram (take_due_pushes),
// envia cada um ao serviço de push do navegador, assinado com as chaves
// VAPID do Vault, e confirma (finish_pushes): o entregue sai da agenda ou
// anda para a próxima vez; o que falhou por um instante volta para a fila.
// Inscrição que não existe mais (404/410) sai do banco.
// Só aceita quem traz o segredo do agendamento (x-push-secret).

import { createClient } from '@supabase/supabase-js';
import { ApplicationServer, importVapidKeys, PushMessageError, Urgency } from '@negrel/webpush';

import { sameSecret } from '../_shared/secret.ts';
import { type DuePush, PushFailed, type PushSender, sendAll } from './push.ts';

interface PushConfig {
  publicKey: JsonWebKey;
  privateKey: JsonWebKey;
  /** Contato do servidor para os serviços de push (URL https ou mailto:). */
  subject: string;
  cronSecret: string;
}

/** Aviso que ficou mais de uma hora sem chegar (aparelho desligado) já não vale. */
const TTL_SECONDS = 3600;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'Método não suportado.' }, 405);

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const { data: config, error: configError } = await admin.rpc('push_config');
  if (configError || !config) {
    console.error('push config missing', configError);
    return json({ error: 'Avisos do navegador não configurados.' }, 503);
  }
  const { publicKey, privateKey, subject, cronSecret } = config as PushConfig;
  if (!sameSecret(req.headers.get('x-push-secret'), cronSecret)) return json({ error: 'Não autorizado.' }, 401);

  const { data: due, error: dueError } = await admin.rpc('take_due_pushes');
  if (dueError) {
    console.error('take_due_pushes failed', dueError);
    return json({ error: 'Falhou.' }, 500);
  }
  const pushes = (due ?? []) as DuePush[];
  if (!pushes.length) return json({ sent: 0, failed: 0, gone: 0 });

  const app = await ApplicationServer.new({
    contactInformation: subject,
    vapidKeys: await importVapidKeys({ publicKey, privateKey }),
  });
  const sender: PushSender = {
    send: async (subscription, payload) => {
      try {
        await app.subscribe(subscription).pushTextMessage(payload, { ttl: TTL_SECONDS, urgency: Urgency.High });
      } catch (err) {
        if (err instanceof PushMessageError) throw new PushFailed(err.response.status);
        throw err;
      }
    },
  };
  const result = await sendAll(pushes, sender);
  if (result.gone.length) {
    const { error } = await admin.from('push_subscriptions').delete().in('id', result.gone);
    if (error) console.error('could not drop gone subscriptions', error);
  }
  // Sem a confirmação, a reserva vence em 5 minutos e os avisos saem de novo.
  const { error: finishError } = await admin.rpc('finish_pushes', { p_done: result.done, p_retry: result.retry });
  if (finishError) console.error('finish_pushes failed', finishError);
  return json({ sent: result.sent, failed: result.failed, gone: result.gone.length, retry: result.retry.length });
});
