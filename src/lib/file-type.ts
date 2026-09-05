export type SniffedMime = "application/pdf" | "image/png" | "image/jpeg";

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * 파일 내용의 시그니처(매직 바이트)로 형식을 판정한다. 브라우저가 보낸 MIME 은 믿지 않는다.
 * PDF 는 스펙상 헤더 앞에 최대 1024바이트의 잡음이 올 수 있어 그 범위 안에서 %PDF- 를 찾는다.
 */
export function sniffMime(data: Buffer): SniffedMime | null {
  if (data.length >= 8 && data.subarray(0, 8).equals(PNG)) return "image/png";
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return "image/jpeg";
  if (data.subarray(0, 1024).indexOf("%PDF-") >= 0) return "application/pdf";
  return null;
}
