-- Nota importada pelo QR code (consulta pública da Sefaz, sem IA).
alter table public.receipts drop constraint receipts_source_check;
alter table public.receipts add constraint receipts_source_check check (source in ('ai', 'manual', 'qrcode'));
