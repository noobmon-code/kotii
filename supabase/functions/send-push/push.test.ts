import { assert, assertEquals } from '@std/assert';
import { ApplicationServer, exportApplicationServerKey, exportVapidKeys, generateVapidKeys, importVapidKeys, Urgency } from '@negrel/webpush';

import { type DuePush, isPushEndpoint, payloadOf, PushFailed, type PushSender, sameSecret, sendAll } from './push.ts';

const due = (overrides: Partial<DuePush> = {}): DuePush => ({
  push_id: 'p1',
  subscription_id: 's1',
  endpoint: 'https://fcm.googleapis.com/fcm/send/abc',
  p256dh: 'chave',
  auth_secret: 'segredo',
  title: 'Conta vence hoje',
  body: 'Luz — R$ 120,00',
  data: { reminder: 'bills:1:2026-10-01' },
  ...overrides,
});

Deno.test('o aviso leva título, texto e a chave do lembrete (um por lembrete na tela)', () => {
  assertEquals(JSON.parse(payloadOf(due())), { title: 'Conta vence hoje', body: 'Luz — R$ 120,00', tag: 'bills:1:2026-10-01', url: '/' });
  assertEquals(JSON.parse(payloadOf(due({ data: { medicationId: 'm1' } }))).tag, 'remedio:m1');
  assertEquals(JSON.parse(payloadOf(due({ data: null }))).tag, 'p1');
});

Deno.test('só envia para os serviços de push dos navegadores', () => {
  assert(isPushEndpoint('https://fcm.googleapis.com/fcm/send/x'));
  assert(isPushEndpoint('https://web.push.apple.com/QAbc'));
  assert(isPushEndpoint('https://updates.push.services.mozilla.com/wpush/v2/x'));
  assert(isPushEndpoint('https://wns2-bn3p.notify.windows.com/w/?token=x'));
  assert(!isPushEndpoint('https://evil.example/fcm.googleapis.com/'));
  assert(!isPushEndpoint('http://fcm.googleapis.com/fcm/send/x'));
});

Deno.test('envia todos; inscrição que sumiu (404/410) sai, e erro de um não para os outros', async () => {
  const sent: string[] = [];
  const sender: PushSender = {
    send: (subscription) => {
      if (subscription.endpoint.endsWith('/sumiu')) return Promise.reject(new PushFailed(410));
      if (subscription.endpoint.endsWith('/fora')) return Promise.reject(new PushFailed(503));
      sent.push(subscription.endpoint);
      return Promise.resolve();
    },
  };
  const result = await sendAll(
    [
      due(),
      due({ push_id: 'p2', subscription_id: 's2', endpoint: 'https://fcm.googleapis.com/fcm/send/sumiu' }),
      due({ push_id: 'p3', subscription_id: 's2', endpoint: 'https://fcm.googleapis.com/fcm/send/sumiu' }),
      due({ push_id: 'p4', subscription_id: 's3', endpoint: 'https://fcm.googleapis.com/fcm/send/fora' }),
      due({ push_id: 'p5', subscription_id: 's4', endpoint: 'https://evil.example/x' }),
    ],
    sender,
    { concurrency: 1 },
  );
  assertEquals(sent, ['https://fcm.googleapis.com/fcm/send/abc']);
  assertEquals(result, { sent: 1, failed: 3, gone: ['s2'] });
});

Deno.test('segredo do agendamento: só o igual passa', () => {
  assert(sameSecret('abc123', 'abc123'));
  assert(!sameSecret('abc124', 'abc123'));
  assert(!sameSecret('abc', 'abc123'));
  assert(!sameSecret(null, 'abc123'));
});

// ---------------------------------------------------------------------------
// De ponta a ponta com a biblioteca: o navegador consegue abrir o aviso.

const b64url = {
  encode: (bytes: ArrayBuffer | Uint8Array) =>
    btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''),
  decode: (text: string): Uint8Array<ArrayBuffer> => Uint8Array.from(atob(text.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0)),
};

type Bytes = Uint8Array<ArrayBuffer>;

async function hkdf(salt: Bytes, ikm: Bytes, info: Bytes, length: number): Promise<Bytes> {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, length * 8));
}

const text = (s: string): Bytes => new TextEncoder().encode(s);
const concat = (...parts: Bytes[]): Bytes => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
};

/** O que o navegador faz ao receber (RFC 8291, aes128gcm). */
async function browserDecrypt(body: Bytes, ua: CryptoKeyPair, authSecret: Bytes): Promise<string> {
  const salt = body.slice(0, 16);
  const idLength = body[20];
  const asPublic = body.slice(21, 21 + idLength);
  const ciphertext = body.slice(21 + idLength);
  const asKey = await crypto.subtle.importKey('raw', asPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: asKey }, ua.privateKey, 256));
  const uaPublic = new Uint8Array(await crypto.subtle.exportKey('raw', ua.publicKey));
  const ikm = await hkdf(authSecret, shared, concat(text('WebPush: info\0'), uaPublic, asPublic), 32);
  const cek = await hkdf(salt, ikm, text('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, text('Content-Encoding: nonce\0'), 12);
  const aes = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['decrypt']);
  const plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, aes, ciphertext));
  // Último registro: termina no delimitador 0x02, seguido de preenchimento.
  return new TextDecoder().decode(plain.slice(0, plain.lastIndexOf(2)));
}

Deno.test('o navegador decifra o aviso e o serviço de push confere a assinatura VAPID', async () => {
  // As chaves como ficam no Vault (JWK) e a pública como o app recebe.
  const exported = await exportVapidKeys(await generateVapidKeys({ extractable: true }));
  const vapidKeys = await importVapidKeys(exported);
  const applicationServerKey = await exportApplicationServerKey(vapidKeys);
  const app = await ApplicationServer.new({ contactInformation: 'https://projeto.supabase.co', vapidKeys });

  const ua = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const authSecret = crypto.getRandomValues(new Uint8Array(16));
  const subscription = {
    endpoint: 'https://fcm.googleapis.com/fcm/send/abc',
    keys: { p256dh: b64url.encode(await crypto.subtle.exportKey('raw', ua.publicKey)), auth: b64url.encode(authSecret) },
  };

  const realFetch = globalThis.fetch;
  let request: Request | null = null;
  globalThis.fetch = (input, init) => {
    request = new Request(input, init);
    return Promise.resolve(new Response(null, { status: 201 }));
  };
  try {
    await app.subscribe(subscription).pushTextMessage(payloadOf(due()), { ttl: 3600, urgency: Urgency.High });
  } finally {
    globalThis.fetch = realFetch;
  }
  const sent = request as Request | null;
  assert(sent);
  assertEquals(sent.url, subscription.endpoint);
  assertEquals(sent.headers.get('Content-Encoding'), 'aes128gcm');
  assertEquals(sent.headers.get('TTL'), '3600');
  assertEquals(sent.headers.get('Urgency'), 'high');

  const message = await browserDecrypt(new Uint8Array(await sent.arrayBuffer()), ua, authSecret);
  assertEquals(JSON.parse(message).title, 'Conta vence hoje');

  // Authorization: vapid t=<JWT>, k=<chave pública que o app usou para se inscrever>.
  const [, token, key] = /^vapid t=([^,]+), k=(.+)$/.exec(sent.headers.get('Authorization') ?? '') ?? [];
  assertEquals(key, applicationServerKey);
  const [header, claims, signature] = token.split('.');
  assertEquals(JSON.parse(new TextDecoder().decode(b64url.decode(claims))).aud, 'https://fcm.googleapis.com');
  const verified = await crypto.subtle.verify(
    { name: 'ECDSA', hash: 'SHA-256' },
    vapidKeys.publicKey,
    b64url.decode(signature),
    text(`${header}.${claims}`),
  );
  assert(verified);
});
