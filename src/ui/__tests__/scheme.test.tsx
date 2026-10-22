import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';
import { Pressable, Text } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import type { ThemeChoice } from '@/domain/appearance';
import { THEME_CHOICE_KEY } from '@/lib/themeChoice';
import { PALETTES, useColors, useScheme, useThemeChoice } from '@/ui/theme';
import { applyPageScheme, ThemeChoiceProvider } from '@/ui/ThemeChoiceProvider';

// O tema escolhido em Configurações: muda as cores de quem usa useColors, fica guardado no aparelho, e o
// automático segue o celular. E ninguém além do ui/theme lê o tema do celular direto.

jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
/** O tema do celular, que o teste troca. */
const mockSystem = { scheme: 'light' as 'light' | 'dark' | null };
jest.mock('react-native/Libraries/Utilities/useColorScheme', () => ({ __esModule: true, default: () => mockSystem.scheme }));

/** O AsyncStorage de mentira: uma resposta trocada vale só para a chamada seguinte (mockImplementationOnce). */
const storage = AsyncStorage as unknown as {
  getItem: jest.Mock<(key: string) => Promise<string | null>>;
  setItem: jest.Mock<(key: string, value: string) => Promise<void>>;
};

let renderer: ReactTestRenderer | undefined;

/** Mostra o tema em uso e a cor de fundo que as telas recebem; os botões escolhem. */
function Probe() {
  const scheme = useScheme();
  const colors = useColors();
  const { choice, ready, setChoice } = useThemeChoice();
  return (
    <>
      <Text testID="probe">{`${ready ? 'pronto' : 'lendo'} ${choice} ${scheme} ${colors.background}`}</Text>
      {(['auto', 'light', 'dark'] as ThemeChoice[]).map((value) => (
        <Pressable key={value} testID={`choose-${value}`} onPress={() => setChoice(value)} />
      ))}
    </>
  );
}

const probe = () => String(renderer!.root.findByProps({ testID: 'probe' }).props.children);
const choose = async (value: ThemeChoice) => {
  await act(async () => renderer!.root.findByProps({ testID: `choose-${value}` }).props.onPress());
};

async function mount() {
  await act(async () => {
    renderer = create(
      <ThemeChoiceProvider>
        <Probe />
      </ThemeChoiceProvider>,
    );
  });
}

beforeEach(() => {
  mockSystem.scheme = 'light';
});

afterEach(async () => {
  await act(async () => renderer?.unmount());
  renderer = undefined;
  await AsyncStorage.clear();
});

describe('tema escolhido', () => {
  it('sem escolha guardada é o automático, que segue o celular (e muda junto com ele)', async () => {
    await mount();
    expect(probe()).toBe(`pronto auto light ${PALETTES.light.background}`);
    mockSystem.scheme = 'dark';
    await act(async () => renderer!.update(
      <ThemeChoiceProvider>
        <Probe />
      </ThemeChoiceProvider>,
    ));
    expect(probe()).toBe(`pronto auto dark ${PALETTES.dark.background}`);
    // O celular sem resposta: claro.
    mockSystem.scheme = null;
    await act(async () => renderer!.update(
      <ThemeChoiceProvider>
        <Probe />
      </ThemeChoiceProvider>,
    ));
    expect(probe()).toBe(`pronto auto light ${PALETTES.light.background}`);
  });

  it('escolher o escuro com o celular claro muda as cores na hora e fica guardado neste aparelho', async () => {
    await mount();
    await choose('dark');
    expect(probe()).toBe(`pronto dark dark ${PALETTES.dark.background}`);
    expect(await AsyncStorage.getItem(THEME_CHOICE_KEY)).toBe('dark');
    // Fechar e abrir de novo: a escolha volta.
    await act(async () => renderer!.unmount());
    await mount();
    expect(probe()).toBe(`pronto dark dark ${PALETTES.dark.background}`);
  });

  it('o claro vale com o celular escuro; voltar ao automático segue o celular e apaga o guardado', async () => {
    mockSystem.scheme = 'dark';
    await mount();
    await choose('light');
    expect(probe()).toBe(`pronto light light ${PALETTES.light.background}`);
    expect(await AsyncStorage.getItem(THEME_CHOICE_KEY)).toBe('light');
    await choose('auto');
    expect(probe()).toBe(`pronto auto dark ${PALETTES.dark.background}`);
    expect(await AsyncStorage.getItem(THEME_CHOICE_KEY)).toBeNull();
  });

  it('enquanto lê o guardado, segue o celular e diz que ainda não está pronto (o _layout espera)', async () => {
    let release: () => void = () => undefined;
    // A leitura do aparelho só responde quando o teste deixa.
    storage.getItem.mockImplementationOnce(() => new Promise((resolve) => (release = () => resolve('dark'))));
    await mount();
    expect(probe()).toBe(`lendo auto light ${PALETTES.light.background}`);
    await act(async () => release());
    expect(probe()).toBe(`pronto dark dark ${PALETTES.dark.background}`);
  });

  it('sem armazenamento (modo privado, erro), abre no automático e a escolha vale enquanto o app está aberto', async () => {
    storage.getItem.mockImplementationOnce(() => Promise.reject(new Error('sem armazenamento')));
    storage.setItem.mockImplementationOnce(() => Promise.reject(new Error('sem armazenamento')));
    await mount();
    expect(probe()).toBe(`pronto auto light ${PALETTES.light.background}`);
    await choose('dark');
    expect(probe()).toBe(`pronto dark dark ${PALETTES.dark.background}`);
  });

  it('um valor estranho guardado (de outra versão) é o automático', async () => {
    await AsyncStorage.setItem(THEME_CHOICE_KEY, 'roxo');
    mockSystem.scheme = 'dark';
    await mount();
    expect(probe()).toBe(`pronto auto dark ${PALETTES.dark.background}`);
  });

  it('fora do provedor (testes, telas soltas), vale o tema do celular', async () => {
    mockSystem.scheme = 'dark';
    await act(async () => {
      renderer = create(<Probe />);
    });
    expect(probe()).toBe(`pronto auto dark ${PALETTES.dark.background}`);
  });
});

describe('a página no navegador', () => {
  it('o color-scheme, o fundo e a cor da barra do navegador acompanham o tema', () => {
    const metas = ['#FBF8F4', '#141733'].map((content) => ({
      content,
      setAttribute(name: string, value: string) {
        if (name === 'content') this.content = value;
      },
    }));
    const doc = {
      documentElement: { style: {} as Record<string, string> },
      body: { style: {} as Record<string, string> },
      querySelectorAll: (selector: string) => (selector === 'meta[name="theme-color"]' ? metas : []),
    };
    applyPageScheme(doc as unknown as Document, 'dark', PALETTES.dark.background);
    expect(doc.documentElement.style.colorScheme).toBe('dark');
    expect(doc.body.style.backgroundColor).toBe(PALETTES.dark.background);
    expect(metas.map((m) => m.content)).toEqual([PALETTES.dark.background, PALETTES.dark.background]);
  });
});

describe('quem lê o tema do celular', () => {
  /** Os arquivos do app (fora os testes). */
  function sources(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) return name === '__tests__' ? [] : sources(path);
      return /\.(ts|tsx)$/.test(name) ? [path] : [];
    });
  }

  it('só o ui/theme usa o useColorScheme do react-native: o resto pergunta ao useScheme, que sabe a escolha', () => {
    const root = join(__dirname, '../..');
    const readers = sources(root)
      .filter((path) => /\buseColorScheme\b/.test(readFileSync(path, 'utf8')))
      .map((path) => relative(root, path).replace(/\\/g, '/'));
    expect(readers).toEqual(['ui/theme.ts']);
    // E nenhum o lê por outro caminho (o Appearance também diria o tema do celular, sem a escolha): só o
    // ThemeChoiceProvider o usa, para passar a escolha aos avisos e ao teclado do sistema.
    const appearance = sources(root)
      .filter((path) => /\bAppearance\b/.test(readFileSync(path, 'utf8')))
      .map((path) => relative(root, path).replace(/\\/g, '/'));
    expect(appearance).toEqual(['ui/ThemeChoiceProvider.tsx']);
  });
});
