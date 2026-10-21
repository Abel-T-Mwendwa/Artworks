create extension if not exists pgcrypto with schema extensions;

create type public.app_role as enum ('salesperson', 'designer', 'admin');
create type public.artwork_status as enum ('Requested', 'In progress', 'Change requested', 'Done');
create type public.change_status as enum ('open', 'done');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique,
  full_name text not null,
  role public.app_role not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.branding_sizes (
  id bigint generated always as identity primary key,
  label text not null unique,
  sort_order integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.ref_counters (
  year_month text primary key check (year_month ~ '^[0-9]{4}$'),
  last_number integer not null check (last_number between 0 and 9999)
);

create table public.artwork_requests (
  id uuid primary key default gen_random_uuid(),
  sr bigint generated always as identity unique,
  ref_no text unique,
  created_at timestamptz not null default now(),
  created_month text not null default to_char(now() at time zone 'Africa/Nairobi', 'YYYY-MM'),
  created_by uuid not null references public.profiles(id),
  category text not null check (category in ('New client', 'Old client')),
  client_name text not null check (length(btrim(client_name)) > 0),
  so_number text not null check (length(btrim(so_number)) > 0),
  product text not null check (length(btrim(product)) > 0),
  branding_mode text not null check (length(btrim(branding_mode)) > 0),
  logo_position text,
  pantone_code text,
  branding_size text references public.branding_sizes(label),
  high_res_logo boolean not null default false,
  redesign_logo boolean not null default false,
  additional_info text,
  date_needed date not null,
  assigned_designer uuid references public.profiles(id),
  status public.artwork_status not null default 'Requested',
  claimed_at timestamptz,
  done_at timestamptz,
  done_by uuid references public.profiles(id),
  designer_notes text,
  change_count integer not null default 0,
  changes_done integer not null default 0,
  updated_at timestamptz not null default now(),
  constraint ref_no_format check (ref_no is null or ref_no ~ '^PK[0-9]{8}$')
);

create table public.artwork_changes (
  id uuid primary key default gen_random_uuid(),
  artwork_id uuid not null references public.artwork_requests(id) on delete cascade,
  change_text text not null,
  requested_by text not null,
  requested_on date not null default (now() at time zone 'Africa/Nairobi')::date,
  status public.change_status not null default 'open',
  done_at timestamptz,
  done_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create table public.user_credentials (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  encrypted_password bytea not null,
  updated_at timestamptz not null default now()
);

create table public.audit_log (
  id bigint generated always as identity primary key,
  actor_id uuid references public.profiles(id),
  target_user_id uuid references public.profiles(id),
  action text not null,
  created_at timestamptz not null default now(),
  details jsonb not null default '{}'::jsonb
);

create table public.login_attempts (
  username text primary key,
  failed_attempts integer not null default 0,
  locked_until timestamptz,
  updated_at timestamptz not null default now()
);

create index artwork_requests_creator_created_idx on public.artwork_requests (created_by, created_at desc);
create index artwork_requests_designer_needed_idx on public.artwork_requests (assigned_designer, date_needed, status);
create index artwork_requests_status_needed_idx on public.artwork_requests (status, date_needed);
create index artwork_changes_artwork_status_idx on public.artwork_changes (artwork_id, status, requested_on desc);
create index audit_log_target_created_idx on public.audit_log (target_user_id, created_at desc);
create unique index profiles_username_case_insensitive_idx on public.profiles (lower(username));

create function public.current_role()
returns public.app_role
language sql stable security definer
set search_path = ''
as $$
  select p.role from public.profiles p where p.id = (select auth.uid()) and p.active
$$;

create function public.is_admin()
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select coalesce(public.current_role() = 'admin'::public.app_role, false)
$$;

create function public.next_ref_no()
returns text
language plpgsql security definer
set search_path = ''
as $$
declare
  v_month text := to_char(now() at time zone 'Africa/Nairobi', 'YYMM');
  v_sequence integer;
begin
  insert into public.ref_counters (year_month, last_number)
  values (v_month, 1)
  on conflict (year_month) do update
    set last_number = public.ref_counters.last_number + 1
  returning last_number into v_sequence;
  if v_sequence > 9999 then
    raise exception 'Monthly artwork reference limit reached';
  end if;
  return 'PK' || v_month || lpad(v_sequence::text, 4, '0');
end
$$;

create function public.set_artwork_ref()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  new.id := gen_random_uuid();
  new.created_at := now();
  new.created_month := to_char(now() at time zone 'Africa/Nairobi', 'YYYY-MM');
  new.ref_no := public.next_ref_no();
  new.status := 'Requested'::public.artwork_status;
  new.claimed_at := null;
  new.done_at := null;
  new.done_by := null;
  new.designer_notes := null;
  new.change_count := 0;
  new.changes_done := 0;
  new.updated_at := now();
  if new.date_needed < (now() at time zone 'Africa/Nairobi')::date then
    raise exception 'Date needed cannot be in the past';
  end if;
  if new.assigned_designer is not null and not exists (
    select 1 from public.profiles p
    where p.id = new.assigned_designer and p.role = 'designer'::public.app_role and p.active
  ) then
    raise exception 'Assigned user must be an active designer';
  end if;
  return new;
end
$$;

create trigger artwork_ref_before_insert
before insert on public.artwork_requests
for each row execute function public.set_artwork_ref();

create function public.prepare_artwork_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.status := 'open'::public.change_status;
  new.done_at := null;
  new.done_by := null;
  new.created_at := now();
  return new;
end
$$;

create trigger artwork_change_before_insert
before insert on public.artwork_changes
for each row execute function public.prepare_artwork_change();

create function public.touch_artwork()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end
$$;

create trigger artwork_touch_before_update
before update on public.artwork_requests
for each row execute function public.touch_artwork();

create function public.set_artwork_completion()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status = 'Done'::public.artwork_status and old.status <> 'Done'::public.artwork_status then
    new.done_at := now();
    new.done_by := coalesce(new.assigned_designer, auth.uid());
  elsif new.status <> 'Done'::public.artwork_status then
    new.done_at := null;
    new.done_by := null;
  end if;
  return new;
end
$$;

create trigger artwork_completion_before_update
before update on public.artwork_requests
for each row execute function public.set_artwork_completion();

create function public.guard_artwork_update()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_role public.app_role := public.current_role();
begin
  if current_setting('app.system_change', true) = 'on' then
    return new;
  end if;
  if new.id is distinct from old.id
    or new.sr is distinct from old.sr
    or new.ref_no is distinct from old.ref_no
    or new.created_at is distinct from old.created_at
    or new.created_month is distinct from old.created_month
    or new.created_by is distinct from old.created_by then
    raise exception 'Artwork tracking fields are permanent';
  end if;
  if v_role = 'admin' then
    if new.assigned_designer is distinct from old.assigned_designer then
      if new.assigned_designer is not null and not exists (
        select 1 from public.profiles p
        where p.id = new.assigned_designer and p.role = 'designer'::public.app_role and p.active
      ) then
        raise exception 'Assigned user must be an active designer';
      end if;
      if new.status <> 'Done'::public.artwork_status then
        new.status := 'Requested'::public.artwork_status;
        new.claimed_at := null;
      end if;
    end if;
    return new;
  elsif v_role = 'salesperson' then
    if old.created_by <> auth.uid() or old.status <> 'Requested'::public.artwork_status then
      raise exception 'Salespeople may edit only their own requested artwork';
    end if;
    if new.assigned_designer is not null and not exists (
      select 1 from public.profiles p
      where p.id = new.assigned_designer and p.role = 'designer'::public.app_role and p.active
    ) then
      raise exception 'Assigned user must be an active designer';
    end if;
    if new.date_needed < (now() at time zone 'Africa/Nairobi')::date then
      raise exception 'Date needed cannot be in the past';
    end if;
    if (new.ref_no, new.sr, new.created_at, new.created_month, new.created_by, new.status, new.claimed_at, new.done_at, new.done_by, new.designer_notes, new.change_count, new.changes_done)
      is distinct from
       (old.ref_no, old.sr, old.created_at, old.created_month, old.created_by, old.status, old.claimed_at, old.done_at, old.done_by, old.designer_notes, old.change_count, old.changes_done) then
      raise exception 'Salespeople cannot modify system-managed artwork fields';
    end if;
    return new;
  elsif v_role = 'designer' then
    if new.ref_no is distinct from old.ref_no
      or new.sr is distinct from old.sr
      or new.created_at is distinct from old.created_at
      or new.created_month is distinct from old.created_month
      or new.created_by is distinct from old.created_by
      or new.category is distinct from old.category
      or new.client_name is distinct from old.client_name
      or new.so_number is distinct from old.so_number
      or new.product is distinct from old.product
      or new.branding_mode is distinct from old.branding_mode
      or new.logo_position is distinct from old.logo_position
      or new.pantone_code is distinct from old.pantone_code
      or new.branding_size is distinct from old.branding_size
      or new.high_res_logo is distinct from old.high_res_logo
      or new.redesign_logo is distinct from old.redesign_logo
      or new.additional_info is distinct from old.additional_info
      or new.date_needed is distinct from old.date_needed
      or new.change_count is distinct from old.change_count
      or new.changes_done is distinct from old.changes_done then
      raise exception 'Designers cannot edit request details';
    end if;
    if old.assigned_designer is distinct from auth.uid() then
      if old.assigned_designer is not null
        or new.assigned_designer is distinct from auth.uid()
        or old.status = 'Done'::public.artwork_status
        or new.status <> 'In progress'::public.artwork_status then
        raise exception 'This artwork is not available to claim';
      end if;
      new.claimed_at := now();
    else
      if new.assigned_designer is distinct from old.assigned_designer then
        raise exception 'Designer assignment cannot be changed here';
      end if;
      if new.status not in ('In progress'::public.artwork_status, 'Done'::public.artwork_status) then
        raise exception 'Invalid designer status update';
      end if;
      if new.status = 'Done'::public.artwork_status
        and old.status <> 'In progress'::public.artwork_status then
        raise exception 'Start the artwork before marking it done';
      end if;
      if new.status = 'In progress'::public.artwork_status
        and old.status <> 'In progress'::public.artwork_status then
        new.claimed_at := coalesce(old.claimed_at, now());
      elsif new.claimed_at is distinct from old.claimed_at then
        raise exception 'Claim time is system managed';
      end if;
    end if;
    if new.status = 'Done'::public.artwork_status then
      new.done_at := now();
      new.done_by := auth.uid();
    elsif new.status = 'In progress'::public.artwork_status then
      new.done_at := null;
      new.done_by := null;
    end if;
    return new;
  end if;
  raise exception 'Not authorized to update artwork';
end
$$;

create trigger artwork_guard_before_update
before update on public.artwork_requests
for each row execute function public.guard_artwork_update();

create function public.after_artwork_change_insert()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  perform set_config('app.system_change', 'on', true);
  update public.artwork_requests
    set status = 'Change requested'::public.artwork_status,
        done_at = null,
        done_by = null,
        updated_at = now()
    where id = new.artwork_id;
  perform set_config('app.system_change', 'off', true);
  return new;
end
$$;

create trigger artwork_change_after_insert
after insert on public.artwork_changes
for each row execute function public.after_artwork_change_insert();

create function public.guard_artwork_change_update()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if public.current_role() = 'admin' then
    return new;
  end if;
  if public.current_role() <> 'designer'
    or old.status <> 'open'::public.change_status
    or new.status <> 'done'::public.change_status
    or new.artwork_id is distinct from old.artwork_id
    or new.change_text is distinct from old.change_text
    or new.requested_by is distinct from old.requested_by
    or new.requested_on is distinct from old.requested_on
    or new.created_at is distinct from old.created_at
    or new.done_by is distinct from auth.uid() then
    raise exception 'Only the assigned designer may complete an open change';
  end if;
  if not exists (
    select 1 from public.artwork_requests a
    where a.id = old.artwork_id and a.assigned_designer = auth.uid()
  ) then
    raise exception 'Only the assigned designer may complete this change';
  end if;
  new.done_at := now();
  return new;
end
$$;

create trigger artwork_change_guard_before_update
before update on public.artwork_changes
for each row execute function public.guard_artwork_change_update();

create function public.after_artwork_change_update()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if old.status = 'open'::public.change_status and new.status = 'done'::public.change_status then
    perform set_config('app.system_change', 'on', true);
    update public.artwork_requests
      set changes_done = changes_done + 1,
          updated_at = now()
      where id = new.artwork_id;
    perform set_config('app.system_change', 'off', true);
  end if;
  return new;
end
$$;

create trigger artwork_change_after_update
after update on public.artwork_changes
for each row execute function public.after_artwork_change_update();

create function public.after_artwork_change_insert_count()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  perform set_config('app.system_change', 'on', true);
  update public.artwork_requests set change_count = change_count + 1 where id = new.artwork_id;
  perform set_config('app.system_change', 'off', true);
  return new;
end
$$;
create trigger artwork_change_count_after_insert
after insert on public.artwork_changes
for each row execute function public.after_artwork_change_insert_count();

create function public.complete_open_artwork_changes()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if old.status <> 'Done'::public.artwork_status and new.status = 'Done'::public.artwork_status
    and new.done_by is not null then
    update public.artwork_changes
      set status = 'done'::public.change_status, done_at = now(), done_by = new.done_by
      where artwork_id = new.id and status = 'open'::public.change_status;
  end if;
  return new;
end
$$;

create trigger artwork_done_after_update
after update on public.artwork_requests
for each row execute function public.complete_open_artwork_changes();

create function public.store_user_credential(p_user_id uuid, p_password text, p_key text)
returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  if p_key is null or length(p_key) < 32 then
    raise exception 'Credential encryption key is missing or too short';
  end if;
  insert into public.user_credentials (user_id, encrypted_password, updated_at)
  values (p_user_id, extensions.pgp_sym_encrypt(p_password, p_key), now())
  on conflict (user_id) do update
    set encrypted_password = excluded.encrypted_password, updated_at = now();
end
$$;

create function public.admin_view_password(p_target_user_id uuid, p_actor_id uuid, p_key text)
returns text
language plpgsql security definer
set search_path = ''
as $$
declare
  v_password text;
begin
  if p_key is null or length(p_key) < 32 then
    raise exception 'Credential encryption key is missing or too short';
  end if;
  select extensions.pgp_sym_decrypt(c.encrypted_password, p_key)
    into v_password
    from public.user_credentials c where c.user_id = p_target_user_id;
  if v_password is null then
    raise exception 'No saved password is available; reset the password to store it';
  end if;
  insert into public.audit_log (actor_id, target_user_id, action)
    values (p_actor_id, p_target_user_id, 'password_viewed');
  return v_password;
end
$$;

create function public.login_attempt_state(p_username text)
returns table (is_locked boolean, locked_until timestamptz)
language plpgsql security definer
set search_path = ''
as $$
begin
  return query
  select coalesce(a.locked_until > now(), false), a.locked_until
  from public.login_attempts a where a.username = lower(trim(p_username));
  if not found then
    return query select false, null::timestamptz;
  end if;
end
$$;

create function public.record_login_attempt(p_username text, p_success boolean)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_username text := lower(trim(p_username));
begin
  if p_success then
    delete from public.login_attempts where username = v_username;
  else
    insert into public.login_attempts (username, failed_attempts, locked_until, updated_at)
    values (v_username, 1, null, now())
    on conflict (username) do update set
      failed_attempts = case
        when public.login_attempts.locked_until < now() then 1
        else public.login_attempts.failed_attempts + 1
      end,
      locked_until = case
        when public.login_attempts.locked_until < now() then null
        when public.login_attempts.failed_attempts + 1 >= 5 then now() + interval '15 minutes'
        else public.login_attempts.locked_until
      end,
      updated_at = now();
  end if;
end
$$;

alter table public.profiles enable row level security;
alter table public.branding_sizes enable row level security;
alter table public.artwork_requests enable row level security;
alter table public.artwork_changes enable row level security;
alter table public.user_credentials enable row level security;
alter table public.audit_log enable row level security;
alter table public.ref_counters enable row level security;
alter table public.login_attempts enable row level security;

create policy "Authenticated users can read profiles" on public.profiles
  for select to authenticated using (active or public.is_admin() or id = (select auth.uid()));
create policy "Admins manage profiles" on public.profiles
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

create policy "Authenticated users read branding sizes" on public.branding_sizes
  for select to authenticated using (true);
create policy "Admins insert branding sizes" on public.branding_sizes
  for insert to authenticated with check (public.is_admin());
create policy "Admins update branding sizes" on public.branding_sizes
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

create policy "Sales read own artwork" on public.artwork_requests
  for select to authenticated using (created_by = (select auth.uid()) and public.current_role() = 'salesperson');
create policy "Designers read assigned and Any artwork" on public.artwork_requests
  for select to authenticated using (
    public.current_role() = 'designer'
    and (assigned_designer = (select auth.uid()) or assigned_designer is null)
  );
create policy "Admins read all artwork" on public.artwork_requests
  for select to authenticated using (public.is_admin());
create policy "Sales insert own artwork" on public.artwork_requests
  for insert to authenticated with check (
    created_by = (select auth.uid()) and public.current_role() = 'salesperson'
    and status = 'Requested'::public.artwork_status
  );
create policy "Sales edit own requested artwork" on public.artwork_requests
  for update to authenticated using (
    created_by = (select auth.uid()) and public.current_role() = 'salesperson'
    and status = 'Requested'::public.artwork_status
  ) with check (created_by = (select auth.uid()) and status = 'Requested'::public.artwork_status);
create policy "Designers claim or update visible work" on public.artwork_requests
  for update to authenticated using (
    public.current_role() = 'designer'
    and (assigned_designer = (select auth.uid()) or assigned_designer is null)
    and status <> 'Done'::public.artwork_status
  ) with check (
    public.current_role() = 'designer'
    and assigned_designer = (select auth.uid())
  );
create policy "Admins manage artwork" on public.artwork_requests
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "Admins delete artwork" on public.artwork_requests
  for delete to authenticated using (public.is_admin());

create policy "Sales read own changes" on public.artwork_changes
  for select to authenticated using (
    public.current_role() = 'salesperson'
    and exists (select 1 from public.artwork_requests a where a.id = artwork_id and a.created_by = (select auth.uid()))
  );
create policy "Designers read visible changes" on public.artwork_changes
  for select to authenticated using (
    public.current_role() = 'designer'
    and exists (select 1 from public.artwork_requests a where a.id = artwork_id and (a.assigned_designer = (select auth.uid()) or a.assigned_designer is null))
  );
create policy "Admins read changes" on public.artwork_changes
  for select to authenticated using (public.is_admin());
create policy "Sales add own changes" on public.artwork_changes
  for insert to authenticated with check (
    public.current_role() = 'salesperson'
    and exists (select 1 from public.artwork_requests a where a.id = artwork_id and a.created_by = (select auth.uid()))
    and status = 'open'::public.change_status
  );
create policy "Designers complete visible changes" on public.artwork_changes
  for update to authenticated using (
    public.current_role() = 'designer' and status = 'open'::public.change_status
    and exists (select 1 from public.artwork_requests a where a.id = artwork_id and a.assigned_designer = (select auth.uid()))
  ) with check (status = 'done'::public.change_status and done_by = (select auth.uid()));
create policy "Admins manage changes" on public.artwork_changes
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy "Admins manage branding options" on public.branding_sizes
  for delete to authenticated using (public.is_admin());

grant select on public.profiles, public.branding_sizes, public.artwork_requests, public.artwork_changes to authenticated;
grant update on public.profiles, public.branding_sizes, public.artwork_requests, public.artwork_changes to authenticated;
grant insert on public.branding_sizes, public.artwork_requests, public.artwork_changes to authenticated;
grant delete on public.branding_sizes, public.artwork_requests, public.artwork_changes to authenticated;
revoke all on public.user_credentials, public.audit_log, public.ref_counters, public.login_attempts from anon, authenticated;
revoke all on function public.store_user_credential(uuid, text, text) from public, anon, authenticated;
revoke all on function public.admin_view_password(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.login_attempt_state(text) from public, anon, authenticated;
revoke all on function public.record_login_attempt(text, boolean) from public, anon, authenticated;
revoke all on function public.next_ref_no() from public, anon, authenticated;
grant execute on function public.store_user_credential(uuid, text, text) to service_role;
grant execute on function public.admin_view_password(uuid, uuid, text) to service_role;
grant execute on function public.login_attempt_state(text) to service_role;
grant execute on function public.record_login_attempt(text, boolean) to service_role;
grant usage, select on all sequences in schema public to authenticated;

insert into public.branding_sizes (label, sort_order) values
  ('Small (up to 5x5 cm)', 1),
  ('Medium (up to 10x10 cm)', 2),
  ('Large (up to 20x20 cm)', 3),
  ('Full wrap', 4),
  ('Other (see notes)', 5)
on conflict (label) do nothing;

do $$
declare
  v_admin_id uuid := 'f17de2b0-978f-4e64-997f-525ba11c2001';
  v_email text := 'it@promokings.local';
begin
  if not exists (select 1 from auth.users where email = v_email) then
    insert into auth.users (
      id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, recovery_token, email_change_token_new, email_change
    ) values (
      v_admin_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
      v_email, extensions.crypt('#Promoadm1n', extensions.gen_salt('bf')), now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{"username":"IT","full_name":"Promo Kings Administrator","role":"admin","password_change_required":true}'::jsonb,
      now(), now(), '', '', '', ''
    );
    insert into auth.identities (provider_id, user_id, identity_data, provider, created_at, updated_at)
    values (
      v_admin_id::text, v_admin_id,
      jsonb_build_object('sub', v_admin_id::text, 'email', v_email),
      'email', now(), now()
    );
  end if;
  insert into public.profiles (id, username, full_name, role, active)
  select id, 'it', 'Promo Kings Administrator', 'admin', true
  from auth.users where email = v_email
  on conflict (id) do nothing;
end
$$;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'artwork_requests'
  ) then
    alter publication supabase_realtime add table public.artwork_requests;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'artwork_changes'
  ) then
    alter publication supabase_realtime add table public.artwork_changes;
  end if;
end
$$;
