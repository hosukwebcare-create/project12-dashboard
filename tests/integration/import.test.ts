import { beforeEach, describe, expect, it } from "vitest";
import { ForbiddenError } from "@/lib/errors";
import { autoMapHeaders, commitImport, previewImport } from "@/modules/members/import";
import { createMember, getMember, listMembers } from "@/modules/members/repo";
import { seedTwoBranches } from "./helpers";
import { resetDb } from "./setup";

const HEADER = ["좌석번호", "성명", "연락처", "생년월일", "성별", "구분", "TYPE", "집중관리", "목표대학/학과/시험", "학교명/학년", "계열", "주소", "학부모 연락처", "등록기간"];

describe("CSV 이관 · 헤더 매핑", () => {
  it("한국어 헤더를 자동으로 필드에 매핑한다", () => {
    const map = autoMapHeaders(HEADER);
    expect(map).toEqual({
      0: "seatNo",
      1: "name",
      2: "phone",
      3: "birthDate",
      4: "gender",
      5: "memberKind",
      6: "studentType",
      7: "focusCare",
      8: "target",
      9: "schoolGrade",
      10: "track",
      11: "address",
      12: "guardianPhone",
      13: "period",
    });
    expect(autoMapHeaders(["이름", "전화번호", "알수없음"])).toEqual({ 0: "name", 1: "phone", 2: null });
  });
});

describe("CSV 이관 · 검증과 반영", () => {
  beforeEach(resetDb);

  const rows = [
    HEADER,
    ["1", "김지민", "010.5091.1066", "2006/10/13", "여", "", "N수생", "O", "", "", "문과", "", "010-0000-0001", ""],
    ["2", "김태림", "010-4016-5246", "2008-04-10", "여", "학생", "재학생", "X", "", "한백고3", "이과", "화성시", "", ""],
    ["6", "이상윤/S", "", "", "남", "", "", "", "", "가온고3", "", "", "", "7월16~8월17일[33일]"],
    ["", "이보나", "010-3193-8895", "", "", "성인", "", "", "", "", "", "", "", ""],
  ];

  it("미리보기는 정규화된 행과 오류·경고를 준다", async () => {
    const t = await seedTwoBranches();
    const pv = await previewImport(t.mgrCtx1, rows, autoMapHeaders(rows[0]), "2026-09-05");
    expect(pv.rows).toHaveLength(4);
    expect(pv.rows[0]).toMatchObject({ name: "김지민", seatNo: 1, phone: "010-5091-1066", birthDate: "2006-10-13", studentType: "N수생", focusCare: true, track: "문과", guardianPhone: "010-0000-0001", status: "enrolled" });
    expect(pv.rows[1]).toMatchObject({ school: "한백고", grade: "3", memberKind: "student", focusCare: false });
    expect(pv.rows[2]).toMatchObject({ name: "이상윤", planType: "short", enrollStart: "2026-07-16", enrollEnd: "2026-08-17", seatNo: null, status: "prospect" });
    expect(pv.rows[3]).toMatchObject({ name: "이보나", memberKind: "adult", seatNo: null, status: "prospect" });
    // 좌석 6은 지점에 없다 (좌석 1~5) → 오류
    expect(pv.errors).toEqual([{ row: 4, message: expect.stringContaining("6번 좌석") }]);
    expect(pv.rows[2].seatNo).toBeNull();
  });

  it("같은 파일 안 좌석 중복과 사용 중인 좌석은 오류", async () => {
    const t = await seedTwoBranches();
    await createMember(t.mgrCtx1, { name: "기존회원", status: "enrolled", seatId: t.seats1[1].id, memberKind: "student", focusCare: false });
    const data = [
      ["좌석번호", "성명"],
      ["1", "가"],
      ["1", "나"],
      ["2", "다"],
      ["3", ""],
    ];
    const pv = await previewImport(t.mgrCtx1, data, autoMapHeaders(data[0]), "2026-09-05");
    expect(pv.errors.map((e) => e.row)).toEqual([3, 4, 5]);
    expect(pv.errors[0].message).toContain("중복");
    expect(pv.errors[1].message).toContain("기존회원");
    expect(pv.errors[2].message).toContain("이름");
  });

  it("반영하면 회원·좌석·학부모·등록기간이 만들어지고, 같은 이름+좌석은 갱신된다", async () => {
    const t = await seedTwoBranches();
    const pv = await previewImport(t.mgrCtx1, rows.slice(0, 4).concat([rows[4]]), autoMapHeaders(rows[0]), "2026-09-05");
    const ok = pv.rows.filter((_, i) => !pv.errors.some((e) => e.row === i + 2));
    const result = await commitImport(t.mgrCtx1, ok);
    expect(result).toMatchObject({ created: 3, updated: 0, failed: [] });
    const list = await listMembers(t.mgrCtx1);
    expect(list.map((m) => [m.name, m.seatNo])).toEqual([
      ["김지민", 1],
      ["김태림", 2],
      ["이보나", null],
    ]);
    const d = await getMember(t.mgrCtx1, list[0].id);
    expect(d.guardians[0]?.phone).toBe("010-0000-0001");
    expect(d.focusCare).toBe(true);

    // 두 번째 반영: 같은 이름+좌석 → 갱신
    const again = await previewImport(t.mgrCtx1, [HEADER, ["1", "김지민", "010-9999-8888", "", "", "", "", "X", "", "", "이과", "", "", ""]], autoMapHeaders(HEADER), "2026-09-05");
    expect(again.errors).toEqual([]);
    expect(again.rows[0].existingId).toBeDefined();
    const r2 = await commitImport(t.mgrCtx1, again.rows);
    expect(r2).toMatchObject({ created: 0, updated: 1, failed: [] });
    const d2 = await getMember(t.mgrCtx1, list[0].id);
    expect(d2.phone).toBe("010-9999-8888");
    expect(d2.track).toBe("이과");
    expect(d2.focusCare).toBe(false);
  });

  it("조교는 이관할 수 없다", async () => {
    const t = await seedTwoBranches();
    await expect(previewImport(t.asstCtx1, rows, autoMapHeaders(rows[0]), "2026-09-05")).rejects.toThrow(ForbiddenError);
  });

  it("실제 시트 형태: 좌석 칸의 상담/종료, 주소 칸의 기간, 이름 표기, 잘못된 보호자 연락처, 첫 등원일", async () => {
    const t = await seedTwoBranches();
    const data = [
      ["좌석번호", "성명", "연락처", "Column 7", "주소", "보호자 성함", "보호자 연락처", "비고", "첫 등원일"],
      ["3", "장지아/3", "010-1111-2222", "학생", "7월22~8월17일[27일]", "김정은", "010.56830.1234", "인강할인권", "2026-08-18"],
      ["종료", "김민수/S", "01033334444", "성인", "동탄순환대로 26길", "", "010-5555-6666", "", "2026-07-08"],
      ["상담", "박가림", "", "", "", "", "", "친구 소개", ""],
      ["휴원", "이보나", "010-7777-8888", "", "", "", "", "", ""],
    ];
    const mapping = { ...autoMapHeaders(data[0]), 3: "memberKind" as const };
    const pv = await previewImport(t.mgrCtx1, data, mapping, "2026-09-06");
    expect(pv.errors).toEqual([]);
    expect(pv.rows.map((r) => [r.name, r.status, r.seatNo, r.planType, r.enrollStart, r.enrollEnd, r.address])).toEqual([
      ["장지아", "enrolled", 3, "regular", "2026-07-22", "2026-08-17", null],
      ["김민수", "withdrawn", null, "short", null, null, "동탄순환대로 26길"],
      ["박가림", "prospect", null, "regular", null, null, null],
      ["이보나", "paused", null, "regular", null, null, null],
    ]);
    expect(pv.rows[0].memo).toBe("인강할할인권".replace("할할", "할") + " · 시트 표기 /3 · 보호자 연락처(원문) 010.56830.1234");
    expect(pv.rows[0].guardianPhone).toBeNull();
    expect(pv.rows[0].guardianName).toBe("김정은");
    expect(pv.rows[0].firstRegisteredAt).toBe("2026-08-18");
    expect(pv.rows[1].phone).toBe("010-3333-4444");
    expect(pv.warnings.map((w) => w.message)).toEqual(expect.arrayContaining([expect.stringContaining("'/3' 표기"), expect.stringContaining("등록기간으로 옮겼습니다"), expect.stringContaining("보호자 연락처")]));
    expect(pv.warnings.some((w) => /좌석번호 '(종료|상담|휴원)'/.test(w.message))).toBe(false);

    const result = await commitImport(t.mgrCtx1, pv.rows);
    expect(result).toMatchObject({ created: 4, updated: 0, failed: [] });
    const list = await listMembers(t.mgrCtx1, {});
    expect(list.map((m) => [m.name, m.status]).sort()).toEqual([["김민수", "withdrawn"], ["박가림", "prospect"], ["이보나", "paused"], ["장지아", "enrolled"]].sort());
  });

  it("반영 중 한 행이 실패해도 나머지는 반영되고 실패 행을 돌려준다", async () => {
    const t = await seedTwoBranches();
    const data = [["좌석번호", "성명"], ["1", "정상"], ["2", "실패"]];
    const pv = await previewImport(t.mgrCtx1, data, autoMapHeaders(data[0]), "2026-09-06");
    pv.rows[1].name = "x".repeat(40); // 30자 초과 → createMember 검증 실패
    const result = await commitImport(t.mgrCtx1, pv.rows);
    expect(result.created).toBe(1);
    expect(result.failed).toEqual([{ row: 3, message: expect.stringContaining("30자") }]);
  });
});
