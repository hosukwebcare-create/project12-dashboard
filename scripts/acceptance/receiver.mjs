// 검수용 수신기: 메신저 인커밍 웹훅과 알림톡 딜러 API 를 흉내 내며 받은 요청을 JSONL 로 남긴다
import { createServer } from "node:http";
import { appendFileSync } from "node:fs";
const LOG = process.argv[2];
createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    const rec = { at: new Date().toISOString(), path: req.url, auth: req.headers.authorization ?? null, body: (() => { try { return JSON.parse(body); } catch { return body; } })() };
    appendFileSync(LOG, JSON.stringify(rec) + "\n");
    res.setHeader("Content-Type", "application/json");
    if (req.url.startsWith("/alimtalk")) res.end(JSON.stringify({ messageId: "dealer-" + Date.now() }));
    else if (req.url.startsWith("/fail")) { res.statusCode = 500; res.end("{}"); }
    else res.end(JSON.stringify({ ok: true }));
  });
}).listen(4599, "0.0.0.0", () => console.log("receiver on :4599"));
