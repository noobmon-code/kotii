import { router } from 'expo-router';

import { FunctionError } from '@/data/images';
import { useImportNfce } from '@/data/receipts';
import { NFCE_CAPTCHA, parseNfceQr } from '@/domain/nfce';
import { forgetCaptchaState, rememberCaptchaState } from '@/lib/captchaStates';
import { errorMessage } from '@/lib/supabase';
import { notify } from '@/ui/dialogs';

/**
 * "Tentar a Sefaz de novo" na pendente que nem foi à Sefaz (domain/captchaStates): esquece o estado e lê a nota
 * pelo QR, como a tela do QR. Lida, a nota abre na revisão e a pendente sai (`onRead`); com o "não sou robô" de
 * novo, o estado volta a ser guardado e a pessoa fica na pendente (`onCaptcha`).
 */
export function useSefazRetry({ onRead, onCaptcha }: { onRead: (accessKey: string) => Promise<void> | void; onCaptcha: () => void }) {
  const importNfce = useImportNfce();

  async function retry(url: string) {
    const qr = parseNfceQr(url);
    if (!qr || importNfce.isPending) return;
    await forgetCaptchaState(qr.uf);
    importNfce.mutate(qr, {
      onSuccess: ({ receipt_id }) => {
        // A revisão toma o lugar da pendente antes de ela sair (sem piscar "não está mais pendente").
        router.replace({ pathname: '/nota/[id]', params: { id: receipt_id } });
        void Promise.resolve(onRead(qr.accessKey)).catch(() => undefined);
      },
      onError: async (err) => {
        if (err instanceof FunctionError && err.code === NFCE_CAPTCHA) {
          await rememberCaptchaState(qr.uf);
          onCaptcha();
          notify('A Sefaz ainda pede a confirmação', 'Leia esta nota pelos prints, como no passo a passo.');
          return;
        }
        notify('Não deu para ler a nota', errorMessage(err));
      },
    });
  }

  return { retry, busy: importNfce.isPending };
}
