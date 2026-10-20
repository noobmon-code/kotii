import { assertEquals } from '@std/assert';

import { deleteAccount, type DeleteAccountDeps, parseDeleteAccountRequest, type PasswordCheck } from './account.ts';

const ANA = { id: 'ana-id', email: 'ana@exemplo.com' };
const CASA = '11111111-2222-4333-8444-555555555555';

/** As partes do Supabase de mentira, guardando o que foi pedido, na ordem. */
function fakeDeps(
  options: {
    password?: PasswordCheck;
    /** false: já passou do limite de tentativas; um Error: o banco falhou ao contar. */
    allowed?: boolean | Error;
    dataError?: { code: string; message: string };
    deleted?: string[];
    userError?: Error;
    filesError?: Error;
  } = {},
) {
  const calls: string[] = [];
  const deps: DeleteAccountDeps = {
    countAttempt: (userId) => {
      calls.push(`conta ${userId}`);
      return options.allowed instanceof Error ? Promise.reject(options.allowed) : Promise.resolve(options.allowed ?? true);
    },
    clearAttempts: (userId) => {
      calls.push(`zera ${userId}`);
      return Promise.resolve();
    },
    checkPassword: (userId, email, password) => {
      calls.push(`senha ${userId} ${email} ${password}`);
      return Promise.resolve(options.password ?? 'ok');
    },
    deleteData: (userId, deleteHouseholds) => {
      calls.push(`banco ${userId} [${deleteHouseholds.join(',')}]`);
      if (options.dataError) return Promise.reject(options.dataError);
      return Promise.resolve({ deleted: options.deleted ?? [], left: ['outra-casa'] });
    },
    cleanFiles: () => {
      calls.push('fotos');
      return options.filesError ? Promise.reject(options.filesError) : Promise.resolve();
    },
    deleteUser: (userId) => {
      calls.push(`auth ${userId}`);
      return options.userError ? Promise.reject(options.userError) : Promise.resolve();
    },
  };
  return { deps, calls };
}

Deno.test('pedido: senha obrigatória, casas só como ids, e nada de dizer de quem é a conta', () => {
  assertEquals(parseDeleteAccountRequest({ password: 'segredo', deleteHouseholds: [CASA.toUpperCase(), CASA] }), {
    password: 'segredo',
    deleteHouseholds: [CASA],
  });
  assertEquals(parseDeleteAccountRequest({ password: 'segredo' }), { password: 'segredo', deleteHouseholds: [] });
  // Um id de outra pessoa no corpo não entra no pedido.
  assertEquals(parseDeleteAccountRequest({ password: 'segredo', userId: 'outra' }), { password: 'segredo', deleteHouseholds: [] });
  assertEquals(parseDeleteAccountRequest({ password: '' }), null);
  assertEquals(parseDeleteAccountRequest({ password: 'x'.repeat(201) }), null);
  assertEquals(parseDeleteAccountRequest({ password: 'segredo', deleteHouseholds: ['casa'] }), null);
  assertEquals(parseDeleteAccountRequest({ password: 'segredo', deleteHouseholds: CASA }), null);
  assertEquals(parseDeleteAccountRequest(null), null);
});

Deno.test('tudo certo: conta a tentativa, confere a senha, zera a contagem, apaga no banco, limpa as fotos e apaga no Auth, nessa ordem', async () => {
  const { deps, calls } = fakeDeps({ deleted: [CASA] });
  const reply = await deleteAccount(ANA, { password: 'segredo', deleteHouseholds: [CASA] }, deps);
  assertEquals(reply, { status: 200, body: { status: 'deleted', deletedHouseholds: 1 } });
  assertEquals(calls, [
    'conta ana-id',
    `senha ana-id ana@exemplo.com segredo`,
    'zera ana-id',
    `banco ana-id [${CASA}]`,
    'fotos',
    'auth ana-id',
  ]);
});

Deno.test('sem casa apagada, não mexe nas fotos', async () => {
  const { deps, calls } = fakeDeps();
  assertEquals((await deleteAccount(ANA, { password: 'segredo', deleteHouseholds: [] }, deps)).status, 200);
  assertEquals(calls.includes('fotos'), false);
});

Deno.test('senha errada não apaga nada, e a tentativa fica contada', async () => {
  const { deps, calls } = fakeDeps({ password: 'wrong' });
  const reply = await deleteAccount(ANA, { password: 'errada', deleteHouseholds: [CASA] }, deps);
  assertEquals(reply.status, 403);
  assertEquals(reply.body.code, 'wrong_password');
  assertEquals(calls, ['conta ana-id', 'senha ana-id ana@exemplo.com errada']);
});

Deno.test('passou do limite de tentativas da conta: 429 sem nem conferir a senha', async () => {
  const { deps, calls } = fakeDeps({ allowed: false });
  const reply = await deleteAccount(ANA, { password: 'segredo', deleteHouseholds: [CASA] }, deps);
  assertEquals([reply.status, reply.body.code], [429, 'too_many_attempts']);
  assertEquals(calls, ['conta ana-id']);
});

Deno.test('o banco não conseguiu contar a tentativa: 503 sem conferir a senha', async () => {
  const { deps, calls } = fakeDeps({ allowed: new Error('rpc fora do ar') });
  const reply = await deleteAccount(ANA, { password: 'segredo', deleteHouseholds: [] }, deps);
  assertEquals([reply.status, reply.body.code], [503, 'check_failed']);
  assertEquals(calls, ['conta ana-id']);
});

Deno.test('muitas tentativas, ou a conferência que falhou: nada é apagado', async () => {
  for (const [password, status, code] of [['too_many', 429, 'too_many_attempts'], ['failed', 503, 'check_failed']] as const) {
    const { deps, calls } = fakeDeps({ password });
    const reply = await deleteAccount(ANA, { password: 'segredo', deleteHouseholds: [] }, deps);
    assertEquals([reply.status, reply.body.code], [status, code]);
    assertEquals(calls, ['conta ana-id', 'senha ana-id ana@exemplo.com segredo']);
  }
  const { deps, calls } = fakeDeps();
  deps.checkPassword = () => Promise.reject(new Error('fora do ar'));
  assertEquals((await deleteAccount(ANA, { password: 'segredo', deleteHouseholds: [] }, deps)).status, 503);
  assertEquals(calls, ['conta ana-id']);
});

Deno.test('conta sem e-mail: não tem como conferir a senha', async () => {
  const { deps, calls } = fakeDeps();
  assertEquals((await deleteAccount({ id: 'x', email: null }, { password: 'segredo', deleteHouseholds: [] }, deps)).status, 400);
  assertEquals(calls, []);
});

Deno.test('uma casa ficou só com a pessoa desde o aviso: 409, e o Auth não é chamado', async () => {
  const { deps, calls } = fakeDeps({ dataError: { code: 'NK001', message: 'last member' } });
  const reply = await deleteAccount(ANA, { password: 'segredo', deleteHouseholds: [] }, deps);
  assertEquals([reply.status, reply.body.code], [409, 'last_member']);
  assertEquals(calls.some((c) => c.startsWith('auth')), false);
});

Deno.test('uma casa avisada como apagada ganhou um morador: 409 houses_changed, e o Auth não é chamado', async () => {
  const { deps, calls } = fakeDeps({ dataError: { code: 'NK011', message: 'household is no longer hers alone' } });
  const reply = await deleteAccount(ANA, { password: 'segredo', deleteHouseholds: [CASA] }, deps);
  assertEquals([reply.status, reply.body.code], [409, 'houses_changed']);
  assertEquals(calls.some((c) => c.startsWith('auth')), false);
});

Deno.test('o banco falhou: nada foi apagado, e o Auth não é chamado', async () => {
  const { deps, calls } = fakeDeps({ dataError: { code: '40P01', message: 'deadlock' } });
  const reply = await deleteAccount(ANA, { password: 'segredo', deleteHouseholds: [] }, deps);
  assertEquals([reply.status, reply.body.code], [500, 'failed']);
  assertEquals(calls.some((c) => c.startsWith('auth')), false);
});

Deno.test('as fotos falharam: a conta é apagada mesmo assim (o agendamento limpa depois)', async () => {
  const { deps, calls } = fakeDeps({ deleted: [CASA], filesError: new Error('storage fora do ar') });
  assertEquals((await deleteAccount(ANA, { password: 'segredo', deleteHouseholds: [CASA] }, deps)).status, 200);
  assertEquals(calls.at(-1), 'auth ana-id');
});

Deno.test('o Auth falhou depois do banco: diz que falta terminar, para tentar de novo', async () => {
  const { deps } = fakeDeps({ userError: new Error('auth fora do ar') });
  const reply = await deleteAccount(ANA, { password: 'segredo', deleteHouseholds: [] }, deps);
  assertEquals([reply.status, reply.body.code], [500, 'auth_failed']);
});
