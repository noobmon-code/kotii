import { describe, expect, it } from '@jest/globals';
import { readdirSync, readFileSync } from 'fs';
import path from 'path';

import { MAX_RECEIPT_PHOTOS, PREVIOUS_MAX_RECEIPT_PHOTOS, TOO_MANY_PHOTOS, tooManyPhotosMessage } from '../receiptPhotos';

describe('quantas fotos por nota', () => {
  it('o app e a função parse-receipt têm o mesmo limite e o mesmo código de recusa', () => {
    const source = readFileSync(path.resolve(__dirname, '../../../supabase/functions/parse-receipt/extract.ts'), 'utf8');
    expect(source).toMatch(new RegExp(`export const MAX_PHOTOS = ${MAX_RECEIPT_PHOTOS};`));
    expect(source).toContain(`export const TOO_MANY_PHOTOS = '${TOO_MANY_PHOTOS}';`);
    expect(MAX_RECEIPT_PHOTOS).toBe(6);
  });

  it('as fotos a mais cabem no banco: a nota guarda a primeira em image_path e as outras em extra_image_paths', () => {
    // O último limite que as migrações deram a extra_image_paths (o check da coluna).
    const dir = path.resolve(__dirname, '../../../supabase/migrations');
    const limits = readdirSync(dir)
      .filter((file) => file.endsWith('.sql'))
      .sort()
      .flatMap((file) => [...readFileSync(path.join(dir, file), 'utf8').matchAll(/cardinality\(extra_image_paths\)\s*<=\s*(\d+)/g)].map((m) => Number(m[1])));
    expect(limits.length).toBeGreaterThan(0);
    expect(MAX_RECEIPT_PHOTOS - 1).toBeLessThanOrEqual(limits[limits.length - 1]);
  });

  it('a função de antes recusa mais de 4 fotos sem dizer por quê: o app diz quantas mandar', () => {
    const message = tooManyPhotosMessage(6, { status: 400, code: null });
    expect(message).toContain(`até ${PREVIOUS_MAX_RECEIPT_PHOTOS} fotos por nota`);
  });

  it('nos outros casos, vale a mensagem da função', () => {
    // A função de agora já diz o limite dela.
    expect(tooManyPhotosMessage(9, { status: 400, code: TOO_MANY_PHOTOS })).toBeNull();
    // Até 4 fotos, o 400 não é pelo número de fotos.
    expect(tooManyPhotosMessage(4, { status: 400, code: null })).toBeNull();
    expect(tooManyPhotosMessage(6, { status: 422, code: null })).toBeNull();
    expect(tooManyPhotosMessage(6, { status: null, code: null })).toBeNull();
  });
});
