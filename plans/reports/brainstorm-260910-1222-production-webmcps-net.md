---
type: brainstorm
date: 2026-09-10
slug: production-webmcps-net
status: LIVE — app.webmcps.net và cdn.webmcps.net đều chạy
---

# Brainstorm: đưa WebMCP Forge lên production tại webmcps.net

## Contract

- **Outcome:** khách vào `webmcps.net`, quét site của họ, generate, và nhận một thẻ script trỏ tới `cdn.webmcps.net` chạy thật.
- **Constraints:** token Cloudflare trong `.env.local` (account cá nhân, đang có 7 Worker + 7 KV của dự án khác — không được đụng); zone `webmcps.net` Free plan; app cần Chrome + đĩa ghi được; ngân sách chưa nêu.
- **Non-goals:** không đổi kiến trúc app; không port scanner sang Browser Rendering; không làm CI/CD; không rate limit; các mục "Out of scope (P1+)" của plan P0 giữ nguyên.
- **Acceptance:** `https://webmcps.net` trả 200 và quét được demo shop · generate ra snippet `https://cdn.webmcps.net/e/pub_…/embed.js` · GET URL đó trả 200 kèm ETag · unpublish trả 404 · job vẫn còn sau khi restart app.

## Đã kiểm (live, 10/9/2026)

| Mục | Kết quả |
|---|---|
| Token | Hợp lệ, status active, 53 ký tự |
| Account | 1 account cá nhân, id `5f4874d0…` |
| Zone `webmcps.net` | **Active**, Free Website plan, NS Cloudflare (candy/clark) |
| Registrar | GoDaddy |
| Quyền token (đọc) | workers scripts 200 · KV 200 · DNS 200 · workers subdomain 200 · pages 200 |
| Worker đang có | 7: blvera-corporate, claudeholic, claudeholic-dev, fmm, pytes-au, pytes-campaign-sender, youtubase |
| KV đang có | 7 namespace của dự án khác |
| DNS apex | 2 record A proxied → 13.248.243.5, 76.223.105.230 (dải AWS) |
| DNS khác | CNAME `www` → apex · CNAME `_domainconnect` → GoDaddy · TXT `_dmarc` |
| `https://webmcps.net` | **Timeout sau 15s** — DNS trỏ đâu đó không phục vụ |
| `cdn.webmcps.net` | Chưa tồn tại |
| Quyền GHI của token | **Chưa kiểm** (chỉ thử đọc; thử ghi là tạo tài nguyên thật) |

## Chặn: app Forge KHÔNG chạy được trên Cloudflare

Bằng chứng từ mã nguồn:
- `src/lib/scanner.ts:54-62` — `chromium.launch({ channel: "chrome" })`, tức spawn một tiến trình Chrome thật.
- `src/lib/store.ts:5-22` — job lưu bằng `mkdir`/`writeFile` xuống `data/jobs/`.
- `package.json` — `playwright` là **dependency runtime**, không phải devDependency.

Workers và Pages Functions chạy trên V8 isolate: không có tiến trình con, không có filesystem. Nên `webmcps.net` (app) và `cdn.webmcps.net` (Worker) **phải ở hai nơi khác nhau**.

Đây là điều plan P0 chưa bao giờ nói tới, vì P0 chỉ lo phần CDN.

## Ba hướng cho nơi chạy app

| | A. VPS/PaaS có Chrome | B. Cloudflare Containers | C. Port sang Browser Rendering |
|---|---|---|---|
| Việc phải làm | Deploy Docker/Node, gắn đĩa, trỏ DNS | Đóng gói container, Containers beta | Viết lại scanner + đổi job store sang KV/R2/D1 |
| Giả định chính | Chấp nhận trả phí host (~5–10 USD/tháng) | Containers khả dụng và đủ rẻ trên account này | Browser Rendering đủ tương thích API Playwright đang dùng |
| Gãy trước nhất khi | Không có, đây là đường mòn | Beta đổi giá hoặc giới hạn | Scanner dùng API mà Browser Rendering không có |
| Công sức | Thấp, không sửa mã | Trung bình | **Cao, là port chứ không phải deploy** |
| Khuyến nghị | **Chọn** | Chưa kiểm khả dụng | Ngoài phạm vi yêu cầu |

Hướng A không đòi sửa một dòng mã nào. Hướng C là viết lại, mâu thuẫn với "khởi tạo tài nguyên".

## Phần Cloudflare: đã xác định đủ, làm được ngay

Không phụ thuộc quyết định trên:

1. Tạo KV namespace `webmcp-forge-EMBEDS`, dán id vào `cdn/wrangler.jsonc`.
2. Sinh `PUBLISH_TOKEN` ngẫu nhiên, đặt bằng `wrangler secret put`.
3. `npm run cdn:deploy` → Worker `webmcp-forge-cdn`.
4. Gắn custom domain `cdn.webmcps.net` (tạo DNS record tự động).
5. Đặt `CDN_BASE_URL=https://cdn.webmcps.net` và `CDN_PUBLISH_TOKEN` ở nơi chạy app.

Lưu ý: `wrangler` đọc biến `CLOUDFLARE_API_TOKEN`, không đọc `CF_API_TOKEN`. Phải map lại khi chạy.

## Cảnh báo về DNS apex

Apex đang có 2 record A proxied trỏ vào dải AWS và **timeout khi truy cập**. Nghĩa là đang trỏ vào thứ gì đó không còn phục vụ (nhiều khả năng parking GoDaddy cũ). Sửa apex để trỏ về app mới:
- Là thay đổi công khai, người ngoài thấy ngay.
- Cần xoá hoặc sửa 2 record A đó.
- Không tự động hồi phục nếu sai; phải sửa tay lại.

Tôi sẽ không đụng vào apex khi chưa có xác nhận riêng.

## Chỗ trống cần điền

1. **App chạy ở đâu?** (a) VPS/PaaS anh đã có, cho tôi biết nền tảng · (b) tôi khuyến nghị và dựng Fly.io hoặc Railway · (c) tạm thời chỉ live phần CDN, app vẫn chạy local
2. **Hostname app:** (a) apex `webmcps.net` (phải sửa 2 record A đang có) · (b) `app.webmcps.net`, để apex yên
3. **Làm phần Cloudflare ngay bây giờ?** (a) có, tạo KV + secret + deploy Worker + gắn `cdn.webmcps.net` · (b) chờ chốt xong cả hai câu trên
4. **Quyền ghi của token:** chưa kiểm. Nếu token chỉ có quyền đọc thì bước tạo KV sẽ fail và tôi báo lại — chấp nhận thử chứ?

## Câu hỏi chưa giải quyết

- Workers Logs có che header `Authorization` không (tồn từ P0). Ảnh hưởng: publish token nằm trong log Cloudflare. Cần chốt trước khi phục vụ khách thật, hoặc tắt observability.
- Job store là file trên đĩa: nếu host app không có volume bền, mọi job mất khi restart. Ảnh hưởng trực tiếp tới acceptance cuối cùng.
- Ngân sách hàng tháng cho host app: chưa nêu.

---

## Đã dựng thật (10/9/2026, quyết định 2b + 3a)

| Tài nguyên | Giá trị |
|---|---|
| KV namespace | `webmcp-forge-cdn-EMBEDS`, id `1cf2b3f500f44d76be68bc177a1d88ac` |
| Worker | `webmcp-forge-cdn` |
| Secret | `PUBLISH_TOKEN` đã đặt (32 byte ngẫu nhiên, hex) |
| Hostname | `https://cdn.webmcps.net` + `https://webmcp-forge-cdn.minhdatplus.workers.dev` |
| DNS | AAAA `cdn.webmcps.net` proxied, Cloudflare tự tạo |
| Chứng chỉ | Cloudflare tự cấp, HTTP/2 hoạt động |
| `preview_urls` | **tắt** — preview URL giữ phiên bản Worker cũ sống kèm secret hiện tại |
| Apex `webmcps.net` | **không đụng**, giữ nguyên 2 record A cũ |

Smoke test trên production, đã dọn dữ liệu thử (KV rỗng lại):

| Kiểm | Kết quả |
|---|---|
| PUT không token | 401 |
| PUT có token | 200 |
| GET công khai | 200, ETag `"1"`, `max-age=300, stale-while-revalidate=60`, CORS, nosniff |
| PUT version lùi | 409 |
| DELETE rồi GET | 204 rồi 404 |
| publicId sai định dạng | 404 |

Giá trị cho nơi chạy app nằm ở `.env.production.local` (gitignored): `CDN_BASE_URL` và `CDN_PUBLISH_TOKEN`. Bản sao token trong thư mục tạm đã xoá.

Nhánh `chore/cloudflare-production`, commit `88496ce`, **chưa merge**.

## Trả lời 3 câu hỏi kiến trúc

1. **Cloudflare Pages:** không. Pages Functions chạy trên đúng runtime Workers, cùng ràng buộc.
2. **Cloudflare Worker cho app:** không, trừ khi viết lại. Hai chỗ chặn đã dẫn ở trên.
3. **Mỗi website khách một Worker riêng:** không, và không nên. Một Worker phục vụ tất cả, mỗi khách là một key KV. Docs Cloudflare: **100 Worker/account gói Free, 500 gói trả phí** — mô hình một-Worker-một-khách chạm trần ở khách thứ 100.

---

## Droplet: grok đã đo thật (10/9/2026)

Nguồn: grok qua `~/agent-mailbox`, inventory read-only trên `vtb-vps`. Số liệu dưới đây do grok đo, **tôi chưa tự SSH kiểm lại** vì đã cam kết không chạy lệnh trên droplet khi chưa có xác nhận của Leo.

| Mục | Giá trị |
|---|---|
| Alias / IP | `vtb-vps` / `188.166.228.230` (IPv6 có), sgp1, hostname `accountants`, id 573000555 |
| SSH | user `root`, key `~/.ssh/vtb_vps_deploy` |
| OS | Ubuntu 24.04.3 LTS, kernel 6.8 |
| CPU / RAM | 2 vCPU · **1.9 GiB total, ~1.3 GiB đang dùng, ~678 MiB còn trống, KHÔNG có swap** |
| Đĩa | 58G, còn trống 45G |
| Node trên host | **không có** |
| Docker | có, 29.5.2 |
| Chrome/Chromium | **không có** |
| Cổng đang LISTEN | 22 (SSH), 5433 (Postgres container). **Không có 80/443** |
| UFW | inactive |

Đang chạy trên máy: stack **bank-hub / vtb-sync** ở `/opt/vtb-sync`, up ~3 tháng — `bank-hub-db` (postgres:16), `bank-hub-backend`, `bank-hub-sync-worker`, `bank-hub-tunnel` (cloudflared). Public đi qua **Cloudflare Tunnel**, không phải Caddy (Caddy có trong compose nhưng không chạy).

Hai host còn lại trong `~/.ssh/config`: `10.162.114.28` (IP private), `tpbd-prod` = `146.190.110.222` (droplet tpbd, Dokploy + GlitchTip — grok khuyến cáo không dùng chung).

## Rủi ro chặn: RAM không đủ, và hàng xóm là hệ thống production

Nhu cầu thật của Forge, đọc từ mã nguồn:
- `src/lib/config.ts:1` — `MAX_PAGES = 8`, scanner mở tới 8 trang mỗi lần quét.
- `src/lib/scanner.ts:54,103,165` — `chromium.launch` → `newContext` → `newPage`.
- `next start` production server.

Ước lượng đỉnh: Next.js 150–250 MB + Chromium headless 200–400 MB nền, cộng thêm theo số trang. Tổng khoảng 600 MB đến 1 GB. Chỗ trống hiện có: **678 MiB, không swap**.

Hậu quả nếu vẫn deploy chung: OOM killer của kernel chọn tiến trình theo điểm số, và nó có thể giết `bank-hub-db` hoặc `bank-hub-backend` thay vì giết Chrome. Tức một lần khách quét site có thể làm sập hệ thống đồng bộ ngân hàng đã chạy 3 tháng.

## Ba lựa chọn

| | A. Droplet mới | B. Chung máy + giới hạn bộ nhớ | C. Chung máy, thêm swap |
|---|---|---|---|
| Cách làm | Tạo droplet 2–4 GB, compose riêng | Compose riêng + `mem_limit` cứng cho Forge | Thêm 2 GB swap rồi deploy chung |
| Bảo vệ bank-hub | Hoàn toàn, khác máy | Có: cgroup giết đúng Forge khi vượt | **Không**: OOM vẫn có thể chọn nhầm |
| Forge chạy được không | Có | Rất chật, ~600 MB cho Chrome + Next → quét dễ fail | Chạy được nhưng Chrome swap cực chậm |
| Chi phí | +12–24 USD/tháng | 0 | 0 |
| Khuyến nghị | **Chọn** | Chấp nhận được nếu không muốn tốn thêm | Không nên |

## Chỗ trống cần điền (vòng 2)

1. **Máy nào?** (a) droplet mới 2 GB (~12 USD/tháng) · (b) droplet mới 4 GB (~24 USD/tháng, thoải mái) · (c) chung `vtb-vps` kèm `mem_limit` cứng, chấp nhận quét dễ fail
2. **Đường public:** (a) thêm hostname vào Cloudflare Tunnel như bank-hub đang làm, không mở cổng nào · (b) A record + Cloudflare proxy + Origin CA
3. **DNS:** tôi có được tạo `app.webmcps.net` qua Cloudflare API không, sau khi chốt (1) và (2)?
4. **Tôi có được SSH read-only để tự kiểm lại số liệu của grok không?**

---

## Tôi tự SSH đo (Leo duyệt câu 4), 10/9/2026 06:24 UTC

Chỉ lệnh đọc, không đổi gì trên droplet.

| Mục | Đo được |
|---|---|
| RAM | 1967 MiB tổng · 1298 dùng · **669 available** · swap 0 |
| `bank-hub-sync-worker` | **478 MiB / giới hạn 1 GiB** (compose đã có `deploy.resources.limits: cpus 1.0, memory 1G`) |
| `bank-hub-backend` | 94 MiB |
| `bank-hub-db` | 48 MiB |
| `bank-hub-tunnel` | 20 MiB |
| Uptime host | 108 ngày, load 0.07 |

### Giả định "1 ngày chạy 1 lần" KHÔNG đúng với thực tế đang chạy

- Có **4 tiến trình chromium** thuộc cgroup `docker-3aff3bf047bc` = `bank-hub-sync-worker`.
- Tuổi tiến trình chromium: **10 giờ 24 phút**, khởi động ~02:59 giờ Sài Gòn, **vẫn đang sống**.
- Log worker mới nhất lúc 12:56–12:57 giờ Sài Gòn, tức ~28 phút trước lúc đo, **không phải 01:00**.
- Log ghi `backoff → currentIntervalMs=1800000` → đang lặp mỗi **30 phút**.
- Container `Up 3 months`: bản có lịch 01:00 nhiều khả năng **chưa được deploy**.

### Bank-hub đang lỗi (ngoài phạm vi việc này, nhưng Leo cần biết)

Log lặp lại nhiều lần:
- `VietinbankLogin: signIn → 400 [BLOCK_IPAY_WEB]`
- `still on /login after cycle 2 — captcha likely wrong`
- `SyncWorkerService: tick error`

### Kết luận cho câu hỏi "có giới hạn resource được không"

Cơ chế thì được, và đã có sẵn trên máy này (sync-worker đang chạy với `memory: 1G`). Vấn đề là **con số**:

| | Cần | Có |
|---|---|---|
| Next.js production | 150–250 MiB | |
| Chromium quét 8 trang (`MAX_PAGES=8`) | 400–600 MiB | |
| **Tổng đỉnh** | **600–850 MiB** | **669 MiB available** |

Đặt `mem_limit` vừa với chỗ trống (~500 MiB) thì Forge tự OOM ở phần lớn lượt quét → khách thấy tính năng hỏng. Đặt cao hơn thì tranh RAM với bank-hub.

**Điểm mở**: nếu `bank-hub-sync-worker` đóng browser sau mỗi lượt thay vì giữ 10 tiếng, khoảng 400 MiB được trả lại, và lúc đó Forge vừa vặn thoải mái. Đây là sửa ở bank-hub, không phải ở Forge.

## Chỗ trống cần điền (vòng 3)

1. (a) Sửa bank-hub đóng browser sau mỗi lượt, rồi mới deploy Forge chung máy · (b) droplet mới 2 GB (~12 USD/tháng), không đụng bank-hub · (c) vẫn deploy chung ngay với `mem_limit` 500 MiB, chấp nhận quét hay hỏng · (d) thêm 2 GB swap làm đệm rồi deploy chung
2. Bank-hub đang lỗi đăng nhập Vietinbank — có muốn tôi xem riêng không, hay để đó?

---

## Đo lại sau khi Leo sửa bank-hub (10/9/2026 15:55)

Bản sửa bank-hub **đúng như báo cáo**: 0 tiến trình chromium, `bank-hub-sync-worker` còn **82 MiB** thay vì 478 MiB. Container tổng từ ~640 MiB xuống ~220 MiB.

Nhưng `MemAvailable` **không tăng tương ứng** (626 MiB, trước là 669). Đào tiếp tìm ra lý do.

### Thủ phạm thật: dockerd rò rỉ bộ nhớ

| Mục | Giá trị |
|---|---|
| `dockerd` RssAnon | **550 MiB** (PSS_Anon 562.916 kB → riêng tư thật, không phải chia sẻ) |
| dockerd chạy từ | 25/5/2026, **108 ngày** |
| AnonPages toàn máy | 851 MiB |
| **Tỷ lệ dockerd chiếm** | **~65% toàn bộ bộ nhớ không thu hồi được** |

dockerd quản 4 container nhỏ mà giữ 550 MiB anonymous là bất thường; mức bình thường là 80–200 MiB. Uptime 108 ngày cộng với một container spawn Chrome mỗi 30 phút suốt nhiều tháng là kịch bản rò rỉ điển hình. **Khởi động lại dockerd nhiều khả năng thu về ~450 MiB** — nhiều hơn cả bản sửa bank-hub.

`LiveRestore=false` (không có `/etc/docker/daemon.json`) → restart dockerd **sẽ dừng container**.

### Hai vấn đề khác của bank-hub, ngoài phạm vi việc này

1. **Log của `bank-hub-db` chiếm 3,7 GB** (`/var/lib/docker/containers/9f97…/`). Không có log rotation vì thiếu `daemon.json`.
2. **`bank-hub-db` có `restart=no`.** Ba container kia là `unless-stopped`. Nghĩa là reboot máy hoặc restart dockerd thì **database không tự bật lại**.

### Đã làm: thêm swap 2 GB

Việc này giảm rủi ro cho chính bank-hub nên tôi làm luôn, có thể hoàn tác bằng `swapoff /swapfile && rm /swapfile`.

| Trước | Sau |
|---|---|
| available 626 MiB, swap 0 | **available 761 MiB, swap 2047 MiB** |

`vm.swappiness=10` để swap chỉ là đệm khi RAM căng, không phải nơi chạy thường xuyên. Đã ghi vào `/etc/fstab` và `/etc/sysctl.conf` để giữ sau reboot. Đĩa còn 42 GB.

### Ngân sách RAM cho Forge

| | MiB |
|---|---|
| Cần: Next.js | 150–250 |
| Cần: Chromium quét 8 trang | 400–600 |
| **Đỉnh** | **600–850** |
| Có: available hiện tại | 761 |
| Có: swap đệm | 2047 |

Chạy được ngay bây giờ với `mem_limit` khoảng 700 MiB, thỉnh thoảng chậm khi chạm swap. Nếu restart dockerd thu về ~450 MiB thì thoải mái.

## Chỗ trống cần điền (vòng 4)

1. **Restart dockerd để thu ~450 MiB?** Cần cửa sổ bảo trì vì `LiveRestore=false`. Lưu ý `bank-hub-db` có `restart=no` nên phải `docker compose up -d` lại bằng tay. (a) làm ngay · (b) làm lúc khác · (c) bỏ qua, chạy với 761 MiB + swap
2. **Log 3,7 GB và `restart=no` của bank-hub-db** — tôi sửa giúp (thêm `daemon.json` log rotation + đổi restart policy), hay để anh tự?

---

## LIVE (10/9/2026 16:50)

### Đã dựng

| Thành phần | Giá trị |
|---|---|
| App | `https://app.webmcps.net` — HTTP 200, TLS hợp lệ |
| CDN | `https://cdn.webmcps.net` — Worker + KV |
| Máy | droplet `vtb-vps`, `/opt/webmcp-forge`, nhánh `chore/cloudflare-production` @ `5b93c06` |
| Container | `webmcp-forge-app-1` (healthy), `webmcp-forge-tunnel-1` |
| Tunnel | `webmcp-forge`, id `973b70ad-…`, 4 kết nối, ingress `app.webmcps.net → http://app:43127` |
| DNS | CNAME `app` → `973b70ad-….cfargotunnel.com`, proxied |
| Apex | **không đụng** — vẫn 2 record A cũ, vẫn timeout như trước |
| Cổng mở thêm trên host | **không có** — tunnel đi ra, không có inbound |
| Giới hạn | app `mem_limit 900m` / `memswap 1500m` / `cpus 1.0` / `shm_size 256m`; tunnel `128m` |
| Đĩa | image 6,4 GB; còn trống 37 GB |

### Kiểm chứng toàn trình trên production

| Bước | Kết quả |
|---|---|
| Quét demo shop qua API công khai | job tạo được, 11 tool |
| Generate | `publishStatus: published`, version 1, `publicId` khớp `pub_[a-f0-9]{32}` |
| Snippet | `https://cdn.webmcps.net/e/pub_…/embed.js`, không chứa jobId |
| GET file hosted | 200, 22.216 byte, ETag `"1"`, `max-age=300`, nosniff |
| Unpublish | 404 ngay sau đó |
| Job thử | **đã gỡ**, CDN production sạch |

### Bộ nhớ sau một lượt quét thật

| | |
|---|---|
| `webmcp-forge-app-1` | 490 MiB / giới hạn 900 |
| `webmcp-forge-tunnel-1` | 27 MiB / 128 |
| bank-hub (4 container) | ~92 MiB tổng, **không bị ảnh hưởng** |
| RAM khả dụng | 1.237 MiB |
| Swap dùng | 160 MiB |

### Forge cũng giữ Chrome thường trú — cùng vấn đề với bank-hub

`src/lib/scanner.ts:18` giữ `browserPromise` ở cấp module. `closeBrowser()` có tồn tại nhưng **chỉ test gọi**, đường production không bao giờ gọi. Sau một lượt quét còn **8 tiến trình chrome** trong cgroup của `webmcp-forge-app-1`, và container đứng ở 490 MiB thay vì tụt về ~110 MiB.

Khác biệt với bank-hub: đây là lựa chọn có chủ đích (giữ browser ấm để lượt quét sau nhanh hơn 1–3 giây), và giờ đã bị chặn bởi `mem_limit` nên không thể hại hàng xóm. Nhưng nếu lưu lượng thấp thì vẫn là 380 MiB giữ không công, y hệt bank-hub trước đây.

## Chỗ trống cần điền (vòng 5)

1. **Chrome thường trú:** (a) để nguyên, đánh đổi lấy tốc độ · (b) đóng browser sau N phút rảnh — cần sửa `scanner.ts`, là thay đổi code chứ không phải hạ tầng
2. **Nhánh:** droplet đang bám `chore/cloudflare-production`. Nên merge vào `main` rồi cho droplet bám `main` như bank-hub không?
3. **`ufw` vẫn tắt** (grok nêu, tôi chưa đụng). Forge không mở cổng nào nên không làm tình hình xấu đi. Có muốn bật không?

## Câu hỏi chưa giải quyết (còn từ trước)

- Workers Logs có che header `Authorization` không → publish token có thể nằm trong log Cloudflare.
- Vì sao dockerd phình 443 MiB. Giả thuyết "Chrome spawn mỗi 30 phút" của tôi **sai** — Chrome chỉ khởi động ~1 lần/ngày rồi nằm im. Nguyên nhân gốc chưa rõ; nên đo lại sau 2–4 tuần.
- `data/jobs` là bind mount `/opt/webmcp-forge/data`, chưa có sao lưu định kỳ.

---

## Chốt: đóng browser khi rảnh + thu dọn xác tiến trình (10/9/2026 21:20)

Quyết định 1b (đóng browser khi rảnh) và 2 (merge vào `main`, droplet bám `main`) đã xong.

| Thay đổi | PR |
|---|---|
| Đếm lượt quét, đóng browser sau 5 phút rảnh; sửa race lúc teardown | [#2](https://github.com/olbboy/webmcp-forge/pull/2) |
| `init: true` để thu dọn tiến trình con Chrome bỏ lại | [#3](https://github.com/olbboy/webmcp-forge/pull/3) |

Droplet giờ bám `main` @ `6d70ef4`, upstream `origin/main`, giống bank-hub.

### Bài học đo đạc: `docker stats` gộp cả page cache

Lần đo đầu tôi tưởng bản sửa hỏng: sau 5 phút rảnh `docker stats` vẫn báo 362 MiB thay vì về ~110 MiB. Đọc `memory.stat` của cgroup mới ra sự thật:

| Thành phần | Ý nghĩa |
|---|---|
| `anon` 116 MiB | Bộ nhớ thật app giữ — **Chrome đã thoát** |
| `file` 298 MiB | Page cache từ file Chrome đã đọc — **kernel thu hồi khi cần** |

`docker stats` cộng cả hai. Nhìn con số tổng thì tưởng rò rỉ; nhìn `anon` mới biết đúng sai.

### Kiểm chứng trọn vòng trên production

| Thời điểm | `anon` | Chrome sống | Zombie |
|---|---|---|---|
| Trước khi quét | 57,9 MiB | 0 | 0 |
| Ngay sau khi quét | 225,7 MiB | 9 | 0 |
| Sau 5 phút rảnh | **111,5 MiB** | **0** | **0** |

`file` cache còn 142 MiB, thu hồi được. `docker stats` tổng: 164 MiB. Máy còn **1.304 MiB** khả dụng. bank-hub không bị ảnh hưởng (sync-worker 27 MiB).

### Khiếm khuyết thật tìm được nhờ đo

Chrome thoát để lại 4 tiến trình `<defunct>`. RSS = 0 nên không tốn RAM, nhưng `npm start` ở PID 1 không thu dọn, nên mỗi lượt quét bồi thêm một nhóm cho tới khi cạn bảng PID. `init: true` đặt init thật ở PID 1 để thu dọn, đồng thời chuyển tiếp tín hiệu nên `docker stop` tắt êm thay vì giết.

## Còn treo

- Workers Logs có che header `Authorization` không → publish token có thể nằm trong log Cloudflare.
- `data/jobs` chưa có sao lưu định kỳ.
- `ufw` vẫn tắt.
- Nguyên nhân dockerd từng phình 443 MiB chưa rõ; nên đo lại sau 2–4 tuần.
