---
title: "P0 Scan Safety"
description: "Đóng SSRF ở /api/scan, giới hạn tần suất + số lượt quét đồng thời, và khoá click_by_text vào allowlist. Ba lỗ hổng đang mở trên production."
status: pending
priority: P1
effort: "3-4d"
tags: [security, ssrf, rate-limit, webmcp, scanner]
created: 2026-09-11
blockedBy: []
blocks: []
---

# P0 Scan Safety

## Overview

`POST /api/scan` trên `app.webmcps.net` hiện **mở công khai, không xác thực, không giới hạn**, và nhận bất kỳ URL http(s) nào — kể cả địa chỉ nội bộ. Kế hoạch này đóng ba lỗ hổng đó và khoá công cụ nguy hiểm nhất trong bộ tool sinh ra.

Nguồn: [`brainstorm-260911-0048`](../reports/brainstorm-260911-0048-dong-cho-trong-forge.md) (bằng chứng thực nghiệm), [`brainstorm-260911-0019`](../reports/brainstorm-260911-0019-forge-vs-webmcp-com.md) (bối cảnh). Bản này là **bản viết lại sau rà soát đối kháng** — xem `## Red Team Review` ở cuối.

## Vì sao gấp

Chứng minh bằng thực nghiệm, không phải suy đoán. Quét một dịch vụ nội bộ giả trả về cho người gọi: tiêu đề, meta description, đường dẫn `/secrets`, **tên và nhãn từng trường của form đăng nhập**, chữ trên nút, và Forge **tự sinh sẵn tool `fill_form_admin_login`**.

Ba biến thể đều lọt, mỗi biến thể loại bỏ một cách sửa hời hợt:

| Biến thể | Kết quả | Loại bỏ cách sửa |
|---|---|---|
| `http://127.0.0.1:43199/` | LỌT | — |
| `http://localtest.me:43199/` (DNS công khai → 127.0.0.1) | LỌT | chặn theo chuỗi IP trong URL |
| `http://…:43198/` → 302 → `…:43199` | LỌT | chỉ kiểm URL đầu vào |

Máy chủ là droplet 2 GB **dùng chung với hệ thống đồng bộ ngân hàng đang production**, không có giới hạn tần suất nào.

## Sự thật production (đo trực tiếp 2026-09-11, SSH chỉ-đọc)

Bốn số liệu này là nền của mọi quyết định bên dưới. Rà soát đối kháng phát hiện bản kế hoạch đầu dựa trên giả định sai về cả bốn.

| Mục | Giá trị đo được | Ảnh hưởng |
|---|---|---|
| `SCANNER_ENGINE` | **`lightpanda`** (không phải chrome) | Đổi hoàn toàn thiết kế lớp 2 |
| `SCANNER_CDP_URL` | `http://127.0.0.1:9222` | Trình duyệt chung namespace mạng với app |
| Tiến trình `next-server` trong container | **đúng 1**, RSS ~124 MiB | Bộ đếm trong bộ nhớ hợp lệ |
| `SCAN_ALLOW_PRIVATE_HOSTS` trong `/opt/webmcp-forge/.env` | **vắng mặt** | Chưa ai vô tình bật |

## Goals

| # | Goal | Priority |
|---|------|----------|
| 1 | URL trỏ tới hạ tầng nội bộ không quét được, kể cả qua tên miền công khai hay chuyển hướng | P1 |
| 2 | Một người lạ không thể làm cạn RAM droplet bằng cách gọi `/api/scan` liên tục | P1 |
| 3 | `click_by_text` chỉ bấm được nút/link đã thấy lúc quét | P1 |
| 4 | Nhãn an toàn tới được trình duyệt thay vì chết trong manifest | P1 |
| 5 | Ba điều trên có hiệu lực **trên production**, và hoàn tác được từng phần | P1 |

## Non-goals

Ngoài phạm vi, đã ghi trong báo cáo nguồn: danh bạ · analytics · tài khoản · health check selector · rescan vào cùng job · AI sinh tool. Dọn `navigator.modelContext` và sửa `scripts/backup-jobs.sh` là P2.

**Một lỗ hổng được ghi nhận nhưng KHÔNG đóng trong đợt này** — xem "Rủi ro còn lại" bên dưới. Ghi ra để nó không bị quên, không phải để lặng lẽ bỏ qua.

## Phases

| # | Phase | Status |
|---|-------|--------|
| 1 | [Phase 1: SSRF Guard](./phase-01-ssrf-guard.md) | Pending |
| 2 | [Phase 2: Rate-Limit](./phase-02-rate-limit.md) | Pending |
| 3 | [Phase 3: Click-Gate](./phase-03-click-gate.md) | Pending |
| 4 | [Phase 4: Deploy-Verify](./phase-04-deploy-verify.md) | Pending |

Mỗi phase là **một commit riêng trên `main`**, để `git revert` được từng cái. Phase 1 và 2 đều chạm đường `/api/scan`; làm tuần tự. Phase 3 độc lập. Phase 4 phụ thuộc cả ba.

## Quyết định kiến trúc

Ghi vào `docs/decisions.md` theo **quy ước sẵn có của file đó**: tiêu đề mô tả bất biến, không đánh số, không mã kế hoạch.

### Chốt chặn nằm ở `jobs.ts`, trước khi job được ghi

Có **hai** hàm tên `runScan`. `route.ts:18` gọi hàm ở `jobs.ts:70`, và hàm đó nuốt mọi lỗi từ `scanSite` rồi trả job `status:"error"` → route trả **422**, không phải 400. Chỉ lỗi ném trước khối `try` (tức cạnh `parseScanUrl` ở `jobs.ts:71`) mới ra 400.

Thêm nữa `jobs.ts:85 saveJob(pending)` chạy **trước** khi quét, nên mỗi lần dò SSRF vẫn để lại một file JSON trong `./data/jobs` — rác đó chảy vào bản sao lưu hằng ngày.

→ Lớp 1 gọi trong `jobs.runScan`, **sau `parseScanUrl`, trước `saveJob(pending)`**.

### Lớp 2 phụ thuộc engine, và engine production không hỗ trợ cách mạnh

Đo trên đúng ảnh `lightpanda/browser:nightly` mà production đang chạy:

| Cơ chế | Chrome | **Lightpanda (production)** |
|---|---|---|
| `response.serverAddr()` | `{"ipAddress":"127.0.0.1","port":43301}` | **`null`** |
| `page.url()` sau redirect | đúng đích | **đúng đích** |
| `resp.request().redirectedFrom()` | thấy chặng trước | **thấy chặng trước** |
| `ctx.on("request")` (navigation) | đủ 2 chặng | **đủ 2 chặng** |

`serverAddr()` là **sự thật mặt đất** — IP đã thật sự nối tới, nên đóng cả DNS rebinding lẫn redirect. Nhưng nó không tồn tại trên Lightpanda. Quy tắc "null = chặn" của bản kế hoạch đầu sẽ chặn **100% lượt quét** trên production.

→ Lớp 2 nhận biết engine:

```
Chrome     : serverAddr() → chặn nếu IP thuộc dải cấm; null = chặn (fail đóng)
Lightpanda : không có serverAddr. Thay bằng: kiểm LẠI mọi URL trong chuỗi
             chuyển hướng (page.url() + redirectedFrom() + nav requests),
             phân giải DNS từng host, chặn nếu bất kỳ IP nào thuộc dải cấm
```

Đây là đánh đổi có ý thức, không phải chỗ chưa nghĩ tới: đường Lightpanda **đóng chuyển hướng, không đóng DNS rebinding**, vì ta phân giải lại chứ không đọc được IP engine đã nối. Ghi rõ trong `docs/decisions.md`.

### Bộ đếm nằm trong route handler, không nằm trong `proxy.ts`

Next.js 16 đổi tên `middleware.ts` → `proxy.ts`. Tài liệu 16.3.4 nói thẳng: *"you should not attempt relying on shared modules or globals"* trong Proxy, và *"avoid relying on Middleware unless no other options exist"*. Biến đếm trong bộ nhớ chính là "globals".

`src/app/api/scan/route.ts:3` đã khai `runtime = "nodejs"`, và đo trên production xác nhận **đúng một tiến trình `next-server`** — nên `Map` cấp module là chỗ đếm hợp lệ. Không cần Redis, không cần KV.

### Cửa thoát cho test là biến môi trường, và nó phải tự tố cáo

`tests/helpers.ts:39` dựng fixture trên `127.0.0.1`; **6 file test** phụ thuộc (`api`, `scanner`, `generator`, `browser-lifetime`, `store`, `hosted-embed.e2e`). Chặn vô điều kiện thì cả bộ test gãy.

Cửa thoát: `SCAN_ALLOW_PRIVATE_HOSTS`, mặc định tắt, bật trong `tests/setup.ts`. **Và ứng dụng log một dòng cảnh báo mỗi lần khởi động khi cờ này bật** — một lần kiểm lúc deploy không ngăn được ai đó thêm nó vào `/opt/webmcp-forge/.env` để gỡ lỗi rồi quên gỡ.

Nơi biến thật được nạp là `/opt/webmcp-forge/.env` (`docker-compose.yml:19` `env_file: .env`; service `app` **không có** khối `environment:`). Đọc `.env.example` không chứng minh được gì.

### URL cùng origin với chính ứng dụng không phải SSRF

`src/components/scan-form.tsx:15` dựng URL demo từ `window.location.origin`. Trong dev đó là `http://localhost:43127` → lớp 1 chặn → nút "Try the demo shop" và toàn bộ `DEMO.md` chết. Miễn trừ tường minh cho origin của chính app.

### Một thông điệp từ chối duy nhất

Nếu lớp 1 nói "địa chỉ riêng" còn lớp 2 nói "không tới được", endpoint thành máy dò cổng nội bộ. Dùng cùng một câu. Chênh lệch thời gian phản hồi vẫn là kênh phụ; ghi nhận, không xử trong đợt này.

## Rủi ro còn lại — ghi rõ, không đóng trong đợt này

| Lỗ hổng | Vì sao còn | Điều kiện xét lại |
|---|---|---|
| **Tài nguyên con và JS trong trang.** Một trang **công khai thật** do kẻ tấn công kiểm soát vượt cả hai lớp hợp lệ, rồi chạy JS dò `127.0.0.1`/`169.254.169.254`/mạng docker và **nhét kết quả vào `document.title`** — thứ extractor bóc ra và API trả về. Với dịch vụ nội bộ có `Access-Control-Allow-Origin: *` thì đây là đọc nội dung đầy đủ | Đóng đúng cách cần **lọc lối ra ở tầng mạng** (trình duyệt không thấy loopback/RFC1918/link-local). Đó là việc hạ tầng, không phải việc mã, và cần cửa sổ bảo trì trên máy dùng chung với bank-hub | Sau khi P0 lên và ổn định. Phase 1 thêm `context.route()` chặn best-effort làm lớp giảm nhẹ, kèm bước dò xem Lightpanda có hỗ trợ `route()` không |
| **DNS rebinding trên Lightpanda** | Không đọc được IP engine đã nối | Nếu chuyển về Chrome, hoặc nếu Lightpanda phát `remoteIPAddress` ở bản sau |
| **Kênh phụ thời gian phản hồi** | Chặn ở lớp 1 nhanh hơn lỗi mạng thật | Đo được thì mới xử |

## Success Criteria

- [ ] Ba biến thể SSRF bị từ chối với **HTTP 400**, không tạo job trên đĩa, có test tự động cả ba
- [ ] Ca chặn chuyển hướng **thoát ra tới route**, không bị `catch` của `visitPage` nuốt thành 200
- [ ] Lớp 2 chạy đúng dưới **cả hai** engine, có bằng chứng đo cho từng engine
- [ ] `npm test` xanh, không test cũ nào phải nới lỏng
- [ ] Nút "Try the demo shop" vẫn chạy trong `npm run dev`
- [ ] Gọi `/api/scan` hai lần liên tiếp cùng IP → lần hai 429 kèm `Retry-After`; hai IP khác nhau đều 200
- [ ] Chỗ đồng thời tự thu hồi sau khi quá hạn, không khoá vĩnh viễn
- [ ] `click_by_text` ngoài allowlist → **không có cú click nào xảy ra**; job cũ không có allowlist vẫn dùng được
- [ ] `annotations` tới `registerTool`, chứng minh bằng spy trên `document.modelContext` giả
- [ ] Mỗi phase là một commit revert được riêng; lớp 2 và click gate có công tắc runtime
- [ ] Sau deploy: `docker compose ps` cho thấy **cả `app` và `lightpanda`** healthy

## Bằng chứng đã kiểm

| Điều | Cách kiểm | Kết quả |
|---|---|---|
| `serverAddr()` trên Chrome | chạy thật | `{"ipAddress":"127.0.0.1","port":43301}` |
| `serverAddr()` trên Lightpanda | chạy thật, đúng image production | **`null`** — cơ chế không tồn tại |
| Chuỗi redirect trên Lightpanda | chạy thật | `page.url()`, `redirectedFrom()`, nav requests đều thấy đủ |
| Production chạy engine nào | SSH chỉ-đọc | `SCANNER_ENGINE=lightpanda` |
| Số tiến trình `next-server` | SSH chỉ-đọc | 1 |
| `route.ts` trả 422 khi status=error | đọc mã | `src/app/api/scan/route.ts:19` |
| `jobs.runScan` nuốt lỗi, ghi job trước khi quét | đọc mã | `src/lib/jobs.ts:85,101-110` |
| `robots.ts` fetch trần, bám redirect | đọc mã | `src/lib/robots.ts:51` |
| Selector nút lệch giữa lúc quét và lúc gọi | đọc mã | `extract.ts:207` không có `a`; `generator.ts:347` có |
| `webmcp.d.ts` thiếu `annotations` | đọc mã | `src/types/webmcp.d.ts:3-20` |
| `PageSnapshot.buttons` chưa ai dùng | `grep "\.buttons" src/lib` | 0 |
| Compose dùng `env_file`, không `environment` | đọc mã | `docker-compose.yml:19` |

## Open Questions

1. **`cloudflared` có chuyển tiếp `CF-Connecting-IP` không** — phải đóng **trước** Phase 2 (một dòng log trên container hiện tại là đủ, không cần deploy gì). Nếu vắng, không được deploy `MAX_PER_WINDOW=1`.
2. **Zone `webmcps.net` có bật Pseudo IPv4 "Overwrite Headers"** — liếc dashboard trước Phase 2.
3. **Lightpanda có hỗ trợ `context.route()` không** — quyết định lớp giảm nhẹ cho tài nguyên con có khả thi không. Dò trong Phase 1.
4. **Bao nhiêu job đã publish có `click_by_text`** — quyết định độ nặng của bước migrate ở Phase 3. `ls /opt/webmcp-forge/data/jobs/*.json | wc -l` + grep `publishStatus`.
5. **Mốc so sánh "bộ tool trước khi sửa"** cho `blvera.com` và `pytesess.vn` — phải chụp **trước** khi merge, nếu không tiêu chí Phase 4 không kiểm được.

---

## Red Team Review

### Session — 2026-09-11

**Findings:** 30 thô → **15 nhóm** sau khử trùng lặp (15 accepted, 0 rejected)
**Severity:** 7 Critical, 6 High, 2 Medium
**Reviewers:** Security Adversary · Assumption Destroyer · Failure Mode Analyst (tầng xác minh Standard)

Không finding nào bị loại ở bộ lọc bằng chứng — cả 30 đều có trích dẫn `file:line`. Controller tự kiểm độc lập 12 khẳng định nặng nhất; tất cả đều đúng.

| # | Finding | Severity | Disposition | Applied To |
|---|---------|----------|-------------|------------|
| 1 | Chốt đặt trong `scanner.runScan`; `jobs.runScan` nuốt lỗi → 422 chứ không phải 400, và vẫn ghi job xuống đĩa | Critical | Accept | Phase 1 |
| 2 | Lớp 2 bị `catch` của `visitPage` nuốt → `proposeTools` vẫn chạy → API trả 200 kèm bộ tool | Critical | Accept | Phase 1 |
| 3 | Production chạy Lightpanda; `serverAddr()` trả `null` ở đó → fail-đóng sẽ chặn 100% lượt quét | Critical | Accept | Phase 1, plan.md |
| 4 | `robots.txt` là đường SSRF thứ hai: `fetch` trần, bám redirect, ngoài tầm cả hai lớp | Critical | Accept | Phase 1 |
| 5 | Tài nguyên con và JS trong trang — SSRF không được nhắc tới | Critical | Accept | Phase 1 (giảm nhẹ) + plan.md (rủi ro còn lại) |
| 6 | Lệnh deploy thiếu `--profile lightpanda` → phá mạng container browser | Critical | Accept | Phase 4 |
| 7 | Ca test lớp 2 thực ra test lớp 1; gỡ lớp 2 test vẫn xanh | Critical | Accept | Phase 1 |
| 8 | `serverAddr()` chỉ trả chặng cuối — chặng giữa nội bộ đi lọt | High | Accept | Phase 1 |
| 9 | `x-forwarded-for[0]` do khách gửi; xô `"unknown"` là tự-DoS cả dịch vụ | High | Accept | Phase 2 |
| 10 | `SCAN_MAX_CONCURRENT=2` suy từ số mâu thuẫn với `docker-compose.yml:24` và `deployment-guide:148` | High | Accept | Phase 2 |
| 11 | Không có đồng hồ chết cho chỗ đồng thời; `acquire`/`release` lệch; job kẹt `"scanning"` vĩnh viễn | High | Accept | Phase 2 |
| 12 | Khoá IPv6 theo địa chỉ đơn → bỏ qua được; `Map` phình không trần | High | Accept | Phase 2 |
| 13 | `click_by_text`: nhánh chuỗi con mở lại lỗ cũ · allowlist thiếu `<a>` · job cũ mất tool | High | Accept | Phase 3 |
| 14 | Demo shop vỡ trong dev; kiểm cửa thoát nhắm `.env.example` thay vì `.env` | High | Accept | Phase 1, Phase 4 |
| 15 | Không hoàn tác được từng phase · `webmcp.d.ts` thiếu `annotations` · nhãn "Đ1-Đ4" phá quy ước `decisions.md` · thiếu 6 file khỏi Related Code Files | Medium | Accept | tất cả |

### Whole-Plan Consistency Sweep

Sau khi áp dụng, đã đọc lại `plan.md` và cả 4 phase file. Delta quyết định và chỗ đã hoà giải:

| Thay đổi | Nơi phải sửa theo | Trạng thái |
|---|---|---|
| Lớp 1 dời từ `scanner.runScan` → `jobs.runScan` | Phase 1 Architecture + steps + Related Files; Phase 4 bảng kỳ vọng | ✅ |
| Lớp 2 thành engine-aware; `serverAddr()` không còn là "sự thật mặt đất" phổ quát | plan.md quyết định + bảng bằng chứng; Phase 1 Architecture + test; Phase 4 | ✅ |
| Mã trả về đổi 422 → 400 | plan.md Success Criteria; Phase 1; Phase 4 bảng | ✅ |
| "5 file test" → **6 file test** | plan.md quyết định cửa thoát | ✅ |
| Nhãn "Đ1–Đ4" bị bỏ, thay bằng tiêu đề mô tả | plan.md; Phase 1 và 2 (bước tài liệu) | ✅ |
| `SCAN_MAX_CONCURRENT` mặc định 2 → **1**, engine-aware | Phase 2 bảng ngưỡng; Phase 4 bước đo | ✅ |
| Ngưỡng khai ở `.env`/`.env.example`, **không** ở `docker-compose.yml` | Phase 2 Related Files + bảng; Phase 4 bước 1 | ✅ |
| Lệnh deploy lấy nguyên từ `deployment-guide.md` | Phase 4 bước 2 + Success Criteria | ✅ |
| Thêm `jobs.ts`, `robots.ts`, `scan-form.tsx`, `webmcp.d.ts`, `form-merging.test.ts`, `DEMO.md` vào Related Files | Phase 1, 2, 3 | ✅ |

**Không còn mâu thuẫn chưa giải.** Năm câu ở `## Open Questions` là việc phải đóng trong lúc triển khai, không phải mâu thuẫn nội bộ của kế hoạch.

<!-- slug: p0-scan-safety -->
