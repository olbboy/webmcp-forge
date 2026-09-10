---
type: brainstorm
date: 2026-09-10
slug: production-webmcps-net
status: blocked on 1 decision (nơi chạy app Forge)
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
