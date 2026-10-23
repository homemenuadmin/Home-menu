-- Roles, owner and first-time setup.
-- Two roles: 'member' (family member) and 'helper' (cook). The old 'admin' role is gone.
-- The first person in a household is its owner (is_owner = true). The owner manages people and invite codes.
-- Run once in the Supabase SQL editor.

-- 1. Owner flag, and move old admins to the new model.
alter table household_members add column if not exists is_owner boolean not null default false;
update household_members set is_owner = true where role = 'admin';
update household_members set role = 'member' where role = 'admin';
alter table household_members drop constraint if exists household_members_role_check;
alter table household_members add constraint household_members_role_check check (role in ('member', 'helper'));

-- 2. Invite codes: only member or helper (cook). Revoke any old admin codes.
update invite_codes set revoked = true where role = 'admin';
alter table invite_codes drop constraint if exists invite_codes_role_check;
alter table invite_codes add constraint invite_codes_role_check check (role in ('member', 'helper'));

-- 3. Helper functions used by the policies below.
create or replace function public.is_household_owner(hh uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (select 1 from household_members
                 where household_id = hh and user_id = auth.uid() and is_owner);
$$;

create or replace function public.is_family_member_or_owner(hh uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select my_role(hh) = 'member' or is_household_owner(hh);
$$;

-- 4. Policies: replace every 'admin' check.
drop policy if exists "admin changes roles" on household_members;
create policy "owner changes roles" on household_members for update
  using (is_household_owner(household_id)) with check (is_household_owner(household_id));

drop policy if exists "admin removes members" on household_members;
create policy "owner removes members" on household_members for delete
  using (is_household_owner(household_id));

drop policy if exists "admin updates household" on households;
create policy "owner updates household" on households for update
  using (is_household_owner(id)) with check (is_household_owner(id));

drop policy if exists "admins read invite codes" on invite_codes;
create policy "owner reads invite codes" on invite_codes for select
  using (is_household_owner(household_id));

drop policy if exists "admins revoke invite codes" on invite_codes;
create policy "owner revokes invite codes" on invite_codes for update
  using (is_household_owner(household_id)) with check (revoked = true);

drop policy if exists "admin removes meals" on meals;
create policy "owner removes meals" on meals for delete
  using (is_household_owner(household_id));

drop policy if exists "admin and helper add stock" on pantry_items;
drop policy if exists "admin and helper change stock" on pantry_items;
drop policy if exists "admin and helper remove stock" on pantry_items;
create policy "cook adds stock" on pantry_items for insert
  with check (my_role(household_id) = 'helper');
create policy "cook changes stock" on pantry_items for update
  using (my_role(household_id) = 'helper') with check (my_role(household_id) = 'helper');
create policy "cook removes stock" on pantry_items for delete
  using (my_role(household_id) = 'helper');

drop policy if exists "edit own recipe ingredients" on recipe_ingredients;
create policy "edit own recipe ingredients" on recipe_ingredients for all
  using (exists (select 1 from recipes r where r.id = recipe_ingredients.recipe_id
                 and r.household_id is not null
                 and (r.created_by = auth.uid() or is_household_owner(r.household_id))))
  with check (exists (select 1 from recipes r where r.id = recipe_ingredients.recipe_id
                 and r.household_id is not null
                 and (r.created_by = auth.uid() or is_household_owner(r.household_id))));

drop policy if exists "admin and member add recipes" on recipes;
drop policy if exists "creator or admin change recipes" on recipes;
drop policy if exists "creator or admin remove recipes" on recipes;
create policy "family adds recipes" on recipes for insert
  with check (household_id is not null and is_family_member_or_owner(household_id));
create policy "creator or owner changes recipes" on recipes for update
  using (household_id is not null and (created_by = auth.uid() or is_household_owner(household_id)))
  with check (household_id is not null and (created_by = auth.uid() or is_household_owner(household_id)));
create policy "creator or owner removes recipes" on recipes for delete
  using (household_id is not null and (created_by = auth.uid() or is_household_owner(household_id)));

drop policy if exists "admin and member add rules" on rules;
drop policy if exists "admin and member change rules" on rules;
drop policy if exists "admin and member remove rules" on rules;
create policy "family adds rules" on rules for insert
  with check (is_family_member_or_owner(household_id));
create policy "family changes rules" on rules for update
  using (is_family_member_or_owner(household_id)) with check (is_family_member_or_owner(household_id));
create policy "family removes rules" on rules for delete
  using (is_family_member_or_owner(household_id));

-- 5. Functions.
create or replace function public.create_household(p_name text)
returns uuid language plpgsql security definer set search_path = public as $$
declare hh uuid;
begin
  insert into public.households (name) values (p_name) returning id into hh;
  -- The person who creates the household is its owner. Their role is set during setup.
  insert into public.household_members (household_id, user_id, role, is_owner)
  values (hh, auth.uid(), 'member', true);
  return hh;
end;
$$;

-- A code only adds a person to the household. Their role comes from the cook answer in setup.
alter table invite_codes alter column role set default 'member';
drop function if exists public.create_invite_code(uuid, text);
create or replace function public.create_invite_code(p_household uuid)
returns text language plpgsql security definer set search_path = public as $$
declare v_code text;
begin
  if not is_household_owner(p_household) then
    raise exception 'Only the household owner can create invite codes';
  end if;
  v_code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
  insert into invite_codes (code, household_id, role, created_by)
  values (v_code, p_household, 'member', auth.uid());
  return v_code;
end;
$$;

-- 6. First-time setup answers. Each person saves their own row.
create table if not exists member_settings (
  user_id uuid primary key references profiles(id) on delete cascade,
  household_id uuid not null references households(id) on delete cascade,
  setup_done boolean not null default false,
  cook_answer text check (cook_answer in ('cook', 'not_cook', 'hybrid')),
  meals_per_day text[] not null default '{}',   -- breakfast, lunch, dinner, snack
  first_meal_time text,                         -- HH:MM (earliest meal)
  meal_times jsonb not null default '{}'::jsonb, -- time for each chosen meal, for example {"breakfast": "07:30"}
  prep_home text[] not null default '{}',       -- days of the week
  prep_school text[] not null default '{}',     -- days of the week
  diet_choices text[] not null default '{}',    -- picky, low_calorie, eat_everything
  diet_notes text not null default '',          -- specifics, for example: low carb, no sugar
  likes text not null default '',
  dislikes text not null default '',
  spice text check (spice in ('none', 'mild', 'medium', 'hot')),
  salt text check (salt in ('less', 'normal', 'more')),
  updated_at timestamptz not null default now()
);

alter table member_settings enable row level security;
drop policy if exists "own settings" on member_settings;
create policy "own settings" on member_settings for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "household reads settings" on member_settings;
create policy "household reads settings" on member_settings for select
  using (is_member(household_id));

-- Each person sets their own role from the cook answer. Only the owner's policy can change other people's roles,
-- so this function lets a family member change just their own row.
create or replace function public.set_my_role(p_household uuid, p_role text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_role not in ('member', 'helper') then
    raise exception 'Unknown role';
  end if;
  update household_members set role = p_role
  where household_id = p_household and user_id = auth.uid();
  if not found then
    raise exception 'You are not in this household';
  end if;
end;
$$;

notify pgrst, 'reload schema';
