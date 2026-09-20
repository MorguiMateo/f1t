-- ============================================================================
-- F1t — `sessions.set_count` is maintained by the database (Phase 4)
--
-- `set_count` is one of the two columns in the PLAN.md §5.2 invariant: it is
-- what `HeatmapSession` reads to decide a square's intensity. Its true value
-- is "how many session_sets rows this session has", so leaving it to the
-- client means two requests for every set ticked at the gym — and an
-- intensity that lies whenever the second one fails.
--
-- Here a trigger recomputes it: one write per tap, and the number cannot
-- drift out of sync even if somebody writes from somewhere else.
-- ============================================================================

-- `security invoker` on purpose: the function runs as the user who ticked the
-- set, so the update against `sessions` goes through the same policy as any
-- other write of theirs. `security definer` would bypass RLS for no reason.
--
-- `search_path = ''` forces every name to be schema-qualified, which is what
-- stops anyone from prepending their own schema and serving a different
-- table.
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

  -- AFTER trigger: the return value is discarded.
  return null;
end;
$$;

-- Insert and delete only: ticking and unticking a set. Editing reps or weight
-- doesn't change how many sets there are, and a set never moves between
-- sessions — if one day it did, both sessions would need updating, not one.
drop trigger if exists session_sets_count_sync on public.session_sets;
create trigger session_sets_count_sync
  after insert or delete on public.session_sets
  for each row execute function public.sync_session_set_count();

-- Any sessions that already exist end up with the right number.
update public.sessions s
   set set_count = (
         select count(*) from public.session_sets ss where ss.session_id = s.id
       )
 where s.set_count is distinct from (
         select count(*) from public.session_sets ss where ss.session_id = s.id
       );
