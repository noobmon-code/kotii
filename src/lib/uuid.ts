// Um id no formato uuid, feito no aparelho: o selo de marcar um item da lista, o id do item que a fila põe e o do item
// que faltou numa nota confirmada. Não precisa ser secreto, só não repetir. Puro, sem nada de rede.

export function newUuid(): string {
  const hex = Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16));
  hex[12] = '4';
  hex[16] = ((Number.parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
  const s = hex.join('');
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`;
}
