-- Invite codes. An admin creates a code and chooses the role it gives.
-- Run this once in the Supabase SQL Editor, before the app update that uses it.
-- Each code works once and expires after 7 days. Admins can see and revoke their household's codes.

create table if not exists invite_codes (
  code text primary key,
  household_id uuid not null references households(id) on delete cascade,
  role text not null check (role in ('admin', 'member', 'helper')),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '7 days'),
  used_by uuid references auth.users(id),
  used_at timestamptz,
  revoked boolean not null default false
);

alter table invite_codes enable row level security;

-- Admins of a household can read and revoke its codes. Nobody can insert or change them directly:
-- creation and redemption go through the functions below.
create policy "admins read invite codes" on invite_codes
  for select using (
    exists (select 1 from household_members m
            where m.household_id = invite_codes.household_id
              and m.user_id = auth.uid() and m.role = 'admin')
  );

create policy "admins revoke invite codes" on invite_codes
  for update using (
    exists (select 1 from household_members m
            where m.household_id = invite_codes.household_id
              and m.user_id = auth.uid() and m.role = 'admin')
  ) with check (revoked = true);

create or replace function create_invite_code(p_household uuid, p_role text)
returns text
language plpgsql security definer set search_path = public
as $$
declare v_code text;
begin
  if not exists (select 1 from household_members
                 where household_id = p_household and user_id = auth.uid() and role = 'admin') then
    raise exception 'Only an admin can create invite codes';
  end if;
  if p_role not in ('admin', 'member', 'helper') then
    raise exception 'Unknown role';
  end if;
  -- 8 random hex characters (0-9, A-F) taken from a random UUID.
  v_code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
  insert into invite_codes (code, household_id, role, created_by)
  values (v_code, p_household, p_role, auth.uid());
  return v_code;
end;
$$;

create or replace function redeem_invite_code(p_code text)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare v_inv invite_codes;
begin
  select * into v_inv from invite_codes where code = upper(trim(p_code)) for update;
  if not found or v_inv.revoked or v_inv.used_at is not null or v_inv.expires_at < now() then
    raise exception 'This invite code is not valid or has expired';
  end if;
  if exists (select 1 from household_members where user_id = auth.uid()) then
    raise exception 'You already belong to a household';
  end if;
  insert into household_members (household_id, user_id, role)
  values (v_inv.household_id, auth.uid(), v_inv.role);
  update invite_codes set used_by = auth.uid(), used_at = now() where code = v_inv.code;
  return v_inv.household_id;
end;
$$;

-- Let the app call these functions.
grant execute on function create_invite_code(uuid, text) to authenticated;
grant execute on function redeem_invite_code(text) to authenticated;

-- Refresh the API so the new table and functions show up.
notify pgrst, 'reload schema';
