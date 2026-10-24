create or replace function public.admin_delete_user(p_target_user_id uuid, p_actor_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  actor_role text;
  actor_active boolean;
  target_role text;
  admin_count integer;
  foreign_key record;
  foreign_key_column text;
  has_reference boolean;
  deleted_count integer;
begin
  perform pg_advisory_xact_lock(731019244);

  select role, active into actor_role, actor_active
  from public.profiles
  where id = p_actor_id
  for update;

  if not found or actor_role <> 'admin' or not actor_active then
    raise exception 'Administrator access is required.';
  end if;
  if p_target_user_id is null then
    raise exception 'A user is required.';
  end if;
  if p_target_user_id = p_actor_id then
    raise exception 'You cannot delete your own account.';
  end if;

  select role into target_role
  from public.profiles
  where id = p_target_user_id;
  if not found then
    raise exception 'User not found.';
  end if;
  if target_role = 'admin' then
    select count(*) into admin_count
    from public.profiles
    where role = 'admin';
    if admin_count <= 1 then
      raise exception 'The last remaining administrator cannot be deleted.';
    end if;
  end if;

  for foreign_key in
    select constraint_row.conrelid as relation_oid,
      array_agg(column_row.attname::text order by key_row.ordinality) as columns
    from pg_constraint constraint_row
    cross join lateral unnest(constraint_row.conkey) with ordinality as key_row(attnum, ordinality)
    join pg_attribute column_row
      on column_row.attrelid = constraint_row.conrelid and column_row.attnum = key_row.attnum
    where constraint_row.contype = 'f'
      and constraint_row.confrelid = 'public.profiles'::regclass
      and constraint_row.conrelid <> 'public.user_credentials'::regclass
    group by constraint_row.conrelid
  loop
    foreach foreign_key_column in array foreign_key.columns
    loop
      execute format(
        'select exists (select 1 from %s where %I = $1)',
        foreign_key.relation_oid::regclass,
        foreign_key_column
      ) into has_reference using p_target_user_id;
      if has_reference then
        raise exception 'This user has linked records and cannot be deleted without removing history.';
      end if;
    end loop;
  end loop;

  delete from auth.users where id = p_target_user_id;
  get diagnostics deleted_count = row_count;
  if deleted_count = 0 then
    raise exception 'Auth user not found.';
  end if;
exception
  when foreign_key_violation then
    raise exception 'This user has linked records and cannot be deleted without removing history.';
end;
$$;

revoke all on function public.admin_delete_user(uuid, uuid) from public, anon, authenticated;
grant execute on function public.admin_delete_user(uuid, uuid) to service_role;
