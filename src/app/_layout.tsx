import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DarkTheme, DefaultTheme, SplashScreen, Stack, ThemeProvider } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { useColorScheme } from 'react-native';

import { AuthProvider, useAuth, useHousehold } from '@/lib/auth';
import { configureNotifications } from '@/lib/reminders';
import { isSupabaseConfigured } from '@/lib/supabase';
import { EmptyState, ErrorNotice, Screen } from '@/ui/primitives';
import { useColors } from '@/ui/theme';

SplashScreen.preventAutoHideAsync();
configureNotifications();

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, retry: 1 } },
});

export default function RootLayout() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <AppNavigator />
      </AuthProvider>
    </QueryClientProvider>
  );
}

function AppNavigator() {
  const scheme = useColorScheme();
  const colors = useColors();
  const { session, loading } = useAuth();
  const household = useHousehold();
  const resolving = loading || (Boolean(session) && household.isPending);

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
          headerTitleStyle: { color: colors.text },
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
          <Stack.Screen name="precos" options={{ title: 'Preços' }} />
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
        </Stack.Protected>
      </Stack>
    </ThemeProvider>
  );
}
