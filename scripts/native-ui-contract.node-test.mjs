import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

// Execute the production policies on macOS without launching App, authenticating,
// requesting system permissions, or touching the workout repository.
const theme = readFileSync('ios/App/Native/native-theme.swift', 'utf8');
const app = readFileSync('ios/App/Native/native-app.swift', 'utf8');
function declaration(source, name) {
  const start = source.indexOf(`enum ${name} {`);
  assert.notEqual(start, -1, `Missing production policy ${name}`);
  const opening = source.indexOf('{', start);
  let depth = 1;
  for (let index = opening + 1; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}') depth -= 1;
    if (depth === 0) return source.slice(start, index + 1);
  }
  assert.fail(`Unclosed production policy ${name}`);
}
const policies = [
  declaration(theme, 'FitTabRootPolicy'),
  declaration(theme, 'FitErrorCopy'),
  declaration(app, 'FitPermissionState'),
].join('\n');
function checkSwift(scenarios) {
  const run = spawnSync('xcrun', ['swift', '-'], {
    input: `import Foundation\n${policies}\n${scenarios}\n`,
    encoding: 'utf8', timeout: 60_000,
  });
  assert.ifError(run.error);
  assert.equal(run.status, 0, run.stderr || run.stdout);
}

test('return to root refuses edited or saving forms at either navigation level', () => {
  checkSwift(`
    precondition(FitTabRootPolicy.canReturn(ownDraft: false, descendantDraft: false))
    precondition(!FitTabRootPolicy.canReturn(ownDraft: true, descendantDraft: false), "Do not discard a root draft")
    precondition(!FitTabRootPolicy.canReturn(ownDraft: false, descendantDraft: true), "Do not pop a dirty destination")
    precondition(!FitTabRootPolicy.canReturn(ownDraft: true, descendantDraft: true))
    // A rejected request is not deferred: only a new tap after resolving the draft may navigate.
    precondition(FitTabRootPolicy.canReturn(ownDraft: false, descendantDraft: false))
  `);
});

test('permission controls never offer another request when denied or already authorized', () => {
  checkSwift(`
    for state in [FitPermissionState.checking, .unavailable] {
        precondition(!state.offersRequest && !state.offersSettings && !state.canToggle)
    }
    precondition(FitPermissionState.notDetermined.offersRequest)
    precondition(!FitPermissionState.notDetermined.canToggle)
    precondition(!FitPermissionState.notDetermined.offersSettings)
    precondition(FitPermissionState.denied.offersSettings)
    precondition(!FitPermissionState.denied.offersRequest && !FitPermissionState.denied.canToggle)
    precondition(FitPermissionState.authorized.canToggle)
    precondition(!FitPermissionState.authorized.offersRequest && !FitPermissionState.authorized.offersSettings)
  `);
});

test('error copy distinguishes confirmed server writes from unknown outcomes and keeps actionable guidance', () => {
  checkSwift(`
    for message in [
        "El cambio se guardó en el servidor, pero no se pudo actualizar la copia de este iPhone. disk error",
        "El cambio se guardó en el servidor, pero no se pudo actualizar el estado de la copia local. disk error"
    ] {
        let copy = FitErrorCopy.guidance(message: message)
        precondition(copy.contains("está guardado en tu cuenta"))
        precondition(copy.contains("no vuelvas a registrar"))
    }
    let unknown = FitErrorCopy.guidance(message: "No se pudo guardar o cargar (HTTP 503, service_error). Reintentá.")
    precondition(unknown.contains("No se pudo confirmar"))
    precondition(!unknown.contains("está guardado"), "A read or failed write cannot prove server success")
    for message in [
        "Revisá los valores: están fuera del rango permitido.",
        "No tenés permiso para sincronizar este cambio. Tu progreso local se conserva.",
        "No se pudo conservar el borrador en el dispositivo. Reintentá antes de salir."
    ] {
        precondition(FitErrorCopy.guidance(message: message) == message, "Do not hide actionable Spanish guidance")
    }
    precondition(FitErrorCopy.guidance(message: "Error Domain=NSURLErrorDomain Code=-1009")
        .contains("No se pudo confirmar"))
  `);
});
