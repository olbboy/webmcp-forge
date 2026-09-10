---
title: "Phase 1: SSRF Guard"
status: todo
---

# Phase 1: SSRF Guard

## Overview

Chặn `/api/scan` mở URL trỏ tới hạ tầng nội bộ — trực tiếp, qua tên miền công khai phân giải ra IP riêng, hoặc qua chuyển hướng. Ba đường phải bịt: trang chính, `robots.txt`, và (giảm nhẹ) tài nguyên con.

## Requirements

- [ ] Chức năng: URL phân giải ra IP thuộc dải cấm bị từ chối với **HTTP 400**, và **không tạo job trên đĩa**
- [ ] Chức năng: chuyển hướng tới IP nội bộ bị chặn, và việc chặn **thoát ra tới route**, không bị nuốt thành 200
- [ ] Chức năng: `robots.txt` không bám redirect ra nội bộ
- [ ] Chức năng: lớp 2 chạy đúng dưới **cả Chrome và Lightpanda**
- [ ] Phi chức năng: 6 file test hiện tại (quét `127.0.0.1`) vẫn chạy được
- [ ] Phi chức năng: nút "Try the demo shop" và `DEMO.md` vẫn chạy trong dev
- [ ] Phi chức năng: một thông điệp từ chối duy nhất, không tiết lộ nội bộ có gì
- [ ] Phi chức năng: lớp 2 có công tắc runtime để tắt riêng khi cần hoàn tác

## Architecture

### Vì sao chốt nằm ở `jobs.ts`, không ở `scanner.ts`

Có **hai** hàm tên `runScan`. Đường thật:

```
route.ts:18  →  jobs.ts:70 runScan  →  jobs.ts:88 scanSite  →  scanner.ts:184 runScan
                     │
                     ├─ :71  parseScanUrl        ← ném ở đây → route.ts:21 catch → 400 ✅
                     ├─ :85  saveJob(pending)    ← job đã nằm trên đĩa
                     └─ :87  try { scanSite }
                        :101 catch → status:"error" → route.ts:19 → 422 ❌
```

Đặt lớp 1 trong `scanner.runScan` thì lỗi rơi vào `catch` ở `jobs.ts:101`, thành **422 kèm nguyên đối tượng job**, và job rác vẫn nằm lại trên bind mount `./data` rồi chảy vào bản sao lưu hằng ngày.

→ Lớp 1 gọi trong **`jobs.runScan`, sau `parseScanUrl`, trước `saveJob(pending)`**.

### Luồng đầy đủ

```
POST /api/scan
   │  jobs.runScan
   ├─ parseScanUrl()                       (đã có: chỉ http/https)
   ├─ assertScannableUrl(url)              ◄── LỚP 1 (mới) — ném ScanBlockedError → 400
   │     miễn trừ: origin của chính app; hoặc SCAN_ALLOW_PRIVATE_HOSTS=1
   │     dns.lookup(host,{all:true}) → mọi IP phải ngoài dải cấm
   ├─ saveJob(pending)                     (chỉ tới đây khi URL đã sạch)
   └─ scanSite
        ├─ fetchRobotsTxt()                ◄── redirect:"manual" + kiểm từng Location
        └─ visitPage()
             resp = await page.goto(...)
             assertConnectionWasPublic(page, resp)   ◄── LỚP 2 (mới, theo engine)
             ném ScanBlockedError → KHÔNG rơi vào catch chung (xem dưới)
             page.evaluate(extractSnapshotInPage)
```

### Lớp 2 phụ thuộc engine — đây là điểm cốt lõi của bản sửa

Đo trên đúng ảnh `lightpanda/browser:nightly` production đang chạy:

| Cơ chế | Chrome | **Lightpanda (production)** |
|---|---|---|
| `response.serverAddr()` | `{"ipAddress":"127.0.0.1","port":43301}` | **`null`** |
| `page.url()` sau redirect | đúng đích | **đúng đích** |
| `resp.request().redirectedFrom()` | thấy chặng trước | **thấy chặng trước** |
| `ctx.on("request")` navigation | đủ 2 chặng | **đủ 2 chặng** |

```
Chrome     : addr = await resp.serverAddr()
             addr == null       → chặn (fail đóng)
             addr.ipAddress ∈ dải cấm → chặn
             Đây là sự thật mặt đất: đóng cả rebinding lẫn redirect.

Lightpanda : không có serverAddr. Thu mọi URL trong chuỗi —
             page.url() + đi ngược redirectedFrom() + nav requests ghi từ ctx.on("request") —
             rồi assertScannableUrl() cho TỪNG host.
             Đóng chuyển hướng. KHÔNG đóng DNS rebinding.
```

Chọn nhánh bằng `selectedEngine()` đã có ở `scanner.ts:82`. **Không** suy ra từ việc `serverAddr()` có trả `null` hay không — làm vậy thì Chrome hỏng một lần là tự tụt xuống nhánh yếu mà không ai biết.

Kiểm **mọi chặng**, không chỉ chặng cuối: `serverAddr()` của `page.goto` trả thông tin của request **cuối** trong chuỗi. Chuỗi `evil.example → 10.0.0.5:9200 → evil.example/collect` kết thúc ở IP công khai và sẽ lọt nếu chỉ nhìn một điểm.

### Việc chặn phải thoát ra, không được rơi vào `catch` chung

`scanner.ts:269-282` bắt mọi lỗi của `visitPage` và trả `PageSnapshot` rỗng kèm `error`. `runScan` chạy tiếp, `scanner.ts:233 proposeTools(pages, origin)` vẫn chạy, và `heuristics.ts:31` (`get_page_info`) cùng `:189` (`click_by_text`) được push **vô điều kiện**.

Kết quả nếu để nguyên: job `status:"ready"`, HTTP **200**, có tool — **không có từ chối nào ở tầng API**. Bản kế hoạch đầu viết *"catch hiện tại đã trả snapshot rỗng… nên không cần nhánh mới"*. Đó chính là lỗ.

→ Thêm nhánh `if (err instanceof ScanBlockedError) throw err;` **trước** `catch` chung trong `visitPage`, và để `runScan` của `scanner.ts` cho nó nổi lên. `jobs.runScan` cần nhánh tương tự để re-throw thay vì nuốt.

### Dải cấm

| Dải | Vì sao |
|---|---|
| `127.0.0.0/8`, `::1/128` | loopback |
| `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16` | RFC1918 |
| `169.254.0.0/16`, `fe80::/10` | link-local — **metadata mọi đám mây** |
| `fc00::/7` | ULA IPv6 |
| `100.64.0.0/10` | CGNAT |
| `0.0.0.0/8`, `::/128` | "this host" |
| `224.0.0.0/4`, `ff00::/8` | multicast |
| `::ffff:0:0/96` | **IPv4-mapped IPv6** — `http://[::ffff:127.0.0.1]` vượt mọi regex chỉ nhìn IPv4 |

## Related Code Files

- Create: `src/lib/net-guard.ts` — dải cấm, `isBlockedIp()`, `assertScannableUrl()`, `assertConnectionWasPublic()`, `allowPrivateHosts()`, `SCAN_BLOCKED_MESSAGE`
- Create: `tests/net-guard.test.ts` · `tests/ssrf.test.ts`
- Modify: **`src/lib/jobs.ts`** — lớp 1 trước `saveJob(pending)`; re-throw `ScanBlockedError`
- Modify: `src/lib/scanner.ts` — lớp 2 trong `visitPage`; re-throw thay vì nuốt
- Modify: **`src/lib/robots.ts`** — `redirect:"manual"` + kiểm từng `Location`
- Modify: `src/app/api/scan/route.ts` — `ScanBlockedError` → 400
- Modify: `tests/setup.ts` — bật `SCAN_ALLOW_PRIVATE_HOSTS`
- Modify: `docs/decisions.md` (tiêu đề mô tả, không đánh số) · `README.md` · `DEMO.md` nếu hành vi demo đổi
- Đọc để đối chiếu, không sửa: `src/components/scan-form.tsx:15` (nguồn URL demo)

## Implementation Steps

1. **Dò trước khi viết mã: Lightpanda có hỗ trợ `context.route()` không.** Chạy `lightpanda/browser:nightly` cục bộ, `connectOverCDP`, thử `context.route("**/*", r => r.continue())`. Kết quả quyết định bước 8 làm được hay chỉ ghi vào rủi ro còn lại. Ghi kết quả vào `plans/reports/`.
2. **`src/lib/net-guard.ts`**
   - `isBlockedIp(ip)` — `net.isIP()` phân nhánh v4/v6; chuẩn hoá IPv4-mapped (`::ffff:a.b.c.d`) về v4 **trước** khi so; so bằng prefix số, không bằng chuỗi.
   - `allowPrivateHosts()` — đọc `process.env` **lúc gọi**, không cache cấp module. **Khi bật, log một dòng cảnh báo** (một lần cho mỗi tiến trình là đủ).
   - `isOwnOrigin(url)` — miễn trừ URL cùng origin với chính app (so với `NEXT_PUBLIC_APP_ORIGIN` hoặc origin của request). Giữ demo shop sống trong dev.
   - `assertScannableUrl(url)` — miễn trừ trước, rồi `dns.promises.lookup(hostname,{all:true})` với timeout 3s (bằng `ROBOTS_TIMEOUT_MS`); ném `ScanBlockedError` nếu **bất kỳ** IP nào bị chặn. Lỗi phân giải cũng ném (fail đóng).
   - `assertConnectionWasPublic(page, resp)` — nhánh theo `selectedEngine()` như Architecture mô tả.
   - `SCAN_BLOCKED_MESSAGE` — một câu dùng chung cho mọi đường từ chối.
   - `enforceConnectedIp()` — đọc `SCAN_ENFORCE_CONNECTED_IP`, mặc định bật. Công tắc hoàn tác cho lớp 2 mà không cần rebuild.
3. **`src/lib/jobs.ts` — lớp 1.** Trong `runScan`, sau `parseScanUrl(rawUrl)` (dòng 71) và **trước** `saveJob(pending)` (dòng 85): `await assertScannableUrl(new URL(rawUrl.trim()))`. Thêm trong `catch`: `if (err instanceof ScanBlockedError) throw err;` để lớp 2 cũng ra được 400.
4. **`src/lib/scanner.ts` — lớp 2.** Trong `visitPage`:
   ```ts
   const resp = await page.goto(href, { … });
   await assertConnectionWasPublic(page, resp);   // ném ScanBlockedError
   const extracted = await page.evaluate(extractSnapshotInPage);
   ```
   Và trong `catch`: `if (err instanceof ScanBlockedError) throw err;` **trước** nhánh trả snapshot rỗng.
5. **`src/lib/robots.ts`.** `redirect: "manual"`; khi nhận 3xx, đọc `Location`, chạy `assertScannableUrl` cho URL đó rồi mới đi tiếp; tối đa 3 chặng. Không có `Location` hợp lệ → coi như không có robots.
6. **`src/app/api/scan/route.ts`.** `ScanBlockedError` → 400 với `SCAN_BLOCKED_MESSAGE`. Không đưa kết quả phân giải DNS vào phản hồi.
7. **`tests/setup.ts`.** Thêm `process.env.SCAN_ALLOW_PRIVATE_HOSTS = "1"`.
8. **Giảm nhẹ tài nguyên con (chỉ khi bước 1 nói `route()` chạy được).** `context.route("**/*")` kiểm host mỗi request; `route.abort()` nếu phân giải ra dải cấm. Best-effort: **không** ghi vào Success Criteria, vì đường đóng thật là lọc lối ra ở tầng mạng (xem `plan.md` → Rủi ro còn lại).
9. **`tests/net-guard.test.ts`.** Mỗi dải một ca chặn; các ca cho phép (`8.8.8.8`, `1.1.1.1`, một IPv6 công khai). Bắt buộc có `::ffff:127.0.0.1` và `169.254.169.254`.
10. **`tests/ssrf.test.ts`** — thiết kế lại để mỗi ca test đúng lớp nó tuyên bố:

    | Ca | Cửa thoát | Chứng minh điều gì |
    |---|---|---|
    | IP riêng trực tiếp | **tắt** | Lớp 1 chặn, route trả **400**, `data/jobs` **không có file mới** |
    | `localtest.me:<port>` (DNS công khai → 127.0.0.1) | **tắt** | Lớp 1 chặn theo IP đã phân giải, không theo chuỗi |
    | 302 → nội bộ | **BẬT cho lớp 1, TẮT cho lớp 2** | Lớp 2, và chỉ lớp 2 |
    | URL cùng origin app | tắt | Miễn trừ hoạt động — demo shop không chết |

    Ca thứ ba là ca then chốt. Ở bản kế hoạch đầu nó bất khả thi: server chuyển hướng cũng nằm trên `127.0.0.1` nên lớp 1 chặn trước, test xanh **vì lớp 1**, và gỡ lớp 2 ra test vẫn xanh. Cần **hai cờ riêng** — `SCAN_ALLOW_PRIVATE_HOSTS` (lớp 1) và `SCAN_ENFORCE_CONNECTED_IP` (lớp 2) — để cô lập đúng lớp cần chứng minh.

    Thêm ca `robots.txt` trả 302 sang nội bộ → bị chặn.
11. **Tài liệu.** `docs/decisions.md` thêm ba mục, tiêu đề mô tả bất biến theo quy ước sẵn có của file (11 mục hiện tại đều vậy): chốt nằm ở `jobs.ts` và vì sao · lớp 2 phụ thuộc engine và Lightpanda đóng được gì · cửa thoát là biến môi trường và nó tự tố cáo. `README.md` ghi giới hạn mới ở bảng API.

## Todo

- [ ] Dò `context.route()` trên Lightpanda, ghi kết quả vào `plans/reports/`
- [ ] `src/lib/net-guard.ts` đủ 10 dải + miễn trừ origin app + công tắc lớp 2
- [ ] Cảnh báo lúc khởi động khi `SCAN_ALLOW_PRIVATE_HOSTS` bật
- [ ] Lớp 1 trong `jobs.runScan`, trước `saveJob(pending)`
- [ ] `jobs.runScan` re-throw `ScanBlockedError`
- [ ] Lớp 2 engine-aware trong `visitPage`, kiểm **mọi chặng**
- [ ] `visitPage` re-throw `ScanBlockedError` thay vì nuốt
- [ ] `robots.ts` `redirect:"manual"` + kiểm từng `Location`
- [ ] Route trả 400, một thông điệp chung
- [ ] `tests/setup.ts` bật cửa thoát
- [ ] `tests/net-guard.test.ts`
- [ ] `tests/ssrf.test.ts` đủ 5 ca, mỗi ca cô lập đúng lớp
- [ ] (nếu khả thi) `context.route()` giảm nhẹ tài nguyên con
- [ ] `docs/decisions.md` + `README.md`

## Success Criteria

- [ ] `npm test` xanh; không test cũ nào bị nới lỏng
- [ ] Ba ca SSRF trả **400** và **không tạo file job nào**
- [ ] Ca lớp 2 **đỏ khi đặt `SCAN_ENFORCE_CONNECTED_IP=0`** — chứng minh nó test đúng lớp
- [ ] Lớp 2 có bằng chứng đo cho **cả hai** engine, ghi trong `plans/reports/`
- [ ] `npm run dev` → "Try the demo shop" → quét xong bình thường
- [ ] Quét `https://blvera.com` và `https://pytesess.vn` ra **cùng bộ tool** như mốc chụp trước khi merge

## Risk Assessment

| Rủi ro | Dấu hiệu | Phản ứng đã định trước |
|---|---|---|
| Lightpanda không hỗ trợ `context.route()` | Bước 1 trả lỗi | Bỏ bước 8, ghi vào rủi ro còn lại của `plan.md`. Không chặn phase |
| Nhánh Lightpanda chậm vì phân giải DNS mỗi chặng | Thời gian quét tăng rõ | Nhớ kết quả phân giải trong một lượt quét (Map cục bộ theo job), timeout 3s mỗi host |
| Site thật dùng CDN có IP lạ | Quét site thật ra ít tool hơn mốc | Dải cấm chỉ gồm không-định-tuyến-công-khai; CDN không nằm trong đó. Đọc thông điệp chặn để biết lớp nào bắt, **không** nới mù |
| `serverAddr()` trả `null` trên Chrome ở phản hồi cache/service worker | Ca hợp lệ bị chặn rời rạc dưới Chrome | Đọc `resp.fromServiceWorker()` rồi mới quyết. Production đang chạy Lightpanda nên rủi ro này chưa chạm tới |
| Ai đó bật `SCAN_ALLOW_PRIVATE_HOSTS` trên production | Cảnh báo khởi động trong `docker compose logs app` | Cảnh báo là cơ chế phát hiện; Phase 4 kiểm `/opt/webmcp-forge/.env`, không phải `.env.example` |
