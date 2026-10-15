-- Upgrade existing projects before deploying the retry-safe start client. Existing five-argument callers keep working.
alter table public.runs add column if not exists request_id uuid;
create unique index if not exists runs_player_request on public.runs (player_id, request_id) where request_id is not null;
create or replace function public.start_run(p_player uuid, p_game text, p_day text, p_seed bigint, p_limit int, p_request uuid)
returns setof public.runs
language plpgsql security definer set search_path = public as $$
declare used int;
begin
  perform pg_advisory_xact_lock(hashtext(p_player::text || ':' || p_game || ':' || p_day));
  if p_request is not null and exists(select 1 from public.runs where player_id=p_player and request_id=p_request) then
    return query select * from public.runs where player_id=p_player and request_id=p_request;
    return;
  end if;
  select count(*) into used from public.runs where player_id=p_player and game=p_game and day=p_day;
  if used >= p_limit then return; end if;
  update public.runs set status='closed', finished_at=now() where player_id=p_player and game=p_game and status='open';
  return query insert into public.runs (player_id,game,day,seed,request_id) values (p_player,p_game,p_day,p_seed,p_request) returning *;
end $$;
revoke all on function public.start_run(uuid,text,text,bigint,int,uuid) from public, anon, authenticated;
grant execute on function public.start_run(uuid,text,text,bigint,int,uuid) to service_role;
