-- Each planned meal can change its own ingredients (the recipe stays as it is).
-- Run after meals-family-adds-cook-marks-cooked.sql. Safe to run twice.
alter table meals add column if not exists ingredient_changes jsonb;

-- Cooks may only mark a meal as cooked, so they cannot change its ingredients either.
create or replace function public.cook_only_marks_cooked()
returns trigger language plpgsql as $$
begin
  if my_role(new.household_id) = 'helper' then
    if new.status is distinct from 'cooked'
       or new.recipe_id is distinct from old.recipe_id
       or new.meal_date is distinct from old.meal_date
       or new.meal_slot is distinct from old.meal_slot
       or new.servings is distinct from old.servings
       or new.ingredient_changes is distinct from old.ingredient_changes
       or new.household_id is distinct from old.household_id
       or new.created_by is distinct from old.created_by then
      raise exception 'Cooks can only mark a meal as cooked';
    end if;
  end if;
  return new;
end $$;
