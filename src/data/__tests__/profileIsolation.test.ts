import { describe, expect, it } from '@jest/globals';
import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';

// A data de nascimento e o telefone são só da pessoa: só a tela de Configurações os lê, e eles nunca chegam ao
// resumo do Nuke, ao consultor nem ao cache guardado no aparelho.

const root = join(__dirname, '../..');

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === '__tests__' ? [] : sources(path);
    return /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

describe('o perfil fica com a pessoa', () => {
  it('só data/profile fala com a tabela e a função, e só a tela de Configurações usa o perfil', () => {
    const files = sources(root).map((path) => ({ path: relative(root, path).replace(/\\/g, '/'), text: readFileSync(path, 'utf8') }));
    const db = files.filter((f) => /from\('profiles'\)|rpc\('save_my_profile'/.test(f.text)).map((f) => f.path);
    expect(db).toEqual(['data/profile.ts']);
    const users = files.filter((f) => /@\/data\/profile['"]/.test(f.text)).map((f) => f.path);
    expect(users).toEqual(['app/configuracoes.tsx']);
  });

  it('o resumo do Nuke e o consultor não leem o perfil', () => {
    const advisor = sources(root).filter((path) => /nuke|finance|consultor|advisor/i.test(relative(root, path)));
    expect(advisor.length).toBeGreaterThan(5);
    for (const path of advisor) {
      const text = readFileSync(path, 'utf8');
      expect({ path, profile: /profiles|useMyProfile|MyProfile|\.phone\b/.test(text) }).toEqual({ path, profile: false });
    }
  });

  it('o perfil não entra no cache guardado no aparelho', () => {
    const text = readFileSync(join(root, 'lib/queryClient.ts'), 'utf8');
    const persisted = text.slice(text.indexOf('const PERSISTED'), text.indexOf(']);', text.indexOf('const PERSISTED')));
    expect(persisted).toContain("'household'");
    expect(persisted).not.toContain("'profile'");
  });
});

