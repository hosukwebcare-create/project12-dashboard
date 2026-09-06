-- 로컬 개발·테스트용 비superuser 앱 역할. RLS 는 superuser 에게 적용되지 않으므로
-- 통합 테스트와 E2E 는 이 역할로 접속해 정책이 실제로 동작하는지 확인한다.
--   psql byeolha_test -f scripts/db-local-app-role.sql
--   psql byeolha_e2e  -f scripts/db-local-app-role.sql
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'byeolha_app') then
    create role byeolha_app login password 'byeolha_app' nosuperuser nocreatedb nocreaterole;
  end if;
end $$;
grant usage on schema public to byeolha_app;
grant all privileges on all tables in schema public to byeolha_app;
grant all privileges on all sequences in schema public to byeolha_app;
alter default privileges in schema public grant all privileges on tables to byeolha_app;
alter default privileges in schema public grant all privileges on sequences to byeolha_app;
-- 서버 기동 시 자동 마이그레이션이 drizzle 스키마를 만들 수 있도록
do $$ begin execute format('grant create on database %I to byeolha_app', current_database()); end $$;
grant usage on schema drizzle to byeolha_app;
grant all privileges on all tables in schema drizzle to byeolha_app;
