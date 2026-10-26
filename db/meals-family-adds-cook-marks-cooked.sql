-- Family members plan meals. Cooks only mark them as cooked.
-- Already applied to the Supabase project. Run after roles-and-setup.sql.
drop policy if exists "helper adds meals" on meals;
drop policy if exists "members add meals" on meals;
drop policy if exists "helper changes meals" on meals;
drop policy if exists "members change meals" on meals;

create policy "family adds meals" on meals for insert
  with check (my_role(household_id) = 'member');
create policy "family changes meals" on meals for update
  using (my_role(household_id) = 'member') with check (my_role(household_id) = 'member');
create policy "cook changes meals" on meals for update
  using (my_role(household_id) = 'helper') with check (my_role(household_id) = 'helper');

-- A cook's update may only set the status to cooked; the meal's details stay as the family planned them.
create or replace function public.cook_only_marks_cooked()
returns trigger language plpgsql as $$
begin
  if my_role(new.household_id) = 'helper' then
    if new.status is distinct from 'cooked'
       or new.recipe_id is distinct from old.recipe_id
       or new.meal_date is distinct from old.meal_date
       or new.meal_slot is distinct from old.meal_slot
       or new.servings is distinct from old.servings
       or new.household_id is distinct from old.household_id
       or new.created_by is distinct from old.created_by then
      raise exception 'Cooks can only mark a meal as cooked';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists meals_cook_only_marks_cooked on meals;
create trigger meals_cook_only_marks_cooked before update on meals
  for each row execute function public.cook_only_marks_cooked();
