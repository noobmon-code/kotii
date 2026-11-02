// O cabeçalho que diz ao Supabase qual casa o pedido quer (ver lib/activeHousehold e a migração
// multiple_households). À parte, sem nada importado: quem só precisa do nome (data/weather) não carrega o
// armazenamento do aparelho.
export const HOUSEHOLD_HEADER = 'x-household-id';
