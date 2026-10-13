/**
 * Os dados de uma consulta só quando ela está em dia. Durante uma nova busca (logo depois de pagar ou
 * desfazer), ou depois de uma busca que falhou, o que ficou guardado é de antes: quem decide um aviso
 * com isso mostraria um selo velho. undefined: ainda não dá para dizer.
 */
export function settledData<T>(query: { data: T | undefined; isSuccess: boolean; isFetching: boolean }): T | undefined {
  return query.isSuccess && !query.isFetching ? query.data : undefined;
}
