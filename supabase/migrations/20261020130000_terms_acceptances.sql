-- Aceite dos termos de uso e privacidade, por pessoa (não por casa): quem
-- aceitou qual versão e quando, pela hora do servidor.
--
-- A versão é a TERMS_ACCEPT_VERSION do app (src/domain/terms.ts), uma data
-- que só muda em mudança importante do texto. O aceite é um aviso, nunca uma
-- trava: o app funciona sem ele, e antes desta migração guarda o "Entendi" no
-- aparelho (e grava aqui na primeira vez que a função existir).
--
-- O app só lê as próprias linhas. Gravar é só pela accept_terms, que põe a
-- conta de quem chama e a hora do servidor; ninguém muda nem apaga um aceite
-- pelo app. A conta apagada leva os aceites dela junto.
create table public.terms_acceptances (
  user_id uuid not null references auth.users (id) on delete cascade,
  version text not null check (version ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'),
  accepted_at timestamptz not null default now(),
  primary key (user_id, version)
);

alter table public.terms_acceptances enable row level security;
revoke all on public.terms_acceptances from anon, authenticated;
grant select on public.terms_acceptances to authenticated;
grant all on public.terms_acceptances to service_role;
create policy "people read their own terms acceptances" on public.terms_acceptances
  for select to authenticated
  using (user_id = auth.uid());

-- Grava o aceite de quem chama. Repetir (outro aparelho, toque duplo, o
-- aceite guardado no aparelho chegando depois) não muda nada: vale o primeiro,
-- com a hora dele.
create function public.accept_terms(p_version text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'sem conta' using errcode = '42501';
  end if;
  insert into public.terms_acceptances (user_id, version)
  values (auth.uid(), p_version)
  on conflict (user_id, version) do nothing;
end;
$$;

revoke execute on function public.accept_terms(text) from public, anon;
grant execute on function public.accept_terms(text) to authenticated;
