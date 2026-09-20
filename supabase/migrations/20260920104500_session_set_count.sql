-- ============================================================================
-- F1t — `sessions.set_count` lo mantiene la base (Fase 4)
--
-- `set_count` es una de las dos columnas del invariante de PLAN.md §5.2: es
-- lo que lee `HeatmapSession` para decidir la intensidad del cuadradito. Su
-- valor real es "cuántas filas de session_sets tiene esta sesión", así que
-- dejarlo en manos del cliente significa dos requests por cada serie que se
-- marca en el gimnasio —y una intensidad que miente cuando el segundo falla.
--
-- Acá lo recalcula un trigger: una sola escritura por toque, y el número no
-- puede quedar desincronizado ni aunque alguien escriba desde otro lado.
-- ============================================================================

-- `security invoker` a propósito: la función corre como el usuario que marcó
-- la serie, así que el update contra `sessions` pasa por la misma policy que
-- cualquier otra escritura suya. Con `security definer` se saltearía RLS sin
-- que haga falta.
--
-- `search_path = ''` obliga a calificar cada nombre con su schema, que es lo
-- que impide que alguien anteponga un schema propio y sirva otra tabla.
create or replace function public.sync_session_set_count()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  target uuid := coalesce(new.session_id, old.session_id);
begin
  update public.sessions
     set set_count = (
           select count(*)
             from public.session_sets
            where session_id = target
         )
   where id = target;

  -- Trigger AFTER: el valor de retorno se descarta.
  return null;
end;
$$;

-- Solo insert y delete: marcar y desmarcar una serie. Editar reps o peso no
-- cambia cuántas series son, y una serie nunca se muda de sesión —si algún
-- día se mudara, habría que actualizar las dos sesiones, no una.
drop trigger if exists session_sets_count_sync on public.session_sets;
create trigger session_sets_count_sync
  after insert or delete on public.session_sets
  for each row execute function public.sync_session_set_count();

-- Las sesiones que ya existan quedan con el número correcto.
update public.sessions s
   set set_count = (
         select count(*) from public.session_sets ss where ss.session_id = s.id
       )
 where s.set_count is distinct from (
         select count(*) from public.session_sets ss where ss.session_id = s.id
       );
