-- Onde fica a casa, para as dicas do clima: o bairro (pelo CEP ou pela
-- localização do celular), com as coordenadas guardadas em duas casas
-- decimais (cerca de 1 km). O endereço exato não fica no banco. Qualquer
-- pessoa da casa define ou muda.

create table public.household_location (
  household_id uuid primary key default public.current_household_id()
    references public.households (id) on delete cascade,
  label text not null check (length(trim(label)) between 1 and 120),
  latitude numeric(5, 2) not null check (latitude between -90 and 90),
  longitude numeric(5, 2) not null check (longitude between -180 and 180),
  source text not null check (source in ('cep', 'gps'))
);

alter table public.household_location enable row level security;
create policy "household members manage the location" on public.household_location for all to authenticated
  using (household_id = (select public.current_household_id()))
  with check (household_id = (select public.current_household_id()));
