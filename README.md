# 프로젝트12 통합관리 플랫폼 (코드명: 별하)

관리형 스터디카페 체인의 회원 관련 업무를 구글 시트 6종에서 하나의 웹 플랫폼으로 통합한다. RFP의 1·2·3단계 범위가 모두 구현되어 있다.

## 문서

| 문서 | 내용 |
|---|---|
| [docs/01_프로젝트_기획서.md](docs/01_프로젝트_기획서.md) | 현행 분석, 목표·KPI, 단계별 범위, 개발 방식 비교·결정, 일정·M/M, 검수 기준, 위험, 확인 필요 사항 |
| [docs/02_시스템_설계서.md](docs/02_시스템_설계서.md) | 아키텍처, 데이터 모델(ERD·테이블), 권한·다지점 격리, 화면 설계, 업무 규칙, API, 이관, 보안, 테스트, 운영 |
| [docs/superpowers/plans/2026-09-05-phase1-core.md](docs/superpowers/plans/2026-09-05-phase1-core.md) | 1단계 코어 구현 계획 |
| [docs/03_운영_가이드.md](docs/03_운영_가이드.md) | 환경 변수, 배포, 배치, 외부 연동(알림톡·HERO·메신저) 설정 |
| [docs/04_성능_점검.md](docs/04_성능_점검.md) | 지점 10 · 회원 900 · 체크 105만 건 기준 응답 시간과 용량 전망 |
| [docs/05_관리자_매뉴얼.md](docs/05_관리자_매뉴얼.md) | 역할별 화면 사용 절차, 자주 묻는 질문 |
| [docs/06_이관_리허설_동탄2.md](docs/06_이관_리허설_동탄2.md) | 실제 시트 5종 구조와 적재 결과 |
| [docs/07_배포_체크리스트.md](docs/07_배포_체크리스트.md) | Railway·GCP·사내 서버 배포, 최초 데이터, 전환 주간 운영 |
| [docs/08_현장_사용_가이드.html](docs/08_현장_사용_가이드.html) | 처음 쓰는 조교·멘토·지점장을 위한 역할별 첫날 안내서 |
| [docs/09_검수_결과서.html](docs/09_검수_결과서.html) | 기획서 검수 기준 37항목을 운영 빌드에서 실제로 돌린 결과 (`scripts/acceptance/run.sh` 로 재실행) |
| [DESIGN.md](DESIGN.md) | 디자인 토큰·밀도 규칙·하지 않는 것 |

## 실행 방법

요구 사항: Node 22+, pnpm, PostgreSQL 16+ (로컬은 brew 서비스).

```bash
createdb byeolha_dev && createdb byeolha_test && createdb byeolha_e2e
cp .env.example .env.local        # DATABASE_URL, DATABASE_URL_TEST, SESSION_SECRET 확인
pnpm install
pnpm db:migrate                   # 개발 DB 마이그레이션
pnpm db:reset:test                 # 테스트 DB 스키마
pnpm seed                         # 가상 데이터 (실제 인물 정보 없음)
pnpm dev                          # http://localhost:3000
```

검증:

```bash
pnpm test                         # 단위·통합 테스트 (테스트 DB)
pnpm exec playwright test         # E2E (운영 빌드 + 전용 DB byeolha_e2e, 자동 시드)
pnpm lint && pnpm build
pnpm perf:seed && pnpm perf:measure   # 대량 데이터 성능 점검 (byeolha_perf DB)
sh scripts/acceptance/run.sh          # 검수 워크스루: 운영 빌드 + 실제 수신기로 기획서 검수 기준 37항목 (acceptance-out/)
DATABASE_URL=... pnpm exec tsx scripts/reconcile-sheets.ts --branch DT2 --dir ~/Downloads --members ... --board ...
                                      # 시트 ↔ DB 대사: 회원 값·라운딩 등급/점수·식사 주문을 건별로 대조
node scripts/acceptance/report.mjs acceptance-out   # → docs/09_검수_결과서.html
```

시드 계정 (괄호 안이 비밀번호):

| 아이디 | 역할 | 지점 | 비고 |
|---|---|---|---|
| `hq` (hq1234) | 본사 관리자 | 전 지점 전환 | 전 지점 요약, 기본 규칙·템플릿·커스텀 필드 관리 |
| `manager` (1234) | 지점장 | 동탄2 | |
| `mentor` (1234) | 멘토 | 동탄2 · 수원1 겸임 | |
| `assistant` (1234) | 조교 | 동탄2 | PIN 1111 |
| `assistant2` (1234) | 조교 | 동탄2 | PIN 2222 (태블릿 전환 시연) |
| `manager2` (1234) | 지점장 | 수원1 | |

현황판 링크는 `pnpm seed` 출력 또는 설정 › 지점·현황판에서 발급한다. 형식: `/board/{지점ID}?t={토큰}`.

## 구현 범위

**1단계 · 코어**
- 인증·역할·지점 격리, 본사 지점 전환, 조교 PIN 전환(공용 태블릿), 조교에게 연락처·학부모 정보 비노출
- 회원 마스터: 목록·상세·등록·수정·상태·좌석·타임라인·라운딩/벌점 주간표·파일, CSV 이관 마법사(자동 매핑·검증·갱신), 모의고사 회차·신청·결제
- 집중관리일지: 주간 그리드(최근 4주·월별), 집중관리 개인 일지, 원장·멘토 2열, 코멘트·@멘션 알림
- 라운딩(모바일): 회차 시작·예외만 탭 입력·벌점 규칙·이슈 보고·회차 완료, 오프라인 재전송 큐, 일별 체크, 회차 조회
- 현황판: 지점 토큰 URL, 주간 좌석 × 항목 그리드, 60초 갱신, 이름 마스킹
- 이슈함·알림함, 대시보드(지점장·본사 전 지점 요약)
- 상담 일정(주 × 시간대 캘린더, 신규/재상담/학부모, 담당 배정·알림)
- 인수인계(근무 타임별 글·답글, 개인 계정 기준 읽음 표시, 공지)
- 결제 대상(좌석 등급별 요금표 → 등록기간마다 금액 자동 계산, 식사 미수와 합산)
- 설정: 지점, 지점 생성·비활성(본사), 사용자·PIN·비밀번호 정책(10자·영문+숫자), 로그인 잠금(5회/10분), 좌석, 벌점 규칙, 현황판 항목, 커스텀 필드(회원·이슈 양식), 감사 로그, 퇴원 회원 보관기간 익명화

**2단계 · 운영 확장**
- 식사주문: 월별 그리드(중·석식), 전일 마감·요일·휴무 규칙, 단가 스냅샷, 일별 발주서(인쇄), 월 정산·결제 처리
- 근무일지: 지점별 타임 정의, 출근 체크·초과근무 사유, 지점장 대리 입력, 본사 확인 잠금, 월 집계·예상 급여·CSV
- 알림톡: 템플릿(#{변수}), 대상 그룹(전체/집중관리/선택 × 회원/학부모), 미리보기, 발송 큐·재시도, 이력. 공급자 어댑터(mock/HTTP 딜러)

**3단계 · 외부 연동**
- HERO 학습진단 웹훅 수신(HMAC 서명) → 회원 프로필 연결
- 회원 파일(AI 컨설팅 리포트 PDF 등) 업로드·버전·다운로드(접근 로그)
- 메신저 웹훅 아웃박스: 이슈 보고·고벌점 이벤트를 Rocket.Chat/Mattermost/Slack 인커밍 웹훅으로 게시, 배치 전송·재시도

파일 저장소는 로컬 디스크와 GCS(`STORAGE_DRIVER=gcs`)를 모두 지원한다. `GET /api/health` 가 DB 연결까지 확인하는 헬스체크다.

보안: 지점 격리는 앱 계층 스코핑 + PostgreSQL RLS(요청 트랜잭션에 지점 컨텍스트 설정, 24개 테이블 정책) 두 겹. 로그인·PIN 5회 실패 잠금, 웹훅 SSRF 차단(로컬·메타데이터·사설망), 업로드 매직 바이트 검사, 상담일지·라운딩 체크 수정 이력.

미구현·미검증: 알림톡 딜러 계정 실연동(NHN Cloud·Solapi 어댑터는 있으나 실계정 검증 전), 사내 메신저 서버 설치 자체(RFP 3-3 별도 견적 항목), 에러 모니터링(Sentry 등) 연동, 실데이터 이관 리허설, 오프라인 상태에서 앱 실행(서비스 워커 없음, 열린 시트의 입력 유실 방지만 됨).

## 기술 스택

Next.js 16 (App Router) · TypeScript · Tailwind v4 · shadcn/ui · Drizzle ORM · PostgreSQL · jose(세션) · bcryptjs · Vitest · Playwright

## 폴더 구조

```
src/app            라우트 (app: 인증 필요 화면, auth: 로그인, board: 공개 현황판, api: 현황판·파일·연동·배치)
src/modules/*      모듈별 repo(데이터 접근·권한)·actions(서버 액션)·schema(검증)
src/lib/rules      순수 업무 규칙 (주차, 벌점, 등록기간, 마스킹, 회차, CSV, 식사, 근무, 템플릿, 커스텀 필드)
src/lib/auth       세션·컨텍스트·비밀번호
src/db             Drizzle 스키마·클라이언트·시드
tests/unit         규칙·세션 단위 테스트
tests/integration  DB를 사용하는 모듈 테스트 (지점 격리·권한 포함)
tests/e2e          Playwright 브라우저 시나리오 (역할별 전 화면)
```
