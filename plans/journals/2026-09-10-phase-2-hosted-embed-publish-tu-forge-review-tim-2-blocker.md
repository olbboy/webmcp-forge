---
title: "Phase 2 Hosted Embed: publish tu Forge, review tim 2 blocker"
date: 2026-09-10
summary: "Noi Forge voi Worker CDN; sua 2 BLOCKER (superseded khong persist, generate dong thoi tao 2 publicId) va 4 finding khac"
---

# Phase 2 Hosted Embed: publish tu Forge, review tim 2 blocker

## Chuyện gì đã xảy ra
Phase 2 nối Forge với Worker CDN. Commit f745d7e. Mới: `src/lib/cdn.ts`, `src/lib/key-queue.ts`, `src/lib/job-error-response.ts`, hai route `publish`/`unpublish`, hai file test. Sửa: `jobs.ts` (viết lại), `types.ts`, `generator.ts`, route `generate`.

## Code review: 2 BLOCKER, 3 SHOULD-FIX, 5 NIT
Reviewer chạy 8 mutation và 7 probe thật, không chỉ đọc code. Cả hai BLOCKER dẫn tới cùng hậu quả: record sống trên CDN mà job không nhớ publicId, nên unpublish mất tác dụng.

- B1: nhánh `superseded` chỉ `getJob` rồi trả về, không persist. Comment của tôi giả định "luôn có run mới hơn đã ghi state" — đúng cho supersede nội bộ hàng đợi, SAI cho 409 từ Worker. Probe cho thấy job kẹt `failed` với publishError cũ trong khi CDN giữ bundle mới hơn. Sửa: persist publicId TRƯỚC khi gọi CDN; nhánh superseded ghi `published` + hosted URL nếu chưa run nào ghi.
- B2: `Promise.all([generate, generate])` → hai publicId, hai bundle khác nội dung cùng version 1, một bản mồ côi. Hàng đợi trong cdn.ts khoá theo publicId nên không chặn được. Plan đã kê đúng mitigation này mà tôi chưa làm. Sửa: `createKeyQueue()` dùng chung, jobs.ts khoá theo jobId.
- S1: `newestRequested` bị xoá khi hàng đợi cạn. Route retry có 3 await trước khi tới publishEmbed; generate xong trong khoảng đó thì retry cũ lọt. Sửa: giữ map suốt vòng đời process, tách khỏi hàng đợi tự dọn.
- S2: 3 mutation sống sót. Đã thêm test cho cả ba.
- S3: lazy rebuild lệch `generatedAt` mà vẫn khai cùng version, trong khi Worker dùng số đó làm ETag. Sửa: `generatedAt` thành tham số của buildManifest, lazy path dùng lại của job.
- N1: lỗi filesystem trả nguyên đường dẫn tuyệt đối cho client kèm 400. Sửa: `JobError` + mapper chung, lỗi lạ trả 500 message chung, log ở server.

Không sửa, có lý do: N2 (publish/unpublish không auth) là quyết định phase 0, jobId = capability; kẻ tấn công biết jobId rồi thì POST thẳng từ server họ cũng được nên CSRF không thêm gì. N3, N4, N5 rủi ro thấp hoặc đã được reviewer kiểm thủ công.

## Bài học
Test tôi viết cho hành vi supersede lần đầu SAI chứ không phải code sai: ba lệnh publish gọi đồng bộ liên tiếp đều thấy version mới nhất trước khi chạy, nên lệnh đầu cũng bị drop. Phải để lệnh đầu vào trong fetch thật (chờ một promise do mock bắn ra) rồi mới gọi hai lệnh sau. Đây đúng loại test giả mà phase 1 đã dính một lần.

## Kết quả kiểm
56 test xanh (6 gốc + 23 phase 1 + 27 phase 2). Lint sạch, typecheck sạch, compile sạch, không process sót. Tự chạy lại 5 mutation trên đúng các hành vi vừa sửa: tất cả đều bị bắt (bỏ serialize theo jobId làm đỏ 11 test).

## Bước tiếp
Phase 3: UI hai panel hosted / self-host, badge trạng thái, nút Publish lại và Unpublish.

## Chưa kiểm
- Workers Logs có redact header Authorization không (từ phase 1, chưa chốt).
- Hành vi khi chạy nhiều instance Forge: job store là file local nên vốn đã không chia sẻ được; key-queue chỉ bảo vệ trong một process.

> Historical work record — not durable authority. Prefer docs/specs/ADRs for current decisions.
