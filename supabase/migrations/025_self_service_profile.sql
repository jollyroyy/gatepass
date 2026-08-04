-- ============================================================================
-- 025 — Self-service profile: display name + photo
--
-- The `avatars` storage bucket and `public.profiles.avatar_url` already exist
-- on the shared project (VMS migrations 033/053), so no storage or column DDL
-- is needed here — and none may be added, per the two-schema rule.
--
-- GatePass never touches public.profiles from the client (migration 006, and
-- the 42P17 recursion that motivated it), so the two edits a user is allowed
-- to make to their OWN row go through SECURITY DEFINER RPCs in this schema,
-- scoped to auth.uid() inside the function body. That widens nothing: a
-- caller can only ever write their own row. The photo object itself is
-- uploaded to the shared `avatars` bucket by the client (path <uid>/avatar),
-- so a photo set here also shows in VMS, and vice versa.
--
-- my_profile() gains avatar_url so the sidebar and the profile page can render
-- the photo. Nothing else in the return shape changes.
-- ============================================================================

-- ─── The caller's own profile, now including the photo ─────────────────────
-- The return shape grows by one column (avatar_url), which `create or replace`
-- cannot do — the function must be dropped and recreated. Grants die with the
-- drop, so my_profile()'s execute grant is restored below.
drop function if exists gatepass.my_profile();
create function gatepass.my_profile()
returns table (
  id            uuid,
  email         text,
  full_name     text,
  role          text,
  department_id uuid,
  avatar_url    text,
  created_at    timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.email, p.full_name, p.role::text, p.department_id, p.avatar_url, p.created_at
    from public.profiles p
   where p.id = auth.uid();
$$;

-- ─── Edit display name (self-service) ──────────────────────────────────────
create or replace function gatepass.update_my_name(p_full_name text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text := trim(p_full_name);
begin
  if v_name = '' then
    raise exception 'Your name cannot be empty.';
  end if;
  if length(v_name) > 80 then
    raise exception 'Please keep your name under 80 characters.';
  end if;

  update public.profiles
     set full_name = v_name
   where id = auth.uid();
end;
$$;

-- ─── Set or clear the avatar URL (self-service) ────────────────────────────
-- The client uploads the photo to the avatars bucket first and persists the
-- public URL here; passing null (or '') clears it. Deleting the storage
-- object is the client's job, so a failed storage delete can never orphan a
-- broken <img> on this page.
create or replace function gatepass.set_my_avatar(p_avatar_url text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.profiles
     set avatar_url = nullif(p_avatar_url, '')
   where id = auth.uid();
end;
$$;

grant execute on function gatepass.my_profile() to authenticated;
grant execute on function gatepass.update_my_name(text) to authenticated;
grant execute on function gatepass.set_my_avatar(text) to authenticated;
