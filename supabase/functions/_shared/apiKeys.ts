// Chaves do projeto com que as funções falam com o Supabase. As novas
// (sb_publishable_…, sb_secret_…) chegam em SUPABASE_PUBLISHABLE_KEYS e
// SUPABASE_SECRET_KEYS: um JSON com uma chave por nome, e a primeira se chama
// "default". As antigas (SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY) ficam só
// de reserva, enquanto o projeto ainda as tiver.

type Env = (name: string) => string | undefined;

const denoEnv: Env = (name) => Deno.env.get(name);

/** A "default"; sem ela (trocada por outra no painel), a primeira que houver. */
function fromKeys(raw: string | undefined): string | null {
  if (!raw) return null;
  let keys: unknown;
  try {
    keys = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!keys || typeof keys !== 'object') return null;
  const named = keys as Record<string, unknown>;
  const usable = (key: unknown): key is string => typeof key === 'string' && key !== '';
  if (usable(named.default)) return named.default;
  return Object.values(named).find(usable) ?? null;
}

function resolve(env: Env, keys: string, legacy: string): string {
  const key = fromKeys(env(keys)) ?? env(legacy);
  if (!key) throw new Error(`Falta a chave do Supabase: ${keys} (ou ${legacy}).`);
  return key;
}

/** Chave pública: com o token de quem chamou, o banco aplica a RLS dela. */
export function publishableKey(env: Env = denoEnv): string {
  return resolve(env, 'SUPABASE_PUBLISHABLE_KEYS', 'SUPABASE_ANON_KEY');
}

/** Chave secreta: passa por cima da RLS. Só para o que o app não pode fazer. */
export function secretKey(env: Env = denoEnv): string {
  return resolve(env, 'SUPABASE_SECRET_KEYS', 'SUPABASE_SERVICE_ROLE_KEY');
}
