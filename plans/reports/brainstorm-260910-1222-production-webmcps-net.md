---
type: brainstorm
date: 2026-09-10
slug: production-webmcps-net
status: phần CDN đã live; còn chờ quyết định nơi chạy app Forge
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
