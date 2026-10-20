import {
  Nunito_400Regular,
  Nunito_600SemiBold,
  Nunito_700Bold,
  Nunito_800ExtraBold,
  useFonts,
} from '@expo-google-fonts/nunito';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { DarkTheme, DefaultTheme, SplashScreen, Stack, ThemeProvider } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { useColorScheme } from 'react-native';

import { AuthProvider, openedByRecoveryLink, useAuth, useHousehold } from '@/lib/auth';
import { clearLinkNotice, useLinkNotice } from '@/lib/linkNotice';
import { useRecovery } from '@/lib/passwordRecovery';
import { configureNotifications } from '@/lib/reminders';
import { persistOptions, queryClient } from '@/lib/queryClient';
import { isSupabaseConfigured } from '@/lib/supabase';
import { notify } from '@/ui/dialogs';
import { EmptyState, ErrorNotice, Loading, Screen } from '@/ui/primitives';
import { fonts, useColors } from '@/ui/theme';

SplashScreen.preventAutoHideAsync();
configureNotifications();

/** No navegador o aviso é um alert, que trava a página: espera a tela ser desenhada. */
const NOTICE_DELAY_MS = 300;

export default function RootLayout() {
  return (
    <PersistQueryClientProvider client={queryClient} persistOptions={persistOptions}>
      <AuthProvider>
        <AppNavigator />
      </AuthProvider>
    </PersistQueryClientProvider>
  );
}

function AppNavigator() {
  const scheme = useColorScheme();
  const colors = useColors();
  const { session, loading } = useAuth();
  const household = useHousehold();
  // Entrou pelo link ou código do e-mail de recuperação: até a senha nova, nada da casa.
  const recovery = useRecovery(session?.user.id);
  // Sem a fonte carregada o texto pisca em outra fonte; se falhar, segue com a do sistema.
  const [fontsLoaded, fontError] = useFonts({ Nunito_400Regular, Nunito_600SemiBold, Nunito_700Bold, Nunito_800ExtraBold });
  // A senha nova não precisa da casa: não espera por ela.
  const newPassword = recovery === 'new-password';
  const resolving =
    loading ||
    recovery === 'reading' ||
    (Boolean(session) && !newPassword && household.isPending) ||
    (!fontsLoaded && !fontError);

  useEffect(() => {
    if (!resolving || !isSupabaseConfigured) SplashScreen.hideAsync();
  }, [resolving]);

  // O link do e-mail não deu certo e há uma conta aberta (a tela de entrar, que mostraria isso, não
  // aparece): um aviso só, depois que a tela já está desenhada.
  const linkNotice = useLinkNotice();
  const signedIn = Boolean(session);
  useEffect(() => {
    if (resolving || !signedIn || !linkNotice) return;
    const timer = setTimeout(() => {
      clearLinkNotice();
      notify('Não deu para abrir o link', linkNotice);
    }, NOTICE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [resolving, signedIn, linkNotice]);

  if (!isSupabaseConfigured) {
    return (
      <Screen>
        <EmptyState
          icon="database-cog-outline"
          title="Configure o Supabase"
          message="Crie o arquivo .env com EXPO_PUBLIC_SUPABASE_URL e EXPO_PUBLIC_SUPABASE_ANON_KEY (veja o README) e reinicie o app."
        />
      </Screen>
    );
  }
  // Conferir o link do e-mail depende da internet e pode demorar: página em branco parece travada
  // (e recarregar nessa hora gasta o link).
  if (loading && openedByRecoveryLink) {
    return (
      <Screen>
        <Loading label="Abrindo o link do e-mail…" />
      </Screen>
    );
  }
  if (resolving) return null;
  if (session && !newPassword && household.isError) {
    return (
      <Screen>
        <ErrorNotice error={household.error} onRetry={() => household.refetch()} />
      </Screen>
    );
  }

  const inHousehold = signedIn && !newPassword && Boolean(household.data);

  return (
    <ThemeProvider value={scheme === 'dark' ? DarkTheme : DefaultTheme}>
      <StatusBar style="auto" />
      <Stack
        screenOptions={{
          headerBackButtonDisplayMode: 'minimal',
          headerTintColor: colors.primary,
          headerTitleStyle: { color: colors.text, fontFamily: fonts.heavy, fontSize: 18 },
          headerStyle: { backgroundColor: colors.background },
          headerShadowVisible: false,
          contentStyle: { backgroundColor: colors.background },
        }}>
        <Stack.Protected guard={!signedIn}>
          <Stack.Screen name="entrar" options={{ headerShown: false }} />
        </Stack.Protected>
        <Stack.Protected guard={newPassword}>
          <Stack.Screen name="nova-senha" options={{ headerShown: false }} />
        </Stack.Protected>
        <Stack.Protected guard={signedIn && !newPassword && !inHousehold}>
          <Stack.Screen name="bem-vindo" options={{ headerShown: false }} />
        </Stack.Protected>
        <Stack.Protected guard={inHousehold}>
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="lista/[id]/index" options={{ title: 'Lista' }} />
          <Stack.Screen name="lista/[id]/onde-comprar" options={{ title: 'Onde comprar' }} />
          <Stack.Screen name="nota/[id]" options={{ title: 'Nota fiscal' }} />
          <Stack.Screen name="nota/qrcode" options={{ title: 'QR code da nota', presentation: 'modal' }} />
          <Stack.Screen name="precos" options={{ title: 'Preços' }} />
          <Stack.Screen name="mercado" options={{ title: 'Mercado do mês' }} />
          <Stack.Screen name="agenda" options={{ title: 'Agenda' }} />
          <Stack.Screen name="cardapio" options={{ title: 'Cardápio da semana' }} />
          <Stack.Screen name="clima" options={{ title: 'Clima da casa' }} />
          <Stack.Screen name="casas" options={{ title: 'Suas casas' }} />
          <Stack.Screen name="pontos" options={{ title: 'Pontos das crianças' }} />
          <Stack.Screen name="orcamento" options={{ title: 'Orçamento do mês', presentation: 'modal' }} />
          <Stack.Screen name="produto/[id]" options={{ title: 'Produto' }} />
          <Stack.Screen name="despensa/[id]" options={{ title: 'Item da despensa', presentation: 'modal' }} />
          <Stack.Screen name="reposicao/[id]" options={{ title: 'Gás, água e ração', presentation: 'modal' }} />
          <Stack.Screen name="tarefa/[id]" options={{ title: 'Tarefa', presentation: 'modal' }} />
          <Stack.Screen name="remedio/[id]" options={{ title: 'Remédio', presentation: 'modal' }} />
          <Stack.Screen name="pessoa/[id]" options={{ title: 'Pessoa', presentation: 'modal' }} />
          <Stack.Screen name="consulta/[id]" options={{ title: 'Consulta', presentation: 'modal' }} />
          <Stack.Screen name="compromisso/[id]" options={{ title: 'Compromisso', presentation: 'modal' }} />
          <Stack.Screen name="vacina/[id]" options={{ title: 'Vacina', presentation: 'modal' }} />
          <Stack.Screen name="exame/[id]" options={{ title: 'Exame' }} />
          <Stack.Screen name="exames/[pessoa]" options={{ title: 'Evolução dos exames' }} />
          <Stack.Screen name="treino/[id]" options={{ title: 'Ficha de treino' }} />
          <Stack.Screen name="dieta/[id]" options={{ title: 'Plano alimentar' }} />
          <Stack.Screen name="aparelho/[id]" options={{ title: 'Aparelho' }} />
          <Stack.Screen name="prestadores" options={{ title: 'Prestadores e consertos' }} />
          <Stack.Screen name="prestador/[id]" options={{ title: 'Prestador' }} />
          <Stack.Screen name="servico/[id]" options={{ title: 'Serviço', presentation: 'modal' }} />
          <Stack.Screen name="documento/[id]" options={{ title: 'Documento' }} />
          <Stack.Screen name="conta/[id]" options={{ title: 'Conta', presentation: 'modal' }} />
          <Stack.Screen name="gasto/[id]" options={{ title: 'Gasto', presentation: 'modal' }} />
          <Stack.Screen name="imposto-de-renda" options={{ title: 'Despesas médicas (IR)' }} />
          <Stack.Screen name="nuke" options={{ headerShown: false, presentation: 'modal' }} />
          <Stack.Screen name="consultor/index" options={{ title: 'Consultor (beta)' }} />
          <Stack.Screen name="consultor/lancamentos" options={{ title: 'Lançamentos do banco' }} />
          <Stack.Screen name="consultor/conversa" options={{ headerShown: false, presentation: 'modal' }} />
        </Stack.Protected>
        {/* Apagar a conta: da aba Família e também sem casa nenhuma (tela de boas-vindas). */}
        <Stack.Protected guard={signedIn && !newPassword}>
          <Stack.Screen name="apagar-conta" options={{ title: 'Apagar minha conta' }} />
        </Stack.Protected>
        {/* Os termos abrem em qualquer estado (sem conta, criando a senha nova, sem casa ou numa casa). Ficam por
            último: com uma guarda desligada, o app volta para a primeira tela disponível, que nunca é esta. */}
        <Stack.Screen name="termos" options={{ title: 'Termos de uso' }} />
      </Stack>
    </ThemeProvider>
  );
}
