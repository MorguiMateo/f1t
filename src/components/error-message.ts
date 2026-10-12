export function describeError(error: unknown): { message: string; detail: string } {
  const raw = error instanceof Error ? error.message
    : typeof error === "string" ? error
    : error && typeof error === "object" && "message" in error ? String(error.message)
    : "";
  let message: string;
  if (/network|fetch|offline|conexi[oó]n|timeout|timed out|aborterror/i.test(raw)) {
    message = "No pudimos conectarnos. Revisá tu conexión y volvé a intentar.";
  } else if (/cancel|access_denied|denied.*access/i.test(raw)) {
    message = "La operación se canceló. Podés volver a intentarlo cuando quieras.";
  } else if (/jwt|token|session.*expired|invalid.*grant|pkce|code.*expired/i.test(raw)) {
    message = "El acceso venció o no pudo validarse. Volvé a iniciar sesión con Google.";
  } else if (/permission|row.level.security|unauthorized|forbidden/i.test(raw)) {
    message = "No pudimos verificar el acceso a estos datos. Revisá tu sesión y volvé a intentar.";
  } else if (/duplicate|unique constraint|already exists/i.test(raw)) {
    message = "Ese registro ya existe. Actualizá los datos antes de intentar otra vez.";
  } else if (/^(No |La |El |Los |Las |Este |Esta |Ya |Sin |Ingres|Eleg|Complet|Revis|Falt|Google no|Inicio de sesi|Permit|Actualiz|Guard|Se |Tu |Tus |Por |Necesit|Podés|Usá|Una )/i.test(raw)) {
    message = raw;
  } else {
    message = "No pudimos completar la operación. Volvé a intentar; si el problema continúa, revisá tu sesión.";
  }
  return { message, detail: raw !== message ? raw : "" };
}
