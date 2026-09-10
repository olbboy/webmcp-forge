---
title: "Phase 4: Docs, E2E, scripts"
status: todo
priority: P1
effort: "4h"
dependencies: [3]
---

# Phase 4: Docs, E2E, scripts

## Overview

E2E xuyên suốt: Forge generate → Worker (harness) phục vụ → Playwright nạp script từ URL hosted vào fixture shop → `getTools()`. Cập nhật README / DEMO / `cdn/README.md`. Kiểm hồi quy toàn bộ.

## Requirements

- [ ] Functional: E2E dùng script tag `src` thật (không inject content) từ URL harness; unpublish → 404; docs mô tả Hosted vs Self-host, CSP, SRI, beta hostname, độ trễ.
- [ ] Non-functional: E2E không cần internet; tổng `npm test` chạy trong giới hạn `testTimeout` 90 s/case hiện có; không để process harness sống sót sau test.

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

- [ ] `tests/hosted-embed.e2e.test.ts` xanh
- [ ] `npm test` toàn bộ xanh, không process sót
- [ ] README / DEMO / cdn/README cập nhật và lệnh đã chạy thử
- [ ] lint + build

## Success Criteria

- [ ] `npm test` exit 0; số test = 6 cũ + mới.
- [ ] E2E chứng minh: URL hosted chứa `pub_`, không chứa `job_`; tools đăng ký từ script tag `src`; unpublish → 404.
- [ ] README mô tả đúng 2 lựa chọn và hạn chế beta; DEMO curl chạy được.

## Risk Assessment

- **Harness chọn port ngẫu nhiên xung đột với fixture server.** Cả hai dùng port do OS cấp; xác suất thấp. Tín hiệu: EADDRINUSE. Phản ứng: retry `listen()` một lần.
- **Playwright chặn script từ `http://127.0.0.1:<port>` khác origin fixture.** Không có CSP trên fixture nên cho phép. Tín hiệu: console error CSP. Phản ứng: kiểm `public/fixture-shop/index.html` không có meta CSP.
- **Harness giữ event loop → vitest không thoát.** Tín hiệu: `npm test` treo sau khi xanh. Phản ứng: đảm bảo `close()` trong `afterAll`; nếu vẫn treo, thêm `--pool=forks` hoặc `teardownTimeout`.
