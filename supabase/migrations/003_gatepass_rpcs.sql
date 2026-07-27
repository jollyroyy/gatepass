-- ============================================================================
-- 003 — State machine RPCs
--
-- These three functions are the ONLY way a gate pass changes state. No client
-- holds UPDATE on gatepass.gate_passes (see 002), so the rules below cannot be
-- bypassed by a crafted REST call, a different frontend, or a future second app.
--
-- Lifecycle:
--                          ┌─ flag_pass  ──→ flagged (terminal; HOD follows up)
--   pending ───────────────┤
--                          └─ match_pass ──→ matched
--                                              │  (RGP only)
--                                              ├──→ awaiting_return
--                                              │        │ mark_returned
--                                              │        └──→ returned
--                                              └─ (IGP/OGP/NRGP: done)
--
-- Exception messages here are deliberately written to be shown to the user
-- verbatim — src/lib/errors.ts passes Postgres P0001 messages straight through.
-- ============================================================================

-- ─── Match: everything checks out, let it through ───────────────────────────
create or replace function gatepass.match_pass(
  p_pass_id          uuid,
  p_verified_quantity numeric default null,
  p_verified_vehicle  text    default null,
  p_remarks           text    default null
)
returns gatepass.gate_passes
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pass gatepass.gate_passes;
begin
  if not gatepass.is_security() then
    raise exception 'Only security can verify a gate pass.';
  end if;

  -- Lock the row so two guards cannot both verify the same pass.
  select * into v_pass
    from gatepass.gate_passes
   where id = p_pass_id
     for update;

  if not found then
    raise exception 'Gate pass not found.';
  end if;

  if v_pass.status <> 'pending' then
    raise exception 'This pass is already %. Only a pending pass can be verified.',
      v_pass.status;
  end if;

  update gatepass.gate_passes
     set status        = 'matched',
         verified_by   = auth.uid(),
         verified_at   = now(),
         -- An RGP now owes a return. Everything else is finished at the gate.
         return_status = case when type = 'RGP' then 'awaiting_return'::gatepass.return_status
                             else 'not_applicable'::gatepass.return_status end
   where id = p_pass_id
   returning * into v_pass;

  -- Record what the guard actually saw, which may differ from what was declared.
  insert into gatepass.verifications
    (gate_pass_id, action, security_user_id, verified_quantity, verified_vehicle, remarks)
  values
    (p_pass_id, 'matched', auth.uid(), p_verified_quantity, p_verified_vehicle, p_remarks);

  return v_pass;
end;
$$;

-- ─── Flag: mismatch found, bounce it back to the HOD ────────────────────────
create or replace function gatepass.flag_pass(
  p_pass_id uuid,
  p_reason  text
)
returns gatepass.gate_passes
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pass gatepass.gate_passes;
begin
  if not gatepass.is_security() then
    raise exception 'Only security can flag a gate pass.';
  end if;

  if p_reason is null or length(trim(p_reason)) = 0 then
    raise exception 'A reason is required when flagging a pass.';
  end if;

  select * into v_pass
    from gatepass.gate_passes
   where id = p_pass_id
     for update;

  if not found then
    raise exception 'Gate pass not found.';
  end if;

  if v_pass.status <> 'pending' then
    raise exception 'This pass is already %. Only a pending pass can be flagged.',
      v_pass.status;
  end if;

  update gatepass.gate_passes
     set status      = 'flagged',
         flag_reason = trim(p_reason),
         verified_by = auth.uid(),
         verified_at = now()
   where id = p_pass_id
   returning * into v_pass;

  insert into gatepass.verifications
    (gate_pass_id, action, security_user_id, remarks)
  values
    (p_pass_id, 'flagged', auth.uid(), trim(p_reason));

  return v_pass;
end;
$$;

-- ─── Mark returned: an RGP's material came back ─────────────────────────────
create or replace function gatepass.mark_returned(
  p_pass_id uuid,
  p_remarks text default null
)
returns gatepass.gate_passes
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pass gatepass.gate_passes;
begin
  if not gatepass.is_security() then
    raise exception 'Only security can record a return.';
  end if;

  select * into v_pass
    from gatepass.gate_passes
   where id = p_pass_id
     for update;

  if not found then
    raise exception 'Gate pass not found.';
  end if;

  if v_pass.return_status <> 'awaiting_return' then
    raise exception 'This pass is not awaiting a return.';
  end if;

  update gatepass.gate_passes
     set return_status      = 'returned',
         actual_return_date = now()
   where id = p_pass_id
   returning * into v_pass;

  insert into gatepass.verifications
    (gate_pass_id, action, security_user_id, remarks)
  values
    (p_pass_id, 'returned', auth.uid(), p_remarks);

  return v_pass;
end;
$$;

-- Callable by any signed-in user; each function enforces its own role check, so
-- an HOD calling match_pass gets a clean refusal rather than a permission error.
grant execute on function gatepass.match_pass(uuid, numeric, text, text) to authenticated;
grant execute on function gatepass.flag_pass(uuid, text)                 to authenticated;
grant execute on function gatepass.mark_returned(uuid, text)             to authenticated;
