---
type: plan-verify
date: 2026-09-10
target: plans/hosted-embed-p0-implement.md (commit 7215509)
verdict: ĐẠT CÓ ĐIỀU KIỆN — 4 lỗi chặn phải sửa trong plan trước khi cook
---

# Kiểm chứng plan Hosted Embed P0

## Đã kiểm (nguồn tự mở)
- 5 quyết định trong plan khớp brainstorm 260910-0119. Mục "Current gaps" khớp mã: `job-catalog.tsx:31-33`, `jobs.ts:6`, `generator.ts:46`, generate không auth.
- "6 tests hiện có" đúng: api 1 + generator 1 + scanner 1 + names 3.
- `crypto.subtle.timingSafeEqual` có trên Workers (docs Web Crypto, "non-standard extension").
- `@cloudflare/vitest-pool-workers@0.22.0` peer `vitest ^4.1.0`; repo dùng `vitest ^5.0.0` → không chạy chung runner gốc.
- `unstable_dev()` đã deprecated; Cloudflare khuyến nghị `createTestHarness()` từ `wrangler` cho "any Node.js test runner" (wrap Miniflare; `listen/fetch/close`; `configPath: "./wrangler.jsonc"`).
- `git check-ignore .env.example` → bị `.env*` bỏ qua (dòng 34 .gitignore).

## Lỗi chặn (sửa plan trước khi cook)

### B1. GET lười tái sinh sẽ vô tình publish
`src/lib/jobs.ts:96-113`: `getEmbedJs`/`getManifestJson` gọi `generateJobBundle` khi thiếu artifact. Nếu publish nằm trong `generateJobBundle` (WP3 ngụ ý), một GET download tự tạo `publicId`, tăng version và PUT lên CDN mà chủ site không bấm Generate.
**Sửa:** `generateJobBundle` giữ thuần (chỉ sinh file). Thêm `generateAndPublish(id, selected, includeLocalRelay)` trong `jobs.ts`, chỉ `POST …/generate` gọi. Đường lười không bao giờ publish.

### B2. Version mâu thuẫn và sai thứ tự
WP2: manifest dùng `job.publishedVersion ?? nextVersion` nhưng manifest được dựng **trước** khi publish → nhúng số cũ. WP2 nói "bump khi publish thành công", WP3 nói "bump rồi PUT".
**Sửa:** `job.version: number` tăng ở đầu mỗi generate (kể cả CDN lỗi). `manifest.version = String(job.version)`. PUT thành công → `publishedVersion = job.version`. `POST …/publish` (retry) gửi lại cùng `job.version`, không tăng. Worker PUT trả 409 nếu `body.version < stored.version` (chặn retry lạc thứ tự); bằng nhau thì cho ghi đè (retry idempotent).

### B3. Công cụ test như plan viết không chạy được
`vitest-pool-workers` cần vitest 4; root là vitest 5. `unstable_dev` deprecated.
**Sửa:** mọi test Worker + E2E chạy từ vitest gốc bằng `createTestHarness({ workers: [{ configPath: "cdn/wrangler.jsonc" }] })`. `wrangler` là devDependency ở root. `cdn/` chỉ còn `wrangler.jsonc`, `src/`, `README.md` — bỏ `cdn/package.json`, bỏ `test:all`; scripts root: `cdn:dev = wrangler dev -c cdn/wrangler.jsonc`, `cdn:deploy = wrangler deploy -c cdn/wrangler.jsonc`. Vẫn giữ quyết định 3 (thư mục `cdn/`). Dùng `wrangler.jsonc` thay `wrangler.toml` (ví dụ docs hiện dùng jsonc).

### B4. `.env.example` bị gitignore
Thêm `!.env.example` sau `.env*`; thêm `.wrangler/` (state local của wrangler).

## Thiếu / nên bổ sung (không chặn)
- **N1.** `job-catalog.tsx` là client component, không đọc được env. Chỉ định: `page.tsx` (server) truyền prop `cdnConfigured` và `cdnBaseUrl`; panel hiện khi `cdnConfigured || job.publishStatus === "published"`.
- **N2.** Worker PUT: giới hạn body (≤ 2 MB → 413); GET thêm `Access-Control-Allow-Origin: *` và `X-Content-Type-Options: nosniff`.
- **N3.** Acceptance #3 "Unpublish → GET 404": ghi rõ là GET qua harness/Worker trực tiếp; trên prod còn độ trễ KV 60s + cache 5 phút (đã nêu ở UI copy).
- **N4.** Retry `POST …/publish` không tái sinh artifact: đọc `readArtifact` sẵn có; nếu thiếu → 409 "generate first".
- **N5.** Ước lượng giờ chỉ có WP0. Ước lượng (chưa kiểm bằng thực tế): WP1 3h · WP2 2h · WP3 3h · WP4 3h · WP5 1h · WP6 4h ≈ 2 ngày.
- **N6.** File plan không theo cấu trúc `plans/<ts>-<slug>/plan.md + phase-NN-*.md` mà `/ak:cook` đọc. Cần chuyển WP → phase (WP0+WP1 → phase 1; WP2+WP3 → 2; WP4 → 3; WP5+WP6+WP7 → 4).
- **N7.** Repo chưa có `docs/`; plan chỉ sửa README/DEMO. Chấp nhận cho P0.

## Đúng, giữ nguyên
Kiến trúc push Forge→Worker; `publicId` 128-bit tách jobId, ổn định qua unpublish/republish; snippet không `?v=`; headers cache; best-effort publish với 4 trạng thái; PR split 3 bước; Out of scope.

## Chỗ trống cần điền
- [ ] B3: (a) dồn test về vitest gốc + `createTestHarness`, bỏ `cdn/package.json` (khuyến nghị) · (b) giữ `cdn/package.json` riêng với vitest 4 + pool-workers
- [ ] N6: (a) tôi chuyển plan sang cấu trúc phase để `/ak:cook` chạy · (b) giữ file hiện tại, cook thủ công
- [ ] B2 chi tiết: (a) tăng version mỗi generate kể cả khi CDN lỗi (khuyến nghị) · (b) chỉ tăng khi publish thành công
