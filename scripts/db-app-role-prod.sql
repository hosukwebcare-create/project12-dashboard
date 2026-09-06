-- 운영 DB 앱 전용 계정. superuser 는 RLS 를 무시하므로 앱은 반드시 이 계정으로 접속한다.
-- 테이블 소유권도 이 계정으로 옮겨 서버 기동 시 자동 마이그레이션(ALTER TABLE)이 되게 하고,
-- FORCE ROW LEVEL SECURITY 덕분에 소유자여도 정책은 적용된다.
--
--   psql "$DATABASE_URL" -v app_password="'긴비밀번호'" -f scripts/db-app-role-prod.sql
--
-- 실행 후 앱 서비스의 DATABASE_URL 을 postgresql://byeolha_app:<비밀번호>@<호스트>:5432/<db> 로 바꾼다.
\set ON_ERROR_STOP on

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'byeolha_app') then
    execute format('create role byeolha_app login password %L nosuperuser nocreatedb nocreaterole', :'app_password');
  else
    execute format('alter role byeolha_app with login password %L nosuperuser nocreatedb nocreaterole', :'app_password');
  end if;
  execute format('grant connect, create on database %I to byeolha_app', current_database());
end $$;

grant usage, create on schema public to byeolha_app;
grant usage on schema drizzle to byeolha_app;

-- 소유권 이전: public·drizzle 스키마의 테이블·시퀀스, drizzle 스키마 자체
do $$
declare r record;
begin
  for r in select schemaname, tablename from pg_tables where schemaname in ('public', 'drizzle') loop
    execute format('alter table %I.%I owner to byeolha_app', r.schemaname, r.tablename);
  end loop;
  for r in select sequence_schema, sequence_name from information_schema.sequences where sequence_schema in ('public', 'drizzle') loop
    execute format('alter sequence %I.%I owner to byeolha_app', r.sequence_schema, r.sequence_name);
  end loop;
end $$;
alter schema drizzle owner to byeolha_app;

-- 확인: superuser 아님, 정책 개수, FORCE 적용
select rolsuper as app_is_superuser from pg_roles where rolname = 'byeolha_app';
select count(*) as policies from pg_policy where polqual is not null;
select count(*) as forced_tables from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relforcerowsecurity;
