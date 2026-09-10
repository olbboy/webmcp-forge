---
title: "Phase 1 Hosted Embed: Worker CDN chay duoc, review bac bo mot finding"
date: 2026-09-10
summary: "Worker cdn/ va 23 test qua createTestHarness; ap 4/5 SHOULD-FIX, bac bo yeu cau content-length bang bang chung"
---

# Phase 1 Hosted Embed: Worker CDN chay duoc, review bac bo mot finding

## Chuyện gì đã xảy ra
- Implement phase 1: `cdn/src/{index,auth,kv}.ts`, `cdn/wrangler.jsonc`, `tests/cdn-worker.test.ts`, `.env.example`, scripts `cdn:dev`/`cdn:deploy`. Commit 59a2d1c.
- Hai rủi ro trong plan bị loại bằng thực nghiệm: `createTestHarness` CÓ trong wrangler 4.130.0, và config inline CÓ nhận `vars` (không cần `.dev.vars` hay spawn `wrangler dev`).
- Chọn type shim hẹp viết tay thay vì `@cloudflare/workers-types`: gói đó xung đột lib DOM nên sẽ kéo theo tsconfig thứ hai + exclude + lệnh typecheck riêng. ~10 dòng interface giữ cả repo trong một TS program. Lệnh compile production typecheck luôn `cdn/` và `tests/`.

## Code review: 0 BLOCKER, 5 SHOULD-FIX, 9 NIT
Áp dụng:
- S1 test auth là phantom test — reviewer chứng minh bằng mutation (bỏ so sánh nội dung token vẫn pass 15/15). Thêm case token sai CÙNG ĐỘ DÀI. Tự chạy lại mutation: giờ đúng 1 test fail.
- S2 KV throw thì workerd trả trang HTML mặc định, phá contract JSON của client phase 2. Bọc try/catch, trả 503 JSON.
- S3 weak ETag. Tự mở docs Cloudflare xác nhận: có chuyển strong sang weak khi nén lại. Không xử lý thì 304 không bao giờ khớp.
- S4 sửa README: cửa sổ hở của version guard là từ 60s trở lên (KV cache read), không phải "badly delayed". Ghi ràng buộc vào phase 2: phải HỦY retry cũ khi generate mới bắt đầu, single-flight không đủ.
- N1 HEAD, N2 shape guard record KV, N4 CORS trên response lỗi, N5 `harness?.close()`, N7 `.dev.vars*`, N8 khôi phục ký tự mũi tên trong package.json.

Bác bỏ, có bằng chứng:
- S5 "bắt buộc content-length, trả 411": làm hỏng 11/23 test vì `harness.fetch` gửi body chuỗi KHÔNG kèm content-length. Không khẳng định được client production luôn gửi, nên giữ content-length làm fast path và đo byte thật làm kiểm tra chính thức. Nhánh đo thật giờ có test riêng (stream 3 MB, kỳ vọng 413), tức vá luôn test gap reviewer nêu.
- N3 version quá lớn khoá record: hồi phục được bằng unpublish (đã có ở P0). Không thêm cap.
- N6 Bearer case-sensitive: chỉ Forge gọi. N9 double encode: không đáng kể.

## Kết quả kiểm
29 test xanh (6 cũ + 23 mới). Lint sạch. Compile production và typecheck sạch. `npm run cdn:dev` phục vụ /health 200, id lạ 404, PUT không token 401. Không process workerd sót.

## Bước tiếp
- Phase 2: Forge data model, `src/lib/cdn.ts`, 3 route.
- Ops Leo: `wrangler login`, tạo KV namespace, `wrangler secret put PUBLISH_TOKEN`, deploy, set `CDN_BASE_URL` và `CDN_PUBLISH_TOKEN`.

## Chưa kiểm
- Workers Logs có redact header `Authorization` không, docs không nói. Nếu không, PUBLISH_TOKEN nằm trong log Cloudflare. Đã ghi thành "Open question before production" trong `cdn/README.md`; phải chốt trước khi deploy prod, hoặc tắt observability.
- Phiên bản wrangler tối thiểu có `createTestHarness`.

> Historical work record — not durable authority. Prefer docs/specs/ADRs for current decisions.
