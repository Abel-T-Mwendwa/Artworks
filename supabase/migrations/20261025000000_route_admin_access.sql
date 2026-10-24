alter table public.profiles
  add column if not exists route_admin_access boolean not null default false;

update public.profiles
set route_admin_access = true
where role::text = 'route_admin' and route_admin_access = false;

create or replace function public.has_route_admin_access()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = (select auth.uid())
      and p.active
      and (p.role::text in ('admin', 'route_admin') or p.route_admin_access)
  )
$$;

revoke all on function public.has_route_admin_access() from public, anon;
grant execute on function public.has_route_admin_access() to authenticated;

drop policy if exists "Authenticated users can read profiles" on public.profiles;
create policy "Authenticated users can read profiles" on public.profiles
for select to authenticated using (
  active or public.is_admin() or id = (select auth.uid())
  or (public.has_route_admin_access() and role::text = 'rider')
);

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
      or old.status <> 'Not started' or new.status <> 'Started'
      or new.assigned_rider is null or new.rider_time is null or new.rider_time_end is null
      or not exists (
        select 1 from public.profiles p
        where p.id = new.assigned_rider and p.role::text = 'rider' and p.active
      ) then
      raise exception 'Route admin may assign only an unassigned rider request to an active rider and time slot';
    end if;
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(new.assigned_rider::text, 0));
    if exists (
      select 1 from public.rider_jobs r
      where r.assigned_rider = new.assigned_rider
        and r.scheduled_date = new.scheduled_date
        and r.status in ('Started', 'In progress')
        and r.id <> new.id
        and new.rider_time < r.rider_time_end
        and r.rider_time < new.rider_time_end
    ) then
      raise exception 'This rider already has a job in the selected time slot';
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

create unique index if not exists rider_jobs_unique_active_rider_slot_idx
  on public.rider_jobs (assigned_rider, scheduled_date, rider_time)
  where assigned_rider is not null and status in ('Started', 'In progress');

drop policy if exists "rider jobs visible by role" on public.rider_jobs;
create policy "rider jobs visible by role" on public.rider_jobs
for select to authenticated using (
  public.current_role()::text = 'admin'
  or (public.current_role()::text = 'salesperson' and created_by = (select auth.uid()))
  or public.has_route_admin_access()
  or (public.current_role()::text = 'rider' and assigned_rider = (select auth.uid()))
);

drop policy if exists "route admin assign rider job" on public.rider_jobs;
create policy "route admin assign rider job" on public.rider_jobs
for update to authenticated using (
  public.has_route_admin_access() and status = 'Not started'
) with check (
  public.has_route_admin_access() and status = 'Started'
);
