---
title: "Phase 4: Docs, E2E, scripts"
status: completed
priority: P1
effort: "4h"
dependencies: [3]
---

# Phase 4: Docs, E2E, scripts

## Overview

E2E xuyên suốt: Forge generate → Worker (harness) phục vụ → Playwright nạp script từ URL hosted vào fixture shop → `getTools()`. Cập nhật README / DEMO / `cdn/README.md`. Kiểm hồi quy toàn bộ.

## Requirements

- [x] Functional: E2E dùng script tag `src` thật (không inject content) từ URL harness; unpublish → 404; docs mô tả Hosted vs Self-host, CSP, SRI, beta hostname, độ trễ.
- [x] Non-functional: E2E không cần internet; tổng `npm test` chạy trong giới hạn `testTimeout` 90 s/case hiện có; không để process harness sống sót sau test.

## Architecture

`tests/hosted-embed.e2e.test.ts`:
1. `beforeAll`: harness Worker (config inline như phase 1, token `test-token`); `listen()` → `cdnUrl`; `process.env.CDN_BASE_URL = cdnUrl`, `CDN_PUBLISH_TOKEN = "test-token"`; fixture server từ `tests/helpers.ts`.
2. Gọi route handler `scanPost` → `generatePost` (pattern `tests/api.test.ts`); đọc `hostedEmbedUrl`.
3. `fetch(hostedEmbedUrl)` → 200, `content-type` JS, `ETag: "1"`.
4. Playwright: `page.goto(fixture)`, `page.addScriptTag({ url: hostedEmbedUrl })`, chờ `__WEBMCP_FORGE_READY__`, `getTools()` chứa `get_page_info`, `list_products` (tái dùng assertion của `tests/generator.test.ts`).
5. `unpublishPost` → `fetch(hostedEmbedUrl)` → 404.
6. `afterAll`: `page.close()`, `closeBrowser()`, `fixture.close()`, `harness.close()`, xoá env.

Lưu ý: trong bước 2 Forge gọi `fetch` thật tới harness (không stub) — đây là điểm khác với phase 2.

## Related Code Files

- Create: `tests/hosted-embed.e2e.test.ts`
- Modify: `README.md` (mục "How a site owner uses it": bước 5 thành 2 lựa chọn; mục API thêm `publish`, `unpublish`; mục Tests nhắc harness; mục mới "Hosted CDN (beta)" với CSP `script-src https://<worker>.workers.dev`, SRI chỉ cho self-host, độ trễ ~6 phút, cảnh báo link admin)
- Modify: `DEMO.md` (curl: generate trả `hostedEmbedUrl`; curl `publish`, `unpublish`; ghi chú cần env)
- Modify: `cdn/README.md` (bổ sung sau khi phase 1–3 ổn định; link từ README gốc)
- Modify: `package.json` chỉ nếu cần script `test:e2e` riêng (mặc định gộp trong `npm test`)

## Implementation Steps

1. Viết E2E theo kiến trúc; chạy riêng `npx vitest run tests/hosted-embed.e2e.test.ts`.
2. Chạy `npm test` toàn bộ; xác nhận 6 test cũ + test phase 1, 2, 4 xanh; `fileParallelism: false` đã có nên harness và Playwright không tranh nhau.
3. Sau test, `lsof -i -P | grep -i workerd` (hoặc `ps`) phải rỗng — không còn process harness.
4. Cập nhật README, DEMO, `cdn/README.md`; kiểm lại mọi lệnh curl trong DEMO bằng `npm run dev` + `npm run cdn:dev`.
5. `npm run lint`, `npm run build`.

## Todo

- [x] `tests/hosted-embed.e2e.test.ts` xanh
- [x] `npm test` toàn bộ xanh, không process sót
- [x] README / DEMO / cdn/README cập nhật và lệnh đã chạy thử
- [x] lint + build

## Success Criteria

- [x] `npm test` exit 0; số test = 6 cũ + mới.
- [x] E2E chứng minh: URL hosted chứa `pub_`, không chứa `job_`; tools đăng ký từ script tag `src`; unpublish → 404.
- [x] README mô tả đúng 2 lựa chọn và hạn chế beta; DEMO curl chạy được.

## As built (sai lệch so với plan, sau code review)

E2E xanh. Mọi lệnh curl trong DEMO đã chạy thật, output khớp mô tả.

Hai lần sai liên tiếp ở cùng chỗ: docs Cloudflare viết `listen()` "trả về URL của nó", tôi hiểu là chuỗi nên `String(...)` ra `[object Object]`; sửa thành `url.replace(...)` thì gặp `url.replace is not a function` vì `url` là **đối tượng URL**. Đúng là `url.href`. Dòng assert `expect(publishError ?? publishStatus)` tôi thêm lúc debug đã in thẳng lý do thay vì chỉ "failed", nên giữ lại.

Sửa theo code review:
- **README thiếu host jsdelivr trong ví dụ CSP.** `generator.ts:383-389` chèn thêm một `<script src>` lúc runtime khi bật local-relay. Chủ site làm đúng theo README sẽ bị chặn script và tích hợp Cursor/Claude Desktop chết im lặng. Đã thêm câu về `cdn.jsdelivr.net`, và ghi rõ embed không gọi mạng gì khác nên không cần `connect-src`.
- **Block `node -e` trong DEMO chạy là lỗi.** `node -e "script" JOB=val` đẩy `JOB=val` vào argv chứ không vào `process.env`, nên script đọc `undefined`. Bản jq ngay dưới đã làm đúng việc đó. Xoá hẳn block node (DRY), ghi rõ mục này cần `jq`.
- **`afterAll` không cô lập lỗi**: ba lệnh close nối tiếp, một lệnh reject là bỏ qua phần còn lại và để lại workerd mồ côi dưới `test:watch`. Đổi sang `Promise.allSettled`.
- **Chưa test nhánh `readyState === "loading"`** — đúng kịch bản README bảo chủ site làm (đặt tag trước `</body>`). Thêm case trong `tests/generator.test.ts`. Mutation xác nhận: phá nhánh `DOMContentLoaded` thì chỉ test mới đỏ, test cũ vẫn xanh.
- Câu SRI nói quá: SRI **chạy được** (Worker đã set CORS header). Vấn đề thật là hash chết mỗi lần republish tại cùng URL. Đổi "is not available" → "is impractical" kèm giải thích.
- Câu unpublish "removes immediately" mâu thuẫn với KV `cacheTtl: 60`. Đổi thành: record bị xoá ngay, nhưng edge đã đọc còn trả lời tới một phút.
- DEMO bước 5 còn tả card cũ trước phase 3. Placeholder hostname thống nhất `<account>` thay vì lẫn `example`.

**Phát hiện đáng ghi về môi trường test:** Chrome CHẶN request script phát sinh lúc phân tích HTML nếu nó vượt sang cổng loopback khác ("Permission was denied for this request to access the `loopback` address space"). Nên E2E phải gắn tag SAU điều hướng bằng `addScriptTag({url})` (vẫn tải theo URL thật, mutation đã xác nhận), còn nhánh parse-time kiểm cùng origin trong `generator.test.ts`. Hai test, hai mối quan tâm.

Chưa kiểm: "no live internet required" chưa thử bằng cách tắt mạng; thời gian deploy Worker thật; hành vi timing thật của KV/edge trên production (chỉ chạy miniflare local).

## Risk Assessment

- **Harness chọn port ngẫu nhiên xung đột với fixture server.** Cả hai dùng port do OS cấp; xác suất thấp. Tín hiệu: EADDRINUSE. Phản ứng: retry `listen()` một lần.
- **Playwright chặn script từ `http://127.0.0.1:<port>` khác origin fixture.** Không có CSP trên fixture nên cho phép. Tín hiệu: console error CSP. Phản ứng: kiểm `public/fixture-shop/index.html` không có meta CSP.
- **Harness giữ event loop → vitest không thoát.** Tín hiệu: `npm test` treo sau khi xanh. Phản ứng: đảm bảo `close()` trong `afterAll`; nếu vẫn treo, thêm `--pool=forks` hoặc `teardownTimeout`.
