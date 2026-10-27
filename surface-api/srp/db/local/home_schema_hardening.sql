-- Home tables, hardening (srp/home-page-schema, second review finding 9). LOCAL DATABASE ONLY: the `srp_cleanup` schema of v3_local.
--
-- Run after home_schema.sql. It makes the database refuse what the seed already never writes:
--   * a second row for the same seat and position (or label), a second brief for a seat and week, a second peer row for a band;
--   * a claim snapshot that belongs to another seat (a composite foreign key on the id and the seat);
--   * lane points above the lane's maximum, and a lane maximum lowered below points already scored;
--   * lane points that do not add up to the snapshot's total (checked when the transaction commits, so a snapshot and its lanes
--     can be written in any order inside one transaction; a snapshot with no lanes at all is still allowed).
-- Additive and re-runnable: every constraint is added only when missing, the triggers are replaced. No data is read or changed
-- by the script; it fails, and changes nothing, if existing rows already break a rule (one transaction).
-- No row-level security; the trigger functions run as the caller and are closed to anon, authenticated and PUBLIC.

begin;

do $$ begin
    if not exists (select 1 from pg_constraint where conname = 'uq_home_competitors_seat_position' and conrelid = 'srp_cleanup.home_competitors'::regclass) then
        alter table srp_cleanup.home_competitors add constraint uq_home_competitors_seat_position unique (tier_agent_id, position);
    end if;
end $$;

do $$ begin
    if not exists (select 1 from pg_constraint where conname = 'uq_home_next_moves_seat_position' and conrelid = 'srp_cleanup.home_next_moves'::regclass) then
        alter table srp_cleanup.home_next_moves add constraint uq_home_next_moves_seat_position unique (tier_agent_id, position);
    end if;
end $$;

do $$ begin
    if not exists (select 1 from pg_constraint where conname = 'uq_home_nora_insights_seat_position' and conrelid = 'srp_cleanup.home_nora_insights'::regclass) then
        alter table srp_cleanup.home_nora_insights add constraint uq_home_nora_insights_seat_position unique (tier_agent_id, position);
    end if;
end $$;

do $$ begin
    if not exists (select 1 from pg_constraint where conname = 'uq_home_activity_seat_label' and conrelid = 'srp_cleanup.home_activity'::regclass) then
        alter table srp_cleanup.home_activity add constraint uq_home_activity_seat_label unique (tier_agent_id, label);
    end if;
end $$;

do $$ begin
    if not exists (select 1 from pg_constraint where conname = 'uq_home_weekly_briefs_seat_week' and conrelid = 'srp_cleanup.home_weekly_briefs'::regclass) then
        alter table srp_cleanup.home_weekly_briefs add constraint uq_home_weekly_briefs_seat_week unique (tier_agent_id, week_start);
    end if;
end $$;

do $$ begin
    if not exists (select 1 from pg_constraint where conname = 'uq_home_weekly_brief_items_brief_position' and conrelid = 'srp_cleanup.home_weekly_brief_items'::regclass) then
        alter table srp_cleanup.home_weekly_brief_items add constraint uq_home_weekly_brief_items_brief_position unique (brief_id, position);
    end if;
end $$;

do $$ begin
    if not exists (select 1 from pg_constraint where conname = 'uq_home_peer_benchmarks_band' and conrelid = 'srp_cleanup.home_peer_benchmarks'::regclass) then
        alter table srp_cleanup.home_peer_benchmarks add constraint uq_home_peer_benchmarks_band unique (band_id);
    end if;
end $$;

do $$ begin
    if not exists (select 1 from pg_constraint where conname = 'uq_home_snapshots_id_seat' and conrelid = 'srp_cleanup.home_snapshots'::regclass) then
        alter table srp_cleanup.home_snapshots add constraint uq_home_snapshots_id_seat unique (id, tier_agent_id);
    end if;
end $$;

-- The claim snapshot must be the same seat's: replace the single-column foreign key by one on (snapshot id, seat).
do $$ begin
    if not exists (select 1 from pg_constraint where conname = 'fk_home_seat_state_claim_same_seat' and conrelid = 'srp_cleanup.home_seat_state'::regclass) then
        alter table srp_cleanup.home_seat_state drop constraint if exists fk_home_seat_state_claim_snapshot_id;
        alter table srp_cleanup.home_seat_state add constraint fk_home_seat_state_claim_same_seat
            foreign key (claim_snapshot_id, tier_agent_id) references srp_cleanup.home_snapshots (id, tier_agent_id)
            on delete set null (claim_snapshot_id);
    end if;
end $$;

-- Lane points never above the lane's maximum.
create or replace function srp_cleanup.home_snapshot_lane_check() returns trigger language plpgsql as $$
declare lane_max integer;
begin
    select max_points into lane_max from srp_cleanup.home_score_lanes where id = new.lane_id;
    if new.points > lane_max then
        raise exception 'lane points % are above the lane maximum %', new.points, lane_max using errcode = 'check_violation';
    end if;
    return new;
end $$;

create or replace function srp_cleanup.home_lane_max_check() returns trigger language plpgsql as $$
begin
    if exists (select 1 from srp_cleanup.home_snapshot_lanes where lane_id = new.id and points > new.max_points) then
        raise exception 'lane maximum % is below points already scored', new.max_points using errcode = 'check_violation';
    end if;
    return new;
end $$;

-- Lane points add up to the snapshot's total (deferred to commit). One helper, two thin trigger functions (one per table's columns).
create or replace function srp_cleanup.home_snapshot_sum_ok(sid bigint) returns void language plpgsql as $$
declare total_now integer; lanes_now bigint; n integer;
begin
    select total into total_now from srp_cleanup.home_snapshots where id = sid;
    if total_now is null then return; end if;   -- the snapshot is gone (a cascade): nothing to add up
    select count(*), coalesce(sum(points), 0) into n, lanes_now from srp_cleanup.home_snapshot_lanes where snapshot_id = sid;
    if n > 0 and lanes_now <> total_now then
        raise exception 'snapshot %: lane points add up to % but the total is %', sid, lanes_now, total_now using errcode = 'check_violation';
    end if;
end $$;

create or replace function srp_cleanup.home_snapshot_sum_check() returns trigger language plpgsql as $$
begin
    if tg_op <> 'DELETE' then perform srp_cleanup.home_snapshot_sum_ok(new.snapshot_id); end if;
    if tg_op <> 'INSERT' then perform srp_cleanup.home_snapshot_sum_ok(old.snapshot_id); end if;
    return null;
end $$;

create or replace function srp_cleanup.home_snapshot_total_check() returns trigger language plpgsql as $$
begin
    perform srp_cleanup.home_snapshot_sum_ok(new.id);
    return null;
end $$;

revoke all on function srp_cleanup.home_snapshot_lane_check() from anon, authenticated, public;
revoke all on function srp_cleanup.home_lane_max_check() from anon, authenticated, public;
revoke all on function srp_cleanup.home_snapshot_sum_ok(bigint) from anon, authenticated, public;
revoke all on function srp_cleanup.home_snapshot_sum_check() from anon, authenticated, public;
revoke all on function srp_cleanup.home_snapshot_total_check() from anon, authenticated, public;

drop trigger if exists trg_home_snapshot_lane_check on srp_cleanup.home_snapshot_lanes;
create trigger trg_home_snapshot_lane_check before insert or update of points, lane_id on srp_cleanup.home_snapshot_lanes
    for each row execute function srp_cleanup.home_snapshot_lane_check();

drop trigger if exists trg_home_lane_max_check on srp_cleanup.home_score_lanes;
create trigger trg_home_lane_max_check before update of max_points on srp_cleanup.home_score_lanes
    for each row execute function srp_cleanup.home_lane_max_check();

drop trigger if exists trg_home_snapshot_sum_lanes on srp_cleanup.home_snapshot_lanes;
create constraint trigger trg_home_snapshot_sum_lanes after insert or update or delete on srp_cleanup.home_snapshot_lanes
    deferrable initially deferred for each row execute function srp_cleanup.home_snapshot_sum_check();

drop trigger if exists trg_home_snapshot_sum_total on srp_cleanup.home_snapshots;
create constraint trigger trg_home_snapshot_sum_total after insert or update of total on srp_cleanup.home_snapshots
    deferrable initially deferred for each row execute function srp_cleanup.home_snapshot_total_check();

commit;

-- Rollback (commented; run by hand):
-- drop trigger if exists trg_home_snapshot_sum_total on srp_cleanup.home_snapshots;
-- drop trigger if exists trg_home_snapshot_sum_lanes on srp_cleanup.home_snapshot_lanes;
-- drop trigger if exists trg_home_lane_max_check on srp_cleanup.home_score_lanes;
-- drop trigger if exists trg_home_snapshot_lane_check on srp_cleanup.home_snapshot_lanes;
-- drop function if exists srp_cleanup.home_snapshot_total_check();
-- drop function if exists srp_cleanup.home_snapshot_sum_check();
-- drop function if exists srp_cleanup.home_snapshot_sum_ok(bigint);
-- drop function if exists srp_cleanup.home_lane_max_check();
-- drop function if exists srp_cleanup.home_snapshot_lane_check();
-- alter table srp_cleanup.home_seat_state drop constraint if exists fk_home_seat_state_claim_same_seat;
-- alter table srp_cleanup.home_seat_state add constraint fk_home_seat_state_claim_snapshot_id foreign key (claim_snapshot_id) references srp_cleanup.home_snapshots (id) on delete set null;
-- alter table srp_cleanup.home_snapshots drop constraint if exists uq_home_snapshots_id_seat;
-- alter table srp_cleanup.home_peer_benchmarks drop constraint if exists uq_home_peer_benchmarks_band;
-- alter table srp_cleanup.home_weekly_brief_items drop constraint if exists uq_home_weekly_brief_items_brief_position;
-- alter table srp_cleanup.home_weekly_briefs drop constraint if exists uq_home_weekly_briefs_seat_week;
-- alter table srp_cleanup.home_activity drop constraint if exists uq_home_activity_seat_label;
-- alter table srp_cleanup.home_nora_insights drop constraint if exists uq_home_nora_insights_seat_position;
-- alter table srp_cleanup.home_next_moves drop constraint if exists uq_home_next_moves_seat_position;
-- alter table srp_cleanup.home_competitors drop constraint if exists uq_home_competitors_seat_position;
