// Gera as chaves VAPID dos avisos do navegador e imprime o SQL que guarda
// tudo no Vault (ver README, "Avisos no navegador"). Rode uma vez:
//
//   deno run supabase/functions/send-push/vapid-keys.ts https://SEU_PROJECT_REF.supabase.co
//
// O argumento é o contato do servidor para os serviços de push (uma URL
// https ou mailto:). Trocar as chaves depois faz cada navegador se inscrever
// de novo na próxima vez que o app abrir.

import { exportApplicationServerKey, exportVapidKeys, generateVapidKeys } from '@negrel/webpush';

const subject = Deno.args[0];
if (!subject || !/^(https:\/\/|mailto:)/.test(subject)) {
  console.error('Informe o contato: uma URL https (a do projeto serve) ou mailto:.');
  Deno.exit(1);
}

const keys = await generateVapidKeys({ extractable: true });
const vapid = {
  ...(await exportVapidKeys(keys)),
  applicationServerKey: await exportApplicationServerKey(keys),
  subject,
};
const secret = Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) => b.toString(16).padStart(2, '0')).join('');
const quote = (value: string) => `'${value.replaceAll("'", "''")}'`;

console.log(`select vault.create_secret(${quote(JSON.stringify(vapid))}, 'push_vapid');`);
console.log(`select vault.create_secret(${quote(secret)}, 'push_cron_secret');`);
