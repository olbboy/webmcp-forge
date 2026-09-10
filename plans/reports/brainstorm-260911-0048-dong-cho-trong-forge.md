---
type: brainstorm
date: 2026-09-11
slug: dong-cho-trong-forge
status: đã đóng 4/4 câu hỏi treo · 5/5 chỗ trống có khuyến nghị dựa trên bằng chứng
tiếp nối: brainstorm-260911-0019-forge-vs-webmcp-com.md
---

# Đóng chỗ trống: bằng chứng cho từng quyết định

## Tóm tắt một màn hình

- **SSRF không còn là giả thuyết.** Tôi dựng dịch vụ nội bộ giả và quét thử: Forge trả về **tên trường form đăng nhập nội bộ**, đường dẫn `/secrets`, và còn tự sinh sẵn tool `fill_form_admin_login`. Ba biến thể đều lọt: IP riêng trực tiếp · tên miền công khai phân giải ra 127.0.0.1 · chuyển hướng.
- **Tiền lệ rõ ràng:** ngay cả webmcp.com — API đọc, miễn phí — cũng công bố giới hạn 30 request/IP/10 phút. Forge chạy Chrome mà không giới hạn gì.
- **Phát hiện mới trong mã:** Forge tính nhãn `readOnlyHint` rồi **vứt đi** — không truyền vào `registerTool`. Sửa chỗ này gần như miễn phí và mở đường cho toàn bộ việc gắn bậc tin cậy.
- **Tiền đề của báo cáo trước đã sai:** "chỉ có MỘT danh bạ đáng tin" — hôm nay có **ít nhất 4 danh bạ khác đang sống**. Kết luận "đừng làm danh bạ" vẫn đúng, nhưng vì lý do khác.
- **Một khuyến nghị của nhánh nghiên cứu bị tôi bác:** đặt bộ đếm trong `proxy.ts`. Tài liệu Next.js 16.3.4 nói thẳng *"you should not attempt relying on shared modules or globals"* trong Proxy. Đặt trong route handler.
- **Sao lưu đã diễn tập khôi phục thật:** 9 job, khớp từng byte. Tìm thêm 2 khiếm khuyết nhỏ của script.

---

## Phần A — Bốn câu hỏi treo, đã đóng

### A1. Kiểm chứng trực tiếp webmcp.com ✅ ĐÓNG

Đo lại hôm nay qua API công khai (`/api/v1/stats`, `generatedAt: 2026-09-10T17:50:33Z`).

| Chỉ số | Báo cáo 10/9 | Hôm nay | Chênh |
|---|---|---|---|
| Site | 564 | **587** (549 live + 38 demo) | +23 (+4,1%) |
| Tool | 3.763 | **3.947** | +184 (+4,9%) |
| Store Shopify | 833.707 | **833.707** | **0** |
| apiSurface spec / polyfill / mixed | 532 / 28 / 4 | **555 / 28 / 4** | toàn bộ +23 đều là spec |
| answer / act / transact | 44 / 51 / 5 % | 1.741 / 2.020 / 186 = **44,1 / 51,2 / 4,7 %** | gần như đứng yên |
| npm `@nekuda/webmcp-sdk` | 2.196 | **2.615** (+19,1%) | |
| npm `@mcp-b/webmcp-polyfill` | 211.351 | **215.717** (+2,1%) | tỷ lệ 96x → **82x** |

Shopify đứng yên vì nguồn là **file tĩnh** `shopify_webmcp_enabled_ALL_20260803.csv` — chưa làm mới từ 03/08. Nghĩa là toàn bộ tăng trưởng một tuần qua đến từ site tự cài, không phải nguồn Shopify.

**Ba câu treo cũ, kết quả:**

| Câu | Kết quả hôm nay |
|---|---|
| AgentLane có trang giá chưa? | **Vẫn không.** `agentlane.com` nay 301 → `nekuda.ai`; `nekuda.ai/pricing` và `/plans` đều **404**. Sản phẩm đã gộp vào thương hiệu nekuda |
| Scorecard A+…C hiện ở đâu? | **Vẫn không hiển thị.** `/methodology` mô tả đầy đủ thang điểm, nhưng `/api/v1/sites/{host}` không có field `grade` và trang site không chứa badge nào |
| Ngưỡng rate limit API? | **ĐÓNG — có tài liệu.** OpenAPI ghi rõ: *"30 requests per IP per 10 minutes, plus 50 per IP per UTC day and 1000 globally per UTC day"*, 429 kèm `Retry-After` |
| Bẫy enum `kind=read` | **Vẫn hỏng âm thầm.** 200 + rỗng. Nhưng `q` 2 ký tự thì trả 400 có message — họ validate chuỗi, chưa validate enum |

**Hai phát hiện MỚI, quan trọng hơn cả bảng trên:**

1. 🔴 **Tiền đề "chỉ có một danh bạ đáng tin" ĐÃ SAI.** Ngoài webmcp.com, hôm nay còn ít nhất 4 registry đang sống: `webmcp-registry.dev`, `webmcp.xyz`, `webmcp.ora.ai` (dữ liệu JSON mốc **2026-09-10**, tức đang chạy), `webmcptools.io`. Thêm một `agentlanehq.com` **trùng tên nhưng khác công ty**, không liên quan nekuda.
   → Báo cáo trước dựa vào §2 của nghiên cứu gốc để nói lợi thế cạnh tranh thật của nekuda là "danh bạ độc nhất". **Điều đó không còn đúng.**
2. Trang site của webmcp.com có nút **"Run Rescan"** — xác nhận nekuda thật sự có chức năng quét lại giữ nguyên danh tính site, đúng như báo cáo trước phỏng đoán.

### A2. Header IP thật sau Cloudflare Tunnel ✅ ĐÓNG (kèm một chỉnh sửa)

| Header | Gói | Ghi chú |
|---|---|---|
| **`CF-Connecting-IP`** | **có trên Free** | *"provides the client IP address connecting to Cloudflare to the origin web server"* — một giá trị duy nhất, khỏi parse chuỗi |
| `X-Forwarded-For` | Free | chuỗi nhiều giá trị, khó hơn |
| `True-Client-IP` | **chỉ Enterprise** | cảnh báo ngược: header optional chưa bật thì *"its value can be spoofed to any value"* |

**Giả mạo được không?** Không, trong đúng kiến trúc này. Host **không mở cổng inbound nào** (đã xác minh phiên trước) → mọi request bắt buộc qua Cloudflare edge; edge tự gắn header theo kết nối TCP thật, không sao chép từ client.

**Rate limit ở tầng Cloudflare gói Free — không đủ dùng một mình:**

| Gói | Số rule | Cửa sổ đếm tối đa |
|---|---|---|
| **Free** | **1** | **10 giây** |
| Pro | 2 | 1 phút |
| Business | 5 | ~1 ngày |

Free **không thể** tạo rule "1 lượt quét/phút". Chỉ chặn được burst rất ngắn.

🔧 **Chỗ tôi bác khuyến nghị của nhánh nghiên cứu.** Nhánh đề xuất đặt bộ đếm trong `proxy.ts` (Next 16 đổi tên `middleware.ts` → `proxy.ts`, chạy Node.js runtime). Tôi tự mở tài liệu Next.js 16.3.4 và thấy đoạn nhánh đó bỏ sót:

> *"Proxy is meant to be invoked separately of your render code and in optimized cases deployed to your CDN... **you should not attempt relying on shared modules or globals.**"*
> *"We recommend users avoid relying on Middleware unless no other options exist."*

Biến đếm trong bộ nhớ **chính là** "globals". Và `src/app/api/scan/route.ts` đã khai `export const runtime = "nodejs"`, chạy trong đúng một tiến trình Node — đặt bộ đếm ở đó vừa đúng tài liệu, vừa ít file hơn, vừa nằm cạnh chỗ cần chặn.

→ **Kết luận: rate limit + kiểm SSRF đặt trong route handler và lớp scanner, không đặt trong `proxy.ts`.** Rule Cloudflare Free (1 rule, 10 giây) thêm vào như lá chắn burst, không phải cơ chế chính.

**Còn treo:** chưa tìm được dòng tài liệu nói thẳng "cloudflared luôn chuyển tiếp `CF-Connecting-IP`". Đóng bằng một dòng log trên droplet khi triển khai. Ngoài ra nếu bật tuỳ chọn **Pseudo IPv4 "Overwrite Headers"** thì Cloudflare ghi đè header này bằng địa chỉ IPv4 giả — cần liếc dashboard trước khi tin.

### A3. Ngân sách RAM cho health check ✅ ĐÓNG

Số đáng tin là số **đo trên droplet** (cgroup `anon`, từ báo cáo 10/9):

| Thời điểm | `anon` |
|---|---|
| Trước khi quét | 57,9 MiB |
| Ngay sau khi quét 8 trang | **225,7 MiB** |
| Sau 5 phút rảnh | 111,5 MiB |
| Giới hạn container | **900 MiB** |

Health check theo thiết kế đề xuất: mở **1 trang cho mỗi job**, tuần tự, dùng lại browser đang ấm. Chi phí **luôn thấp hơn** một lượt quét 8 trang bình thường — thứ đã chứng minh vừa trong 900 MiB. **Đáp án: vừa, không cần thêm RAM.** Chỉ dài hơn về thời gian, không cao hơn về đỉnh.

Đo tại chỗ trên máy Leo để lấy chi phí biên mỗi trang: tiến trình Chrome chính đứng ở **215 MiB khi rảnh**, lên **218 MiB khi quét 1 trang**, **219 MiB khi quét 4 trang** — tức phần cố định là browser, phần biên mỗi trang rất nhỏ.

⚠️ **Cảnh báo về phép đo của chính tôi:** nếu cộng RSS của cả cây tiến trình trên macOS, con số nhảy lên 499 MiB (rảnh) và 940 MiB (đỉnh 4 trang). Đó là **RSS đếm trùng bộ nhớ dùng chung giữa các tiến trình Chrome**, không phải bộ nhớ thật. Cùng loại bẫy mà báo cáo 10/9 đã gặp với `docker stats`. **Chỉ dùng số `anon` trên droplet để quyết định.**

### A4. Diễn tập khôi phục sao lưu ✅ ĐÓNG — chạy thật, kèm 2 khiếm khuyết

Chạy `scripts/backup-jobs.sh` vào thư mục tạm rồi giải nén ra chỗ khác và so sánh:

| Bước | Kết quả |
|---|---|
| Sao lưu | 9 job, tarball 52 KB, tự xác minh "verified 9 job(s)" |
| Nội dung | 31 mục — **có cả artifact** (7 file `embed.js`), không chỉ JSON |
| Khôi phục | 9/9 file |
| So sánh | `diff -r` **sạch — khớp từng byte** |

**Khiếm khuyết 1 — script chỉ chạy được trên bash 4+.** Bước dọn bản cũ dùng `mapfile`, không có trên bash 3.2 (macOS). Kết quả: script thoát **exit 127 sau khi tarball đã ghi xong an toàn** — tức cron sẽ báo lỗi cho một lần sao lưu thật ra đã thành công. Droplet chạy Ubuntu 24.04 (bash 5) nên production không bị; đây là vấn đề tính di động, mức thấp.

**Khiếm khuyết 2 — chú thích đã lạc hậu.** Đầu script viết *"Jobs are written with a plain write, not a temp-file rename"*. Nhưng `src/lib/store.ts` **nay đã ghi qua temp + rename** (`writeFileAtomic`, commit `88c454b`). Bước xác minh sau khi nén vẫn đáng giữ, nhưng lý do nêu trong chú thích không còn đúng.

Hướng dẫn khôi phục có sẵn ở `docs/deployment-guide.md:96`.

---

## Phần B — Bằng chứng mới về lỗ hổng, nặng hơn ước lượng cũ

### B1. 🔴 SSRF: chứng minh bằng thực nghiệm, ba biến thể đều lọt

Dựng một dịch vụ nội bộ giả trên `127.0.0.1:43199` (trang quản trị có form đăng nhập), chạy Forge tại chỗ, gọi `POST /api/scan`. **Không đụng production.**

Kết quả trả về cho người gọi:

```
title       : Bank Hub — Internal Admin
description : Internal only. Do not expose.
headings    : ['Bank Hub Admin', 'Vietinbank sync console']
links       : ['…/accounts', '…/secrets']
form        : admin-login → /auth  post
  fields    : [('operator_id','input','Operator ID'),
               ('vault_passphrase','password','Vault passphrase')]
buttons     : ['Unlock vault']
tool đề xuất: [... 'fill_form_admin_login' ...]
```

**Nặng hơn ước lượng trong báo cáo trước.** Tôi từng viết "chỉ rò tiêu đề và tên trường". Thực tế còn có meta description, đường dẫn `/secrets`, nhãn tiếng người của từng trường, và Forge **tự sinh sẵn một tool mô tả cách điền form đăng nhập nội bộ đó**.

| Biến thể | URL gửi vào | Kết quả |
|---|---|---|
| IP riêng trực tiếp | `http://127.0.0.1:43199/` | **LỌT** — trả toàn bộ như trên |
| Tên miền công khai phân giải ra IP riêng | `http://localtest.me:43199/` (DNS → 127.0.0.1) | **LỌT** — chặn theo chuỗi IP là vô dụng |
| Chuyển hướng từ URL "sạch" sang nội bộ | `http://127.0.0.1:43198/` → 302 → `:43199` | **LỌT** — chỉ kiểm URL đầu vào là vô dụng |
| Địa chỉ metadata đám mây | `http://169.254.169.254/` | **Không bị từ chối** — vẫn thử kết nối, chỉ thất bại vì máy Mac không có dịch vụ đó. Trên droplet là chuyện khác |

Và production đang mở thật: `POST https://app.webmcps.net/api/scan` không cần xác thực, không có header rate-limit nào, chỉ từ chối khi giao thức sai.

**Hệ quả cho cách sửa:** ba biến thể trên loại bỏ hai cách sửa hời hợt. Cách đúng theo OWASP là: phân giải DNS **một lần** ở tầng Node → kiểm mọi IP thu được với bảng dải cấm → **kết nối tới đúng IP đã duyệt** → tự xử lý từng chặng redirect, lặp lại kiểm tra. Bảng dải cấm phải có cả `169.254.0.0/16` (metadata mọi đám mây) và **IPv4-mapped IPv6** `::ffff:0:0/96` — bẫy hay quên: `http://[::ffff:127.0.0.1]` vượt qua mọi regex chỉ nhìn IPv4.

Một lưu ý cho khâu triển khai: chốt chính phải nằm **trước `page.goto`**, vì Chromium tự phân giải DNS bằng ngăn xếp mạng riêng, không đi qua Node. `page.route()` chỉ nên là lớp phòng thủ thứ hai — có issue Playwright ghi nhận route không bắt tin cậy các request sinh ra từ chuỗi redirect.

### B2. 🟠 Forge tính nhãn an toàn rồi vứt đi

Chuẩn WebMCP (bản dự thảo **9/9/2026**, tôi tự mở kiểm) định nghĩa:

```
dictionary ToolAnnotations {
  boolean readOnlyHint = false;           // chỉ đọc, không đổi trạng thái
  boolean untrustedContentHint = false;   // đầu ra chứa nội dung không tin cậy
  boolean consequentialHint = false;      // hệ quả thật, khó hoàn tác — "booking a flight, transferring money"
};
```
và `registerTool(tool, options)` nhận `annotations` như một thành viên của `ModelContextTool`.

Forge **đã tính** nhãn — `heuristics.ts:40,56,77,105` gắn `readOnlyHint: true` cho 4 kiểu tool. Nhưng lúc đăng ký (`generator.ts:400-404`) chỉ truyền:

```js
ctx.registerTool({ name, description, inputSchema, execute });
//                                  ↑ annotations không bao giờ tới đây
```

→ **Nhãn chết trong manifest, không bao giờ tới trình duyệt.** Đây là việc rẻ nhất trong toàn bộ danh sách và là nền cho mọi việc gắn bậc tin cậy sau này.

Kèm theo: chuẩn 9/9/2026 **chỉ nói tới `document.modelContext`**, không nhắc `navigator.modelContext` một lần nào. Nhánh nghiên cứu báo Chromium 150 đã đánh dấu `navigator.modelContext` là deprecated. Forge ưu tiên `document` nên **không hỏng**, nhưng vẫn ghi vào `navigator` (`generator.ts:175`) và quảng cáo fallback đó trong manifest — nên dọn.

### B3. ⚠️ Nhãn là gợi ý, không phải rào chắn

Đừng nhầm việc gắn nhãn với việc an toàn. Ba sự thật:

- WebMCP và MCP dùng **hai bộ từ vựng khác nhau**; chỉ `readOnlyHint` trùng tên. MCP có `destructiveHint`/`idempotentHint`/`openWorldHint`; WebMCP có `untrustedContentHint`/`consequentialHint`.
- Blog MCP chính chủ tự nhận: *"An untrusted server can lie. A server can claim readOnlyHint: true and delete your files anyway"* và *"Clients must treat hints as untrusted by default"*.
- Client thực thi không đều: Codex CLI có bảng quyết định thật theo `destructiveHint`; Claude Code thì **không** tự duyệt theo `readOnlyHint` (yêu cầu tính năng đã đóng "not planned").

→ **Cổng an toàn thật phải nằm trong `executeImpl` của chính Forge.** Nhãn chỉ để client hiển thị cho người dùng.

### B4. Khán giả hôm nay — vẫn hẹp, và chuẩn đang bị phản đối mạnh

| Agent | Gọi được tool? | Điều kiện |
|---|---|---|
| ChatGPT Desktop (Atlas) | ✅ | cần model GPT-5.6 Sol/Terra; bật mặc định |
| ChatGPT Work | ✅ | như trên |
| Codex (OpenAI) | ✅ | có liệt kê chính thức |
| ChatGPT web / Enterprise / Edu | ❌ | *"Not available on web or other browsers"* |
| **Claude for Chrome / Claude Code** | ❌ | yêu cầu tính năng đóng `not_planned` (08/04/2026) |
| Chrome + Gemini | ❓ | không tìm được công bố chính thức đã ship |
| Perplexity Comet | ❓ | không có bằng chứng |
| Brave Leo | ❓ | issue theo dõi **vẫn mở**, còn ở mức thử nghiệm |

Trạng thái chuẩn: Dự thảo Community Group (không phải W3C Standard), Chrome origin trial 149→156 **chưa stable**. **WebKit chống thẳng**, lý lẽ kiến trúc chứ không phải kỹ thuật vặt: *"An agent acting on a user's behalf is, in effect, assistive technology... WebMCP does the opposite, making 'an agent is driving' an observable fact."* Mozilla trung lập, đang nghiêng về ủng hộ **API mệnh lệnh** và không ủng hộ API khai báo.

Phía cung thì tăng mạnh (Shopify bật cho mọi storefront Liquid từ 5/8, Cloudflare cho mọi domain qua dashboard từ 6/8) — nhưng **cung tăng không có nghĩa cầu tăng**. Bên gọi được vẫn chỉ là nhà OpenAI.

---

## Phần C — Năm chỗ trống, giờ đã có đáp án

### C1. Làm gì trước? → **A (an toàn), rồi B (vòng đời). Bỏ C.**

| Bằng chứng mới | Đẩy về hướng nào |
|---|---|
| SSRF chứng minh được, 3 biến thể, rò cả tên trường form nội bộ | **A, gấp** |
| Production mở, không xác thực, không rate limit | **A, gấp** |
| webmcp.com — API đọc miễn phí — vẫn giới hạn 30/10 phút | **A** — đây là mức tối thiểu của ngành |
| Đã có ≥4 danh bạ đối thủ đang sống | **bỏ C** |
| Nút "Run Rescan" của nekuda tồn tại thật | **B** — đây mới là khoảng cách sản phẩm |
| Khán giả vẫn chỉ ChatGPT | **bỏ C** — nút thắt là bên gọi, không phải bên tra danh bạ |

Lý do bỏ C đã đổi so với báo cáo trước: **không phải vì nekuda dẫn 564–1**, mà vì **thị trường danh bạ đã đông và không phải nút thắt.**

### C2. `click_by_text` → **(b) allowlist, cộng hai việc kèm theo**

Chọn (b), vì bằng chứng chỉ đúng một hướng:
- Chuẩn khuyến khích tool **có tên và phạm vi cụ thể** (`add_to_cart`), không phải `click(bất kỳ)`. Chính điểm này là lý do WebKit chống.
- Hướng dẫn secure-tools của Chrome: gắn `consequentialHint` cho hành động có hệ quả thật, giới hạn phạm vi.
- Nhãn không được thực thi (B3) → cổng phải nằm trong mã của mình.

Ba việc, theo thứ tự rẻ dần:
1. **Truyền `annotations` vào `registerTool`** (B2) — gần như miễn phí, mở đường cho phần còn lại.
2. **Giới hạn `click_by_text` vào allowlist nút thu được lúc quét**, thay vì khớp chuỗi con trên mọi phần tử.
3. **Gắn `consequentialHint: true`** cho `click_by_text`, `open_path`, và `fill_form` khi gửi thật; `readOnlyHint: true` cho 4 kiểu đọc.

### C3. Analytics → **(a) không làm bây giờ**

Không phải vì nguyên tắc, mà vì **không có gì để đo**: khán giả gọi được hôm nay chỉ có ChatGPT desktop/Work + Codex; Claude Chrome đã chính thức từ chối. Xây đường ống telemetry lúc này là đánh đổi lời hứa "embed không gọi mạng" — lời hứa đang là điểm mạnh đối chiếu với nekuda (telemetry bật mặc định) — để lấy về gần như số không.

**Điều kiện xét lại:** khi có họ agent thứ hai ngoài OpenAI gọi được tool. Lúc đó chọn (b) — chọn-tham-gia, chỉ đếm số lượt theo tên tool, không ghi tham số.

### C4. Health check → **(b) tự chạy hàng tuần cho job đã publish**

RAM đã trả lời (A3): vừa, không cần thêm gì. Và đây đánh đúng điểm yếu cấu trúc — selector tĩnh hỏng im lặng. Nút bấm tay xuất hiện như sản phẩm phụ của cùng đoạn mã, cứ để luôn.

### C5. Vị thế sản phẩm → **giữ "xưởng đúc không bịa số"**

Bằng chứng mới đều nói cùng một điều: chuẩn **chưa chắc thắng** (WebKit chống bằng lý lẽ kiến trúc, không phải bất đồng kỹ thuật nhỏ), khán giả hẹp, danh bạ đông. Trong bối cảnh đó, cược vào **chất lượng hạ tầng và vòng đời** bền hơn cược vào quy mô danh bạ. Nếu chuẩn có chững lại, một công cụ sinh ra file JS tĩnh trung thực vẫn còn giá trị; một danh bạ thứ sáu thì không.

---

## Phần D — Bảng ưu tiên cập nhật

| Mức | Việc | Đổi gì so với báo cáo trước | Bằng chứng |
|---|---|---|---|
| **P0** | Chặn SSRF: phân giải DNS một lần → kiểm mọi IP → nối đúng IP đã duyệt → tự xử lý redirect từng chặng | **Nâng mức** — đã chứng minh 3 biến thể, rò tên trường form nội bộ | thực nghiệm §B1 |
| **P0** | Rate limit + giới hạn số lượt quét đồng thời, **trong route handler** (không phải `proxy.ts`) | **Đổi vị trí** so với khuyến nghị nghiên cứu | tài liệu Next 16.3.4 |
| **P0** | Cổng cho `click_by_text` → allowlist nút thu lúc quét | giữ, nay chọn được phương án (b) | spec + secure-tools |
| **P1** | **Truyền `annotations` vào `registerTool`** | **MỚI** | `generator.ts:400-404` |
| **P1** | Gắn `consequentialHint` / `readOnlyHint` cho cả 8 kiểu | cụ thể hoá bằng từ vựng đúng của WebMCP (không phải MCP) | spec 9/9/2026 |
| **P1** | Health check hàng tuần, báo selector chết | giữ, RAM đã xác nhận vừa | §A3 |
| **P1** | Rescan vào cùng job, có diff, giữ `publicId` | giữ; xác nhận nekuda có "Run Rescan" | §A1 |
| **P2** | Bảng "hôm nay agent nào gọi được" trên trang job | giữ, nay có dữ liệu để điền | §B4 |
| **P2** | Dọn `navigator.modelContext` khỏi polyfill + manifest note | **MỚI** | spec không nhắc navigator |
| **P2** | Sửa chú thích lạc hậu trong `backup-jobs.sh`; thay `mapfile` cho chạy được trên bash 3.2 | **MỚI** | §A4 |
| **Không làm** | Danh bạ · analytics · tài khoản · AI sinh tool | lý do bỏ danh bạ đã đổi | §C1, §C3 |

---

## Câu hỏi chưa giải quyết

1. **`cloudflared` có chuyển tiếp `CF-Connecting-IP` không** — chưa có dòng tài liệu nói thẳng cho kịch bản Tunnel. Đóng bằng một dòng log khi triển khai, không chặn việc lập kế hoạch.
2. **Pseudo IPv4 "Overwrite Headers"** trên zone `webmcps.net` đang ở chế độ nào — nếu bật ghi đè thì khoá rate-limit theo IPv6 mất chính xác. Cần liếc dashboard.
3. **Container Docker có với tới `169.254.169.254` không** — tài liệu DigitalOcean không nói về container. Suy từ tài liệu Docker là **có** trừ khi đã thêm luật iptables. Đóng bằng một lệnh `curl` trong container; nhưng dù kết quả thế nào vẫn phải chặn dải này ở tầng ứng dụng.
4. **Playwright issue #34994** (route không bắt tin cậy redirect) đã fix chưa — cần thử trên đúng phiên bản trong repo trước khi coi `page.route()` là lớp phòng thủ thứ hai đáng tin.
5. **`@mcp-b/webmcp-local-relay` có map annotation WebMCP sang MCP không** — chưa đọc mã. Ảnh hưởng: bật local-relay thì nhãn an toàn có tới được Cursor/Claude Desktop hay bị bỏ trống. Ngoài ra relay mở WebSocket trên localhost — chưa rõ có token giữa embed và relay hay không; tiến trình khác trên cùng máy có thể gọi được tool của trang đang mở.
6. **Bốn danh bạ đối thủ ra đời khi nào và quy mô ra sao** — chỉ mới xác nhận "đang sống", chưa đo số site họ index.
