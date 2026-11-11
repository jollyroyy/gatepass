-- 079 — Pass-scoped material photographs and a print decision based on actual signatures.
-- Images are stored under <pass UUID>/<image UUID>.<extension> in the existing
-- private pass-images bucket. No public URL or user-supplied URL is trusted.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'pass-images', 'pass-images', false, 5242880,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create or replace function gatepass.pass_image_pass_id(p_path text)
returns uuid
language sql
immutable
security invoker
set search_path = ''
as $$
  select substring(
    p_path from
    '^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|jpeg|png|webp)$'
  )::uuid;
$$;

-- Only the raiser or an HOD of the pass's department may add evidence, and
-- only before any approval office has decided. Existing images stay immutable.
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
       and (select count(*) from storage.objects o
             where o.bucket_id = 'pass-images'
               and o.name like p_pass_id::text || '/%') < 10
  );
$$;

revoke all on function gatepass.pass_image_pass_id(text) from public;
revoke all on function gatepass.can_attach_pass_image(uuid) from public;
grant execute on function gatepass.pass_image_pass_id(text) to authenticated;
grant execute on function gatepass.can_attach_pass_image(uuid) to authenticated;

drop policy if exists "authenticated can upload pass-images" on storage.objects;
drop policy if exists "authenticated can view pass-images" on storage.objects;
drop policy if exists "anyone can view pass-images" on storage.objects;

create policy "pass readers can view material images"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'pass-images'
    and gatepass.can_see_pass(gatepass.pass_image_pass_id(name))
  );

create policy "pass raisers can attach material images"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'pass-images'
    and owner_id = (select auth.uid())::text
    and gatepass.can_attach_pass_image(gatepass.pass_image_pass_id(name))
  );

-- SECURITY INVOKER makes the pass's own RLS the visibility check. The
-- emergency/grandfathered flags matter: those rows say approved, but no
-- required office actually signed them. A shared COO/CEO rung may legitimately
-- close its unused half as not_required.
create or replace function gatepass.can_print_pass(p_pass_id uuid)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select exists (
    select 1 from gatepass.gate_passes g
     where g.id = p_pass_id
       and g.status in ('pending', 'matched')
       and exists (
         select 1 from gatepass.pass_approvals a
          where a.gate_pass_id = g.id
       )
       and not exists (
         select 1 from gatepass.pass_approvals a
          where a.gate_pass_id = g.id
            and (a.status not in ('approved', 'not_required')
                 or a.emergency or a.grandfathered)
       )
       and not exists (
         select 1 from gatepass.emergency_releases e
          where e.gate_pass_id = g.id
       )
  );
$$;

revoke all on function gatepass.can_print_pass(uuid) from public;
grant execute on function gatepass.can_print_pass(uuid) to authenticated;

notify pgrst, 'reload schema';
