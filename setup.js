// First-time setup: a few questions about the person and how the household eats.
// Everyone answers these once. The first question is whether they cook, which sets their role.
// An invite code only adds a person to the household; it does not set their role.
// Part of Home Menu. Loaded by index.html. Load order matters: see index.html.

const SETUP_MEALS = ['breakfast', 'lunch', 'dinner', 'snack'];
const SETUP_DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const SETUP_DIET = ['picky', 'low_calorie', 'eat_everything'];
const DEFAULT_MEAL_TIMES = { breakfast: '07:30', lunch: '13:30', dinner: '20:00', snack: '17:00' };
let setupStep = 0;
let setupData = null;

function blankSetup() {
  return {
    name: '',
    cook_answer: null,
    meals_per_day: ['breakfast', 'lunch', 'dinner'],
    meal_times: {},
    prep_home: [],
    prep_school: [],
    diet_choices: [],
    diet_notes: '',
    likes: '',
    dislikes: '',
    spice: 'mild',
    salt: 'normal',
  };
}

// Steps depend on earlier answers: people who do not cook are not asked which days they cook.
function setupSteps() {
  const steps = ['name', 'cook', 'meals', 'mealTimes'];
  if (setupData.cook_answer !== 'not_cook') steps.push('prepHome');
  return steps.concat(['prepSchool', 'diet', 'tastes', 'spice', 'salt']);
}

// Selected meals, in day order, for example breakfast, lunch, dinner.
function selectedMeals() {
  return SETUP_MEALS.filter((m) => setupData.meals_per_day.includes(m));
}

// Copy what is typed in the text boxes into the answers, so nothing is lost when a button re-draws the screen.
function collectSetupInputs() {
  document.querySelectorAll('[data-setup]').forEach((el) => {
    if (el.dataset.meal) setupData.meal_times[el.dataset.meal] = el.value;
    else setupData[el.dataset.field] = el.value;
  });
}

function pickSetup(field, value) {
  if (!setupData) return;
  collectSetupInputs();
  setupData[field] = value;
  render();
}

function toggleSetup(field, value) {
  if (!setupData) return;
  collectSetupInputs();
  const list = setupData[field];
  setupData[field] = list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
  render();
}

function setupOptions(field, options, selected) {
  return `<div class="setup-options">${options.map(([v, label]) =>
    `<button class="${selected === v ? 'btn' : 'btn secondary'}" onclick="pickSetup('${field}','${v}')">${esc(label)}</button>`).join('')}</div>`;
}

function setupChips(field, options, selected) {
  return options.map(([v, label]) =>
    `<button class="chip ${selected.includes(v) ? 'on' : ''}" onclick="toggleSetup('${field}','${v}')">${esc(label)}</button>`).join('');
}

function dayOptions() {
  return SETUP_DAYS.map((d) => [d, t('day_' + d)]);
}

function setupStepHtml(step) {
  if (step === 'name') {
    return `<h2 style="margin-top:0">${esc(t('nameQ'))}</h2>
      <input data-setup data-field="name" value="${esc(setupData.name)}" maxlength="30" autocomplete="nickname">
      <p class="muted">${esc(t('nameNote'))}</p>`;
  }
  if (step === 'cook') {
    return `<h2 style="margin-top:0">${esc(t('cookQ'))}</h2>
      ${setupOptions('cook_answer', [['cook', t('cookYes')], ['not_cook', t('cookNo')], ['hybrid', t('cookSometimes')]], setupData.cook_answer)}
      <p class="muted">${esc(t('cookNote'))}</p>`;
  }
  if (step === 'meals') {
    return `<h2 style="margin-top:0">${esc(t('mealsQ'))}</h2>
      <div>${setupChips('meals_per_day', SETUP_MEALS.map((m) => [m, t(m)]), setupData.meals_per_day)}</div>`;
  }
  if (step === 'mealTimes') {
    return `<h2 style="margin-top:0">${esc(t('mealTimesQ'))}</h2>` + selectedMeals().map((m) =>
      `<label>${esc(t(m))}</label>
       <input type="time" data-setup data-meal="${m}" value="${esc(setupData.meal_times[m] || DEFAULT_MEAL_TIMES[m])}">`).join('');
  }
  if (step === 'prepHome') {
    return `<h2 style="margin-top:0">${esc(t('prepHomeQ'))}</h2>
      <div>${setupChips('prep_home', dayOptions(), setupData.prep_home)}</div>`;
  }
  if (step === 'prepSchool') {
    return `<h2 style="margin-top:0">${esc(t('prepSchoolQ'))}</h2>
      <div>${setupChips('prep_school', dayOptions(), setupData.prep_school)}</div>`;
  }
  if (step === 'diet') {
    return `<h2 style="margin-top:0">${esc(t('dietQ'))}</h2>
      <div>${setupChips('diet_choices', [['picky', t('dietPicky')], ['low_calorie', t('dietLowCal')], ['eat_everything', t('dietEatAll')]], setupData.diet_choices)}</div>
      <label>${esc(t('dietNotesQ'))}</label>
      <textarea data-setup data-field="diet_notes">${esc(setupData.diet_notes)}</textarea>`;
  }
  if (step === 'tastes') {
    return `<label>${esc(t('likesQ'))}</label>
      <textarea data-setup data-field="likes">${esc(setupData.likes)}</textarea>
      <label>${esc(t('dislikesQ'))}</label>
      <textarea data-setup data-field="dislikes">${esc(setupData.dislikes)}</textarea>`;
  }
  if (step === 'spice') {
    return `<h2 style="margin-top:0">${esc(t('spiceQ'))}</h2>
      ${setupOptions('spice', [['none', t('spiceNone')], ['mild', t('spiceMild')], ['medium', t('spiceMedium')], ['hot', t('spiceHot')]], setupData.spice)}`;
  }
  if (step === 'salt') {
    return `<h2 style="margin-top:0">${esc(t('saltQ'))}</h2>
      ${setupOptions('salt', [['less', t('saltLess')], ['normal', t('saltNormal')], ['more', t('saltMore')]], setupData.salt)}`;
  }
  return '';
}

function renderSetup() {
  if (!setupData) { setupData = blankSetup(); setupStep = 0; }
  const steps = setupSteps();
  if (setupStep > steps.length - 1) setupStep = steps.length - 1;
  const last = setupStep === steps.length - 1;
  return `
    <div class="card">
      <div class="muted">${esc(t('stepOf'))} ${setupStep + 1} / ${steps.length}</div>
      ${setupStep === 0 ? `<p>${esc(t('setupIntro'))}</p>` : ''}
      ${setupStepHtml(steps[setupStep])}
    </div>
    <button class="btn" onclick="setupNext()">${esc(t(last ? 'setupFinish' : 'setupNext'))}</button>
    ${setupStep > 0 ? `<button class="btn secondary" onclick="setupBack()">${esc(t('setupBack'))}</button>` : ''}
    ${session && session.user.email === TEST_EMAIL ? `<button class="btn secondary" onclick="skipSetup()">${esc(t('setupSkip'))}</button>` : ''}`;
}

// Test account only: finish the setup with the default answers.
async function skipSetup() {
  if (!setupData) return;
  collectSetupInputs();
  if (!setupData.name.trim()) setupData.name = 'Test';
  await saveSetup();
}

function setupBack() {
  collectSetupInputs();
  setupStep = Math.max(0, setupStep - 1);
  problem = '';
  render();
}

async function setupNext() {
  // A second tap after setup has finished has nothing to do.
  if (!setupData) return;
  collectSetupInputs();
  const steps = setupSteps();
  const step = steps[setupStep];
  if (step === 'name' && !setupData.name.trim()) { problem = t('nameRequired'); return render(); }
  if (step === 'cook' && !setupData.cook_answer) { problem = t('pickOne'); return render(); }
  if (step === 'meals' && !setupData.meals_per_day.length) { problem = t('pickOne'); return render(); }
  if (step === 'mealTimes') {
    // Every chosen meal gets a time, even if the box was left empty.
    selectedMeals().forEach((m) => { if (!setupData.meal_times[m]) setupData.meal_times[m] = DEFAULT_MEAL_TIMES[m]; });
  }
  problem = '';
  if (setupStep < steps.length - 1) { setupStep++; return render(); }
  await saveSetup();
}

async function saveSetup() {
  const d = setupData;
  // The name they type is their nickname, shown in Settings and to the household.
  const { error: nameError } = await sb.from('profiles').update({ nickname: d.name.trim() }).eq('id', session.user.id);
  if (nameError) return setProblem(nameError);
  const { error } = await sb.from('member_settings').upsert({
    user_id: session.user.id,
    household_id: hh.id,
    setup_done: true,
    cook_answer: d.cook_answer,
    meals_per_day: d.meals_per_day,
    meal_times: Object.fromEntries(selectedMeals().map((m) => [m, d.meal_times[m] || DEFAULT_MEAL_TIMES[m]])),
    first_meal_time: selectedMeals().map((m) => d.meal_times[m] || DEFAULT_MEAL_TIMES[m]).sort()[0] || null,
    prep_home: d.prep_home,
    prep_school: d.prep_school,
    diet_choices: d.diet_choices,
    diet_notes: d.diet_notes.trim(),
    likes: d.likes.trim(),
    dislikes: d.dislikes.trim(),
    spice: d.spice,
    salt: d.salt,
    updated_at: new Date().toISOString(),
  });
  if (error) return setProblem(error);
  // The cook answer sets the role: cooks get the cook role, everyone else is a family member. Changeable later in People.
  const role = d.cook_answer === 'cook' ? 'helper' : 'member';
  const { error: roleError } = await sb.rpc('set_my_role', { p_household: hh.id, p_role: role });
  if (roleError) return setProblem(roleError);
  hh.role = role;
  needsSetup = false;
  setupData = null;
  setupStep = 0;
  notice = t('setupDone');
  problem = '';
  tab = 'home';
  await loadTab();
}
