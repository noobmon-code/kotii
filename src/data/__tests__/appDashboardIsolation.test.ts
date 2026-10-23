import { describe, expect, it } from '@jest/globals';
import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';

// O painel do app é só de quem mantém o Kotii: só data/appDashboard fala com as duas funções, os números nunca
// ficam guardados no aparelho e nada dele chega ao resumo do Nuke ou ao consultor.

const root = join(__dirname, '../..');

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === '__tests__' ? [] : sources(path);
    return /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

const files = () => sources(root).map((path) => ({ path: relative(root, path).replace(/\\/g, '/'), text: readFileSync(path, 'utf8') }));

describe('o painel do app fica com quem mantém o app', () => {
  it('só data/appDashboard chama app_dashboard e is_app_admin', () => {
    const callers = files()
      .filter((f) => /rpc\(\s*['"`](app_dashboard|is_app_admin)['"`]/.test(f.text))
      .map((f) => f.path);
    expect(callers).toEqual(['data/appDashboard.ts']);
  });

  it('os números do painel e a pergunta de quem o vê não entram no cache guardado no aparelho', () => {
    const text = readFileSync(join(root, 'lib/queryClient.ts'), 'utf8');
    const start = text.indexOf('const PERSISTED');
    const persisted = text.slice(start, text.indexOf(']);', start));
    expect(persisted).toContain("'household'");
    expect(persisted).not.toContain("'appDashboard'");
    expect(persisted).not.toContain("'appAdmin'");
    // As duas chaves são as que data/appDashboard usa.
    const data = readFileSync(join(root, 'data/appDashboard.ts'), 'utf8');
    expect(data).toContain("queryKey: ['appDashboard', userId]");
    expect(data).toContain("queryKey: ['appAdmin', userId]");
  });

  it('o resumo do Nuke e o consultor não leem o painel', () => {
    const advisor = files().filter((f) => /nuke|finance|consultor|advisor/i.test(f.path));
    expect(advisor.map((f) => f.path)).toEqual(expect.arrayContaining(['domain/nuke.ts', 'domain/financeAdvisor.ts']));
    for (const { path, text } of advisor) {
      expect({ path, dashboard: /appDashboard|app_dashboard|is_app_admin|useIsAppAdmin/.test(text) }).toEqual({ path, dashboard: false });
    }
  });
});
