import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, cpSync, rmSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { nativeXCConfig } from './ios-native-config.mjs';

const run = (url, key) => spawnSync(process.execPath, ['scripts/ios-native-prepare.mjs'], { encoding: 'utf8', env: { ...process.env, VITE_SUPABASE_URL: url, VITE_SUPABASE_ANON_KEY: key } });
test('native preparation rejects service-role and secret keys without exposing them', () => {
  const jwt = `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({ role: 'service_role', sentinel: 'not-for-app' })).toString('base64url')}.signature`;
  for (const key of [jwt, 'sb_secret_never_bundle_this']) {
    const r = run('https://example.supabase.co', key);
    assert.notEqual(r.status, 0);
    assert.equal((r.stdout + r.stderr).includes(key), false);
  }
});
test('native preparation rejects URL credentials and non-origin configuration', () => {
  for (const url of ['http://example.supabase.co', 'https://user:password@example.supabase.co', 'https://example.supabase.co/path', 'https://example.supabase.co?token=abc']) {
    assert.notEqual(run(url, 'sb_publishable_public_test_key').status, 0);
  }
});
test('native preparation writes unquoted comment-safe config using local env precedence', () => {
  const root = mkdtempSync(join(tmpdir(), 'fit-native-prepare-'));
  const key = 'sb_publishable_public_test_key';
  try {
    for (const dir of ['scripts', 'ios', 'public/exercises', 'src/features/exercises']) mkdirSync(join(root, dir), { recursive: true });
    for (const name of ['ios-native-config.mjs', 'ios-native-prepare.mjs']) cpSync(`scripts/${name}`, join(root, 'scripts', name));
    writeFileSync(join(root, '.env'), 'VITE_SUPABASE_URL=https://old.example\nVITE_SUPABASE_ANON_KEY=sb_secret_rejected_if_used\n');
    writeFileSync(join(root, '.env.local'), `VITE_SUPABASE_URL="https://example.supabase.co/"\nVITE_SUPABASE_ANON_KEY='${key}'\n`);
    writeFileSync(join(root, 'src/features/exercises/catalog.json'), '[]');
    const env = { ...process.env };
    delete env.VITE_SUPABASE_URL; delete env.VITE_SUPABASE_ANON_KEY;
    const result = spawnSync(process.execPath, [join(root, 'scripts/ios-native-prepare.mjs')], { env, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    const configPath = join(root, 'ios/native-config.xcconfig');
    const config = readFileSync(configPath, 'utf8');
    assert.equal(config, nativeXCConfig('https://example.supabase.co', key));
    assert.match(config, /^SUPABASE_URL = https:\/\$\(\)\/example\.supabase\.co$/m);
    assert.equal(statSync(configPath).mode & 0o777, 0o600);
    assert.equal((result.stdout + result.stderr).includes(key), false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

const validateBuild = (url, key) => {
  const env = { ...process.env };
  delete env.SUPABASE_URL; delete env.SUPABASE_ANON_KEY;
  if (url !== undefined) env.SUPABASE_URL = url;
  if (key !== undefined) env.SUPABASE_ANON_KEY = key;
  return spawnSync(process.execPath, ['scripts/ios-native-config.mjs'], { env, encoding: 'utf8' });
};
test('Xcode configuration guard accepts expanded HTTPS with public anon or publishable keys', () => {
  const anon = `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({ role: 'anon' })).toString('base64url')}.signature`;
  for (const key of [anon, 'sb_publishable_public_test_key']) {
    for (const url of ['https://example.supabase.co', 'https://example.supabase.co/']) {
      const result = validateBuild(url, key);
      assert.equal(result.status, 0, result.stderr);
      assert.equal(result.stdout + result.stderr, '');
    }
  }
});
test('Xcode guard rejects missing, unexpanded and quoted/truncated or normalized-only origins', () => {
  for (const url of [undefined, '', '$(SUPABASE_URL)', '"https:', 'https:', 'https:/example.supabase.co', 'https:/$()/example.supabase.co', ' https://example.supabase.co', 'https://user:password@example.supabase.co', 'https://example.supabase.co/path']) {
    const result = validateBuild(url, 'sb_publishable_public_test_key');
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /error: FIT:.*npm run ios:prepare/);
    assert.equal(result.stderr.includes('sb_publishable_public_test_key'), false);
    if (url && url.length > 10) assert.equal(result.stderr.includes(url), false);
  }
});
test('Xcode guard rejects missing, unresolved and privileged keys without logging values', () => {
  const serviceRole = `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({ role: 'service_role' })).toString('base64url')}.signature`;
  for (const key of [undefined, '', '$(SUPABASE_ANON_KEY)', 'sb_secret_never_bundle_this', serviceRole, 'not_a_public_key']) {
    const result = validateBuild('https://example.supabase.co', key);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /error: FIT:.*npm run ios:prepare/);
    assert.equal(result.stderr.includes('https://example.supabase.co'), false);
    if (key) assert.equal(result.stderr.includes(key), false);
  }
});
test('App target always validates resolved config before sources in Debug and Release', () => {
  const project = readFileSync('ios/App/App.xcodeproj/project.pbxproj', 'utf8');
  const object = id => {
    const match = project.match(new RegExp(`^\\s*${id}[^=\\n]*= [{]([\\s\\S]*?)^\\s*[}];`, 'm'));
    assert.ok(match, `Missing Xcode object ${id}`);
    return match[1];
  };
  const app = object('504EC3031FED79650016851F');
  assert.match(app, /buildPhases = \(\s*B66000000000000000000001/);
  assert.ok(app.indexOf('B66000000000000000000001') < app.indexOf('504EC3001FED79650016851F'));
  const phase = object('B66000000000000000000001');
  assert.match(phase, /isa = PBXShellScriptBuildPhase/);
  assert.match(phase, /alwaysOutOfDate = 1/);
  assert.match(phase, /showEnvVarsInLog = 0/);
  assert.match(phase, /runOnlyForDeploymentPostprocessing = 0/);
  assert.match(phase, /ios-native-config\.mjs/);
  assert.match(phase, /\/opt\/homebrew\/bin:\/usr\/local\/bin/);
  for (const id of ['504EC3171FED79650016851F', '504EC3181FED79650016851F']) assert.match(object(id), /baseConfigurationReference = B61200000000000000000003/);
});
test('iOS app target contains native sources and no Capacitor package dependency', () => {
  const p = readFileSync('ios/App/App.xcodeproj/project.pbxproj', 'utf8');
  assert.equal(p.includes('CapApp-SPM'), false);
  assert.ok(p.includes('native-app.swift in Sources'));
  assert.ok(p.includes('NativeTests'));
  for (const file of ['ios/App/App/AppDelegate.swift', 'ios/App/App/SceneDelegate.swift']) assert.equal(readFileSync(file, 'utf8').includes('import Capacitor'), false);
});
test('public iOS sync command cannot run Capacitor or overwrite native startup', () => {
  const p = JSON.parse(readFileSync('package.json', 'utf8'));
  assert.equal(p.scripts['ios:sync'], 'npm run ios:prepare');
  assert.equal(p.scripts['ios:open'], 'open ios/App/App.xcodeproj');
});

test('app and widget declare only their actual required-reason API categories', () => {
  const manifest = path => readFileSync(path, 'utf8');
  const app = manifest('ios/App/App/PrivacyInfo.xcprivacy');
  const widget = manifest('ios/App/WidgetExtension/PrivacyInfo.xcprivacy');
  const strings = xml => [...xml.matchAll(/<string>([^<]+)<\/string>/g)].map(match => match[1]);
  assert.deepEqual(strings(app), ['NSPrivacyAccessedAPICategoryUserDefaults', 'CA92.1', 'NSPrivacyAccessedAPICategoryFileTimestamp', 'C617.1']);
  assert.deepEqual(strings(widget), ['NSPrivacyAccessedAPICategoryFileTimestamp', 'C617.1']);
  for (const xml of [app, widget]) {
    assert.ok(xml.includes('<key>NSPrivacyAccessedAPITypes</key>'));
    assert.equal(xml.includes('NSPrivacyCollectedDataTypes'), false);
    assert.equal(xml.includes('NSPrivacyTracking'), false);
  }
});
test('each privacy manifest is wired to its own target resource phase', () => {
  const project = readFileSync('ios/App/App.xcodeproj/project.pbxproj', 'utf8');
  const object = id => {
    const match = project.match(new RegExp(`^\\s*${id}[^=\\n]*= [{]([^}]+)[}];`, 'm'));
    assert.ok(match, `Missing Xcode object ${id}`);
    return match[1];
  };
  const appResource = object('504EC3021FED79650016851F');
  const widgetResource = object('B63000000000000000000005');
  assert.ok(appResource.includes('isa = PBXResourcesBuildPhase'));
  assert.ok(appResource.includes('B63000000000000000000001'));
  assert.ok(widgetResource.includes('isa = PBXResourcesBuildPhase'));
  assert.ok(widgetResource.includes('B63000000000000000000002'));
  assert.ok(object('B63000000000000000000001').includes('fileRef = B63000000000000000000003'));
  assert.ok(object('B63000000000000000000002').includes('fileRef = B63000000000000000000004'));
  for (const ref of ['B63000000000000000000003', 'B63000000000000000000004']) assert.ok(object(ref).includes('path = PrivacyInfo.xcprivacy'));
  assert.ok(object('A6F200000000000000000020').includes('B63000000000000000000005'));
  assert.ok(object('504EC3031FED79650016851F').includes('504EC3021FED79650016851F'));
});

test('native display branding is FIT without changing installed identity or web branding', () => {
  const read = path => readFileSync(path, 'utf8');
  for (const path of ['ios/App/App/Info.plist', 'ios/App/WidgetExtension/Info.plist']) {
    assert.match(read(path), /<key>CFBundleDisplayName<\/key>\s*<string>FIT<\/string>/);
  }
  const app = read('ios/App/Native/native-app.swift');
  assert.ok(app.includes('Text("FIT")'));
  assert.ok(app.includes('No se guardan contraseñas en FIT.'));
  assert.ok(read('ios/App/Native/native-device.swift').includes('content.title = "Hoy toca entrenar"'));
  assert.ok(read('ios/App/Native/native-device.swift').includes('Tu rutina está lista en FIT.'));
  const widgets = read('ios/App/WidgetExtension/F1tWidgets.swift');
  assert.ok(widgets.includes('.configurationDisplayName("FIT")'));
  assert.ok(widgets.includes('Abrí FIT para ver tu actividad'));
  assert.ok(widgets.includes('Abrí FIT para ver la rutina de hoy'));
  assert.ok(widgets.includes('let kind = "F1tWidget"'));
  assert.ok(read('ios/App/Native/native-auth.swift').includes('com.morguimateo.f1t.native-session'));
  assert.ok(read('ios/App/Native/native-auth.swift').includes('f1t://auth/callback'));
  assert.ok(read('ios/App/Native/native-device.swift').includes('"f1t.native.training.'));
  for (const path of ['ios/App/App/App.entitlements', 'ios/App/WidgetExtension/WidgetExtension.entitlements']) {
    assert.ok(read(path).includes('<string>group.com.morguimateo.f1t</string>'));
  }
  const project = read('ios/App/App.xcodeproj/project.pbxproj');
  assert.equal((project.match(/PRODUCT_BUNDLE_IDENTIFIER = com\.morguimateo\.f1t;/g) ?? []).length, 2);
  assert.equal((project.match(/PRODUCT_BUNDLE_IDENTIFIER = com\.morguimateo\.f1t\.widget;/g) ?? []).length, 2);
  assert.ok(project.includes('DEVELOPMENT_TEAM = JD8CG96M2A;'));
  assert.ok(read('index.html').includes('<title>F1t</title>'));
});
