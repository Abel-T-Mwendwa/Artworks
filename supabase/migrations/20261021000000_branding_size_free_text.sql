do $$
declare
  constraint_name text;
begin
  for constraint_name in
    select con.conname
    from pg_constraint con
    where con.conrelid = 'public.artwork_requests'::regclass
      and (
        (con.contype = 'f' and con.confrelid = 'public.branding_sizes'::regclass)
        or (con.contype = 'c' and pg_get_constraintdef(con.oid) ~* '\mbranding_size\M')
      )
  loop
    execute format('alter table public.artwork_requests drop constraint %I', constraint_name);
  end loop;
end
$$;

alter table public.artwork_requests
  alter column branding_size type text using branding_size::text;
