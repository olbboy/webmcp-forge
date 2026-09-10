---
title: "Phase 1: Worker cdn/ + test harness"
status: completed
priority: P1
effort: "4h"
dependencies: []
---

# Phase 1: Worker `cdn/` + test harness

## Overview

Worker Cloudflare phục vụ `embed.js` / `manifest.json` từ KV, nhận PUT/DELETE bằng Bearer token; test chạy từ vitest gốc qua `createTestHarness`. Phase này độc lập, có thể merge riêng (PR1).

## Requirements

- [x] Functional: 5 route ở bảng dưới, header cache/ETag/CORS/nosniff, 404 khi thiếu, 401 sai token, 409 version lùi, 413 body quá cỡ.
- [x] Non-functional: không có `cdn/package.json`; wrangler ở root; `.wrangler/`, `.dev.vars` ignore; `.env.example` commit được.

## Architecture

| Method | Path | Auth | Hành vi |
|---|---|---|---|
| GET | `/e/:publicId/embed.js` | không | 200 JS + header chuẩn; 404 nếu thiếu; `If-None-Match` khớp ETag → 304 |
| GET | `/e/:publicId/manifest.json` | không | 200 JSON, cùng header |
| PUT | `/e/:publicId` | Bearer | body JSON `{ embedJs, manifestJson, version, jobOrigin? }`; 409 nếu `version < stored.version`; bằng → ghi đè (retry idempotent); 413 nếu body > 2 MB; 200 `{ publicId, version }` |
| DELETE | `/e/:publicId` | Bearer | xoá key; 204 kể cả khi không tồn tại |
| GET | `/health` | không | 200 `ok` |

- `publicId` hợp lệ: `/^pub_[a-f0-9]{32}$/`; sai định dạng → 404 (không lộ lý do).
- KV binding `EMBEDS`; đọc với `{ cacheTtl: 60 }`.
- Auth: so token bằng `crypto.subtle.timingSafeEqual` trên hai `Uint8Array` cùng độ dài (khác độ dài → 401 luôn).
- Secret `PUBLISH_TOKEN` (wrangler secret / `.dev.vars` local / `vars` inline trong test).

## Related Code Files

- Create: `cdn/wrangler.jsonc` (name `webmcp-forge-cdn`, `main: "src/index.ts"`, `compatibility_date`, `workers_dev: true`, `kv_namespaces: [{ binding: "EMBEDS", id: "<điền sau khi tạo>" }]`, `observability.enabled: true`)
- Create: `cdn/src/index.ts` (router theo `URL.pathname` + method; không dùng framework)
- Create: `cdn/src/auth.ts` (`isAuthorized(request, env)`)
- Create: `cdn/src/kv.ts` (`getRecord`, `putRecord`, `deleteRecord`, type `CdnRecord`)
- Create: `cdn/README.md` (deploy, secrets, `wrangler dev`, tạo KV namespace)
- Create: `.env.example` (`CDN_BASE_URL=`, `CDN_PUBLISH_TOKEN=`)
- Create: `tests/cdn-worker.test.ts`
- Modify: `.gitignore` (thêm `!.env.example` ngay sau `.env*`; thêm `.wrangler/`, `.dev.vars`)
- Modify: `package.json` (devDependency `wrangler@^4.130.0`; scripts `cdn:dev`, `cdn:deploy`)

## Implementation Steps

1. Thêm `wrangler` devDependency; `npm install`. Kiểm `import { createTestHarness } from "wrangler"` resolve được; nếu không, nâng phiên bản và ghi vào README.
2. Viết `cdn/wrangler.jsonc`, `cdn/src/kv.ts`, `cdn/src/auth.ts`, `cdn/src/index.ts`. Mỗi handler trả `Response` sớm; không giữ state module-level ngoài hằng số.
3. Header GET dùng một helper `publicHeaders(contentType, version)` để hai route dùng chung.
4. `tests/cdn-worker.test.ts`: `beforeAll` tạo harness với config inline (`main: "cdn/src/index.ts"`, `kv_namespaces: [{ binding: "EMBEDS", id: "test" }]`, `vars: { PUBLISH_TOKEN: "test-token" }`), `listen()`; `afterAll` `close()`. Các case: GET 404 · PUT không token 401 · PUT sai token 401 · PUT + GET body/ETag/Cache-Control · GET `If-None-Match` → 304 · PUT version thấp hơn → 409 · PUT bằng → 200 · body 3 MB → 413 · DELETE → 204 rồi GET 404 · `/health` 200.
5. `.gitignore`, `.env.example`, scripts root: `"cdn:dev": "wrangler dev -c cdn/wrangler.jsonc"`, `"cdn:deploy": "wrangler deploy -c cdn/wrangler.jsonc"`.
6. `cdn/README.md`: 5 bước ops như `plan.md` + cách chạy local.

## Todo

- [x] wrangler devDependency + scripts root
- [x] `cdn/wrangler.jsonc`, `src/index.ts`, `src/auth.ts`, `src/kv.ts`
- [x] `tests/cdn-worker.test.ts` xanh
- [x] `.gitignore`, `.env.example`, `cdn/README.md`

## Success Criteria

- [x] `npx vitest run tests/cdn-worker.test.ts` xanh, ≥ 10 case ở bước 4.
- [x] `npm test` vẫn xanh 6 test cũ.
- [x] `git status` thấy `.env.example`; không thấy `.wrangler/`.
- [x] `npm run cdn:dev` phục vụ `/health` ở local.

## As built (sai lệch so với bản plan, sau code review)

Rủi ro R1 và R2 đều không xảy ra: `createTestHarness` có trong wrangler 4.130.0 và config inline nhận `vars`, nên không cần fallback `.dev.vars` hay spawn `wrangler dev`.

Thêm so với plan (đều từ finding của code review, có bằng chứng):
- **HEAD** được chấp nhận ở mọi route trả GET. Uptime monitor mặc định dùng HEAD; trả 405 sẽ báo Worker chết.
- **503 JSON** khi KV throw (`route()` bọc trong try/catch). Free tier chặn ở 1.000 write/ngày, khi vượt KV throw và workerd sẽ trả trang HTML mặc định — phá contract JSON mà client phase 2 dựa vào.
- **Chấp nhận weak ETag** (`W/"n"`) khi so `If-None-Match`. Docs Cloudflare: "In some situations Cloudflare will convert strong ETags to weak ETags" khi nén lại. Không xử lý thì 304 không bao giờ khớp và mỗi lần revalidate lại tải nguyên bundle.
- **CORS + nosniff trên cả response lỗi**, để caller đọc được status thay vì thấy network error.
- **Guard shape cho record KV**: JSON hợp lệ nhưng sai shape trước đây cho ra 200 với body rỗng và cache 5 phút.
- Test: 23 case thay vì ≥10, gồm case token sai **cùng độ dài**. Mutation test xác nhận: bỏ so sánh nội dung token thì chỉ đúng case này fail, các case còn lại vẫn xanh.

Bác bỏ một finding, có bằng chứng: đề xuất **bắt buộc `content-length`** (411) làm hỏng 11/23 test vì `harness.fetch` gửi body chuỗi **không** kèm header đó. Không thể khẳng định client production luôn gửi, nên giữ `content-length` làm fast path và đo kích thước thật làm kiểm tra chính thức. Nhánh đo thật giờ có test riêng (body streamed 3 MB → 413).

Chưa kiểm được: Workers Logs có redact header `Authorization` hay không — docs không nói. Đã ghi thành mục "Open question before production" trong `cdn/README.md`.

## Risk Assessment

- **`createTestHarness` chưa có ở phiên bản wrangler cài được.** Tín hiệu: import undefined. Phản ứng: nâng wrangler; nếu vẫn không, fallback spawn `wrangler dev --port 43128` trong `beforeAll` và kill ở `afterAll` (port cố định, theo quy tắc process-management).
- **Config inline không nhận `vars`.** Tín hiệu: 401 ở mọi test PUT. Phản ứng: dùng `cdn/.dev.vars` với token test và `configPath`.
- **Miniflare KV `cacheTtl` không mô phỏng độ trễ.** Chấp nhận: test khẳng định hành vi logic, không khẳng định độ trễ.
