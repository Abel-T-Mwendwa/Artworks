create or replace function public.has_valid_branding_details(value jsonb)
returns boolean
language plpgsql
immutable
parallel safe
set search_path = ''
as $$
declare
  item jsonb;
  field_name text;
begin
  if value is null or pg_catalog.jsonb_typeof(value) <> 'array'
    or pg_catalog.jsonb_array_length(value) = 0 then
    return false;
  end if;

  for item in select pg_catalog.jsonb_array_elements(value)
  loop
    if pg_catalog.jsonb_typeof(item) <> 'object' then
      return false;
    end if;
    foreach field_name in array array['logo', 'mode', 'pantone', 'size', 'position']
    loop
      if pg_catalog.jsonb_typeof(item -> field_name) <> 'string' then
        return false;
      end if;
    end loop;
    if pg_catalog.length(pg_catalog.btrim(item ->> 'mode')) = 0 then
      return false;
    end if;
  end loop;
  return true;
end
$$;

alter table public.artwork_requests
  add column branding_details jsonb,
  add column preferred_designer uuid references public.profiles(id),
  add column preferred_designer_recorded boolean not null default true;

-- Claimed legacy requests do not reveal whether the original preference was Any.
do $$
begin
  perform set_config('app.system_change', 'on', true);
  execute 'alter table public.artwork_requests disable trigger artwork_touch_before_update';
  update public.artwork_requests as request
  set preferred_designer = case when request.claimed_at is null then request.assigned_designer else null end,
      preferred_designer_recorded = request.claimed_at is null,
      branding_details = (
        select pg_catalog.jsonb_agg(
          pg_catalog.jsonb_build_object(
            -- The legacy value combined logo and position, so keep it intact in Position.
            'logo', '',
            'mode', coalesce(request.branding_mode ->> (line_number - 1), request.branding_mode ->> 0, ''),
            'pantone', case when line_number = 1 then coalesce(request.pantone_code, '') else '' end,
            'size', case when line_number = 1 then coalesce(request.branding_size, '') else '' end,
            'position', coalesce(request.logo_position ->> (line_number - 1), request.logo_position ->> 0, '')
          )
          order by line_number
        )
        from pg_catalog.generate_series(
          1,
          greatest(
            coalesce(pg_catalog.jsonb_array_length(request.branding_mode), 0),
            coalesce(pg_catalog.jsonb_array_length(request.logo_position), 0),
            1
          )
        ) as line_index(line_number)
      );
  execute 'alter table public.artwork_requests enable trigger artwork_touch_before_update';
  perform set_config('app.system_change', 'off', true);
exception when others then
  execute 'alter table public.artwork_requests enable trigger artwork_touch_before_update';
  perform set_config('app.system_change', 'off', true);
  raise;
end
$$;

alter table public.artwork_requests
  alter column branding_details set not null,
  add constraint artwork_requests_branding_details_check
    check (public.has_valid_branding_details(branding_details)),
  add constraint artwork_requests_preferred_designer_recorded_check
    check (preferred_designer_recorded or preferred_designer is null);

create or replace function public.validate_artwork_detail_lines()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if not public.has_nonempty_text_lines(new.product) then
      raise exception 'Product must contain at least one non-empty line';
    end if;
    if not public.has_nonempty_text_lines(new.branding_mode) then
      raise exception 'Branding must contain at least one valid mode';
    end if;
  else
    if new.product is distinct from old.product and not public.has_nonempty_text_lines(new.product) then
      raise exception 'Product must contain at least one non-empty line';
    end if;
    if new.branding_mode is distinct from old.branding_mode and not public.has_nonempty_text_lines(new.branding_mode) then
      raise exception 'Branding must contain at least one valid mode';
    end if;
  end if;
  return new;
end
$$;

create or replace function public.sync_artwork_branding_legacy_fields()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  modes jsonb;
  positions jsonb;
begin
  if not public.has_valid_branding_details(new.branding_details) then
    raise exception 'Each branding line must have a mode and valid text fields';
  end if;

  select pg_catalog.jsonb_agg(item -> 'mode' order by ordinal),
         pg_catalog.jsonb_agg(item -> 'position' order by ordinal)
           filter (where pg_catalog.length(pg_catalog.btrim(item ->> 'position')) > 0)
    into modes, positions
    from pg_catalog.jsonb_array_elements(new.branding_details) with ordinality as detail(item, ordinal);

  new.branding_mode := modes;
  new.logo_position := case
    when exists (
      select 1 from pg_catalog.jsonb_array_elements(new.branding_details) as detail(item)
      where pg_catalog.length(pg_catalog.btrim(item ->> 'position')) > 0
    ) then positions
    else null
  end;
  new.pantone_code := nullif(pg_catalog.btrim(new.branding_details -> 0 ->> 'pantone'), '');
  new.branding_size := nullif(pg_catalog.btrim(new.branding_details -> 0 ->> 'size'), '');
  return new;
end
$$;

create trigger artwork_branding_sync_before_insert
before insert on public.artwork_requests
for each row execute function public.sync_artwork_branding_legacy_fields();

create trigger artwork_branding_sync_before_update
before update of branding_details on public.artwork_requests
for each row execute function public.sync_artwork_branding_legacy_fields();

create or replace function public.guard_artwork_branding_and_preference()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role public.app_role := public.current_role();
begin
  if current_setting('app.system_change', true) = 'on' then
    return new;
  end if;

  if tg_op = 'UPDATE'
    and new.branding_details is not distinct from old.branding_details
    and (new.branding_mode is distinct from old.branding_mode
      or new.logo_position is distinct from old.logo_position
      or new.pantone_code is distinct from old.pantone_code
      or new.branding_size is distinct from old.branding_size) then
    raise exception 'Update branding through the branding details field';
  end if;

  if v_role = 'designer' then
    if new.branding_details is distinct from old.branding_details
      or new.preferred_designer is distinct from old.preferred_designer
      or new.preferred_designer_recorded is distinct from old.preferred_designer_recorded then
      raise exception 'Designers cannot change branding details or designer preference';
    end if;
    return new;
  end if;

  if v_role = 'salesperson' then
    if not new.preferred_designer_recorded then
      raise exception 'Choose a designer preference for this request';
    end if;
    if new.preferred_designer is distinct from new.assigned_designer then
      raise exception 'Preferred designer must match the request assignment';
    end if;
    if new.preferred_designer is not null and not exists (
      select 1 from public.profiles p
      where p.id = new.preferred_designer and p.role = 'designer'::public.app_role and p.active
    ) then
      raise exception 'Preferred user must be an active designer';
    end if;
  elsif v_role = 'admin' then
    if new.preferred_designer is distinct from old.preferred_designer
      and new.preferred_designer is not null and not exists (
      select 1 from public.profiles p
      where p.id = new.preferred_designer and p.role = 'designer'::public.app_role and p.active
    ) then
      raise exception 'Preferred user must be an active designer';
    end if;
  end if;
  return new;
end
$$;

create trigger artwork_branding_update_guard
before update on public.artwork_requests
for each row execute function public.guard_artwork_branding_and_preference();

create or replace function public.set_artwork_ref()
returns trigger
language plpgsql
security definer
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
  if not new.preferred_designer_recorded
    or new.preferred_designer is distinct from new.assigned_designer then
    raise exception 'Preferred designer must match the request assignment';
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

create table public.designer_notifications (
  id uuid primary key default gen_random_uuid(),
  artwork_id uuid not null references public.artwork_requests(id) on delete cascade,
  designer_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  read_at timestamptz
);

create index designer_notifications_unread_idx
  on public.designer_notifications (designer_id, created_at desc)
  where read_at is null;

alter table public.designer_notifications enable row level security;

create policy "Designers read their assignment notifications"
  on public.designer_notifications
  for select to authenticated
  using (designer_id = (select auth.uid()) and public.current_role() = 'designer'::public.app_role);

grant select on public.designer_notifications to authenticated;
revoke insert, update, delete on public.designer_notifications from anon, authenticated;

create or replace function public.notify_preferred_designer()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and new.preferred_designer is not distinct from old.preferred_designer then
    return new;
  end if;

  update public.designer_notifications
    set read_at = now()
    where artwork_id = new.id and read_at is null;

  if new.preferred_designer is not null then
    insert into public.designer_notifications (artwork_id, designer_id)
    values (new.id, new.preferred_designer);
  end if;
  return new;
end
$$;

create trigger artwork_preferred_designer_notification_after_insert
after insert on public.artwork_requests
for each row execute function public.notify_preferred_designer();

create trigger artwork_preferred_designer_notification_after_update
after update of preferred_designer on public.artwork_requests
for each row execute function public.notify_preferred_designer();

create or replace function public.clear_assignment_notification_on_start()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status is distinct from old.status
    and new.status in ('In progress'::public.artwork_status, 'Done'::public.artwork_status) then
    update public.designer_notifications
      set read_at = now()
      where artwork_id = new.id and read_at is null;
  end if;
  return new;
end
$$;

create trigger artwork_assignment_notification_clear_after_update
after update of status on public.artwork_requests
for each row execute function public.clear_assignment_notification_on_start();

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'designer_notifications'
  ) then
    alter publication supabase_realtime add table public.designer_notifications;
  end if;
end
$$;
