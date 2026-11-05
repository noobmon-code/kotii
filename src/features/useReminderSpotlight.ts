import { useNavigation } from 'expo-router';
import { useEffect, useRef, useState, type RefObject } from 'react';
import {
  AccessibilityInfo,
  Platform,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type ScrollView,
  type Switch,
  type View,
} from 'react-native';

import { reminderKindFromParam, type HouseReminderKind } from '@/domain/houseReminders';
import { scrollTargetY } from '@/domain/scrollTarget';
import { measureInScroll, measureScrollArea } from '@/ui/scrollMeasure';

// "Abrir os avisos" de outra tela (a despensa, o clima, o estoque do remédio) abre a aba Família com `?aviso=<tipo>`:
// a aba rola até "Avisos neste celular/navegador", com o interruptor desse tipo à vista e destacado por um momento,
// para a pessoa ver qual ligar. O pedido vale uma visita: o parâmetro sai da rota assim que é lido, então desenhar de
// novo, voltar à aba depois ou recarregar a página não rola outra vez; tocar no link de novo, sim. O parâmetro sai
// pela navegação da própria tela (`navigation.setParams`), e não pelo `router` global: vindo de uma tela da pilha (o
// clima, o remédio, a reposição), a aba Família monta no mesmo instante que o navegador de abas novo, e o `router`
// tiraria o parâmetro da rota das abas, e não da Família (na recarga da página, ele nem está pronto ainda).

/** Quanto tempo a linha fica destacada (e a tela a acompanha), desde a rolagem. */
export const SPOTLIGHT_MS = 4000;
/** Sem conseguir medir nesse tempo (a casa carregando, uma aba escondida no navegador), desiste: a tela fica no alto. */
export const SPOTLIGHT_WAIT_MS = 10_000;
/** De quanto em quanto tempo mede de novo: o que carrega acima da seção a empurra para baixo. */
export const SPOTLIGHT_TICK_MS = 250;
/**
 * O leitor de tela vai para o interruptor depois que a tela parou: no celular pelo evento de acessibilidade, no
 * navegador pelo foco do campo do interruptor (sem rolar: a rolagem já é a de scrollTargetY).
 */
export const SPOTLIGHT_FOCUS_DELAY_MS = 600;
/**
 * A tela relatando outra posição que não a da rolagem daqui (mais do que isso) é a pessoa rolando: deixa de
 * acompanhar. É o que vale no navegador, que não avisa o arrasto (onScrollBeginDrag só existe no celular).
 */
export const SPOTLIGHT_SCROLL_SLOP = 2;

export interface ReminderSpotlight {
  kind: HouseReminderKind;
  /** A linha do tipo está destacada agora. */
  highlighted: boolean;
  sectionRef: RefObject<View | null>;
  rowRef: RefObject<View | null>;
  switchRef: RefObject<Switch | null>;
}

/** Um pedido: um objeto novo a cada toque no link, mesmo para o mesmo tipo. */
interface Request {
  kind: HouseReminderKind;
}

export function useReminderSpotlight(param: string | string[] | undefined): {
  scrollRef: RefObject<ScrollView | null>;
  onScrollBeginDrag: () => void;
  /** Só durante um pedido (fora dele, a tela não precisa mandar a posição). */
  onScroll: ((event: NativeSyntheticEvent<NativeScrollEvent>) => void) | undefined;
  spotlight: ReminderSpotlight | null;
} {
  const navigation = useNavigation();
  const scrollRef = useRef<ScrollView>(null);
  const sectionRef = useRef<View>(null);
  const rowRef = useRef<View>(null);
  const switchRef = useRef<Switch>(null);
  // Acompanha a linha enquanto a pessoa não rola a tela.
  const following = useRef(false);
  // Onde a última rolagem daqui deixou a tela (null: nenhuma ainda neste pedido).
  const scrolledTo = useRef<number | null>(null);
  const value = Array.isArray(param) ? param[0] : param;

  // O pedido nasce quando o parâmetro muda para um valor (e não a cada desenho): ajustado durante o desenho, como a
  // documentação do React manda para o estado que segue uma prop.
  const [seen, setSeen] = useState<string | undefined>(undefined);
  const [request, setRequest] = useState<Request | null>(null);
  const [highlightedFor, setHighlightedFor] = useState<Request | null>(null);
  if (value !== seen) {
    setSeen(value);
    const kind = value === undefined ? null : reminderKindFromParam(value);
    if (kind) setRequest({ kind });
  }

  // O parâmetro sai da rota já: o pedido fica no estado daqui. Sem parâmetro, nada a tirar. A ação vai com a chave
  // da rota da Família, e o navegador de abas a trata, seja qual for a ordem em que as telas montaram.
  useEffect(() => {
    if (value === undefined) return;
    navigation.setParams({ aviso: undefined } as never);
  }, [value, navigation]);

  useEffect(() => {
    if (!request) return;
    following.current = true;
    scrolledTo.current = null;
    const startedAt = Date.now();
    let shownAt: number | null = null;
    let busy = false;
    let cancelled = false;
    let focusTimer: ReturnType<typeof setTimeout> | undefined;
    let interval: ReturnType<typeof setInterval> | undefined;

    const finish = () => {
      clearInterval(interval);
      setHighlightedFor((current) => (current === request ? null : current));
      setRequest((current) => (current === request ? null : current));
    };

    async function tick() {
      if (cancelled || busy) return;
      const now = Date.now();
      if (shownAt === null ? now - startedAt > SPOTLIGHT_WAIT_MS : now - shownAt >= SPOTLIGHT_MS) {
        finish();
        return;
      }
      if (shownAt !== null && !following.current) return;
      busy = true;
      try {
        const scroll = scrollRef.current;
        const area = await measureScrollArea(scroll);
        const section = await measureInScroll(scroll, sectionRef.current);
        const row = rowRef.current ? await measureInScroll(scroll, rowRef.current) : null;
        if (cancelled || !area || !section) return;
        if (shownAt !== null && !following.current) return;
        const y = scrollTargetY({ sectionTop: section.top, row, viewport: area.viewport, content: area.content });
        const lastY = scrolledTo.current;
        if (lastY === null || Math.abs(y - lastY) > 1) {
          scrolledTo.current = y;
          scrollRef.current?.scrollTo({ y, animated: false });
        }
        if (shownAt === null) {
          shownAt = Date.now();
          if (row) {
            setHighlightedFor(request);
            focusTimer = setTimeout(() => {
              const target = switchRef.current;
              if (cancelled || !target) return;
              if (Platform.OS === 'web') {
                // No navegador, o Switch é um <input role="switch">: o foco leva o leitor de tela (e o teclado) até ele.
                (target as unknown as { focus?: (options?: { preventScroll?: boolean }) => void }).focus?.({ preventScroll: true });
              } else {
                AccessibilityInfo.sendAccessibilityEvent(target as unknown as Parameters<typeof AccessibilityInfo.sendAccessibilityEvent>[0], 'focus');
              }
            }, SPOTLIGHT_FOCUS_DELAY_MS);
          }
        }
      } finally {
        busy = false;
      }
    }

    interval = setInterval(() => void tick(), SPOTLIGHT_TICK_MS);
    void tick();
    return () => {
      cancelled = true;
      clearInterval(interval);
      if (focusTimer) clearTimeout(focusTimer);
      following.current = false;
      scrolledTo.current = null;
    };
  }, [request]);

  return {
    scrollRef,
    onScrollBeginDrag: () => {
      following.current = false;
    },
    // A posição relatada longe da rolagem daqui: a pessoa rolou (a roda do mouse, o dedo, o teclado, o leitor de tela).
    onScroll: request
      ? (event) => {
          const at = scrolledTo.current;
          if (at === null) return;
          if (Math.abs(event.nativeEvent.contentOffset.y - at) > SPOTLIGHT_SCROLL_SLOP) following.current = false;
        }
      : undefined,
    spotlight: request
      ? { kind: request.kind, highlighted: highlightedFor === request, sectionRef, rowRef, switchRef }
      : null,
  };
}
