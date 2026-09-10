---
title: "Phase 2: Rate-Limit"
status: todo
---

# Phase 2: Rate-Limit

## Overview

Giới hạn tần suất gọi `/api/scan` và số lượt quét đồng thời, để một người lạ không ép được droplet 2 GB — nơi có hệ thống ngân hàng đang chạy — mở trình duyệt liên tục. Kèm dọn hai chế độ hỏng mà rà soát đối kháng chỉ ra: chỗ đồng thời bị rò vĩnh viễn, và job kẹt ở `"scanning"`.

## Requirements

- [ ] Chức năng: quá ngưỡng → 429 kèm `Retry-After`
- [ ] Chức năng: trần đồng thời; request vượt nhận 429 ngay, **không xếp hàng**
- [ ] Chức năng: chỗ đồng thời **tự thu hồi** khi lượt quét treo — không khoá vĩnh viễn
- [ ] Chức năng: khoá đếm không bị người gọi tự đặt, và không bỏ qua được bằng IPv6
- [ ] Chức năng: job kẹt `"scanning"` quá hạn được coi là lỗi, không chặn người dùng mãi
- [ ] Phi chức năng: ngưỡng đổi được qua `.env`, không rebuild
- [ ] Phi chức năng: `Map` đếm có trần cứng
- [ ] Phi chức năng: bộ test hiện tại quét nhiều lần liên tiếp vẫn chạy

## Architecture

Đặt trong route handler, **không** trong `proxy.ts` — xem `plan.md`. Đo trên production xác nhận **đúng một tiến trình `next-server`**, nên `Map` cấp module là chỗ đếm hợp lệ. Không cần Redis, không cần KV.

```
POST /api/scan
   ├─ clientIp(request)     cf-connecting-ip → XFF phần tử CUỐI → từ chối
   ├─ rateKey(ip)           IPv4 giữ /32 · IPv6 cắt /64
   ├─ acquireScan()         trần đồng thời + thu hồi chỗ quá hạn   ← TRƯỚC takeSlot
   ├─ takeSlot(key)         cửa sổ ngắn + trần ngày (mốc UTC)
   ├─ … runScan() …
   └─ releaseScan()         finally, ĐỐI XỨNG với acquire
```

`acquireScan` trước `takeSlot`: nếu ngược lại, một request bị từ chối vì **trần đồng thời** vẫn đốt mất suất trong ngày của người dùng đó.

### Khoá đếm — hai lỗi phải tránh

**Một:** `x-forwarded-for` **phần tử đầu là giá trị do khách gửi** — Cloudflare *nối thêm* IP thật vào cuối chuỗi có sẵn. Lấy phần tử đầu nghĩa là kẻ tấn công tự chọn xô đếm: mỗi request một xô mới, giới hạn thành số không. Lấy **phần tử cuối** (chặng gần nhất, do cloudflared đặt), hoặc từ chối phục vụ thay vì suy ra khoá từ dữ liệu khách kiểm soát.

`CF-Connecting-IP` đáng tin **trong đúng kiến trúc này** vì host không mở cổng inbound nào — mọi request bắt buộc qua Cloudflare edge. Nếu sau này mở cổng trực tiếp, giả định vỡ; ghi chú ngay trong `rate-limit.ts`.

**Hai:** khách IPv6 dân dụng thường được cấp cả `/64`. Đếm theo địa chỉ đơn thì đổi địa chỉ nguồn là thao tác một dòng và mỗi địa chỉ là một xô mới. **Cắt IPv6 về `/64`** trước khi làm khoá.

### Xô `"unknown"` không được là công tắc tắt dịch vụ

Nếu `CF-Connecting-IP` vắng, dồn mọi khách vào một xô với `MAX_PER_WINDOW=1` nghĩa là **cả sản phẩm phục vụ 1 lượt/30 giây cho toàn thế giới** — tự-DoS rẻ hơn cả DoS bằng RAM. Cho xô `"unknown"` một trần riêng, rộng (`SCAN_RATE_UNKNOWN_PER_DAY`, mặc định 200), và **đóng câu hỏi header trước khi deploy** (xem `plan.md` → Open Questions #1).

### Chỗ đồng thời phải có đồng hồ chết

`finally` chỉ chạy khi promise **settle**. Đường quét có ít nhất ba chỗ không timeout: `chromium.launch()`/`connectOverCDP()` (`scanner.ts:102,128-140`), `context.close()` (`scanner.ts:229-231`), và `maxDuration = 60` ở `route.ts:5` **không được `next start` tự host thi hành** — đó là gợi ý cho nền tảng serverless. `SCAN_TIMEOUT_MS` chỉ được kiểm *giữa các trang* (`scanner.ts:216`).

Hai lượt treo = `/api/scan` trả 429 vĩnh viễn cho mọi người, kể cả Leo. Đường thoát duy nhất là restart container — mà restart lại phá mạng Lightpanda.

→ `acquireScan()` lưu timestamp; chỗ quá `SCAN_TIMEOUT_MS * 2` bị thu hồi. Và route bọc `runScan` bằng `Promise.race` với timeout cứng.

### Job kẹt `"scanning"`

`jobs.ts:85` ghi job `status:"scanning"` trước khi quét; chỉ hai đường thoát, cả hai nằm trong tiến trình đang chạy. OOM-kill hoặc deploy giữa chừng để job nằm lại vĩnh viễn, rồi `jobs.ts:169-171` trả `409 "Scan is still running"` mãi mãi. UI (`job-catalog.tsx:183`) chỉ xử lý `status === "error"`, không có nút nào gỡ ra.

→ Trong `getJob`, nếu `status === "scanning"` và `Date.now() - Date.parse(updatedAt) > SCAN_TIMEOUT_MS * 2` thì coi là `"error"` với thông điệp "lượt quét bị gián đoạn".

### Ngưỡng mặc định

| Biến | Mặc định | Lý do |
|---|---|---|
| `SCAN_RATE_WINDOW_MS` | `30000` | webmcp.com — chỉ đọc danh bạ — vẫn giới hạn 30 req/IP/10 phút. Quét đắt hơn nhiều bậc |
| `SCAN_RATE_MAX_PER_WINDOW` | `1` | một lượt quét mỗi 30 giây cho mỗi khoá |
| `SCAN_RATE_MAX_PER_DAY` | `20` | trần ngày, chặn rò rỉ chậm |
| `SCAN_RATE_UNKNOWN_PER_DAY` | `200` | xô không xác định được IP — rộng hơn, để không tự-DoS |
| `SCAN_MAX_CONCURRENT` | **`1`** | xem bên dưới |
| `SCAN_RATE_MAP_MAX` | `5000` | trần cứng mỗi `Map` |
| `SCAN_RATE_LIMIT_DISABLED` | *(vắng)* | `"1"` để tắt; `tests/setup.ts` đặt |

**Vì sao `1` chứ không phải `2`.** Bản đầu chọn 2 dựa trên "225,7 MiB `anon` một lượt; máy còn 761 MiB". Ba chỗ sai: (a) ràng buộc thật là `mem_limit: 900m` của **container**, không phải RAM trống của host; (b) cgroup v2 giết theo `memory.current` = anon + page cache + kernel, không theo `anon`; (c) repo tự mâu thuẫn — `docker-compose.yml:24` ghi *"250 MB server + **400-600 MB browser**"*, `deployment-guide.md:148` ghi *"Chrome ~350 MB, Lightpanda ~20 MB"*, kế hoạch ghi 225,7 MiB. Chưa từng có phép đo nào ở mức **2 lượt song song**.

Mặc định phải là giá trị an toàn nhất. Nâng lên sau khi Phase 4 đo thật ở mức đồng thời — và với Lightpanda (~20 MB/lượt) nhiều khả năng nâng được khá cao.

## Related Code Files

- Create: `src/lib/rate-limit.ts` — `clientIp()`, `rateKey()`, `takeSlot()`, `acquireScan()`, `releaseScan()`, `__resetForTests()`
- Create: `tests/rate-limit.test.ts`
- Modify: `src/app/api/scan/route.ts` — cổng chặn + `Promise.race` + `finally` đối xứng
- Modify: **`src/lib/jobs.ts`** — coi job `"scanning"` quá hạn là lỗi
- Modify: `tests/setup.ts` — `SCAN_RATE_LIMIT_DISABLED=1`
- Modify: **`.env.example`** — khai các biến ngưỡng (giá trị thật đặt ở `/opt/webmcp-forge/.env`)
- Modify: `README.md` — bảng API ghi 429 · `docs/decisions.md`
- Đọc để đối chiếu: `src/components/scan-form.tsx:31-44` (chưa đọc `Retry-After`; ngoài phạm vi, ghi lại)

**Không** khai ngưỡng trong `docker-compose.yml`: service `app` dùng `env_file: .env` và không có khối `environment:`; thêm `environment:` sẽ **đè** `.env`. Ngoài ra compose được git theo dõi còn deploy dùng `git reset --hard`, nên sửa ngưỡng tại chỗ trong compose sẽ bị xoá ở lần deploy sau.

## Implementation Steps

1. **Đóng Open Question #1 trước khi viết mã.** Log một dòng header trên container hiện tại (hoặc đọc log sau một request thật) để biết `CF-Connecting-IP` có tới origin không. Nếu vắng, **không** deploy `MAX_PER_WINDOW=1`. Việc này không cần Phase 1-3, làm được ngay.
2. **`src/lib/rate-limit.ts`**
   - `clientIp(request)` — `cf-connecting-ip`; nếu vắng thì phần tử **cuối** của `x-forwarded-for`; nếu vẫn vắng trả `null`. Không dùng `true-client-ip` (chỉ Enterprise; header optional chưa bật thì giả mạo được).
   - `rateKey(ip)` — `null` → `"unknown"`; IPv4 giữ nguyên; IPv6 cắt `/64`.
   - Hai `Map<string,{count,resetAt}>`: cửa sổ ngắn và ngày (mốc UTC). Vượt `SCAN_RATE_MAP_MAX` → xoá mục hết hạn, **vẫn vượt thì xoá theo LRU**. Mục ngày sống 24h nên chỉ xoá-hết-hạn là không đủ.
   - `acquireScan()` — trả `true` ngay khi giới hạn tắt (đọc env **bên trong hàm**), để `try/finally` luôn đối xứng. Lưu timestamp; thu hồi chỗ quá `SCAN_TIMEOUT_MS * 2`.
   - `releaseScan()`, `__resetForTests()`.
   - Mọi hàm đọc env **lúc gọi**, không cache cấp module.
3. **`src/app/api/scan/route.ts`.** `acquireScan()` → `takeSlot()` → `Promise.race([runScan(...), timeout])` → `finally { releaseScan(); }`. `releaseScan` **vô điều kiện** trong `finally`, cân với `acquireScan` luôn được gọi.
4. **`src/lib/jobs.ts`.** `getJob` coi `"scanning"` quá hạn là `"error"`.
5. **`tests/setup.ts`.** `process.env.SCAN_RATE_LIMIT_DISABLED = "1"`.
6. **`tests/rate-limit.test.ts`** — bật lại giới hạn trong `beforeEach` + `__resetForTests()`:
   - `cf-connecting-ip` thắng `x-forwarded-for`
   - `x-forwarded-for: "1.2.3.4, 5.6.7.8"` → lấy **`5.6.7.8`** (phần tử cuối), không phải `1.2.3.4`
   - hai IPv6 khác nhau **trong cùng `/64`** dùng chung xô
   - hai IP khác nhau không ảnh hưởng nhau
   - quá ngưỡng → 429 + `Retry-After` là số dương
   - cửa sổ trôi qua → cho phép lại (`vi.useFakeTimers()`, không `sleep`)
   - trần đồng thời: đúng `SCAN_MAX_CONCURRENT` lần rồi từ chối; sau `releaseScan()` lại nhận
   - **chỗ treo được thu hồi**: acquire đủ trần, đẩy đồng hồ vượt `SCAN_TIMEOUT_MS*2`, acquire tiếp phải nhận
   - **`acquireScan()` khi giới hạn tắt vẫn trả `true`** và `releaseScan()` không đẩy bộ đếm xuống âm — `vitest.config.mts:14` đặt `fileParallelism: false` nên mọi file test chung một tiến trình và một bộ đếm
   - 10.000 khoá khác nhau liên tiếp → `Map.size` vẫn dưới trần
   - route trả 400 cho URL sai định dạng (đường ném thật duy nhất) rồi lượt kế vẫn chạy được
7. **`.env.example` + `README.md` + `docs/decisions.md`.**

## Todo

- [ ] Đóng câu hỏi `CF-Connecting-IP` **trước** khi viết mã
- [ ] `src/lib/rate-limit.ts` — XFF phần tử cuối, IPv6 `/64`, trần `Map` + LRU
- [ ] `acquireScan` có timestamp + thu hồi chỗ quá hạn
- [ ] Thứ tự `acquireScan` → `takeSlot`
- [ ] `Promise.race` timeout cứng ở route; `finally` đối xứng
- [ ] Job `"scanning"` quá hạn → `"error"` trong `jobs.getJob`
- [ ] `tests/setup.ts` tắt giới hạn cho bộ test cũ
- [ ] `tests/rate-limit.test.ts` đủ 11 ca ở bước 6
- [ ] Ngưỡng vào `.env.example` (**không** vào `docker-compose.yml`)
- [ ] `README.md` + `docs/decisions.md`

## Success Criteria

- [ ] `npm test` xanh
- [ ] Hai lần gọi trong 30 giây cùng khoá → lần hai 429 kèm `Retry-After`
- [ ] Hai IPv6 trong cùng `/64` dùng chung giới hạn
- [ ] `x-forwarded-for` do khách đặt **không** đổi được xô đếm
- [ ] Chỗ đồng thời tự thu hồi sau khi quá hạn — chứng minh bằng test đồng hồ giả
- [ ] Đổi `SCAN_RATE_MAX_PER_WINDOW` qua `.env` thì hành vi đổi theo, không rebuild
- [ ] Job kẹt `"scanning"` quá hạn trả lỗi rõ ràng, không phải 409 vĩnh viễn

## Risk Assessment

| Rủi ro | Dấu hiệu | Phản ứng đã định trước |
|---|---|---|
| Quên `releaseScan()` hoặc `acquire`/`release` lệch | Sau vài request, mọi lượt 429 | Có ca test riêng cho cả hai. Đây là lỗi nguy hiểm nhất của phase |
| `CF-Connecting-IP` không tới origin | Log ở bước 1 | **Chặn bước 3**: không deploy `MAX_PER_WINDOW=1` khi chưa biết. Xô `"unknown"` có trần rộng riêng |
| Pseudo IPv4 "Overwrite Headers" bật trên zone | IPv6 dồn về một IPv4 giả | Liếc dashboard (Open Question #2). Ảnh hưởng độ chính xác, không ảnh hưởng tính đúng |
| Mất trạng thái đếm khi container restart | Khoảng ngắn không giới hạn sau deploy | Chấp nhận có ý thức. Rule Cloudflare 10 giây ở Phase 4 là lưới đỡ |
| Nhiều instance trong tương lai | Mỗi tiến trình đếm riêng | Đã đo: đúng 1 tiến trình `next-server`. Nếu nhân bản, giả định vỡ — ghi chú ngay trong `rate-limit.ts` |
| Ngưỡng quá chặt, Leo bị chặn lúc demo | 429 khi tự thử | Sửa `/opt/webmcp-forge/.env` + `up -d`, không cần `--build` |
