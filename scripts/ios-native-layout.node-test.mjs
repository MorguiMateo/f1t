import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const app = readFileSync('ios/App/Native/native-app.swift', 'utf8');
const todayViews = readFileSync('ios/App/Native/native-today-views.swift', 'utf8');
const today = todayViews
  .split('struct NativeTodayView: View {')[1].split('struct NativeTodayRoutine: View {')[0];
const theme = readFileSync('ios/App/Native/native-theme.swift', 'utf8');
const routines = readFileSync('ios/App/Native/native-routine-views.swift', 'utf8');
const api = readFileSync('ios/App/Native/native-api.swift', 'utf8');

// Exercise actual production navigation and draft policies without a simulator,
// account, network requests, or source substitutions for their implementations.
function declaration(source, name) {
  const match = source.match(new RegExp(`(?:enum|struct) ${name}(?:\\s*[:{])`));
  assert.ok(match, `Missing production declaration ${name}`);
  const opening = source.indexOf('{', match.index);
  let depth = 1;
  for (let index = opening + 1; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}') depth -= 1;
    if (depth === 0) return source.slice(match.index, index + 1);
  }
  assert.fail(`Unclosed declaration ${name}`);
}
function checkSwift(scenarios) {
  const source = [
    'import Foundation',
    declaration(theme, 'FitGlyphKind'), declaration(theme, 'FitTab'),
    declaration(theme, 'FitTabRootPolicy'), declaration(app, 'FitTabNavigationState'),
    declaration(routines, 'NativeRoutineRoute'), declaration(routines, 'NativeRoutineDraftPolicy'),
    declaration(api, 'NativeFailure'), declaration(api, 'NativeConfiguration'),
    scenarios,
  ].join('\n');
  const run = spawnSync('xcrun', ['swift', '-'], { input: source, encoding: 'utf8', timeout: 60_000 });
  assert.ifError(run.error);
  assert.equal(run.status, 0, run.stderr || run.stdout);
}

test('food diary is a first-class tab while Today retains workout and steps controls', () => {
  const tabs = app.split('struct NativeTabsView: View {')[1];
  const tabCases = theme.split('enum FitTab:')[1].split('var label:')[0];
  assert.match(tabCases, /case\s+[^\n]*\bfoods\b/);
  assert.match(tabs, /case \.foods:[\s\S]*?NavigationStack\(path: \$foodPath\)/);
  assert.match(tabs, /NativeFoodsView\(\)/);
  assert.equal(today.includes('NativeFoodsView'), false, 'Today must not retain the obsolete food navigation CTA');
  assert.equal(today.includes('fork.knife'), false, 'Today must not retain the obsolete food CTA icon');
  assert.match(today, /NativeStepsView\(\)/);
  assert.match(today, /NativeTodayRoutine\(date: now\)/);
  assert.match(readFileSync('ios/App/Native/native-store.swift', 'utf8'), /@Published var foodEntries/);
});

test('native tab shell reserves intrinsic bar height and retains keyboard/tab/top behavior', () => {
  const tabs = app.split('struct NativeTabsView: View {')[1];
  assert.match(tabs, /VStack\(spacing: 0\)/);
  assert.equal(tabs.includes('.safeAreaInset(edge: .bottom'), false);
  assert.match(tabs, /\.fixedSize\(horizontal: false, vertical: true\)/);
  assert.match(tabs, /if !keyboardVisible/);
  assert.match(tabs, /keyboardWillShowNotification/);
  assert.match(tabs, /keyboardWillHideNotification/);
  assert.match(tabs, /ForEach\(FitTab\.allCases/);
  assert.equal(tabs.includes('.id(resets'), false, 'Repeated taps must not remount a form');
  assert.match(tabs, /\.allowsHitTesting\(selection == tab\)/);
  assert.match(tabs, /\.accessibilityHidden\(selection != tab\)/);
  assert.match(tabs, /\.safeAreaInset\(edge: \.top, spacing: 0\) \{ banner \}/);
});

test('tab switching preserves visited context; re-tap requests root without blurring or remounting', () => {
  checkSwift(`
    var state = FitTabNavigationState()
    precondition(!state.select(.today), "Internal same-tab links must not reset navigation")
    precondition(state.rootRequests.isEmpty)
    precondition(state.select(.routines))
    precondition(state.select(.today))
    precondition(state.visited == Set([.today, .routines]), "Keep both roots mounted")
    precondition(state.rootRequests.isEmpty, "Switching tabs must preserve each path")
    precondition(!state.select(.today, returnToRootIfSelected: true), "A re-tap must not blur a draft")
    let request = state.rootRequests[.today]
    precondition(request != nil)
    precondition(!state.select(.today, returnToRootIfSelected: true))
    precondition(state.rootRequests[.today] != request, "Each explicit tap gets a fresh request")
    precondition(state.visited == Set([.today, .routines]))
    precondition(!FitTabRootPolicy.canReturn(ownDraft: true, descendantDraft: false))
    precondition(!FitTabRootPolicy.canReturn(ownDraft: false, descendantDraft: true))
    precondition(FitTabRootPolicy.canReturn(ownDraft: false, descendantDraft: false))
  `);
});

test('account identity resets tab routes while edited routine names survive refreshes', () => {
  assert.match(app, /NativeTabsView\(store: store, auth: auth\)\.id\(auth\.session\?\.user\.id\)/);
  for (const root of [todayViews, routines]) {
    assert.match(root, /NavigationStack\(path: \$path\)/);
    assert.match(root, /\.fitTabRoot\(/);
    assert.match(root, /\.onChange\(of: store\.auth\.generation\)[\s\S]*?path = \[\]/);
  }
  assert.match(routines, /\.fitNavigationDraft\(creatingWeekday != nil/);
  assert.match(routines, /\.fitNavigationDraft\(\(labelInitialized/);
  assert.match(routines, /\.fitNavigationDraft\(editing \|\| saving\)/);
  checkSwift(`
    var oldAccount = FitTabNavigationState()
    _ = oldAccount.select(.profile)
    _ = oldAccount.select(.profile, returnToRootIfSelected: true)
    let newAccount = FitTabNavigationState()
    precondition(newAccount.selection == .today && newAccount.visited == Set([.today]))
    precondition(newAccount.rootRequests.isEmpty, "Account identity must not inherit requests")
    precondition(!NativeRoutineDraftPolicy.canRefresh(draft: "Mi borrador", previous: "Anterior", incoming: "Otro dispositivo", initialized: true))
    precondition(!NativeRoutineDraftPolicy.canRefresh(draft: "", previous: "Pierna", incoming: "Torso", initialized: true), "Keep invalid empty edits visible")
    precondition(NativeRoutineDraftPolicy.canRefresh(draft: "Anterior", previous: "Anterior", incoming: "Actualizado", initialized: true))
    precondition(NativeRoutineDraftPolicy.canRefresh(draft: "Confirmado", previous: "Anterior", incoming: "Confirmado", initialized: true))
    precondition(NativeRoutineDraftPolicy.canRefresh(draft: "", previous: nil, incoming: "Primera carga", initialized: false))
    precondition(NativeRoutineDraftPolicy.nameError("") != nil)
    precondition(NativeRoutineDraftPolicy.nameError("   ") != nil)
    precondition(NativeRoutineDraftPolicy.nameError("Pierna") == nil)
    // Separate Today and Routines paths have the same typed destinations, but no shared storage.
    var todayPath = [NativeRoutineRoute.workout(date: Date(timeIntervalSince1970: 0), dayID: "day", guided: true)]
    let routinePath = [NativeRoutineRoute.routine("routine"), .day("day", initiallyAdding: true)]
    todayPath.removeAll()
    precondition(routinePath.count == 2)
  `);
});

test('an unconfigured installation gives a product error without developer commands or secret values', () => {
  checkSwift(`
    do {
        _ = try NativeConfiguration.load() // Interpreter bundle intentionally has no app configuration.
        preconditionFailure("Missing configuration cannot connect to the service")
    } catch {
        let copy = error.localizedDescription
        precondition(copy.contains("Actualizá la app"))
        precondition(copy.contains("no se modificaron"))
        precondition(!copy.contains("npm") && !copy.contains("SupabaseAnonKey") && !copy.contains("service_role"))
    }
  `);
});

const workout = readFileSync('ios/App/Native/native-workout-views.swift', 'utf8');
const summary = todayViews.split('private func dayBlock')[1].split('// A weekday')[0];
const guided = readFileSync('ios/App/Native/native-guided-workout.swift', 'utf8');
const exerciseLog = readFileSync('ios/App/Native/native-exercise-log.swift', 'utf8');
const progress = readFileSync('ios/App/Native/native-progress-views.swift', 'utf8');

test('Today is summary-only and opts into guided training while history defaults to editor', () => {
  assert.equal(summary.includes('FitExerciseLine'), false);
  assert.equal(summary.includes('ForEach'), false);
  assert.match(summary, /Empezar entrenamiento/);
  assert.match(summary, /Editar este día/);
  assert.match(summary, /\.workout\(date: date, dayID: day.id, guided: !finished\)/);
  assert.match(routines, /mode: guided \? \.guided : \.history/);
  assert.match(workout, /mode: NativeWorkoutMode = \.history/);
  assert.match(workout, /case history, guided/);
  assert.match(progress, /NativeWorkoutView\(date: NativeDate\.parse\(key\) \?\? Date\(\)\)/);
});

test('guided screen renders one exercise, preserves pending navigation and explicit completion', () => {
  assert.equal((guided.match(/NativeExerciseLog\(/g) ?? []).length, 1);
  assert.match(guided, /Ejercicio .* de /);
  assert.match(guided, /NativeExerciseLog/);
  assert.match(guided, /\.id\(id\)/);
  assert.match(guided, /NativeWorkoutProgress\.complete/);
  assert.match(guided, /selectExercise\(next\)/);
  assert.match(guided, /NativeWorkoutSelection\.shouldSelect/);
  assert.match(guided, /live\.selectExercise\(candidate, store: store\)/);
  assert.match(guided, /Hacer este ejercicio después/);
  assert.match(guided, /Queda pendiente; no se marca como completado/);
  assert.match(guided, /Todas las series registradas/);
  assert.match(guided, /Finalizar entrenamiento/);
  assert.match(guided, /Revisar o corregir series/);
  assert.match(guided, /Finalizar por hoy/);
  assert.match(workout, /NativeWorkoutBottomAction\(controls: controls\)/);
  assert.match(workout, /\.disabled\(controls\.saving\)/);
  assert.match(workout, /Set\(0..<goal\(target\)\)\.isSubset/);
  assert.match(exerciseLog, /if guided \{ return NativeWorkoutProgress\.goal/);
});

test('rest uses local bounded preference and an end date, not decrementing counters', () => {
  assert.match(guided, /@AppStorage\("native\.workout\.restMinutes"\) private var restMinutes = 2\.0/);
  assert.match(workout, /in: 0\.5\.\.\.10, step: 0\.5/);
  assert.match(workout, /end = now\.addingTimeInterval/);
  assert.match(workout, /timeIntervalSince\(now\)/);
  assert.match(workout, /TimelineView/);
  assert.match(workout, /Button\("Omitir descanso", action: onSkip\)/);
  assert.match(guided, /\.onReceive\(store\.accountChanges\)/);
  assert.equal(guided.includes('nativeDateRollover'), false, 'Midnight must not end a durable session through its view');
  const persistence = readFileSync('ios/App/Native/native-workout-persistence.swift', 'utf8');
  assert.match(persistence, /isNew = old == nil/);
  assert.match(persistence, /if isNew \{ onNewSet\(\) \}/);
  assert.match(exerciseLog, /guard !saving, hydratedContext == context, let action = identity, action\.isCurrent\(in: store\.auth\)/);
});

const project = readFileSync('ios/App/App.xcodeproj/project.pbxproj', 'utf8');
const privateAppSources = [
  'native-workout-persistence.swift', 'native-active-workout.swift', 'native-rest-notifications.swift',
  'native-alarm-provider.swift', 'native-workout-shortcuts.swift', 'native-exercise-instructions-es.swift',
  'native-food-preferences.swift', 'native-today-views.swift', 'native-guided-workout.swift',
  'native-exercise-log.swift', 'native-progress-views.swift',
];
function sourceNames(phaseID) {
  const phase = project.match(new RegExp(`${phaseID} /\\* Sources \\*/ = \\{([\\s\\S]*?)\\n\\t\\t\\};`));
  assert.ok(phase, 'Expected explicit Xcode source phase');
  return [...phase[1].matchAll(/\/\* (.*?) in Sources \*\//g)].map(match => match[1]);
}

test('private native sources belong only to App, alarm metadata is shared, fixtures stay test-only', () => {
  const appSources = sourceNames('504EC3001FED79650016851F');
  const widgetSources = sourceNames('A6F200000000000000000017');
  const testSources = sourceNames('B62000000000000000000007');
  for (const source of privateAppSources) {
    assert.equal(appSources.filter(name => name === source).length, 1, `${source}: App membership`);
    assert.equal(widgetSources.includes(source), false, `${source}: private app code must not enter the extension`);
    assert.equal(testSources.includes(source), false, `${source}: tests import the app implementation`);
  }
  assert.ok(appSources.includes('native-alarm-live-activity.swift'));
  assert.ok(widgetSources.includes('native-alarm-live-activity.swift'));
  assert.deepEqual(testSources, ['native-tests.swift']);
  assert.equal(appSources.includes('native-tests.swift'), false);
  assert.equal(widgetSources.includes('native-tests.swift'), false);
  assert.equal(new Set(appSources).size, appSources.length);
  assert.equal(new Set(widgetSources).size, widgetSources.length);
});

test('new explicit source references resolve from their actual Xcode groups', () => {
  const group = id => {
    const match = project.match(new RegExp(`^\\t\\t${id} /\\* .*? \\*/ = \\{([\\s\\S]*?)\\n\\t\\t\\};`, 'm'));
    assert.ok(match, `Missing declared group ${id}`);
    return match[1];
  };
  const native = group('B61300000000000000000001');
  const widget = group('A6F200000000000000000022');
  const products = group('504EC3051FED79650016851F');
  for (const [name, folder, children] of [
    ...privateAppSources.map(name => [name, 'Native', native]),
    ['native-alarm-live-activity.swift', 'WidgetExtension', widget],
  ]) {
    assert.ok(children.includes(`/* ${name} */`), `${name}: belongs to ${folder}`);
    assert.equal(products.includes(`/* ${name} */`), false, `${name}: source must not resolve through Products`);
    assert.ok(existsSync(`ios/App/${folder}/${name}`), `${name}: actual source file exists`);
  }
});
