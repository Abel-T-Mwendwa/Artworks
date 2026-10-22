alter table public.artwork_requests
  add column completed_at timestamptz;

do $$
begin
  perform set_config('app.system_change', 'on', true);
  execute 'alter table public.artwork_requests disable trigger artwork_touch_before_update';
  update public.artwork_requests
  set completed_at = done_at
  where status = 'Done'::public.artwork_status
    and done_at is not null;
  execute 'alter table public.artwork_requests enable trigger artwork_touch_before_update';
  perform set_config('app.system_change', 'off', true);
exception when others then
  execute 'alter table public.artwork_requests enable trigger artwork_touch_before_update';
  perform set_config('app.system_change', 'off', true);
  raise;
end
$$;

create or replace function public.guard_artwork_completed_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_setting('app.system_change', true) = 'on' then
    return new;
  end if;
  if new.completed_at is distinct from old.completed_at then
    raise exception 'Completion timestamp is system managed';
  end if;
  return new;
end
$$;

create trigger artwork_a_completed_at_guard_before_update
before update on public.artwork_requests
for each row execute function public.guard_artwork_completed_at();

create or replace function public.set_artwork_completion()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status = 'Done'::public.artwork_status
    and old.status is distinct from 'Done'::public.artwork_status then
    new.done_at := now();
    new.completed_at := new.done_at;
    new.done_by := coalesce(new.assigned_designer, auth.uid());
  elsif new.status <> 'Done'::public.artwork_status then
    new.done_at := null;
    new.completed_at := null;
    new.done_by := null;
  end if;
  return new;
end
$$;

drop policy if exists "Designers read assigned and Any artwork" on public.artwork_requests;
create policy "Designers read all artwork" on public.artwork_requests
  for select to authenticated
  using (public.current_role() = 'designer'::public.app_role);
