---
title: "Phase 4 Hosted Embed: E2E va docs, Chrome chan loopback luc parse"
date: 2026-09-10
summary: E2E ba tang that; sua 4 SHOULD-FIX gom CSP thieu jsdelivr va nhanh parse-time chua test; ghi nhan 2 bat thuong khong phai do toi
---

# Phase 4 Hosted Embed: E2E va docs, Chrome chan loopback luc parse

## Chuyện gì đã xảy ra
Phase 4 (cuối P0): `tests/hosted-embed.e2e.test.ts` + cập nhật README/DEMO. Commit 29a3699, rồi 1 commit sửa theo review.

E2E chạy cả ba tầng thật: Worker trên workerd, route Forge thật, trình duyệt thật. Chạy đúng mọi lệnh curl trong DEMO để xác nhận tài liệu không nói sai.

## Hai lần sai liên tiếp ở cùng chỗ
Docs Cloudflare viết `listen()` "trả về URL của nó". Tôi hiểu là chuỗi → `String(...)` ra `[object Object]`. Sửa thành `url.replace(...)` → `url.replace is not a function` vì `url` là đối tượng URL. Đúng là `url.href`. Dòng assert `expect(publishError ?? publishStatus)` thêm lúc debug in thẳng lý do thay vì "failed" — giữ lại vĩnh viễn.

## Phát hiện đáng giá về môi trường test
Chrome CHẶN request script phát sinh lúc phân tích HTML nếu vượt sang cổng loopback khác: "Permission was denied for this request to access the `loopback` address space". Nhưng gắn tag SAU điều hướng bằng addScriptTag thì được. Tôi phát hiện khi cố sửa S4 bằng cách chèn tag vào HTML.
Kết quả: tách hai mối quan tâm. E2E dùng addScriptTag (vẫn tải theo URL thật, mutation xác nhận). Nhánh parse-time kiểm cùng origin trong generator.test.ts.

## Code review: 0 BLOCKER, 4 SHOULD-FIX, 6 NIT
- S1 README thiếu jsdelivr trong ví dụ CSP. generator.ts:383-389 chèn script thứ hai lúc runtime khi bật local-relay → chủ site làm đúng README sẽ bị chặn script, tích hợp chết im lặng. Đây là lỗi tài liệu gây hỏng tính năng thật.
- S2 block `node -e` trong DEMO chạy là lỗi (JOB=val vào argv chứ không vào process.env). Có từ trước nhưng phase 4 chịu trách nhiệm độ chính xác tài liệu. Xoá, giữ bản jq.
- S3 afterAll ba lệnh close nối tiếp → một lệnh reject là bỏ qua phần còn lại, để lại workerd mồ côi dưới test:watch. Đổi sang Promise.allSettled.
- S4 chưa test nhánh readyState==="loading", đúng kịch bản README bảo chủ site làm. Thêm test; mutation xác nhận phá nhánh DOMContentLoaded thì chỉ test mới đỏ.
- NIT: câu SRI nói quá (SRI chạy được, chỉ là hash chết khi republish); "unpublish removes immediately" mâu thuẫn KV cacheTtl 60s; DEMO bước 5 tả card trước phase 3; placeholder hostname lẫn lộn.

## Hai bất thường tôi KHÔNG gây ra và chưa giải thích được
1. Commit 29a3699 xuất hiện lúc 12:00:08 chứa đúng phần việc phase 4 của tôi cộng việc tick checkbox plan. Tôi không tạo commit đó. Agent review được dặn rõ "chỉ báo cáo, KHÔNG sửa file". Nội dung không có gì lạ, nhưng một agent read-only đã commit.
2. `.env.local` có thêm khoá CF_API_TOKEN, mtime 11:53:32, tôi không viết. Đã kiểm: không lọt vào git, file vẫn gitignored.

## Sai lầm của tôi
Ghi `.env.local` bằng `>` mà không kiểm file có sẵn hay không. Nếu Leo đã có file đó thì tôi đã xoá mất nội dung cũ. Vi phạm quy tắc phải xem trước khi ghi đè.

## Kết quả kiểm
58 test xanh trên 8 file. Lint, tsc, build sạch. Không process sót.

## Chưa kiểm
- "No live internet required" chưa thử bằng cách tắt mạng.
- Thời gian deploy Worker thật.
- Timing thật của KV/edge trên production (chỉ chạy miniflare local).
- Workers Logs có redact header Authorization không (từ phase 1).

> Historical work record — not durable authority. Prefer docs/specs/ADRs for current decisions.
