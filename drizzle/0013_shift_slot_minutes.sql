ALTER TABLE "shift_slots" ADD COLUMN "minutes" integer;--> statement-breakpoint
-- 타임의 대상을 직군(조교·원장·멘토)에서 근무 형태로 바꾼다. 시트가 주간조교와 야간조교에
-- 서로 다른 타임표를 쓰기 때문이다. 직군은 근무 형태에서 다시 뽑아낸다.
UPDATE "shift_slots" SET "audience" = CASE "audience"
  WHEN 'assistant' THEN '주간조교'
  WHEN 'manager' THEN '원장'
  WHEN 'mentor' THEN '컨설팅'
  ELSE "audience" END
WHERE "audience" IN ('assistant', 'manager', 'mentor');
