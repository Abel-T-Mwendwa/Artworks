create or replace function public.has_nonempty_text_lines(value jsonb)
returns boolean
language sql
immutable
parallel safe
set search_path = ''
as $$
  select case
    when value is null or pg_catalog.jsonb_typeof(value) <> 'array' then false
    when pg_catalog.jsonb_array_length(value) = 0 then false
    else not exists (
        select 1
        from pg_catalog.jsonb_array_elements(value) as item(line)
        where pg_catalog.jsonb_typeof(item.line) <> 'string'
          or pg_catalog.length(pg_catalog.btrim(item.line #>> '{}')) = 0
      )
  end
$$;

alter table public.artwork_requests
  drop constraint if exists artwork_requests_product_check,
  drop constraint if exists artwork_requests_branding_mode_check;

alter table public.artwork_requests
  alter column product type jsonb using case
    when product is null then null
    else pg_catalog.jsonb_build_array(product)
  end,
  alter column branding_mode type jsonb using case
    when branding_mode is null then null
    else pg_catalog.jsonb_build_array(branding_mode)
  end,
  alter column logo_position type jsonb using case
    when logo_position is null then null
    else pg_catalog.jsonb_build_array(logo_position)
  end;

alter table public.artwork_requests
  add constraint artwork_requests_product_check
    check (public.has_nonempty_text_lines(product)),
  add constraint artwork_requests_branding_mode_check
    check (public.has_nonempty_text_lines(branding_mode)),
  add constraint artwork_requests_logo_position_check
    check (logo_position is null or public.has_nonempty_text_lines(logo_position));

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
      raise exception 'Mode of branding must contain at least one non-empty line';
    end if;
    if not public.has_nonempty_text_lines(new.logo_position) then
      raise exception 'Logo and branding position must contain at least one non-empty line';
    end if;
  else
    if new.product is distinct from old.product and not public.has_nonempty_text_lines(new.product) then
      raise exception 'Product must contain at least one non-empty line';
    end if;
    if new.branding_mode is distinct from old.branding_mode and not public.has_nonempty_text_lines(new.branding_mode) then
      raise exception 'Mode of branding must contain at least one non-empty line';
    end if;
    if new.logo_position is distinct from old.logo_position and not public.has_nonempty_text_lines(new.logo_position) then
      raise exception 'Logo and branding position must contain at least one non-empty line';
    end if;
  end if;
  return new;
end
$$;

create trigger artwork_detail_lines_before_insert
before insert on public.artwork_requests
for each row execute function public.validate_artwork_detail_lines();

create trigger artwork_detail_lines_before_update
before update on public.artwork_requests
for each row execute function public.validate_artwork_detail_lines();
