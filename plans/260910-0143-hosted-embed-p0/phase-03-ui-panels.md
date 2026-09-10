---
title: "Phase 3: UI hosted / self-host panels"
status: completed
priority: P1
effort: "3h"
dependencies: [2]
---

# Phase 3: UI hosted / self-host panels

## Overview

Thay card "Embed on your site" hiện tại (snippet giả trỏ về origin Forge) bằng hai panel ngang hàng: **Hosted (beta, khuyên dùng)** và **Self-host**, kèm trạng thái publish, nút Publish lại / Unpublish, cảnh báo link admin.

## Requirements

- [x] Functional: panel Hosted chỉ hiện khi `cdnConfigured || job.publishStatus === "published"`; snippet `<script src="${hostedEmbedUrl}"></script>` (không `?v=`); link Test = `hostedEmbedUrl?v=${publishedVersion}`; badge trạng thái; nút Publish lại (khi `failed`/`unpublished`), Unpublish (khi `published`); panel Self-host giữ 2 nút download tới `/api/jobs/${jobId}/…`.
- [x] Non-functional: `jobId` không xuất hiện trong bất kỳ text nào của panel Hosted; copy tiếng Anh + 1 dòng gợi ý tiếng Việt như pattern hiện có; không thêm dependency UI.

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

- [x] page.tsx prop
- [x] Bỏ snippet giả, thêm state publishInfo
- [x] Panel Hosted + Self-host
- [x] lint + build + kiểm tay 2 trạng thái env

## Success Criteria

- [x] Không còn chuỗi `/api/jobs/${job.id}/embed.js` trong bất kỳ snippet copy nào; chỉ còn trong link download.
- [x] Với env CDN + Worker local: sau generate, panel Hosted hiện snippet `pub_…`, badge `published`, nút Unpublish; bấm Unpublish → badge `unpublished`, nút Publish lại.
- [x] Không env: chỉ panel Self-host.
- [x] `npm run lint` và `npm run build` sạch.

## As built (sai lệch so với plan, sau code review)

Kiểm bằng trình duyệt thật (bản production + Worker local), không chỉ chạy test. Vòng đời đã đi hết: generate → published → unpublish → publish lại, cùng URL. Job `skipped` sinh trước khi bật CDN cũng đã publish được.

Sửa theo code review:
- **Câu dẫn panel Hosted mâu thuẫn với snippet ngay dưới nó.** Text cũ "Nothing to host." nằm ở nhánh CÓ `hostedEmbedUrl`, ngay trên đoạn script phải copy, cạnh badge `published`. Ý tôi là "bạn không phải host gì cả" nhưng đọc lên gần trùng với câu ở nhánh else "Nothing is hosted for this job yet." nghĩa ngược lại. Đổi thành "We serve this file for you. Paste the tag before </body>:".
- **Job `skipped` bị ngõ cụt.** `canRetryPublish` cũ chỉ nhận `failed`/`unpublished`, trong khi `republishJob` phía server chỉ cần CDN đã cấu hình và có artifact trên đĩa. Job generate trước khi bật CDN hiện panel "not hosted" mà không có nút nào; lối thoát duy nhất là bấm Generate lại, tăng version vô ích. Đổi thành `canPublish = cdnConfigured && publishStatus !== "published"`, nhãn nút theo trạng thái. Đã kiểm trên job thật: publish thành công, version giữ nguyên 1.
- **Lỗi của publish/unpublish hiện ngoài tầm nhìn.** State `error` render ngay dưới nút Generate, tức phía trên grid; hai nút gây lỗi nằm trong panel sau 4 dòng cảnh báo, thường quá một khung hình. Thêm state `actionError` render trong chính panel Hosted, có `role="alert"`.
- **`PublishState` không ràng buộc với `publishSummary`.** Trước là `Pick<ScanJob, …>` viết tay, nên bỏ một field khỏi `publishSummary` vẫn qua `tsc` và 56 test, còn UI âm thầm tụt về nhánh "chưa host gì". Đổi thành `ReturnType<typeof publishSummary>` qua `import type`. Đã kiểm bundle client sau build: không có `playwright`/`scanSite` lọt vào.
- Grid cố định 2 cột kể cả khi chỉ có một panel → `cn("grid gap-4", showHosted && "lg:grid-cols-2")`. Đã kiểm: khi tắt CDN class chỉ còn `grid gap-4`.
- Con số độ trễ: 60s KV + `max-age=300` + `stale-while-revalidate=60` ≈ 420s, không phải 6 phút. Sửa UI và `cdn/README.md` thành "about seven minutes".
- "Your download below is unaffected" → "The self-host download is unaffected" (trên màn rộng panel nằm bên cạnh, không phải bên dưới).
- Nút publish/unpublish thêm nhãn bận ("Publishing…", "Unpublishing…"); timeout CDN là 10 giây nên nút xám im lặng quá lâu. Gộp `busy` thành state `pending` để biết hành động nào đang chạy.
- `copy()` thêm try/catch: `navigator.clipboard` không tồn tại ngoài secure context, trước đó nút im lặng và ném unhandled rejection. Nay đổi nhãn thành "Select it above".
- `aria-live="polite"` trên hàng badge để người dùng screen reader nghe được đổi trạng thái.
- `eslint.config.mjs` bỏ qua `data/**`: eslint đang quét bundle embed sinh ra trong `data/jobs/`, tạo 10 warning giả mỗi khi có job local.
- Thêm một dòng khi publish lỗi mà bản cũ còn sống: "The tag above still works…", để chủ site không tưởng site đã hỏng.

Không sửa: hai tab cùng mở một job có thể lệch state (không polling). Chấp nhận cho P0, một chủ site một tab; hành động vẫn idempotent nhờ `runForJob` và unpublish coi 404 là thành công.

Trả lời câu hỏi mở của reviewer: `?v=` chỉ là cache-buster cho nút Test, đúng thiết kế. Worker route theo `pathname` và bỏ qua query, không có ý định đọc query để trả version.

Ghi nhận môi trường: `npm run dev` không kiểm UI được ở máy này vì HMR websocket bị chặn cross-origin, React hydrate nhưng không phản hồi click. Dùng `npm run build` + `npm start`.

## Risk Assessment

- **Clipboard API bị chặn trên http không phải localhost.** Đã tồn tại với nút Copy hiện tại; giữ nguyên hành vi, hiển thị snippet trong `<pre>` để chọn tay.
- **Trạng thái UI lệch với server sau reload.** Tín hiệu: badge sai sau F5. Phản ứng: state khởi tạo từ `job` server-render (đã có `force-dynamic`), không cache client.
