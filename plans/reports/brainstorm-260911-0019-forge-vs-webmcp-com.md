---
type: brainstorm
date: 2026-09-11
slug: forge-vs-webmcp-com
status: đánh giá — chưa triển khai
nguồn: plans/reports (deep-research) research-260910-1216-webmcp-nekuda-ecosystem-synthesis.md
---

# Forge đứng ở đâu so với webmcp.com

## Tóm tắt một màn hình

- Hai thứ **không cùng loại**. webmcp.com/nekuda là **hệ sinh thái** (danh bạ + AI sinh tool + bàn điều khiển vòng đời). Forge là **một xưởng đúc** (quét → chọn → nhúng). So "hơn kém" toàn cục là so sai; so từng khúc mới ra việc.
- **Forge miễn nhiễm với lỗ hổng lớn nhất của cả hệ sinh thái** (§8 báo cáo: không lớp nào kiểm tính đúng của số liệu). Forge không sinh code nghiệp vụ, nên không có chỗ để bịa hằng số. Đây là điểm mạnh cấu trúc, không phải may.
- Đổi lại, Forge **không làm được tool đặc thù ngành** như `check_inverter_compatibility`. Trần năng lực thấp hơn hẳn.
- **Ba khoảng trống thật của Forge:** không có danh bạ (agent không tìm thấy site), không phát hiện selector chết khi site đổi giao diện, và quét lại là tạo job mới → khách phải dán lại thẻ script.
- **Ba lỗi nên sửa sớm, tự tìm khi đọc mã** (không có trong báo cáo): `/api/scan` không chặn địa chỉ nội bộ, `click_by_text` bấm được mọi nút mà không cần xác nhận, README hứa rộng hơn thực tế.

---

## 0. Từ dùng, định nghĩa một lần

| Từ | Nghĩa trong báo cáo này |
|---|---|
| **tool** | Một hàm site tự khai để agent gọi: có tên, mô tả, schema đầu vào |
| **danh bạ (directory)** | Danh sách site có tool, để agent tra trước khi vào |
| **bậc tin cậy** | Nhãn answer (đọc) / act (đổi trạng thái, hoàn tác được) / transact (tiền, cam kết) |
| **drift** | Site đổi giao diện → selector trong tool trỏ vào chỗ không còn tồn tại |
| **selector** | Chuỗi CSS chỉ đúng một phần tử trên trang, ví dụ `form[name="contact"]` |
| **polyfill** | Đoạn mã tự dựng `document.modelContext` khi trình duyệt chưa có sẵn |
| **SSRF** | Máy chủ bị dụ gọi tới địa chỉ nội bộ mà người ngoài không tới được |

---

## 1. Cùng một chị Lan, hai con đường

Chị Lan là chủ `pytesess.vn`, bán hệ lưu trữ năng lượng. Sáng thứ hai chị muốn ChatGPT trả lời đúng khi khách hỏi về sản phẩm của chị.

**Đường nekuda:** chị dán URL vào scanner của webmcp.com. AI đọc site, **tự viết** 5 tool, trong đó có `calculate_storage_system` biết tính tiền tiết kiệm. Chị bấm "Enable", dán một dòng script. Site chị lên danh bạ 564 site, agent nào tra danh bạ cũng thấy.
**Cái giá:** tool tính tiền đó dùng **6 hằng số AI tự bịa** (giá điện 2.800đ/kWh phẳng, suất đầu tư 8,5 triệu/kWh…), trong khi máy tính thật trên `/calculator` của chị dùng biểu giá EVN và bức xạ theo từng tỉnh. Không lớp kiểm nào của nekuda bắt được (§8). Khách hỏi ChatGPT, nhận số sai, mang số đó đi so giá.

**Đường Forge:** chị dán URL vào `app.webmcps.net`. Forge quét, đề xuất 11 tool **không có tool nào biết tính tiền**. Có `open_path` dẫn agent tới `/calculator`, có `list_products` đọc thẳng thẻ sản phẩm đang hiển thị, có `fill_form_contact` điền form nhưng không gửi. Chị chọn, generate, dán thẻ script — hoặc tải hai file về bỏ vào repo.
**Cái giá:** không có tool nào bóc bảng tương thích inverter như nekuda làm được. Và **không ai tìm thấy site chị** ngoài agent đang mở đúng tab đó.

Đó là toàn bộ sự đánh đổi, gọn trong một đoạn.

---

## 2. Đối chiếu năng lực

Cột nekuda lấy từ báo cáo đính kèm (tôi **chưa tự mở** webmcp.com phiên này). Cột Forge tôi đọc mã trực tiếp.

| Khúc | nekuda / webmcp.com | Forge | Ai hơn |
|---|---|---|---|
| Sinh tool | AI viết code riêng cho từng site | 8 kiểu cố định, tham số hoá | nekuda (trần cao hơn) |
| Đúng đắn nội dung | **Không lớp nào kiểm** (§8) | Không có gì để sai — tool đọc DOM lúc gọi | **Forge** |
| Danh bạ | 564 site · 3.763 tool · API mở, OpenAPI 3.1 | **Không có** | **nekuda** |
| Bậc tin cậy | 3 mức, chủ site ghi đè được, transact chặn eval | `readOnlyHint` trên 4/8 kiểu, không phân loại | **nekuda** |
| Vòng đời tool | Version, rescan, drift detection, eval | Version bundle có; **rescan/drift không có** | **nekuda** |
| Quyền kiểm soát mã | Mã ở máy chủ nekuda, sửa từ dashboard | **Tải file về, bỏ vào repo, review qua PR** | **Forge** |
| Polyfill | **Không** — chỉ đăng ký khi trình duyệt đã có (§6) | **Có** — tự dựng registry nếu thiếu | **Forge** |
| Cầu nối agent ngoài | Không đề cập | Tuỳ chọn `@mcp-b/webmcp-local-relay` cho Cursor/Claude Desktop | **Forge** |
| Telemetry | Bật mặc định; kênh đầy đủ bật được | **Không gọi mạng** ngoài relay tuỳ chọn | Forge (riêng tư) / nekuda (dữ liệu) |
| Analytics cho chủ site | "Agents activity" | **Không có** | **nekuda** |
| Kích thước snippet | 41.322 byte | 22.216 byte (đo trên production) | Forge |
| Bảo vệ lúc gửi form | Nhãn transact chặn eval | `dryRun:false` **và** `confirmSubmit:true` mới gửi | Forge (cứng hơn) |
| Tài khoản | Có | Không — job id là chìa khoá | nekuda |
| Giá | Không công bố | Tự host | — |

---

## 3. Ba chỗ Forge thật sự hơn, kèm bằng chứng

### 3.1. Không có chỗ để bịa số — vì không tính gì cả

Báo cáo §7 rút ra quy luật: *AI đọc dữ liệu thật khi site phơi ra dạng đọc được; AI bịa số khi logic nằm sau biểu mẫu tương tác.*

Forge nằm ngoài quy luật đó vì **nó không sinh logic**. Tám kiểu tool trong [heuristics.ts](src/lib/heuristics.ts) đều là đọc hoặc điều khiển DOM, và thân hàm nằm sẵn trong [generator.ts](src/lib/generator.ts:214) — cùng một `executeImpl` cho mọi khách, chỉ khác selector.

```js
// generator.ts — list_products đọc thẻ đang hiển thị, không nhớ gì từ lúc quét
case "list_products": {
  var cards = queryAll((tool.selectors && tool.selectors.product) || ".product-card, …");
  // giá lấy từ .price NGAY LÚC AGENT GỌI → site đổi giá thì tool đổi theo
```

**Vì sao quan trọng:** giá lấy lúc gọi, không phải lúc quét. `calculate_storage_system` của nekuda đông cứng 2.800đ/kWh vào mã; Forge không có chỗ nào để đông cứng.

**Đánh đổi thật, phải nói thẳng:** cũng chính vì vậy Forge **không làm được** `check_inverter_compatibility` (bóc 3 bảng HTML thật, chạy đúng, báo cáo đã kiểm). Forge chỉ đưa được agent tới trang đó. Trần năng lực thấp hơn.

### 3.2. Có polyfill — khán giả rộng hơn nekuda

Báo cáo §6 đóng câu hỏi treo: snippet AgentLane **không** polyfill, `if (!J) return { available: false }`. Nghĩa là nekuda phục vụ đúng ChatGPT desktop + ChatGPT Work.

Forge tự dựng `document.modelContext` khi thiếu ([generator.ts:75](src/lib/generator.ts:75)): registry, `registerTool`, `getTools`, `executeTool`, sự kiện `toolchange`, có cả `Object.defineProperty` fallback.

**Cẩn thận, đừng hiểu quá:** polyfill chỉ dựng registry **trong trang**. Không có cầu nối thì không ai gọi được từ ngoài. Cái tạo ra khán giả là **local-relay tuỳ chọn** — tick vào lúc generate thì Cursor/Claude Desktop gọi được. Nói "Forge phục vụ nhiều agent hơn" chỉ đúng khi bật relay.

### 3.3. Đường tự host — trả lại quyền cho repo

Rủi ro #4 của báo cáo: *"Mã tool ngoài tầm kiểm soát repo — không pull request, không git history bên bạn."*

Forge có sẵn lối thoát: tải `webmcp-forge.embed.js` + `webmcp-forge.manifest.json`, bỏ vào repo, review qua PR như mọi file khác. Thêm nữa [jobs.ts:271](src/lib/jobs.ts) tái dựng bundle **đúng từng byte** (cùng selection, cùng version, cùng timestamp) — nên file trong repo và file trên CDN đối chiếu được.

---

## 4. Ba khoảng trống thật của Forge

### 4.1. Không có danh bạ — đây là khoảng cách chiến lược, không phải tính năng thiếu

Báo cáo §2: *"Hệ sinh thái WebMCP hiện chỉ có đúng MỘT danh bạ đáng tin: webmcp.com. Đây là lợi thế cạnh tranh thật của nekuda."*

Forge không có bề mặt khám phá nào. Chị Lan cài xong, agent chỉ dùng được tool **nếu đã ở trên tab đó**. Với ChatGPT desktop — kịch bản chính hôm nay — điều đó tạm ổn (người dùng tự mở trang). Nhưng mọi kịch bản "agent tự đi tìm site bán pin lưu trữ ở VN" đều không có Forge trong đó.

Và đáng chú ý: §5 báo cáo đo được AgentLane chỉ chiếm **~2% (1/45 mẫu)** trong chính danh bạ của họ — 94% site dùng API chuẩn tự cài. **Danh bạ mới là tài sản, không phải SaaS.**

### 4.2. Selector chết mà không ai biết

Forge lưu selector CSS chụp lúc quét. Chị Lan đổi theme WordPress tháng sau → `form[name="contact"]` biến mất → tool trả `{ok:false, error:"Form not found"}` **im lặng**, không ai được báo. Không có health check, không có drift detection, không có thông báo.

nekuda có drift detection và "Tool checks". Báo cáo cũng cảnh báo chính xác điểm này: *"lưu ý **giòn** khi đổi layout"*.

**Đây là tính năng đáng làm nhất của Forge**, vì nó đánh đúng điểm yếu cấu trúc của chính Forge (selector tĩnh), và làm được bằng hạ tầng đã có (scanner + so sánh candidates).

### 4.3. Quét lại = job mới = thẻ script mới

`runScan` gọi `newJobId()` mỗi lần ([jobs.ts:70](src/lib/jobs.ts:70)). Không có endpoint rescan. Hệ quả cụ thể: chị Lan quét lại sau khi đổi theme → job mới → `publicId` mới → **URL mới** → phải vào sửa thẻ `<script>` trên site. Chọn tool cũng phải chọn lại từ đầu.

nekuda giữ danh tính theo domain, tool có version. Báo cáo để treo câu *"rescan có ghi đè tool đã sửa tay không"* — nghĩa là **nekuda cũng chưa giải xong**. Forge có cơ hội làm đúng hơn: quét lại vào **cùng job**, hiện diff (tool nào mới, tool nào selector chết, tool nào mất), chủ site duyệt, `publicId` giữ nguyên.

---

## 5. Ba lỗi của chính Forge, tìm khi đọc mã

Không có trong báo cáo đính kèm. Tôi đọc mã ra.

### 5.1. 🔴 `/api/scan` không chặn địa chỉ nội bộ (SSRF)

[scanner.ts:139](src/lib/scanner.ts:139) `parseScanUrl` chỉ kiểm giao thức http/https. [route.ts](src/app/api/scan/route.ts) không xác thực, không giới hạn tần suất, không danh sách chặn.

Người ngoài POST `{"url":"http://169.254.169.254/metadata/v1/"}` → Chrome **trong container trên droplet** mở địa chỉ đó. Cũng tới được container hàng xóm trong mạng docker.

**Mức rò rỉ có giới hạn** — snapshot chỉ lấy title, headings, links, **tên trường form**, chữ trên nút; không lấy body text. Nhưng đủ để dò xem cái gì đang chạy và form đăng nhập nội bộ có những trường nào.

**Cộng thêm:** không giới hạn tần suất, mỗi lượt quét mở tới 8 trang Chrome trên droplet **2 GB dùng chung với bank-hub** (đã ghi trong `brainstorm-260910-1222`). Một vòng lặp curl là đủ để ép container chạm `mem_limit 900m` liên tục.

**Nên chặn:** giải DNS rồi từ chối dải riêng (10/8, 172.16/12, 192.168/16, 127/8, 169.254/16, ::1, fc00::/7), kiểm lại sau redirect, thêm giới hạn tần suất theo IP.

### 5.2. 🟠 `click_by_text` — công cụ nguy hiểm nhất, canh gác lỏng nhất

[generator.ts:341](src/lib/generator.ts:341):

```js
case "click_by_text": {
  var needle = String(args.text || "").trim().toLowerCase();
  var match = nodes.find(function (el) { … t.indexOf(needle) !== -1; });
  match.click();     // ← không dryRun, không confirmSubmit, không allowlist
```

`fill_form` cần **hai** cờ mới gửi. `click_by_text` bấm thẳng, và khớp **chuỗi con**: agent gửi `"xoá"` có thể trúng "Xoá tài khoản"; gửi `"mua"` trúng "Mua ngay". Trên site thương mại điện tử đây là tool hạng `transact` đang được canh như hạng `answer` — đúng kiểu tự mâu thuẫn mà báo cáo §9 chê nekuda (`ANSWER` + `read-only` nhưng `Kind: action`).

**Nên sửa:** áp cùng cổng `confirmSubmit` cho `click_by_text`, hoặc chỉ cho bấm nút nằm trong allowlist thu lúc quét, hoặc chặn theo từ khoá nguy hiểm. Và gắn nhãn bậc tin cậy cho cả 8 kiểu — đây chính là bài học đáng bê nguyên từ nekuda.

### 5.3. 🟡 README hứa rộng hơn sự thật

README viết *"Agents then call structured tools in the visitor's open tab"* mà không nói **hôm nay agent nào đọc được**. Báo cáo §6 có bảng rõ ràng: ChatGPT desktop ✅, ChatGPT Work ✅, Claude for Chrome ❌ (*"Invocation works; discovery doesn't exist"*), Chrome+Gemini ❌, Comet/Sider/Monica ❌.

Điểm trung thực bất thường mà báo cáo khen nekuda (§9, mục 3) là **ecosystem tracker trích nguyên văn phản đối của WebKit/Mozilla**. Rẻ để bắt chước, và đúng với khách: một dòng "hôm nay ai gọi được tool của bạn" ngay trên trang job.

---

## 6. Ba bài học chuyển thẳng thành thiết kế

| Bài học từ báo cáo | Điều khoản thiết kế cho Forge |
|---|---|
| §8 — không lớp nào kiểm tính đúng nội dung | **Giữ nguyên vị thế: không sinh logic nghiệp vụ.** Đây là khác biệt bán được, đừng đánh đổi để thêm tool "thông minh" |
| §4 — bậc tin cậy chạy xuyên cả chồng sản phẩm | Gắn nhãn answer/act/transact cho **cả 8 kiểu**, hiện trên UI, và cổng an toàn phải khớp nhãn (sửa `click_by_text`) |
| §9 — ecosystem tracker trung thực được khen nhiều nhất | Nói thẳng khán giả hôm nay trên trang job, kèm ngày kiểm |

---

## 7. Contract cho việc tiếp theo

- **Outcome:** Forge giữ lợi thế "không bịa số", đồng thời bịt ba khoảng trống xếp theo mức đau: an toàn máy chủ → tool chết im lặng → khách phải dán lại thẻ.
- **Constraints:** droplet 2 GB dùng chung bank-hub; job là file JSON trên đĩa, không có tài khoản; embed hiện không gọi mạng (đổi điều này là đổi lời hứa riêng tư); `publicId` phải giữ nguyên vì khách đã dán thẻ.
- **Non-goals:** không xây danh bạ trong đợt này; không sinh tool bằng AI; không làm tài khoản; không chạy lại WindTunnel.
- **Acceptance:** quét địa chỉ nội bộ bị từ chối kèm lý do · `click_by_text` không bấm được khi thiếu xác nhận · một lượt kiểm sức khoẻ báo đúng tool nào selector đã chết · quét lại giữ nguyên `publicId` và hiện diff cho chủ site duyệt.

### Ba hướng, chọn một

| | A. An toàn trước | B. Vòng đời trước | C. Danh bạ trước |
|---|---|---|---|
| Làm gì | Chặn SSRF + rate limit + cổng cho `click_by_text` + nhãn bậc tin cậy | Rescan vào cùng job + diff + health check selector | Dựng danh bạ site dùng Forge, API đọc |
| Giả định chống đỡ chính | Forge sẽ có người lạ gọi API | Khách quay lại sau khi đổi giao diện | Có đủ site để danh bạ có nghĩa |
| Gãy trước nhất khi | Không gãy — đây là nợ đã đến hạn | Khách cài xong không bao giờ quay lại | **0 khách → danh bạ rỗng, đối đầu trực diện với thứ nekuda đã dẫn 564–1** |
| Công sức | Thấp (1–2 ngày) | Trung bình (3–5 ngày) | Cao, và cần lưu lượng |
| Rẻ để bỏ dở | ✅ | ✅ | ❌ |

**Khuyến nghị: A trước, rồi B.** A là nợ đã đến hạn — máy chủ đang mở, dùng chung với hệ thống ngân hàng đang chạy production; chi phí sửa thấp, không phụ thuộc giả định nào. B đánh đúng điểm yếu cấu trúc của Forge bằng hạ tầng đã có. C thì báo cáo §5 đã chỉ ra: **danh bạ là tài sản, nhưng nó thắng nhờ có sẵn 564 site**, không nhờ được viết tốt hơn — đối đầu ở đó bây giờ là chọn trận địa của đối thủ.

---

## 8. Bảng ưu tiên

| Mức | Việc | Vì sao bây giờ | Bằng chứng |
|---|---|---|---|
| **P0** | Chặn dải IP nội bộ ở `/api/scan`, kiểm cả sau redirect | SSRF đang mở trên máy chung với bank-hub | `scanner.ts:139` |
| **P0** | Giới hạn tần suất `/api/scan` theo IP | Mỗi lượt = 8 trang Chrome trên 2 GB dùng chung | `config.ts:1` |
| **P0** | Cổng xác nhận cho `click_by_text` | Bấm được "Xoá tài khoản" bằng khớp chuỗi con | `generator.ts:341` |
| **P1** | Nhãn answer/act/transact cho 8 kiểu, hiện trên UI | Bài học §4; hiện chỉ 4/8 có `readOnlyHint` | `heuristics.ts:40` |
| **P1** | Health check: chạy lại selector trên site thật, báo cái nào chết | Selector tĩnh + không cảnh báo = hỏng im lặng | `generator.ts:186` |
| **P1** | Rescan vào cùng job, có diff, giữ `publicId` | Hiện quét lại là mất thẻ script | `jobs.ts:70` |
| **P2** | Bảng "hôm nay agent nào gọi được" trên trang job | Trung thực là điểm được khen nhất ở nekuda | README |
| **P2** | Analytics chọn-tham-gia cho chủ site | Dữ liệu chưa ai có — nhưng phá lời hứa "không gọi mạng"; cần quyết riêng | — |
| **Không làm** | Danh bạ, tài khoản, AI sinh tool | Xem §7 | — |

---

## 9. Chỗ trống cần điền

1. **Làm gì trước?** (a) A — an toàn (khuyến nghị) · (b) B — vòng đời · (c) cả A và B trong một đợt · (d) C — danh bạ
2. **`click_by_text` xử ra sao?** (a) thêm cổng `confirmSubmit` như `fill_form` · (b) chỉ cho bấm nút trong allowlist thu lúc quét · (c) bỏ hẳn khỏi bộ mặc định, ai cần thì tự tick
3. **Analytics:** (a) không làm, giữ "embed không gọi mạng" · (b) làm, chọn-tham-gia, chỉ đếm số lượt gọi theo tên tool, không ghi tham số · (c) làm đầy đủ như nekuda
4. **Health check chạy khi nào?** (a) chủ site tự bấm · (b) tự chạy hàng tuần cho job đã publish · (c) chưa cần
5. **Vị thế sản phẩm:** giữ "xưởng đúc không bịa số" làm điểm bán chính, hay nhắm dần thành đối thủ đầy đủ của AgentLane?

---

## 10. Câu hỏi chưa giải quyết

- Tôi **chưa tự mở** webmcp.com/AgentLane phiên này; toàn bộ cột nekuda dựa vào báo cáo đính kèm ngày 10/9/2026. Nếu cần đối chiếu trực tiếp thì phải kiểm lại.
- Rate limit theo IP trên droplet: sau Cloudflare Tunnel thì IP thật nằm ở header nào, chưa kiểm.
- Health check cần mở Chrome định kỳ cho mọi job đã publish — ngân sách RAM chưa tính, và bài học `docker stats` gộp page cache (brainstorm-260910-1222) nói rằng phải đo bằng `anon`, không đo bằng số tổng.
- `data/jobs` đã có sao lưu hàng ngày (commit `3a99629`), nhưng chưa diễn tập khôi phục.
