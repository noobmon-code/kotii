import { describe, expect, it } from '@jest/globals';
import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';

// Toda câmera do app passa por ui/AppCameraView, que vigia o vídeo do navegador (lib/cameraStreams): o CameraView do
// expo-camera direto, desmontado com o vídeo ainda começando, deixaria a luz da câmera acesa até a aba fechar.

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === '__tests__' ? [] : sources(path);
    return /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

describe('AppCameraView', () => {
  it('só ele usa o CameraView do expo-camera', () => {
    const root = join(__dirname, '../..');
    const direct = sources(root)
      .filter((path) => /import\s*\{[^}]*\bCameraView\b[^}]*\}\s*from\s*'expo-camera'/.test(readFileSync(path, 'utf8')))
      .map((path) => relative(root, path));
    expect(direct).toEqual(['ui/AppCameraView.tsx']);
  });

  it('as três câmeras do app (o QR da nota, o código de barras e o boleto) usam ele', () => {
    const root = join(__dirname, '../..');
    for (const path of ['app/nota/qrcode.tsx', 'features/ProductBarcodeScanner.tsx', 'features/finance/BoletoScanner.tsx']) {
      expect(readFileSync(join(root, path), 'utf8')).toContain('<AppCameraView');
    }
  });
});
