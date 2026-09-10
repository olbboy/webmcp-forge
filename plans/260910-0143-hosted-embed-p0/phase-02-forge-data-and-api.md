---
title: "Phase 2: Forge data, client CDN, API"
status: completed
priority: P1
effort: "5h"
dependencies: [1]
---

# Phase 2: Forge data, client CDN, API

## Overview

Thêm `publicId`, `version`, trạng thái publish vào job; client `src/lib/cdn.ts` gọi Worker; `POST generate` publish best-effort; thêm `POST publish` (retry) và `POST unpublish`. `generateJobBundle` giữ thuần.

## Requirements

- [x] Functional: generate luôn `status: generated`; publish best-effort với 4 trạng thái; retry không tái sinh; unpublish xoá CDN; response generate trả `publicId`, `hostedEmbedUrl`, `publishStatus`, `publishedVersion`, `version`.
- [x] Non-functional: `jobId` không bao giờ đi qua Worker; `publicId` không bao giờ được chấp nhận làm khoá admin; đường tái sinh lười không publish, không tăng version.

## Architecture

```
POST /api/jobs/:id/generate
  └─ generateAndPublish(id, selected, includeLocalRelay)
       ├─ job.version = (job.version ?? 0) + 1          // luôn tăng, trước khi sinh file
       ├─ generateJobBundle(id, selected, relay, job.version)   // thuần: manifest.version = String(version)
       ├─ if !isCdnConfigured(): publishStatus = "skipped"; return
       ├─ job.publicId ??= newPublicId()
       └─ try publishEmbed({...}) → published, publishedVersion = version, hostedEmbedUrl
          catch → failed, publishError = message  (status vẫn "generated")
POST /api/jobs/:id/publish   → đọc artifact sẵn (readArtifact); thiếu → 409; gửi lại job.version
POST /api/jobs/:id/unpublish → unpublishEmbed(publicId) → publishStatus = "unpublished"
GET  /api/jobs/:id/embed.js  → không đổi; lazy path dùng job.version ?? 1, không bump, không publish
```

**Contract fixed by phase 1 (do not re-derive):**
- Every Worker response body is JSON `{ error }` on failure. 503 means KV was
  unavailable and the publish should be recorded as `failed`, not retried
  immediately.
- 409 means a newer version is already stored. Treat it as success-by-supersede:
  leave the newer state alone, do not downgrade `publishStatus`.
- The Worker's 409 guard is defeatable inside a 60-second KV cache window, so
  Forge must **abandon a pending retry once a newer generate starts** for the
  same `publicId`. Single-flight alone is not enough; a queued retry has to be
  dropped, not merely serialized behind the new publish.

`src/lib/cdn.ts`:
- `isCdnConfigured()` = có cả `CDN_BASE_URL` và `CDN_PUBLISH_TOKEN`.
- `hostedUrls(publicId)` → `{ embed, manifest }` = `${base}/e/${publicId}/embed.js|manifest.json` (base bỏ dấu `/` cuối).
- `publishEmbed({ publicId, embedJs, manifestJson, version, jobOrigin })` → `PUT ${base}/e/${publicId}` với `Authorization: Bearer`, timeout 10 s (`AbortSignal.timeout`); non-2xx → throw `Error("CDN publish failed: <status> <text ≤ 200 ký tự>")`.
- `unpublishEmbed(publicId)` → DELETE; 204/404 đều coi thành công.
- Single-flight: `Map<publicId, Promise>`; gọi trùng khi đang bay thì chờ promise cũ (tránh vượt 1 write/s/key của KV).
- Không log token; lỗi trả về không chứa header.

## Related Code Files

- Modify: `src/lib/types.ts` (ScanJob thêm `version?: number; publicId?: string; publishStatus?: "skipped"|"published"|"failed"|"unpublished"; publishedVersion?: number; publishedAt?: string; publishError?: string; hostedEmbedUrl?: string; hostedManifestUrl?: string`)
- Modify: `src/lib/generator.ts` (`buildManifest(job, tools, includeLocalRelay, version: number)`; bỏ hardcode `"1.0.0"`)
- Modify: `src/lib/jobs.ts` (`newPublicId()`; `generateJobBundle` nhận `version`; thêm `generateAndPublish`, `republish`, `unpublish`; lazy path truyền `job.version ?? 1`)
- Create: `src/lib/cdn.ts`
- Modify: `src/app/api/jobs/[id]/generate/route.ts` (gọi `generateAndPublish`; mở rộng response)
- Create: `src/app/api/jobs/[id]/publish/route.ts`
- Create: `src/app/api/jobs/[id]/unpublish/route.ts`
- Modify: `tests/generator.test.ts` (truyền version vào `buildManifest`)
- Modify: `tests/api.test.ts` (thêm case; mock `fetch` bằng `vi.stubGlobal`)
- Create: `tests/cdn-client.test.ts`

## Implementation Steps

1. `types.ts` + `generator.ts`: thêm tham số `version`; sửa test generator hiện có cho khớp chữ ký.
2. `jobs.ts`: `newPublicId()` = `pub_` + `crypto.randomUUID()` ×2 bỏ dấu gạch (32 hex). `generateJobBundle` giữ nguyên hành vi, chỉ nhận thêm `version`. Viết `generateAndPublish` theo sơ đồ; lưu job **hai lần**: sau khi sinh file (đã bump version) và sau khi publish xong, để CDN lỗi không mất version.
3. `cdn.ts` theo mô tả kiến trúc. Đọc env mỗi lần gọi (không cache module-level) để test stub env được.
4. Routes: generate gọi `generateAndPublish`; `publish`/`unpublish` copy khung try/catch của generate; 404 khi job thiếu, 409 khi chưa generate hoặc chưa cấu hình CDN.
5. Tests:
   - `cdn-client.test.ts`: env trống → `isCdnConfigured()` false, `publishEmbed` throw "not configured"; env có → gọi `fetch` đúng URL/method/header Authorization (chỉ kiểm tra tồn tại, không in giá trị); non-2xx → throw kèm status; single-flight: 2 lời gọi song song → 1 fetch.
   - `api.test.ts`: (a) CDN không cấu hình → `publishStatus: skipped`, không có `publicId`; (b) stub env + fetch 200 → `published`, `publicId` khớp `/^pub_[a-f0-9]{32}$/`, `version` 1, `hostedEmbedUrl` chứa `publicId` và không chứa `job_`; generate lần 2 → `version` 2, cùng `publicId`; (c) fetch throw → `status: generated`, `publishStatus: failed`, `publishError` có, `version` vẫn tăng; sau đó `POST publish` với fetch 200 → `published`, `publishedVersion === version`; (d) `POST unpublish` → fetch DELETE, `publishStatus: unpublished`; (e) GET `embed.js` sau khi xoá artifact trên đĩa → tái sinh, `version` không đổi, `fetch` không được gọi.

## Todo

- [x] types + generator + sửa test generator
- [x] jobs.ts: publicId, generateAndPublish, republish, unpublish
- [x] cdn.ts + cdn-client.test.ts
- [x] 3 route + api.test.ts mở rộng

## Success Criteria

- [x] `npm test` xanh, gồm 5 case (a)–(e) và test client.
- [x] `grep -r "job_" src/lib/cdn.ts` không có kết quả; URL hosted chỉ chứa `publicId`.
- [x] Không có `console.log` token; `publishError` không chứa header.

## As built (sai lệch so với plan, sau code review)

Rủi ro "lưu job hai lần gây race" mà plan đã kê ĐÃ xảy ra thật. Reviewer chứng minh bằng `Promise.all([generate, generate])`: hai run mint hai `publicId`, đẩy hai bundle khác nội dung cùng mang version 1, và một bản nằm sống trên CDN mà job không còn nhớ id nên `unpublish` không bao giờ gỡ được. Mitigation trong plan (single-flight theo `jobId`) giờ đã implement.

Thêm so với plan:
- **`src/lib/key-queue.ts`** (mới): `createKeyQueue()` serialize theo khoá. Hai nơi dùng: `jobs.ts` khoá theo `jobId` (job store là file JSON không khoá), `cdn.ts` khoá theo `publicId` (KV chỉ nhận 1 ghi/giây/khoá). Trước đó logic này chỉ nằm trong `cdn.ts`.
- **`publicId` được persist TRƯỚC khi gọi CDN**, không phải sau. Một publish hỏng giữa chừng vẫn có thể đã tạo record; id mà job quên là một embed không ai gỡ được.
- **Nhánh `superseded` giờ ghi trạng thái `published`** kèm hosted URL nếu chưa run nào ghi. Trước đó nó chỉ `getJob` rồi trả về, nên khi Worker trả 409 mà không có run nội bộ nào mới hơn, job kẹt ở `failed` với `publishError` cũ trong khi CDN đang giữ bundle mới hơn.
- **`newestRequested` giữ suốt vòng đời process**, tách khỏi hàng đợi tự dọn. Route retry có 3 lần `await` (đọc job + 2 artifact) trước khi tới `publishEmbed`; nếu quên mốc version trong khoảng đó thì một retry cũ lọt qua và revert bundle. Đổi lại một số nguyên cho mỗi publicId đã publish.
- **`generatedAt` trở thành tham số của `buildManifest`.** Đường tái sinh lười dùng lại `job.generatedAt` nên rebuild ra đúng byte cũ. Trước đó rebuild lệch timestamp mà vẫn khai cùng version, trong khi Worker dùng chính số đó làm ETag.
- **`JobError` + `src/lib/job-error-response.ts`** (mới) thay `errorStatus`. Lỗi không phải `JobError` giờ trả 500 kèm message chung và log ở server; trước đó một lỗi filesystem trả nguyên đường dẫn tuyệt đối cho client kèm status 400.
- **Đường tái sinh lười không còn `saveJob`.** `buildBundle` tách khỏi `generateJobBundle`, nên một GET download không còn đổi `status`, `generatedAt`, `updatedAt` của job.

Test: 33 case cho phase 2 (13 client + 14 route + 6 gốc đã sửa). Mutation test tự chạy lại 5 hành vi, tất cả đều bị bắt: bỏ re-check trong hàng đợi · lazy path bỏ qua selection đã lưu · `superseded` trả job nguyên trạng · bỏ serialize theo jobId (11 test đỏ) · lazy rebuild dùng timestamp mới.

Ghi nhận, không sửa (quyết định phase 0): `POST publish`/`unpublish` không có auth. Mô hình tin cậy là "jobId = capability". Kẻ tấn công cần biết jobId mới dựng được request, mà biết rồi thì POST thẳng từ server của họ cũng được, nên CSRF không thêm khả năng gì. Blast radius có tăng: trước là ghi file local, giờ là mutate CDN đang chạy.

## Risk Assessment

- **Stub `fetch` toàn cục làm hỏng Playwright trong cùng file test.** Tín hiệu: scan fail trong api.test. Phản ứng: stub chỉ trong `it` và `vi.unstubAllGlobals()` ở `afterEach`; hoặc tách case publish sang file riêng dùng job fixture ghi thẳng qua `saveJob`.
- **Lưu job hai lần gây race khi generate liên tiếp.** Tín hiệu: `version` lùi. Phản ứng: single-flight theo `jobId` trong `generateAndPublish` (cùng Map pattern như cdn.ts).
- **Env đọc lúc build thay vì runtime.** Tín hiệu: `skipped` dù đã set env. Phản ứng: đọc `process.env` trong hàm, route `dynamic = "force-dynamic"` như hiện có.
