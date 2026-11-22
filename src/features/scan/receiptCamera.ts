import { router } from 'expo-router';

/**
 * A câmera só da nota (/escanear?para=nota, domain/scan): o "Adicionar nota" de Compras → Notas, o do Mercado do
 * mês vazio e o "Finalizar compra" da lista abrem direto nela, sem um menu antes. Ela lê o QR code (que segue para a
 * tela do QR) e fotografa a nota; a galeria, o link do QR e a nota à mão ficam em "Mais opções". A nota lida, ou
 * criada à mão, toma o lugar da câmera: quem a abriu fica logo embaixo da revisão.
 */
export function openReceiptCamera() {
  router.push({ pathname: '/escanear', params: { para: 'nota' } });
}
