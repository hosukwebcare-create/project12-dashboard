"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { ImportField, ImportPreview, ImportRow } from "@/modules/members/import";
import { commitImportAction, parseImportAction, previewImportAction } from "@/modules/members/import-actions";
import { STATUS_LABEL } from "@/modules/members/schema";

type Props = { fields: { key: ImportField; label: string }[] };

export function ImportWizard({ fields }: Props) {
  const [text, setText] = useState("");
  const [data, setData] = useState<string[][]>([]);
  const [mapping, setMapping] = useState<Record<number, ImportField | null>>({});
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [result, setResult] = useState<{ created: number; updated: number; failed: { row: number; message: string }[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  async function readFile(file: File) {
    setText(await file.text());
  }

  function parse() {
    setError(null);
    start(async () => {
      const r = await parseImportAction(text);
      if (r.error) return setError(r.error);
      setData(r.data);
      setMapping(r.mapping);
      const pv = await previewImportAction(r.data, r.mapping);
      if ("error" in pv) return setError(pv.error);
      setPreview(pv);
    });
  }

  function remap(col: number, field: ImportField | "") {
    const next = { ...mapping, [col]: field === "" ? null : field };
    setMapping(next);
    start(async () => {
      const pv = await previewImportAction(data, next);
      if ("error" in pv) return setError(pv.error);
      setPreview(pv);
    });
  }

  function commit() {
    if (!preview) return;
    const bad = new Set(preview.errors.map((e) => e.row));
    const rows = preview.rows.filter((r) => !bad.has(r.row));
    start(async () => {
      const r = await commitImportAction(rows);
      if ("error" in r) return setError(r.error);
      setResult(r);
    });
  }

  if (result) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>이관 완료</CardTitle>
          <CardDescription>
            새로 등록 {result.created}명, 기존 갱신 {result.updated}명{result.failed.length ? `, 반영 실패 ${result.failed.length}행` : ""}
          </CardDescription>
        </CardHeader>
        {result.failed.length ? (
          <CardContent>
            <ul className="mb-3 space-y-1 text-sm text-destructive">
              {result.failed.map((f) => (
                <li key={f.row}>
                  {f.row}행: {f.message}
                </li>
              ))}
            </ul>
          </CardContent>
        ) : null}
        <CardContent className="flex gap-2">
          <Button asChild>
            <Link href="/members">회원 목록으로</Link>
          </Button>
          <Button variant="outline" onClick={() => location.reload()}>
            다른 파일 이관
          </Button>
        </CardContent>
      </Card>
    );
  }

  const errorRows = new Map<number, string[]>();
  for (const e of preview?.errors ?? []) errorRows.set(e.row, [...(errorRows.get(e.row) ?? []), e.message]);
  const warnRows = new Map<number, string[]>();
  for (const w of preview?.warnings ?? []) warnRows.set(w.row, [...(warnRows.get(w.row) ?? []), w.message]);
  const okCount = preview ? preview.rows.filter((r) => !errorRows.has(r.row)).length : 0;

  return (
    <div className="space-y-4">
      {!preview ? (
        <Card>
          <CardHeader>
            <CardTitle>1. 데이터 붙여넣기 또는 파일 선택</CardTitle>
            <CardDescription>구글 시트에서 범위를 복사해 붙여넣거나(탭 구분), CSV 파일을 올립니다. 첫 행은 헤더여야 합니다.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <input type="file" accept=".csv,text/csv,text/plain" onChange={(e) => e.target.files?.[0] && readFile(e.target.files[0])} className="text-sm" />
            <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={8} placeholder={"좌석번호\t성명\t연락처\t생년월일\t성별\t구분\tTYPE\t집중관리\t목표대학/학과/시험\t학교명/학년\t계열\t주소\t학부모 연락처\t등록기간"} className="font-mono text-xs" />
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
            <Button onClick={parse} disabled={pending || !text.trim()}>
              {pending ? "읽는 중…" : "미리보기"}
            </Button>
          </CardContent>
        </Card>
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle>2. 열 매핑 확인</CardTitle>
              <CardDescription>자동으로 맞춘 매핑입니다. 잘못 잡힌 열은 바꾸고, 쓰지 않을 열은 &quot;사용 안 함&quot;으로 두세요.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              {data[0].map((h, i) => (
                <label key={i} className="flex items-center gap-1 rounded-md border px-2 py-1 text-xs">
                  <span className="max-w-32 truncate font-medium">{h || `(${i + 1}열)`}</span>
                  <select value={mapping[i] ?? ""} onChange={(e) => remap(i, e.target.value as ImportField | "")} className="h-7 rounded border bg-background px-1 text-xs">
                    <option value="">사용 안 함</option>
                    {fields.map((f) => (
                      <option key={f.key} value={f.key}>
                        {f.label}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>3. 검증 결과</CardTitle>
              <CardDescription>
                총 {preview.rows.length}행 · 반영 가능 {okCount}행 · 오류 {preview.errors.length}건 · 경고 {preview.warnings.length}건. 오류 행은 건너뛰고 나머지만 반영합니다.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="max-h-[28rem] overflow-auto rounded-md border">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-muted text-left">
                    <tr>
                      <th className="px-2 py-1">행</th>
                      <th className="px-2 py-1">이름</th>
                      <th className="px-2 py-1">좌석</th>
                      <th className="px-2 py-1">상태</th>
                      <th className="px-2 py-1">연락처</th>
                      <th className="px-2 py-1">학교/학년</th>
                      <th className="px-2 py-1">계열</th>
                      <th className="px-2 py-1">집중</th>
                      <th className="px-2 py-1">등록기간</th>
                      <th className="px-2 py-1">학부모</th>
                      <th className="px-2 py-1">메시지</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.rows.map((r: ImportRow) => {
                      const errs = errorRows.get(r.row);
                      const warns = warnRows.get(r.row);
                      return (
                        <tr key={r.row} className={cn("border-t align-top", errs ? "bg-rose-50" : warns ? "bg-amber-50" : "")}>
                          <td className="px-2 py-1 tabular-nums">{r.row}</td>
                          <td className="px-2 py-1 font-medium">
                            {r.name || <span className="text-destructive">(없음)</span>}
                            {r.existingId ? <span className="ml-1 rounded bg-sky-100 px-1 text-[10px] text-sky-800">갱신</span> : null}
                          </td>
                          <td className="px-2 py-1">{r.seatNo ?? "-"}</td>
                          <td className="px-2 py-1">{STATUS_LABEL[r.status]}</td>
                          <td className="px-2 py-1">{r.phone ?? ""}</td>
                          <td className="px-2 py-1">
                            {r.school ?? ""}
                            {r.grade ? ` ${r.grade}` : ""}
                          </td>
                          <td className="px-2 py-1">{r.track ?? ""}</td>
                          <td className="px-2 py-1">{r.focusCare ? "O" : ""}</td>
                          <td className="px-2 py-1 whitespace-nowrap">
                            {r.enrollStart && r.enrollEnd ? `${r.enrollStart} ~ ${r.enrollEnd}${r.planType === "short" ? " (단기)" : ""}` : ""}
                          </td>
                          <td className="px-2 py-1">{r.guardianPhone ?? r.guardianName ?? ""}</td>
                          <td className="px-2 py-1">
                            {errs?.map((m, i) => (
                              <div key={i} className="text-destructive">
                                {m}
                              </div>
                            ))}
                            {warns?.map((m, i) => (
                              <div key={i} className="text-amber-700">
                                {m}
                              </div>
                            ))}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {error ? <p className="mt-2 text-sm text-destructive">{error}</p> : null}
              <div className="mt-3 flex gap-2">
                <Button onClick={commit} disabled={pending || okCount === 0}>
                  {pending ? "반영 중…" : `${okCount}행 반영`}
                </Button>
                <Button variant="outline" onClick={() => setPreview(null)} disabled={pending}>
                  처음으로
                </Button>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
