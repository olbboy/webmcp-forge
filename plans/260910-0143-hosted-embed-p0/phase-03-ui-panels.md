---
title: "Phase 3: UI hosted / self-host panels"
status: todo
priority: P1
effort: "3h"
dependencies: [2]
---

# Phase 3: UI hosted / self-host panels

## Overview

Thay card "Embed on your site" hiện tại (snippet giả trỏ về origin Forge) bằng hai panel ngang hàng: **Hosted (beta, khuyên dùng)** và **Self-host**, kèm trạng thái publish, nút Publish lại / Unpublish, cảnh báo link admin.

## Requirements

- [ ] Functional: panel Hosted chỉ hiện khi `cdnConfigured || job.publishStatus === "published"`; snippet `<script src="${hostedEmbedUrl}"></script>` (không `?v=`); link Test = `hostedEmbedUrl?v=${publishedVersion}`; badge trạng thái; nút Publish lại (khi `failed`/`unpublished`), Unpublish (khi `published`); panel Self-host giữ 2 nút download tới `/api/jobs/${jobId}/…`.
- [ ] Non-functional: `jobId` không xuất hiện trong bất kỳ text nào của panel Hosted; copy tiếng Anh + 1 dòng gợi ý tiếng Việt như pattern hiện có; không thêm dependency UI.

## Architecture

- `src/app/jobs/[id]/page.tsx` (server) đọc `isCdnConfigured()` và truyền prop `cdnConfigured: boolean` vào `JobCatalog`. Client không đọc env.
- `JobCatalog` giữ state `publishInfo` = `{ publicId, publishStatus, publishedVersion, hostedEmbedUrl, hostedManifestUrl, publishError }` khởi tạo từ `job`, cập nhật từ response của generate / publish / unpublish.
- Hai panel là hai `Card` trong một grid `sm:grid-cols-2`; trên mobile xếp dọc.

Text bắt buộc trên panel Hosted:
- Badge `beta` + câu "Hostname may change before GA; you will need to update the tag."
- "New versions and unpublish reach visitors within ~6 minutes (edge + browser cache)."
- "This file is public: anyone with the link can download it."
- "Your admin link is this page (`/jobs/…`). Do not share it."

## Related Code Files

- Modify: `src/app/jobs/[id]/page.tsx` (prop `cdnConfigured`)
- Modify: `src/components/job-catalog.tsx` (bỏ `embedUrl`/`snippet` giả ở dòng 31–34; thêm 2 panel; 2 hàm `republish()`, `unpublish()` theo khung `generate()`)
- Modify: `src/lib/types.ts` chỉ nếu cần type response chung (ưu tiên tái dùng `ScanJob` partial)

## Implementation Steps

1. `page.tsx`: import `isCdnConfigured` từ `@/lib/cdn`; truyền prop.
2. `job-catalog.tsx`: xoá snippet giả; thêm state `publishInfo`; `generate()` set `publishInfo` từ response.
3. Panel Hosted: snippet + Copy + Test (mở tab mới) + badge + 4 câu text + nút theo trạng thái + hiển thị `publishError` khi `failed`.
4. Panel Self-host: 2 nút download hiện có + đoạn "CSP / SRI / offline" ngắn; giữ snippet local-relay tuỳ chọn.
5. Khi `cdnConfigured` false và chưa từng publish: chỉ hiện panel Self-host, full width.
6. Chạy `npm run lint` và `npm run build`; xem trang job với demo shop có/không env CDN.

## Todo

- [ ] page.tsx prop
- [ ] Bỏ snippet giả, thêm state publishInfo
- [ ] Panel Hosted + Self-host
- [ ] lint + build + kiểm tay 2 trạng thái env

## Success Criteria

- [ ] Không còn chuỗi `/api/jobs/${job.id}/embed.js` trong bất kỳ snippet copy nào; chỉ còn trong link download.
- [ ] Với env CDN + Worker local: sau generate, panel Hosted hiện snippet `pub_…`, badge `published`, nút Unpublish; bấm Unpublish → badge `unpublished`, nút Publish lại.
- [ ] Không env: chỉ panel Self-host.
- [ ] `npm run lint` và `npm run build` sạch.

## Risk Assessment

- **Clipboard API bị chặn trên http không phải localhost.** Đã tồn tại với nút Copy hiện tại; giữ nguyên hành vi, hiển thị snippet trong `<pre>` để chọn tay.
- **Trạng thái UI lệch với server sau reload.** Tín hiệu: badge sai sau F5. Phản ứng: state khởi tạo từ `job` server-render (đã có `force-dynamic`), không cache client.
