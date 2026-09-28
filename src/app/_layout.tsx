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

import { AuthProvider, useAuth, useHousehold } from '@/lib/auth';
import { configureNotifications } from '@/lib/reminders';
import { persistOptions, queryClient } from '@/lib/queryClient';
import { isSupabaseConfigured } from '@/lib/supabase';
import { EmptyState, ErrorNotice, Screen } from '@/ui/primitives';
import { fonts, useColors } from '@/ui/theme';

SplashScreen.preventAutoHideAsync();
configureNotifications();


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
  // Sem a fonte carregada o texto pisca em outra fonte; se falhar, segue com a do sistema.
  const [fontsLoaded, fontError] = useFonts({ Nunito_400Regular, Nunito_600SemiBold, Nunito_700Bold, Nunito_800ExtraBold });
  const resolving = loading || (Boolean(session) && household.isPending) || (!fontsLoaded && !fontError);

  useEffect(() => {
    if (!resolving || !isSupabaseConfigured) SplashScreen.hideAsync();
  }, [resolving]);

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
  if (resolving) return null;
  if (session && household.isError) {
    return (
      <Screen>
        <ErrorNotice error={household.error} onRetry={() => household.refetch()} />
      </Screen>
    );
  }

  const signedIn = Boolean(session);
  const inHousehold = signedIn && Boolean(household.data);

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
        <Stack.Protected guard={signedIn && !inHousehold}>
          <Stack.Screen name="bem-vindo" options={{ headerShown: false }} />
        </Stack.Protected>
        <Stack.Protected guard={inHousehold}>
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="lista/[id]/index" options={{ title: 'Lista' }} />
          <Stack.Screen name="lista/[id]/onde-comprar" options={{ title: 'Onde comprar' }} />
          <Stack.Screen name="nota/[id]" options={{ title: 'Nota fiscal' }} />
          <Stack.Screen name="nota/qrcode" options={{ title: 'QR code da nota', presentation: 'modal' }} />
          <Stack.Screen name="precos" options={{ title: 'Preços' }} />
          <Stack.Screen name="agenda" options={{ title: 'Agenda' }} />
          <Stack.Screen name="orcamento" options={{ title: 'Orçamento do mês', presentation: 'modal' }} />
          <Stack.Screen name="produto/[id]" options={{ title: 'Produto' }} />
          <Stack.Screen name="despensa/[id]" options={{ title: 'Item da despensa', presentation: 'modal' }} />
          <Stack.Screen name="tarefa/[id]" options={{ title: 'Tarefa', presentation: 'modal' }} />
          <Stack.Screen name="remedio/[id]" options={{ title: 'Remédio', presentation: 'modal' }} />
          <Stack.Screen name="pessoa/[id]" options={{ title: 'Pessoa', presentation: 'modal' }} />
          <Stack.Screen name="consulta/[id]" options={{ title: 'Consulta', presentation: 'modal' }} />
          <Stack.Screen name="vacina/[id]" options={{ title: 'Vacina', presentation: 'modal' }} />
          <Stack.Screen name="exame/[id]" options={{ title: 'Exame' }} />
          <Stack.Screen name="treino/[id]" options={{ title: 'Ficha de treino' }} />
          <Stack.Screen name="dieta/[id]" options={{ title: 'Plano alimentar' }} />
          <Stack.Screen name="aparelho/[id]" options={{ title: 'Aparelho' }} />
          <Stack.Screen name="documento/[id]" options={{ title: 'Documento' }} />
          <Stack.Screen name="conta/[id]" options={{ title: 'Conta', presentation: 'modal' }} />
          <Stack.Screen name="gasto/[id]" options={{ title: 'Gasto', presentation: 'modal' }} />
          <Stack.Screen name="imposto-de-renda" options={{ title: 'Despesas médicas (IR)' }} />
          <Stack.Screen name="nuke" options={{ headerShown: false, presentation: 'modal' }} />
        </Stack.Protected>
      </Stack>
    </ThemeProvider>
  );
}
