alter type public.app_role add value if not exists 'production';
alter type public.app_role add value if not exists 'dispatch';
alter type public.app_role add value if not exists 'route_admin';
alter type public.app_role add value if not exists 'rider';

create table if not exists public.deliveries (
  id uuid primary key default gen_random_uuid(),
  sr bigint generated always as identity unique,
  ref_no text unique,
  created_at timestamptz not null default now(),
  created_by uuid not null references public.profiles(id),
  client_name text not null check (length(btrim(client_name)) between 1 and 160),
  contact_name text not null check (length(btrim(contact_name)) between 1 and 160),
  contact_number text not null check (contact_number ~ '^\+?[0-9][0-9 ()-]{6,30}$'),
  items jsonb not null,
  delivery_time time not null,
  delivery_date date not null,
  special_instruction text check (special_instruction is null or length(special_instruction) <= 1000),
  production_status text not null default 'Not ready'
    check (production_status in ('Not ready', 'Ready')),
  dispatch_status text not null default 'Not delivered'
    check (dispatch_status in ('Not delivered', 'Delivered')),
  ready_at timestamptz,
  dispatched_at timestamptz,
  delivered_at timestamptz,
  transport text check (transport is null or transport in ('Client', 'Company')),
  vehicle_id uuid,
  constraint deliveries_ref_no_format check (ref_no is null or ref_no ~ '^DL[0-9]{8}$')
);

create table if not exists public.vehicles (
  id uuid primary key default gen_random_uuid(),
  registration_number text not null unique check (length(btrim(registration_number)) between 1 and 32),
  description text not null check (length(btrim(description)) between 1 and 120),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles(id)
);

create table if not exists public.rider_jobs (
  id uuid primary key default gen_random_uuid(),
  sr bigint generated always as identity unique,
  ref_no text unique,
  created_at timestamptz not null default now(),
  created_by uuid not null references public.profiles(id),
  client_name text not null check (length(btrim(client_name)) between 1 and 160),
  contact_name text not null check (length(btrim(contact_name)) between 1 and 160),
  contact_number text not null check (contact_number ~ '^\+?[0-9][0-9 ()-]{6,30}$'),
  address text not null check (length(btrim(address)) between 1 and 240),
  job_type text not null check (job_type in ('Pickup', 'Dropoff')),
  details text not null check (length(btrim(details)) between 1 and 500),
  expected_time time not null,
  scheduled_date date not null default (now() at time zone 'Africa/Nairobi')::date,
  assigned_rider uuid references public.profiles(id),
  rider_time time,
  rider_time_end time,
  status text not null default 'Not started'
    check (status in ('Not started', 'Started', 'In progress', 'Finished')),
  assigned_at timestamptz,
  started_at timestamptz,
  finished_at timestamptz,
  constraint rider_jobs_ref_no_format check (ref_no is null or ref_no ~ '^RJ[0-9]{8}$'),
  constraint rider_jobs_rider_slot_check check (
    (assigned_rider is null and rider_time is null and rider_time_end is null)
    or (assigned_rider is not null and rider_time is not null and rider_time_end is not null
      and rider_time_end = rider_time + interval '1 hour')
  )
);

create table if not exists public.portal_notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  notification_type text not null,
  related_id uuid not null,
  event_key text not null unique,
  created_at timestamptz not null default now(),
  read_at timestamptz
);

create table if not exists public.portal_ref_counters (
  prefix text not null check (prefix in ('DL', 'RJ')),
  year_month text not null check (year_month ~ '^[0-9]{4}$'),
  last_number integer not null check (last_number between 0 and 9999),
  primary key (prefix, year_month)
);

do $$
begin
  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.deliveries'::regclass
      and conname = 'deliveries_vehicle_id_fkey'
  ) then
    alter table public.deliveries
      add constraint deliveries_vehicle_id_fkey
      foreign key (vehicle_id) references public.vehicles(id);
  end if;
end
$$;

create index if not exists deliveries_status_created_idx
  on public.deliveries (production_status, dispatch_status, created_at desc);
create index if not exists deliveries_created_by_created_idx
  on public.deliveries (created_by, created_at desc);
create index if not exists rider_jobs_status_created_idx
  on public.rider_jobs (status, created_at desc);
create index if not exists rider_jobs_assignee_status_idx
  on public.rider_jobs (assigned_rider, status, created_at desc);
create index if not exists rider_jobs_creator_created_idx
  on public.rider_jobs (created_by, created_at desc);
create unique index if not exists rider_jobs_one_in_progress_per_rider_idx
  on public.rider_jobs (assigned_rider)
  where assigned_rider is not null and status = 'In progress';
create index if not exists portal_notifications_recipient_unread_idx
  on public.portal_notifications (recipient_id, created_at desc)
  where read_at is null;
create index if not exists vehicles_active_registration_idx
  on public.vehicles (active, registration_number);

drop policy if exists "Authenticated users can read profiles" on public.profiles;
create policy "Authenticated users can read profiles" on public.profiles
for select to authenticated using (
  active or public.is_admin() or id = (select auth.uid())
  or (public.current_role()::text = 'route_admin' and role::text = 'rider')
);

create or replace function public.valid_delivery_items(value jsonb)
returns boolean
language plpgsql
immutable
parallel safe
set search_path = ''
as $$
declare
  item jsonb;
begin
  if value is null or pg_catalog.jsonb_typeof(value) <> 'array'
    or pg_catalog.jsonb_array_length(value) = 0 then
    return false;
  end if;
  for item in select pg_catalog.jsonb_array_elements(value)
  loop
    if pg_catalog.jsonb_typeof(item) <> 'object'
      or coalesce(pg_catalog.length(pg_catalog.btrim(item ->> 'so_number')), 0) = 0
      or coalesce(pg_catalog.length(pg_catalog.btrim(item ->> 'so_number')), 0) > 200
      or coalesce(pg_catalog.length(pg_catalog.btrim(item ->> 'item_name')), 0) = 0
      or coalesce(pg_catalog.length(pg_catalog.btrim(item ->> 'item_name')), 0) > 200
      or coalesce((item ->> 'address') !~ '^[^,[:space:]][^,]*,[[:space:]]*[^,[:space:]][^,]*,[[:space:]]*[^,[:space:]][^,]*$', true)
      or coalesce(pg_catalog.length(item ->> 'address'), 0) > 200
      or coalesce((item ->> 'quantity')::integer, 0) < 1 then
      return false;
    end if;
  end loop;
  return true;
exception when invalid_text_representation or numeric_value_out_of_range then
  return false;
end
$$;

alter table public.deliveries drop constraint if exists deliveries_items_check;
alter table public.deliveries add constraint deliveries_items_check
  check (public.valid_delivery_items(items));

alter table public.deliveries drop constraint if exists deliveries_status_timestamps_check;
alter table public.deliveries add constraint deliveries_status_timestamps_check check (
  ((production_status = 'Not ready' and ready_at is null)
    or (production_status = 'Ready' and ready_at is not null))
  and ((dispatch_status = 'Not delivered' and delivered_at is null)
    or (dispatch_status = 'Delivered' and delivered_at is not null and dispatched_at is not null
      and production_status = 'Ready'))
  and (dispatched_at is null or transport is not null)
  and (transport is distinct from 'Company' or vehicle_id is not null)
);

alter table public.rider_jobs drop constraint if exists rider_jobs_status_timestamp_check;
alter table public.rider_jobs add constraint rider_jobs_status_timestamp_check check (
  (status = 'Not started' and assigned_rider is null and assigned_at is null
    and started_at is null and finished_at is null)
  or (status = 'Started' and assigned_rider is not null and assigned_at is not null
    and started_at is null and finished_at is null)
  or (status = 'In progress' and assigned_rider is not null and assigned_at is not null
    and started_at is not null and finished_at is null)
  or (status = 'Finished' and assigned_rider is not null and assigned_at is not null
    and started_at is not null and finished_at is not null)
);

create or replace function public.next_portal_ref(p_prefix text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  month_key text := pg_catalog.to_char(now() at time zone 'Africa/Nairobi', 'YYMM');
  next_number integer;
begin
  if p_prefix not in ('DL', 'RJ') then
    raise exception 'Invalid reference prefix';
  end if;
  insert into public.portal_ref_counters (prefix, year_month, last_number)
  values (p_prefix, month_key, 1)
  on conflict (prefix, year_month) do update
    set last_number = public.portal_ref_counters.last_number + 1
  returning last_number into next_number;
  if next_number > 9999 then
    raise exception 'Monthly reference limit reached';
  end if;
  return p_prefix || month_key || pg_catalog.lpad(next_number::text, 4, '0');
end
$$;

create or replace function public.prepare_delivery_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if public.current_role()::text not in ('salesperson', 'admin')
    or (public.current_role()::text = 'salesperson' and new.created_by <> auth.uid()) then
    raise exception 'Only a salesperson may submit their own delivery request';
  end if;
  if new.delivery_date < (now() at time zone 'Africa/Nairobi')::date then
    raise exception 'Delivery date cannot be in the past';
  end if;
  new.id := coalesce(new.id, gen_random_uuid());
  new.created_at := now();
  new.ref_no := public.next_portal_ref('DL');
  new.production_status := 'Not ready';
  new.dispatch_status := 'Not delivered';
  new.ready_at := null;
  new.dispatched_at := null;
  new.delivered_at := null;
  new.transport := null;
  new.vehicle_id := null;
  return new;
end
$$;

drop trigger if exists deliveries_prepare_before_insert on public.deliveries;
create trigger deliveries_prepare_before_insert
before insert on public.deliveries
for each row execute function public.prepare_delivery_insert();

create or replace function public.guard_delivery_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_role text := public.current_role()::text;
begin
  if actor_role = 'admin' then
    return new;
  elsif actor_role = 'production' then
    if (new.id, new.sr, new.ref_no, new.created_at, new.created_by, new.client_name,
        new.contact_name, new.contact_number, new.items, new.delivery_time, new.delivery_date,
        new.special_instruction, new.dispatch_status, new.dispatched_at, new.delivered_at,
        new.transport, new.vehicle_id)
       is distinct from
       (old.id, old.sr, old.ref_no, old.created_at, old.created_by, old.client_name,
        old.contact_name, old.contact_number, old.items, old.delivery_time, old.delivery_date,
        old.special_instruction, old.dispatch_status, old.dispatched_at, old.delivered_at,
        old.transport, old.vehicle_id)
      or old.production_status <> 'Not ready' or new.production_status <> 'Ready' then
      raise exception 'Production may only mark a request Ready once';
    end if;
    new.ready_at := now();
    return new;
  elsif actor_role = 'dispatch' then
    if old.production_status <> 'Ready'
      or new.production_status is distinct from old.production_status
      or (new.id, new.sr, new.ref_no, new.created_at, new.created_by, new.client_name,
          new.contact_name, new.contact_number, new.items, new.delivery_time, new.delivery_date,
          new.special_instruction, new.ready_at)
         is distinct from
         (old.id, old.sr, old.ref_no, old.created_at, old.created_by, old.client_name,
          old.contact_name, old.contact_number, old.items, old.delivery_time, old.delivery_date,
          old.special_instruction, old.ready_at) then
      raise exception 'Dispatch is available only after production marks the request Ready';
    end if;
    if old.dispatch_status = 'Delivered' then
      raise exception 'Delivered requests cannot be changed';
    end if;
    if new.dispatch_status = 'Delivered' then
      if old.dispatched_at is null and new.dispatched_at is null then
        raise exception 'Dispatch this request before marking it Delivered';
      end if;
      new.dispatched_at := coalesce(old.dispatched_at, new.dispatched_at);
      new.delivered_at := now();
    else
      if new.transport not in ('Client', 'Company') then
        raise exception 'Choose Client or Company transport';
      end if;
      if new.transport = 'Company' and not exists (
        select 1 from public.vehicles v where v.id = new.vehicle_id and v.active
      ) then
        raise exception 'Choose an active company vehicle';
      end if;
      if new.transport = 'Client' then new.vehicle_id := null; end if;
      new.dispatched_at := coalesce(old.dispatched_at, now());
      new.delivered_at := null;
    end if;
    return new;
  end if;
  raise exception 'Not authorized to update delivery requests';
end
$$;

drop trigger if exists deliveries_guard_before_update on public.deliveries;
create trigger deliveries_guard_before_update
before update on public.deliveries
for each row execute function public.guard_delivery_update();

create or replace function public.prepare_rider_job_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if public.current_role()::text not in ('salesperson', 'admin')
    or (public.current_role()::text = 'salesperson' and new.created_by <> auth.uid()) then
    raise exception 'Only a salesperson may request a rider';
  end if;
  new.id := coalesce(new.id, gen_random_uuid());
  new.created_at := now();
  new.ref_no := public.next_portal_ref('RJ');
  new.scheduled_date := (now() at time zone 'Africa/Nairobi')::date;
  new.assigned_rider := null;
  new.rider_time := null;
  new.rider_time_end := null;
  new.status := 'Not started';
  new.assigned_at := null;
  new.started_at := null;
  new.finished_at := null;
  return new;
end
$$;

drop trigger if exists rider_jobs_prepare_before_insert on public.rider_jobs;
create trigger rider_jobs_prepare_before_insert
before insert on public.rider_jobs
for each row execute function public.prepare_rider_job_insert();

create or replace function public.guard_rider_job_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_role text := public.current_role()::text;
begin
  if actor_role = 'admin' then return new; end if;
  if actor_role = 'route_admin' then
    if (new.id, new.sr, new.ref_no, new.created_at, new.created_by, new.client_name,
        new.contact_name, new.contact_number, new.address, new.job_type, new.details,
        new.expected_time, new.scheduled_date, new.started_at, new.finished_at)
       is distinct from
       (old.id, old.sr, old.ref_no, old.created_at, old.created_by, old.client_name,
        old.contact_name, old.contact_number, old.address, old.job_type, old.details,
        old.expected_time, old.scheduled_date, old.started_at, old.finished_at)
      or old.status <> 'Not started' or new.status <> 'Started'
      or new.assigned_rider is null or new.rider_time is null or new.rider_time_end is null
      or not exists (
        select 1 from public.profiles p
        where p.id = new.assigned_rider and p.role::text = 'rider' and p.active
      ) then
      raise exception 'Route admin may assign only an unassigned rider request to an active rider and time slot';
    end if;
    new.assigned_at := now();
    return new;
  elsif actor_role = 'rider' then
    if old.assigned_rider <> auth.uid()
      or (new.id, new.sr, new.ref_no, new.created_at, new.created_by, new.client_name,
          new.contact_name, new.contact_number, new.address, new.job_type, new.details,
          new.expected_time, new.scheduled_date, new.assigned_rider, new.rider_time,
          new.rider_time_end, new.assigned_at)
         is distinct from
         (old.id, old.sr, old.ref_no, old.created_at, old.created_by, old.client_name,
          old.contact_name, old.contact_number, old.address, old.job_type, old.details,
          old.expected_time, old.scheduled_date, old.assigned_rider, old.rider_time,
          old.rider_time_end, old.assigned_at) then
      raise exception 'Riders may update only their own assigned job status';
    end if;
    if old.status = 'Started' and new.status = 'In progress' then
      new.started_at := now();
      new.finished_at := null;
    elsif old.status = 'In progress' and new.status = 'Finished' then
      new.finished_at := now();
    else
      raise exception 'Rider jobs must be started before they can be finished';
    end if;
    return new;
  end if;
  raise exception 'Not authorized to update rider jobs';
end
$$;

drop trigger if exists rider_jobs_guard_before_update on public.rider_jobs;
create trigger rider_jobs_guard_before_update
before update on public.rider_jobs
for each row execute function public.guard_rider_job_update();

create or replace function public.notify_delivery_events()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  recipient record;
  event_name text;
  event_time timestamptz;
  recipient_user uuid;
begin
  if tg_op = 'INSERT' then
    for recipient in select p.id from public.profiles p where p.role::text = 'production' and p.active loop
      insert into public.portal_notifications(recipient_id, notification_type, related_id, event_key)
      values(recipient.id, 'delivery_new', new.id, 'delivery_new:' || new.id || ':' || recipient.id)
      on conflict(event_key) do nothing;
    end loop;
    return new;
  end if;
  if old.production_status is distinct from new.production_status and new.production_status = 'Ready' then
    event_name := 'delivery_ready';
    event_time := new.ready_at;
    for recipient in select p.id from public.profiles p where p.role::text = 'dispatch' and p.active loop
      insert into public.portal_notifications(recipient_id, notification_type, related_id, event_key)
      values(recipient.id, event_name, new.id, event_name || ':' || new.id || ':' || event_time || ':' || recipient.id)
      on conflict(event_key) do nothing;
    end loop;
  end if;
  if old.dispatch_status is distinct from new.dispatch_status and new.dispatch_status = 'Delivered' then
    recipient_user := new.created_by;
    insert into public.portal_notifications(recipient_id, notification_type, related_id, event_key)
    values(recipient_user, 'delivery_delivered', new.id, 'delivery_delivered:' || new.id || ':' || new.delivered_at)
    on conflict(event_key) do nothing;
  end if;
  return new;
end
$$;

drop trigger if exists deliveries_notify_after_change on public.deliveries;
create trigger deliveries_notify_after_change
after insert or update on public.deliveries
for each row execute function public.notify_delivery_events();

create or replace function public.notify_rider_job_events()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and old.status is distinct from new.status then
    if new.status = 'Started' then
      insert into public.portal_notifications(recipient_id, notification_type, related_id, event_key)
      values(new.assigned_rider, 'rider_job_assigned', new.id,
        'rider_job_assigned:' || new.id || ':' || new.assigned_at || ':' || new.assigned_rider)
      on conflict(event_key) do nothing;
      insert into public.portal_notifications(recipient_id, notification_type, related_id, event_key)
      values(new.created_by, 'rider_job_assigned_sales', new.id,
        'rider_job_assigned_sales:' || new.id || ':' || new.assigned_at)
      on conflict(event_key) do nothing;
    elsif new.status = 'In progress' then
      insert into public.portal_notifications(recipient_id, notification_type, related_id, event_key)
      values(new.created_by, 'rider_job_started', new.id,
        'rider_job_started:' || new.id || ':' || new.started_at)
      on conflict(event_key) do nothing;
    elsif new.status = 'Finished' then
      insert into public.portal_notifications(recipient_id, notification_type, related_id, event_key)
      values(new.created_by, 'rider_job_finished', new.id,
        'rider_job_finished:' || new.id || ':' || new.finished_at)
      on conflict(event_key) do nothing;
    end if;
  end if;
  return new;
end
$$;

drop trigger if exists rider_jobs_notify_after_change on public.rider_jobs;
create trigger rider_jobs_notify_after_change
after update on public.rider_jobs
for each row execute function public.notify_rider_job_events();

alter table public.deliveries enable row level security;
alter table public.vehicles enable row level security;
alter table public.rider_jobs enable row level security;
alter table public.portal_notifications enable row level security;
alter table public.portal_ref_counters enable row level security;

drop policy if exists "delivery role read" on public.deliveries;
create policy "delivery role read" on public.deliveries
for select to authenticated using (
  public.current_role()::text = 'admin'
  or (public.current_role()::text = 'salesperson' and created_by = (select auth.uid()))
  or public.current_role()::text in ('production', 'dispatch')
);
drop policy if exists "sales create own delivery" on public.deliveries;
create policy "sales create own delivery" on public.deliveries
for insert to authenticated with check (
  created_by = (select auth.uid()) and public.current_role()::text = 'salesperson'
);
drop policy if exists "production mark ready" on public.deliveries;
create policy "production mark ready" on public.deliveries
for update to authenticated using (
  public.current_role()::text = 'production' and production_status = 'Not ready'
) with check (public.current_role()::text = 'production' and production_status = 'Ready');
drop policy if exists "dispatch update ready delivery" on public.deliveries;
create policy "dispatch update ready delivery" on public.deliveries
for update to authenticated using (
  public.current_role()::text = 'dispatch' and production_status = 'Ready'
) with check (public.current_role()::text = 'dispatch' and production_status = 'Ready');
drop policy if exists "admin manage deliveries" on public.deliveries;
create policy "admin manage deliveries" on public.deliveries
for all to authenticated using (public.current_role()::text = 'admin')
with check (public.current_role()::text = 'admin');

drop policy if exists "dispatch read vehicles" on public.vehicles;
create policy "dispatch read vehicles" on public.vehicles
for select to authenticated using (public.current_role()::text in ('dispatch', 'admin'));
drop policy if exists "dispatch manage vehicles" on public.vehicles;
create policy "dispatch manage vehicles" on public.vehicles
for all to authenticated using (public.current_role()::text in ('dispatch', 'admin'))
with check (public.current_role()::text in ('dispatch', 'admin'));

drop policy if exists "rider jobs visible by role" on public.rider_jobs;
create policy "rider jobs visible by role" on public.rider_jobs
for select to authenticated using (
  public.current_role()::text = 'admin'
  or (public.current_role()::text = 'salesperson' and created_by = (select auth.uid()))
  or public.current_role()::text = 'route_admin'
  or (public.current_role()::text = 'rider' and assigned_rider = (select auth.uid()))
);
drop policy if exists "sales create own rider job" on public.rider_jobs;
create policy "sales create own rider job" on public.rider_jobs
for insert to authenticated with check (
  created_by = (select auth.uid()) and public.current_role()::text = 'salesperson'
);
drop policy if exists "route admin assign rider job" on public.rider_jobs;
create policy "route admin assign rider job" on public.rider_jobs
for update to authenticated using (
  public.current_role()::text = 'route_admin' and status = 'Not started'
) with check (public.current_role()::text = 'route_admin' and status = 'Started');
drop policy if exists "rider update own assigned job" on public.rider_jobs;
create policy "rider update own assigned job" on public.rider_jobs
for update to authenticated using (
  public.current_role()::text = 'rider' and assigned_rider = (select auth.uid())
  and status in ('Started', 'In progress')
) with check (
  public.current_role()::text = 'rider' and assigned_rider = (select auth.uid())
  and status in ('In progress', 'Finished')
);
drop policy if exists "admin manage rider jobs" on public.rider_jobs;
create policy "admin manage rider jobs" on public.rider_jobs
for all to authenticated using (public.current_role()::text = 'admin')
with check (public.current_role()::text = 'admin');

drop policy if exists "users read own portal notifications" on public.portal_notifications;
create policy "users read own portal notifications" on public.portal_notifications
for select to authenticated using (recipient_id = (select auth.uid()));
drop policy if exists "users mark own portal notifications read" on public.portal_notifications;
create policy "users mark own portal notifications read" on public.portal_notifications
for update to authenticated using (recipient_id = (select auth.uid()) and read_at is null)
with check (recipient_id = (select auth.uid()) and read_at is not null);

grant select, insert, update, delete on public.deliveries, public.vehicles, public.rider_jobs to authenticated;
grant select, update on public.portal_notifications to authenticated;
revoke all on public.portal_ref_counters from anon, authenticated;
revoke update on public.portal_notifications from anon, authenticated;
grant update (read_at) on public.portal_notifications to authenticated;
grant usage, select on sequence public.deliveries_sr_seq, public.rider_jobs_sr_seq to authenticated;
revoke insert, delete on public.portal_notifications from anon, authenticated;
revoke all on function public.next_portal_ref(text) from public, anon, authenticated;
grant execute on function public.next_portal_ref(text) to service_role;

do $$
begin
  if exists (
    select 1 from pg_catalog.pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'portal_notifications'
  ) is false then
    alter publication supabase_realtime add table public.portal_notifications;
  end if;
  if exists (
    select 1 from pg_catalog.pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'deliveries'
  ) is false then
    alter publication supabase_realtime add table public.deliveries;
  end if;
  if exists (
    select 1 from pg_catalog.pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'rider_jobs'
  ) is false then
    alter publication supabase_realtime add table public.rider_jobs;
  end if;
end
$$;

-- Manual cleanup, run periodically from the SQL Editor:
-- delete from public.portal_notifications where read_at < now() - interval '30 days';
