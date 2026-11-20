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
import { StyleSheet, View } from 'react-native';

import { routeWindowLayout, windowOptions } from '@/features/desktop/RouteWindow';
import { Sidebar } from '@/features/desktop/Sidebar';
import { AuthProvider, openedByRecoveryLink, useAuth, useHousehold } from '@/lib/auth';
import { FEATURES } from '@/lib/features';
import { clearLinkNotice, useLinkNotice } from '@/lib/linkNotice';
import { markHadAccount } from '@/lib/onboarding';
import { useRecovery } from '@/lib/passwordRecovery';
import { configureNotifications } from '@/lib/reminders';
import { persistOptions, queryClient } from '@/lib/queryClient';
import { isSupabaseConfigured } from '@/lib/supabase';
import { SidebarContext, useDesktop } from '@/ui/desktop';
import { notify } from '@/ui/dialogs';
import { EmptyState, ErrorNotice, Loading, Screen } from '@/ui/primitives';
import { fonts, useColors, useScheme, useThemeChoice } from '@/ui/theme';
import { ThemeChoiceProvider } from '@/ui/ThemeChoiceProvider';

SplashScreen.preventAutoHideAsync();
configureNotifications();

/** No navegador o aviso é um alert, que trava a página: espera a tela ser desenhada. */
const NOTICE_DELAY_MS = 300;

export default function RootLayout() {
  return (
    <PersistQueryClientProvider client={queryClient} persistOptions={persistOptions}>
      <AuthProvider>
        <ThemeChoiceProvider>
          <AppNavigator />
        </ThemeChoiceProvider>
      </AuthProvider>
    </PersistQueryClientProvider>
  );
}

function AppNavigator() {
  const scheme = useScheme();
  const theme = useThemeChoice();
  const colors = useColors();
  const { session, loading } = useAuth();
  const household = useHousehold();
  const desktop = useDesktop();
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
    (!fontsLoaded && !fontError) ||
    // O tema escolhido neste aparelho: lido antes de abrir, para não piscar o do celular.
    !theme.ready;

  useEffect(() => {
    if (!resolving || !isSupabaseConfigured) SplashScreen.hideAsync();
  }, [resolving]);

  // O link do e-mail não deu certo e há uma conta aberta (a tela de entrar, que mostraria isso, não
  // aparece): um aviso só, depois que a tela já está desenhada.
  const linkNotice = useLinkNotice();
  const signedIn = Boolean(session);
  // Uma conta entrou neste aparelho: a tela de entrar do começo novo abre direto em "Entrar" daqui em diante.
  useEffect(() => {
    if (signedIn) markHadAccount();
  }, [signedIn]);
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
  // A barra lateral do computador: só dentro de uma casa (fora dela não há áreas para onde ir).
  const sidebar = desktop && inHousehold;

  return (
    <ThemeProvider value={scheme === 'dark' ? DarkTheme : DefaultTheme}>
      {/* "auto" seguiria o celular: a barra acompanha o tema do app, que pode ser outro. */}
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
      {/* No computador (domain/desktop), a barra lateral fica ao lado de todas as telas de dentro da casa, no lugar
          da pílula de abas. As duas caixas em volta do Stack existem sempre: só a barra entra e sai, e a tela aberta
          não é montada de novo quando a janela cruza a largura do computador. */}
      <View style={[styles.shell, { backgroundColor: colors.background }]}>
        {sidebar ? <Sidebar /> : null}
        <View style={styles.stack}>
          {/* As telas que se arrumam pela largura (o Painel do app) descontam a barra (ui/desktop). */}
          <SidebarContext.Provider value={sidebar}>
            {/* As telas em janela (as de `windowOptions`: no celular sobem por cima das outras) ficam, no computador,
                numa caixa no meio da janela, com o app escurecido atrás (features/desktop/RouteWindow). */}
            <Stack
              screenLayout={routeWindowLayout}
              screenOptions={{
                headerBackButtonDisplayMode: 'minimal',
                // No computador a coluna da tela fica no meio do lugar ao lado da barra lateral: o título, em cima dela.
                headerTitleAlign: desktop ? 'center' : undefined,
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
                <Stack.Screen name="escanear" options={{ title: 'Escanear' }} />
                <Stack.Screen name="nota/qrcode" options={windowOptions(desktop, { title: 'QR code da nota' })} />
                <Stack.Screen name="nota/pendente" options={windowOptions(desktop, { title: 'Nota pendente' })} />
                <Stack.Screen name="precos" options={{ title: 'Preços' }} />
                <Stack.Screen name="mercado" options={{ title: 'Mercado do mês' }} />
                <Stack.Screen name="agenda" options={{ title: 'Agenda' }} />
                <Stack.Screen name="cardapio" options={{ title: 'Cardápio da semana' }} />
                <Stack.Screen name="clima" options={{ title: 'Clima da casa' }} />
                <Stack.Screen name="casas" options={{ title: 'Suas casas' }} />
                <Stack.Screen name="pontos" options={{ title: 'Pontos das crianças' }} />
                <Stack.Screen name="produto/[id]" options={{ title: 'Produto' }} />
                <Stack.Screen name="despensa/[id]" options={windowOptions(desktop, { title: 'Item da despensa' })} />
                <Stack.Screen name="reposicao/[id]" options={windowOptions(desktop, { title: 'Gás, água e ração' })} />
                <Stack.Screen name="tarefa/[id]" options={windowOptions(desktop, { title: 'Tarefa' })} />
                <Stack.Screen name="remedio/[id]" options={windowOptions(desktop, { title: 'Remédio' })} />
                <Stack.Screen name="pessoa/[id]" options={windowOptions(desktop, { title: 'Pessoa' })} />
                <Stack.Screen name="consulta/[id]" options={windowOptions(desktop, { title: 'Consulta' })} />
                <Stack.Screen name="compromisso/[id]" options={windowOptions(desktop, { title: 'Compromisso' })} />
                <Stack.Screen name="vacina/[id]" options={windowOptions(desktop, { title: 'Vacina' })} />
                <Stack.Screen name="exame/[id]" options={{ title: 'Exame' }} />
                <Stack.Screen name="exames/[pessoa]" options={{ title: 'Evolução dos exames' }} />
                <Stack.Screen name="treino/[id]" options={{ title: 'Ficha de treino' }} />
                <Stack.Screen name="dieta/[id]" options={{ title: 'Plano alimentar' }} />
                <Stack.Screen name="aparelho/[id]" options={{ title: 'Aparelho' }} />
                <Stack.Screen name="prestadores" options={{ title: 'Prestadores e consertos' }} />
                <Stack.Screen name="prestador/[id]" options={{ title: 'Prestador' }} />
                <Stack.Screen name="servico/[id]" options={windowOptions(desktop, { title: 'Serviço' })} />
                <Stack.Screen name="documento/[id]" options={{ title: 'Documento' }} />
                <Stack.Screen name="nuke" options={windowOptions(desktop, { headerShown: false })} />
                {/* As telas que a aba Configurações abre por uma linha, para ficar curta. */}
                <Stack.Screen name="avisos" options={{ title: 'Avisos' }} />
                <Stack.Screen name="perfil" options={{ title: 'Perfil' }} />
                <Stack.Screen name="recado" options={{ title: 'Mandar recado' }} />
                <Stack.Screen name="moderacao" options={{ title: 'Nomes dos mercados' }} />
                {/* A prévia do começo de uma conta nova, para quem mantém o app (Configurações → Manutenção do app). */}
                <Stack.Screen name="primeira-vez" options={{ title: 'Prévia do começo' }} />
                {/* O endereço da antiga aba Família (favoritos, o app instalado): troca para a aba Configurações. */}
                <Stack.Screen name="familia" options={{ headerShown: false }} />
              </Stack.Protected>
              {/* As telas de Finanças: só numa casa e com a chave ligada (lib/features). Desligada, nenhuma delas
                  existe no navegador, e nenhum endereço ou botão chega a elas. */}
              <Stack.Protected guard={inHousehold && FEATURES.finance}>
                {/* O endereço da antiga aba Finanças (favoritos, o app instalado): troca para Casa → Finanças. */}
                <Stack.Screen name="financas" options={{ headerShown: false }} />
                <Stack.Screen name="orcamento" options={windowOptions(desktop, { title: 'Orçamento do mês' })} />
                <Stack.Screen name="conta/[id]" options={windowOptions(desktop, { title: 'Conta' })} />
                <Stack.Screen name="gasto/[id]" options={windowOptions(desktop, { title: 'Gasto' })} />
                <Stack.Screen name="imposto-de-renda" options={{ title: 'Despesas médicas (IR)' }} />
                <Stack.Screen name="consultor/index" options={{ title: 'Consultor (beta)' }} />
                <Stack.Screen name="consultor/lancamentos" options={{ title: 'Lançamentos do banco' }} />
                <Stack.Screen name="consultor/conversa" options={windowOptions(desktop, { headerShown: false })} />
              </Stack.Protected>
              {/* Sem depender de casa: apagar a conta (da aba Configurações e da tela de boas-vindas, sem casa nenhuma) e o
                  Painel do app (de Configurações ou por /painel; só quem está em app_admins vê os números). */}
              <Stack.Protected guard={signedIn && !newPassword}>
                <Stack.Screen name="apagar-conta" options={{ title: 'Apagar minha conta' }} />
                <Stack.Screen name="painel" options={{ title: 'Painel do app' }} />
              </Stack.Protected>
              {/* Os termos abrem em qualquer estado (sem conta, criando a senha nova, sem casa ou numa casa). Ficam por
                  último: com uma guarda desligada, o app volta para a primeira tela disponível, que nunca é esta. */}
              {/* O link do convite também abre em qualquer estado: guarda o código e segue para entrar, para as boas-vindas
                  ou para "Suas casas". Fica no fim, como os termos. */}
              <Stack.Screen name="convite/[codigo]" options={{ headerShown: false }} />
              <Stack.Screen name="termos" options={{ title: 'Termos de uso' }} />
            </Stack>
          </SidebarContext.Provider>
        </View>
      </View>
    </ThemeProvider>
  );
}

const styles = StyleSheet.create({
  shell: { flex: 1, flexDirection: 'row' },
  // minWidth 0: a tela encolhe com a janela em vez de empurrar a barra lateral.
  stack: { flex: 1, minWidth: 0 },
});
