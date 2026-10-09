// Roda antes do build da web (vercel.json): o leitor de QR code e de boleto
// busca o .wasm do zxing em public/assets/zxing/<versão>/ (src/lib/barcodeReader.ts).
// Sem o arquivo certo, a câmera da web abriria e não leria nada; melhor o deploy falhar.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { ZXING_WASM_SHA256, ZXING_WASM_VERSION } = require('barcode-detector');

const problems = [];
const file = `public/assets/zxing/${ZXING_WASM_VERSION}/zxing_reader.wasm`;
if (!existsSync(file) || createHash('sha256').update(readFileSync(file)).digest('hex') !== ZXING_WASM_SHA256) {
  problems.push(`${file} não é o .wasm do zxing-wasm ${ZXING_WASM_VERSION}: copie node_modules/zxing-wasm/dist/reader/zxing_reader.wasm para lá.`);
}
const camera = path.dirname(require.resolve('expo-camera/package.json'));
if (require.resolve('barcode-detector', { paths: [camera] }) !== require.resolve('barcode-detector')) {
  problems.push('O expo-camera usa outro barcode-detector: ponha no package.json a versão dele (npm ls barcode-detector).');
}
if (problems.length) {
  console.error(`Leitor de código da web:\n- ${problems.join('\n- ')}`);
  process.exit(1);
}
