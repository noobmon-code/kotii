import { describe, expect, it } from '@jest/globals';
import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';

// O painel do app é só de quem mantém o Kotii: só data/appDashboard fala com as duas funções, os números nunca
// ficam guardados no aparelho e nada dele chega ao resumo do Nuke ou ao consultor. O mesmo vale para os recados
// (data/appFeedback): a caixa de entrada não fica no aparelho e o resumo do Nuke nunca a lê; o Nuke só manda o
// recado que a pessoa confirmou (sendAppFeedback).

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

describe('os recados ficam com quem mantém o app', () => {
  it('só data/appFeedback chama as três funções dos recados', () => {
    const callers = files()
      .filter((f) => /rpc\(\s*['"`](send_app_feedback|app_feedback_list|set_app_feedback)['"`]/.test(f.text))
      .map((f) => f.path);
    expect(callers).toEqual(['data/appFeedback.ts']);
  });

  it('a caixa de entrada não entra no cache guardado no aparelho', () => {
    const text = readFileSync(join(root, 'lib/queryClient.ts'), 'utf8');
    const start = text.indexOf('const PERSISTED');
    const persisted = text.slice(start, text.indexOf(']);', start));
    expect(persisted).toContain("'household'");
    expect(persisted).not.toContain("'appFeedback'");
    // A chave é a que data/appFeedback usa.
    const data = readFileSync(join(root, 'data/appFeedback.ts'), 'utf8');
    expect(data).toContain("['appFeedback', userId, status ?? 'todos']");
  });

  it('o resumo do Nuke e o consultor não leem os recados; o Nuke só manda o que a pessoa confirmou', () => {
    // domain/nuke usa o vocabulário (os tipos, o corte do texto) de domain/appFeedback, que não é dado de recado.
    const reads = /app_feedback_list|set_app_feedback|useAppFeedback|useSetAppFeedback|fetchAppFeedback|useRefetchAppFeedback/;
    const advisor = files().filter((f) => /nuke|finance|consultor|advisor/i.test(f.path));
    expect(advisor.map((f) => f.path)).toEqual(expect.arrayContaining(['domain/nuke.ts', 'data/nuke.ts', 'app/nuke.tsx']));
    for (const { path, text } of advisor) {
      expect({ path, reads: reads.test(text) }).toEqual({ path, reads: false });
    }
    // O retrato da casa (useNukeContext) não importa nada dos recados: data/nuke só traz o envio.
    const nuke = readFileSync(join(root, 'data/nuke.ts'), 'utf8');
    expect(nuke.match(/import .* from '@\/data\/appFeedback';/g)).toEqual(["import { sendAppFeedback } from '@/data/appFeedback';"]);
    const snapshot = nuke.slice(nuke.indexOf('export function useNukeContext'), nuke.indexOf('export function useAskNuke'));
    expect(snapshot).toContain('buildNukeContext(snapshot)');
    expect(snapshot).not.toMatch(/feedback/i);
    expect(readFileSync(join(root, 'domain/nuke.ts'), 'utf8')).not.toMatch(/@\/data\//);
  });
});
