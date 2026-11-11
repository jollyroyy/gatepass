-- 080 — Every material photograph belongs to one gate-pass item.
-- New objects use <pass UUID>/<item UUID>/<image UUID>.<extension>.
-- The older pass-level paths remain readable, but can no longer be uploaded.

create or replace function gatepass.pass_image_pass_id(p_path text)
returns uuid
language sql
immutable
security invoker
set search_path = ''
as $$
  with parts as (select string_to_array(p_path, '/') as segments)
  select case when
    cardinality(segments) in (2, 3)
    and segments[1] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    and (
      (cardinality(segments) = 2 and segments[2] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}[.](jpg|jpeg|png|webp)$')
      or
      (cardinality(segments) = 3
       and segments[2] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       and segments[3] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}[.](jpg|jpeg|png|webp)$')
    )
    then segments[1]::uuid end
  from parts;
$$;

create or replace function gatepass.pass_image_item_id(p_path text)
returns uuid
language sql
immutable
security invoker
set search_path = ''
as $$
  select case when cardinality(string_to_array(p_path, '/')) = 3
    and gatepass.pass_image_pass_id(p_path) is not null
    then split_part(p_path, '/', 2)::uuid end;
$$;
-- 079's permission helper also counted all photos on a pass. The limit is
-- per item now, so a pass with more than ten lines can photograph every line.
create or replace function gatepass.can_attach_pass_image(p_pass_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from gatepass.gate_passes g
     where g.id = p_pass_id
       and g.status = 'pending'
       and gatepass.is_user_active(auth.uid())
       and (
         g.raised_by = auth.uid()
         or (gatepass.app_role() = 'hod'
             and g.department_id in (select gatepass.my_department_ids()))
       )
       and not exists (
         select 1 from gatepass.pass_approvals a
          where a.gate_pass_id = g.id and a.status <> 'pending'
       )
  );
$$;

create or replace function gatepass.can_attach_item_image(p_pass_id uuid, p_item_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select gatepass.can_attach_pass_image(p_pass_id)
    and exists (
      select 1 from gatepass.gate_pass_items i
       where i.id = p_item_id and i.gate_pass_id = p_pass_id
    )
    and (select count(*) from storage.objects o
          where o.bucket_id = 'pass-images'
            and o.name like p_pass_id::text || '/' || p_item_id::text || '/%') < 10;
$$;

revoke all on function gatepass.pass_image_item_id(text) from public;
revoke all on function gatepass.can_attach_item_image(uuid, uuid) from public;
grant execute on function gatepass.pass_image_item_id(text) to authenticated;
grant execute on function gatepass.can_attach_item_image(uuid, uuid) to authenticated;

drop policy if exists "pass raisers can attach material images" on storage.objects;
create policy "pass raisers can attach item images"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'pass-images'
    and owner_id = (select auth.uid())::text
    and gatepass.can_attach_item_image(
      gatepass.pass_image_pass_id(name),
      gatepass.pass_image_item_id(name)
    )
  );

notify pgrst, 'reload schema';
