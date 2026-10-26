-- Cooks have the same settings as family members, so they can add, change and remove household rules too.
-- Run this once in the Supabase SQL editor, after roles-and-setup.sql.

drop policy if exists "family adds rules" on rules;
drop policy if exists "family changes rules" on rules;
drop policy if exists "family removes rules" on rules;

create policy "household adds rules" on rules for insert
  with check (is_member(household_id));
create policy "household changes rules" on rules for update
  using (is_member(household_id)) with check (is_member(household_id));
create policy "household removes rules" on rules for delete
  using (is_member(household_id));
