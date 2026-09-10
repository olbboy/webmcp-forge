---
title: "Phase 3 Hosted Embed: hai panel UI, review bat mot cau copy mau thuan"
date: 2026-09-10
summary: "Panel Hosted/Self-host; sua 1 BLOCKER copy, job skipped bi ngo cut, loi hien sai cho, va type khong rang buoc voi server"
---

# Phase 3 Hosted Embed: hai panel UI, review bat mot cau copy mau thuan

## Chuyện gì đã xảy ra
Phase 3: hai panel Hosted / Self-host thay card cũ. Sửa `job-catalog.tsx`, `page.tsx`, `eslint.config.mjs`, `cdn/README.md`.

Card cũ hiện snippet trỏ về chính origin Forge, vừa vô dụng với khách vừa đưa jobId (khoá admin không auth) vào markup mà khách được mời dán lên trang công khai.

## Kiểm bằng trình duyệt thật, không chỉ test
Vòng đời đầy đủ trên bản production + Worker local: generate → published (CDN trả 200, snippet không có ?v=, link Test có ?v=1) → Unpublish (curl Worker 404; fetch trong trình duyệt vẫn 200 vì cache 5 phút, đúng như UI cảnh báo) → Publish lại (cùng URL, 200). Không CDN: chỉ panel Self-host, publishStatus skipped.

## Code review: 1 BLOCKER, 3 SHOULD-FIX, 8 NIT
- BLOCKER: câu "Nothing to host." nằm ở nhánh CÓ hostedEmbedUrl, ngay trên snippet phải copy, cạnh badge published. Ý tôi là "bạn không phải host gì" nhưng gần trùng câu nhánh else nghĩa ngược lại. Reviewer bắt được bằng HTML render thật.
- Job `skipped` bị ngõ cụt: panel hiện "not hosted" mà không nút nào, dù republishJob phía server chỉ cần CDN cấu hình + artifact trên đĩa. Đã kiểm lại trên job thật: publish được, version giữ nguyên 1.
- Lỗi publish/unpublish render dưới nút Generate, phía trên grid, cách nút gây lỗi quá một khung hình. Tách state actionError vào trong panel.
- PublishState viết tay bằng Pick<ScanJob>: bỏ field khỏi publishSummary vẫn qua tsc và 56 test, UI âm thầm hỏng. Đổi sang ReturnType<typeof publishSummary> qua import type; đã quét bundle client sau build, không có playwright/scanSite lọt vào.
- NIT đã sửa: grid 2 cột khi chỉ có 1 panel; con số 6 phút thật ra ~7 (60s KV + 300s max-age + 60s stale-while-revalidate); "download below" thành "self-host download"; nhãn bận cho nút publish/unpublish (timeout 10s); try/catch cho clipboard ngoài secure context; aria-live cho badge; eslint bỏ qua data/**.

## Sai lầm của tôi trong phiên này
Dọn cổng bằng `lsof -i :43127 -t` rồi kill PID đầu tiên. Lệnh đó trả về cả tiến trình đang KẾT NỐI tới cổng, không chỉ tiến trình lắng nghe. PID tôi kill là network service của ứng dụng Claude vì browser pane đang mở kết nối tới trang. App tự khởi động lại service nên không thiệt hại lâu dài. Cờ đúng: `-sTCP:LISTEN`. Vi phạm quy tắc chỉ dừng tiến trình mình sở hữu.

## Cạm bẫy môi trường
`npm run dev` không kiểm UI được ở máy này: HMR websocket bị chặn cross-origin, React hydrate nhưng click không phản hồi. Phải dùng build + start. Browser pane khi ẩn thì không vẽ trang nên screenshot ra trắng; đọc DOM bằng JS thay thế.

## Kết quả kiểm
56 test xanh, lint sạch (sau khi bỏ qua data/**), tsc sạch, build sạch, không process sót.

## Bước tiếp
Phase 4: E2E nạp script từ URL hosted vào fixture, cập nhật README và DEMO.

## Chưa kiểm
- Workers Logs có redact header Authorization không (từ phase 1).
- Hai tab cùng mở một job lệch state; chấp nhận cho P0.

> Historical work record — not durable authority. Prefer docs/specs/ADRs for current decisions.
