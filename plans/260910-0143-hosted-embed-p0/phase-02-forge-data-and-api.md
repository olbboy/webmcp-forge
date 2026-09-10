---
title: "Phase 2: Forge data, client CDN, API"
status: todo
priority: P1
effort: "5h"
dependencies: [1]
---

# Phase 2: Forge data, client CDN, API

## Overview

Thêm `publicId`, `version`, trạng thái publish vào job; client `src/lib/cdn.ts` gọi Worker; `POST generate` publish best-effort; thêm `POST publish` (retry) và `POST unpublish`. `generateJobBundle` giữ thuần.

## Requirements

- [ ] Functional: generate luôn `status: generated`; publish best-effort với 4 trạng thái; retry không tái sinh; unpublish xoá CDN; response generate trả `publicId`, `hostedEmbedUrl`, `publishStatus`, `publishedVersion`, `version`.
- [ ] Non-functional: `jobId` không bao giờ đi qua Worker; `publicId` không bao giờ được chấp nhận làm khoá admin; đường tái sinh lười không publish, không tăng version.

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

- [ ] types + generator + sửa test generator
- [ ] jobs.ts: publicId, generateAndPublish, republish, unpublish
- [ ] cdn.ts + cdn-client.test.ts
- [ ] 3 route + api.test.ts mở rộng

## Success Criteria

- [ ] `npm test` xanh, gồm 5 case (a)–(e) và test client.
- [ ] `grep -r "job_" src/lib/cdn.ts` không có kết quả; URL hosted chỉ chứa `publicId`.
- [ ] Không có `console.log` token; `publishError` không chứa header.

## Risk Assessment

- **Stub `fetch` toàn cục làm hỏng Playwright trong cùng file test.** Tín hiệu: scan fail trong api.test. Phản ứng: stub chỉ trong `it` và `vi.unstubAllGlobals()` ở `afterEach`; hoặc tách case publish sang file riêng dùng job fixture ghi thẳng qua `saveJob`.
- **Lưu job hai lần gây race khi generate liên tiếp.** Tín hiệu: `version` lùi. Phản ứng: single-flight theo `jobId` trong `generateAndPublish` (cùng Map pattern như cdn.ts).
- **Env đọc lúc build thay vì runtime.** Tín hiệu: `skipped` dù đã set env. Phản ứng: đọc `process.env` trong hàm, route `dynamic = "force-dynamic"` như hiện có.
