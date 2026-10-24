alter table public.profiles
  add column if not exists password_change_required boolean not null default false;

alter table public.rider_jobs
  add column if not exists decline_reason text,
  add column if not exists declined_at timestamptz;

drop policy if exists "Authenticated users can read profiles" on public.profiles;
create policy "Authenticated users can read profiles" on public.profiles
for select to authenticated using (
  active or public.is_admin() or id = (select auth.uid())
  or (public.has_route_admin_access() and role::text = 'rider')
);

alter table public.rider_jobs drop constraint if exists rider_jobs_status_timestamp_check;
alter table public.rider_jobs drop constraint if exists rider_jobs_status_check;
alter table public.rider_jobs add constraint rider_jobs_status_check
  check (status in ('Not started', 'Started', 'In progress', 'Finished', 'Declined'));
alter table public.rider_jobs add constraint rider_jobs_status_timestamp_check check (
  (status = 'Not started' and assigned_rider is null and assigned_at is null
    and started_at is null and finished_at is null and decline_reason is null and declined_at is null)
  or (status = 'Started' and assigned_rider is not null and assigned_at is not null
    and started_at is null and finished_at is null and decline_reason is null and declined_at is null)
  or (status = 'In progress' and assigned_rider is not null and assigned_at is not null
    and started_at is not null and finished_at is null and decline_reason is null and declined_at is null)
  or (status = 'Finished' and assigned_rider is not null and assigned_at is not null
    and started_at is not null and finished_at is not null and decline_reason is null and declined_at is null)
  or (status = 'Declined' and assigned_rider is null and assigned_at is null
    and started_at is null and finished_at is null
    and declined_at is not null
    and decline_reason is not null
    and pg_catalog.length(pg_catalog.btrim(decline_reason)) between 1 and 500)
);

drop index if exists public.rider_jobs_unique_active_rider_slot_idx;

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
  if public.has_route_admin_access() and actor_role <> 'rider' then
    if (new.id, new.sr, new.ref_no, new.created_at, new.created_by, new.client_name,
        new.contact_name, new.contact_number, new.address, new.job_type, new.details,
        new.expected_time, new.scheduled_date, new.started_at, new.finished_at)
       is distinct from
       (old.id, old.sr, old.ref_no, old.created_at, old.created_by, old.client_name,
        old.contact_name, old.contact_number, old.address, old.job_type, old.details,
        old.expected_time, old.scheduled_date, old.started_at, old.finished_at)
      or old.status <> 'Not started' or new.status not in ('Started', 'Declined') then
      raise exception 'Route admin may only assign or decline a pending rider request';
    end if;
    if new.status = 'Declined' then
      if new.assigned_rider is not null or new.rider_time is not null or new.rider_time_end is not null
        or new.assigned_at is not null
        or new.declined_at is not null
        or new.decline_reason is null
        or pg_catalog.length(pg_catalog.btrim(new.decline_reason)) not between 1 and 500 then
        raise exception 'A decline reason between 1 and 500 characters is required';
      end if;
      new.declined_at := now();
      return new;
    end if;
    if new.assigned_rider is null or new.rider_time is null or new.rider_time_end is null
      or new.decline_reason is not null or new.declined_at is not null
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
          new.rider_time_end, new.assigned_at, new.decline_reason, new.declined_at)
         is distinct from
         (old.id, old.sr, old.ref_no, old.created_at, old.created_by, old.client_name,
          old.contact_name, old.contact_number, old.address, old.job_type, old.details,
          old.expected_time, old.scheduled_date, old.assigned_rider, old.rider_time,
          old.rider_time_end, old.assigned_at, old.decline_reason, old.declined_at) then
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

drop policy if exists "route admin assign rider job" on public.rider_jobs;
create policy "route admin assign rider job" on public.rider_jobs
for update to authenticated using (
  public.has_route_admin_access() and status = 'Not started'
) with check (
  public.has_route_admin_access() and status in ('Started', 'Declined')
);

drop policy if exists "rider jobs visible by role" on public.rider_jobs;
create policy "rider jobs visible by role" on public.rider_jobs
for select to authenticated using (
  public.current_role()::text = 'admin'
  or (public.current_role()::text = 'salesperson' and created_by = (select auth.uid()))
  or public.has_route_admin_access()
  or (public.current_role()::text = 'rider' and assigned_rider = (select auth.uid()))
);

drop policy if exists "dispatch read vehicles" on public.vehicles;
create policy "dispatch read vehicles" on public.vehicles
for select to authenticated using (
  public.current_role()::text in ('admin', 'dispatch', 'production')
);

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
  if old.dispatched_at is distinct from new.dispatched_at and new.dispatched_at is not null then
    insert into public.portal_notifications(recipient_id, notification_type, related_id, event_key)
    values(new.created_by, 'delivery_dispatched', new.id, 'delivery_dispatched:' || new.id || ':' || new.dispatched_at)
    on conflict(event_key) do nothing;
  end if;
  if old.dispatch_status is distinct from new.dispatch_status and new.dispatch_status = 'Delivered' then
    insert into public.portal_notifications(recipient_id, notification_type, related_id, event_key)
    values(new.created_by, 'delivery_delivered', new.id, 'delivery_delivered:' || new.id || ':' || new.delivered_at)
    on conflict(event_key) do nothing;
  end if;
  return new;
end
$$;

create or replace function public.notify_rider_job_events()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  recipient record;
begin
  if tg_op = 'INSERT' then
    for recipient in
      select p.id from public.profiles p
      where p.active and (p.role::text in ('admin', 'route_admin') or p.route_admin_access)
    loop
      insert into public.portal_notifications(recipient_id, notification_type, related_id, event_key)
      values(recipient.id, 'rider_request_new', new.id, 'rider_request_new:' || new.id || ':' || recipient.id)
      on conflict(event_key) do nothing;
    end loop;
    return new;
  end if;
  if old.status is distinct from new.status then
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
      values(new.created_by, 'rider_job_started', new.id, 'rider_job_started:' || new.id || ':' || new.started_at)
      on conflict(event_key) do nothing;
    elsif new.status = 'Finished' then
      insert into public.portal_notifications(recipient_id, notification_type, related_id, event_key)
      values(new.created_by, 'rider_job_finished', new.id, 'rider_job_finished:' || new.id || ':' || new.finished_at)
      on conflict(event_key) do nothing;
    elsif new.status = 'Declined' then
      insert into public.portal_notifications(recipient_id, notification_type, related_id, event_key)
      values(new.created_by, 'rider_request_declined', new.id, 'rider_request_declined:' || new.id)
      on conflict(event_key) do nothing;
    end if;
  end if;
  return new;
end
$$;

drop trigger if exists rider_jobs_notify_after_change on public.rider_jobs;
create trigger rider_jobs_notify_after_change
after insert or update on public.rider_jobs
for each row execute function public.notify_rider_job_events();

do $$
begin
  if not exists (
    select 1 from pg_catalog.pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'rider_jobs'
  ) then
    alter publication supabase_realtime add table public.rider_jobs;
  end if;
  if not exists (
    select 1 from pg_catalog.pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'deliveries'
  ) then
    alter publication supabase_realtime add table public.deliveries;
  end if;
  if not exists (
    select 1 from pg_catalog.pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'portal_notifications'
  ) then
    alter publication supabase_realtime add table public.portal_notifications;
  end if;
  if not exists (
    select 1 from pg_catalog.pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'vehicles'
  ) then
    alter publication supabase_realtime add table public.vehicles;
  end if;
end
$$;
