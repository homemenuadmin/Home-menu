-- Mock recipes, ingredients and kitchen stock for the test account, and a reset that recreates them.
-- Already applied to the Supabase project. Run after roles-and-setup.sql.

-- Mock recipes, ingredients and kitchen stock for a household.
create or replace function public.seed_test_household(p_household uuid, p_user uuid)
returns void language plpgsql security definer set search_path to 'public' as $$
declare rid uuid;
begin
  insert into pantry_items (household_id, name_en, name_ar, ingredient_key, location, level, updated_by) values
    (p_household, 'Onion', 'بصل', 'onion', 'fridge', 'Full', p_user),
    (p_household, 'Tomato', 'طماطم', 'tomato', 'fridge', 'Half', p_user),
    (p_household, 'Chicken', 'دجاج', 'chicken', 'freezer', 'Low', p_user),
    (p_household, 'Rice', 'أرز', 'rice', 'pantry', 'Full', p_user),
    (p_household, 'Eggs', 'بيض', 'eggs', 'fridge', 'Full', p_user),
    (p_household, 'Bread', 'خبز', 'bread', 'pantry', 'Finished', p_user),
    (p_household, 'Garlic', 'ثوم', 'garlic', 'pantry', 'Full', p_user),
    (p_household, 'Lentils', 'عدس', 'lentils', 'pantry', 'Half', p_user),
    (p_household, 'Olive oil', 'زيت زيتون', 'olive_oil', 'pantry', 'Full', p_user),
    (p_household, 'Potato', 'بطاطس', 'potato', 'pantry', 'Low', p_user),
    (p_household, 'Cheese', 'جبن', 'cheese', 'fridge', 'Full', p_user),
    (p_household, 'Lemon', 'ليمون', 'lemon', 'fridge', 'Finished', p_user),
    (p_household, 'Cumin', 'كمون', 'cumin', 'pantry', 'Full', p_user);

  insert into recipes (household_id, title_en, title_ar, minutes, meal_slot, steps_en, steps_ar, created_by)
  values (p_household, 'Chicken and rice', 'دجاج وأرز', 60, 'lunch',
    'Fry the chopped onion and garlic in the oil until soft.
Add the chicken pieces and cumin and cook until browned.
Add the rice and water, cover, and simmer on low for 25 minutes.
Rest for 5 minutes, then serve.',
    'قلّبوا البصل والثوم المفرومين في الزيت حتى يلينا.
أضيفوا قطع الدجاج والكمون واتركوها حتى تحمرّ.
أضيفوا الأرز والماء، غطّوا القدر واتركوه على نار هادئة 25 دقيقة.
اتركوه 5 دقائق ثم قدّموه.', p_user) returning id into rid;
  insert into recipe_ingredients (recipe_id, ingredient_key, name_en, name_ar, quantity, optional) values
    (rid, 'chicken', 'Chicken', 'دجاج', '500 g', false),
    (rid, 'rice', 'Rice', 'أرز', '2 cups', false),
    (rid, 'onion', 'Onion', 'بصل', '1', false),
    (rid, 'garlic', 'Garlic', 'ثوم', '2 cloves', false),
    (rid, 'olive_oil', 'Olive oil', 'زيت زيتون', '2 tbsp', false),
    (rid, 'cumin', 'Cumin', 'كمون', '1 tsp', false),
    (rid, 'parsley', 'Parsley', 'بقدونس', '1 handful', true);

  insert into recipes (household_id, title_en, title_ar, minutes, meal_slot, steps_en, steps_ar, created_by)
  values (p_household, 'Lentil soup', 'شوربة عدس', 40, 'lunch',
    'Fry the onion and garlic in the oil.
Add the rinsed lentils, potato cubes, cumin and 1.5 litres of water.
Simmer for 30 minutes until soft.
Squeeze lemon over the top before serving.',
    'قلّبوا البصل والثوم في الزيت.
أضيفوا العدس المغسول وقطع البطاطس والكمون ولترا ونصف من الماء.
اتركوه على نار هادئة 30 دقيقة حتى يلين.
اعصروا الليمون فوقه قبل التقديم.', p_user) returning id into rid;
  insert into recipe_ingredients (recipe_id, ingredient_key, name_en, name_ar, quantity, optional) values
    (rid, 'lentils', 'Lentils', 'عدس', '1 cup', false),
    (rid, 'onion', 'Onion', 'بصل', '1', false),
    (rid, 'garlic', 'Garlic', 'ثوم', '1 clove', false),
    (rid, 'potato', 'Potato', 'بطاطس', '1', false),
    (rid, 'cumin', 'Cumin', 'كمون', '1/2 tsp', false),
    (rid, 'lemon', 'Lemon', 'ليمون', '1', false),
    (rid, 'olive_oil', 'Olive oil', 'زيت زيتون', '1 tbsp', false);

  insert into recipes (household_id, title_en, title_ar, minutes, meal_slot, steps_en, steps_ar, created_by)
  values (p_household, 'Scrambled eggs with tomato', 'بيض بالطماطم', 15, 'breakfast',
    'Fry the chopped onion in the oil for 2 minutes.
Add the chopped tomatoes and cook until soft.
Break in the eggs and stir gently until set.',
    'قلّبوا البصل المفروم في الزيت دقيقتين.
أضيفوا الطماطم المقطعة واتركوها حتى تلين.
كسروا البيض فوقها وقلّبوه برفق حتى ينضج.', p_user) returning id into rid;
  insert into recipe_ingredients (recipe_id, ingredient_key, name_en, name_ar, quantity, optional) values
    (rid, 'eggs', 'Eggs', 'بيض', '3', false),
    (rid, 'tomato', 'Tomato', 'طماطم', '2', false),
    (rid, 'onion', 'Onion', 'بصل', '1/2', false),
    (rid, 'olive_oil', 'Olive oil', 'زيت زيتون', '1 tbsp', false),
    (rid, 'parsley', 'Parsley', 'بقدونس', '1 handful', true);

  insert into recipes (household_id, title_en, title_ar, minutes, meal_slot, steps_en, steps_ar, created_by)
  values (p_household, 'Bread and cheese', 'خبز وجبن', 5, 'breakfast',
    'Slice the bread and the tomato.
Serve with the cheese and tomato.',
    'قطّعوا الخبز والطماطم.
قدّموهما مع الجبن.', p_user) returning id into rid;
  insert into recipe_ingredients (recipe_id, ingredient_key, name_en, name_ar, quantity, optional) values
    (rid, 'bread', 'Bread', 'خبز', '2 slices', false),
    (rid, 'cheese', 'Cheese', 'جبن', '50 g', false),
    (rid, 'tomato', 'Tomato', 'طماطم', '1', false);

  insert into recipes (household_id, title_en, title_ar, minutes, meal_slot, steps_en, steps_ar, created_by)
  values (p_household, 'Potato stew', 'يخنة بطاطس', 45, 'dinner',
    'Fry the onion and garlic in the oil.
Add the chopped tomatoes, potato cubes, cumin and a cup of water.
Cover and simmer for 30 minutes until the potatoes are soft.',
    'قلّبوا البصل والثوم في الزيت.
أضيفوا الطماطم المقطعة وقطع البطاطس والكمون وكوبا من الماء.
غطّوها واتركوها 30 دقيقة حتى تنضج البطاطس.', p_user) returning id into rid;
  insert into recipe_ingredients (recipe_id, ingredient_key, name_en, name_ar, quantity, optional) values
    (rid, 'potato', 'Potato', 'بطاطس', '3', false),
    (rid, 'tomato', 'Tomato', 'طماطم', '3', false),
    (rid, 'onion', 'Onion', 'بصل', '1', false),
    (rid, 'garlic', 'Garlic', 'ثوم', '2 cloves', false),
    (rid, 'olive_oil', 'Olive oil', 'زيت زيتون', '2 tbsp', false),
    (rid, 'cumin', 'Cumin', 'كمون', '1 tsp', false);
end $$;

-- Test account reset: clears the account's own households and makes a fresh seeded one.
create or replace function public.reset_test_account(p_email text, p_password text)
returns void
language plpgsql
security definer
set search_path to 'public', 'auth', 'extensions'
as $function$
declare
  uid uuid;
  hid uuid;
begin
  -- Only the one test account can be reset, and only with its password.
  if lower(p_email) <> 'test.owner@example.com' then
    raise exception 'not the test account';
  end if;
  select id into uid from auth.users
   where email = 'test.owner@example.com'
     and encrypted_password = crypt(p_password, encrypted_password);
  if uid is null then
    raise exception 'wrong test password';
  end if;

  -- Delete any household that only the test account belongs to. Deleting the household
  -- cascades to its meals, recipes, kitchen items, rules, codes and settings.
  for hid in
    select hm.household_id from household_members hm
    where hm.user_id = uid
      and not exists (select 1 from household_members o where o.household_id = hm.household_id and o.user_id <> uid)
  loop
    delete from households where id = hid;
  end loop;

  -- Leave any shared household the test account was added to, without touching its data.
  delete from household_members where user_id = uid;
  delete from member_settings where user_id = uid;

  -- A fresh test household, owned by the test account, with mock recipes and kitchen stock.
  insert into households (name) values ('Test household') returning id into hid;
  insert into household_members (household_id, user_id, role, is_owner) values (hid, uid, 'member', true);
  perform public.seed_test_household(hid, uid);
end $function$;

-- Seed the household the test account currently loads.
select public.seed_test_household('8952839a-4099-49f8-9ba0-e0473193d130', (select id from auth.users where email = 'test.owner@example.com'));
