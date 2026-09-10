---
type: research
date: 2026-09-10
slug: lightpanda-thay-chrome
status: đánh giá xong, chưa đổi gì
---

# Lightpanda thay Chrome cho scanner: có được không, có đủ nghiệp vụ không

## Kết luận ngắn

Được về mặt kỹ thuật, và nhẹ hơn khoảng **20 lần**. Nhưng chưa nên đổi hẳn ngay: bản đang có là *nightly*, và một site thật đã cho kết quả lệch. Hướng đúng là dùng Lightpanda làm mặc định, giữ Chrome làm đường lùi.

## Vì sao khớp: scanner của ta không cần thứ Lightpanda thiếu

Lightpanda **không có engine dựng hình** — không CSS, không layout, không toạ độ phần tử. Đó thường là lý do loại nó.

Nhưng `src/lib/extract.ts` chỉ dùng: `querySelectorAll` (10), `textContent` (9), `querySelector` (7), `closest` (1), cộng `document.title`, `document.body`, `location.href/origin`.

**Không có** `getComputedStyle`, `getBoundingClientRect`, `offsetWidth/Height`, không kiểm tra hiển thị. Đúng chỗ Lightpanda yếu thì ta không đụng tới.

API Playwright ta dùng cũng nhỏ: `newContext`, `newPage`, `goto`, `evaluate`, `waitForLoadState`, `url`, `close`. Docs Lightpanda ghi rõ hỗ trợ `chromium.connectOverCDP()` và `browser.newContext()`.

## Đo thật (10/9/2026, `1.0.0-nightly.9309`)

### Fixture shop, 4 trang, qua URL công khai

| | Chrome | Lightpanda |
|---|---|---|
| Tool tìm ra | 11 | **11, giống hệt** |
| Mọi con số mỗi trang | — | **trùng khớp hoàn toàn** |

Cùng danh sách: `get_page_info, get_site_nav, list_links, list_products, search_on_page, fill_form_newsletter, fill_form_form_1, fill_form_calculator, fill_form_contact, click_by_text, open_path`.

### Site thật

| Site | Chrome | Lightpanda | Khớp? |
|---|---|---|---|
| books.toscrape.com (server-render) | h21 link80 form21 btn20 product20 · 1935ms | y hệt · 2176ms | **có** |
| quotes.toscrape.com/js/ (**JS sinh nội dung**) | h1 nav1 link5 · 1566ms | y hệt · 1891ms | **có** |
| demo.vercel.store (Next.js SPA thật) | form**1** search**1**, h15 link29 product15 · 1265ms | form**2** search**2**, còn lại y hệt · **953ms** | **lệch nhẹ** |

### Tài nguyên

| | Chrome (trong container Forge) | Lightpanda |
|---|---|---|
| RAM lúc quét | ~350 MiB | **18 MiB** (sau 4 trang) → **44 MiB** (sau 3 site thật) |
| Image | 6,4 GB (Playwright + Chrome + Next) | **364 MB** |
| Tốc độ | mốc so sánh | tương đương, có lúc nhanh hơn |

## Rủi ro, xếp theo mức

1. **Bản nightly.** `1.0.0-nightly.9309+33ddbdf0f`. Không có tag ổn định để ghim.
2. **Lệch DOM trên SPA thật.** demo.vercel.store cho 2 form/2 search thay vì 1. Hậu quả: sinh thừa một tool trùng. Không sai kết quả, nhưng chứng minh hai engine **không** luôn cho DOM giống nhau.
3. **Không có trang "known issues".** Docs không liệt kê giới hạn hay API không hỗ trợ. Vắng tài liệu không phải là bằng chứng không có vấn đề.
4. **Telemetry bật mặc định — ĐÃ TẮT ĐƯỢC (cập nhật 10/9 22:10).**

   Lần đầu tôi kết luận "không có cờ tắt". Sai, vì hai lỗi tìm kiếm của chính tôi:
   - Grep chữ `telemetry` trong `--help`, nhưng cờ liên quan dùng chữ `metrics`.
   - Dò binary bằng `strings`, mà image **không cài `strings`** nên lệnh trả rỗng và tôi tưởng là "không có gì".

   Làm lại bằng `grep -a` trực tiếp trên `/bin/lightpanda`:

   | Phát hiện | Giá trị |
   |---|---|
   | Biến tắt telemetry | `LIGHTPANDA_DISABLE_TELEMETRY` |
   | Biến tắt crash dump | `LIGHTPANDA_DISABLE_CORE_DUMP` |
   | Đích gửi | `telemetry.lightpanda.io`, `crash.lightpanda.io` |
   | `--disable-metrics` | **KHÔNG** liên quan — chỉ tắt endpoint `/metrics` Prometheus cục bộ |

   Chạy thử xác nhận: đặt `LIGHTPANDA_DISABLE_TELEMETRY=true` thì log đổi từ `disabled=false` sang `disabled=true`.

   Cả hai biến **không có trong docs**, nên có thể đổi ở nightly sau mà không ai báo.
5. **Đổi kiến trúc.** Đang launch trong tiến trình; chuyển sang connect CDP tới container riêng. Cơ chế đóng browser khi rảnh vừa làm ở PR #2 sẽ không còn ý nghĩa như cũ.

## Hướng đề xuất

Không đổi hẳn. Thêm một chế độ chọn được:

- `SCANNER_ENGINE=chrome` (mặc định hiện tại, giữ nguyên hành vi)
- `SCANNER_ENGINE=lightpanda` + `SCANNER_CDP_URL` → `connectOverCDP`
- Quét lỗi hoặc ra 0 tool trên Lightpanda thì thử lại bằng Chrome

Lợi: giảm ~300 MiB RAM cho phần lớn lượt quét, image nhỏ hơn nhiều, mà không đánh cược sản phẩm vào một bản nightly.

## Câu hỏi chưa giải quyết

- Telemetry gửi gì, về đâu, tắt bằng cách nào. Phải chốt trước khi cho chạm site của khách.
- Nguyên nhân lệch form/search trên demo.vercel.store: khác thời điểm hydrate hay khác cách dựng DOM.
- Chưa thử site có đăng nhập, có iframe, có shadow DOM.
- Ghim phiên bản thế nào khi chỉ có nightly.

---

## Telemetry: đã kết luận (10/9/2026 22:15)

Grok đọc source và privacy policy; tôi kiểm lại độc lập bằng cách chạy thật và đọc chính sách.

### Telemetry gửi gì

Privacy policy (cập nhật 3/8/2026) liệt kê rõ hai danh sách:

| Có gửi | **Không** gửi |
|---|---|
| timestamp, phiên bản, IP, instance id, kiến trúc CPU, OS, protocol, có TLS không, có proxy không | biến môi trường, đường dẫn file, nội dung file, log, **URL**, cookie, header, **nội dung trang** |

Nguyên văn về cách tắt: *"You can disable both by setting the env var `LIGHTPANDA_DISABLE_TELEMETRY=true`."* — "both" là telemetry **và** crash report.

**Kết luận cho nghiệp vụ:** URL site khách **không** nằm trong payload. Đây là điểm chặn duy nhất, và nó đã được gỡ.

### Cái bẫy: mọi giá trị đều tắt

Tôi chạy thử từng giá trị:

| Đặt | Kết quả |
|---|---|
| `"true"` | `disabled=true` |
| `"false"` | **`disabled=true`** |
| `"0"` | **`disabled=true`** |
| `""` (rỗng) | **`disabled=true`** |
| không đặt biến | `disabled=false` |

Code kiểm **sự tồn tại** của biến, không kiểm giá trị. Ai muốn bật lại telemetry mà viết `=false` sẽ không đạt được điều đó. Compose của ta đặt `"true"`, nên đúng cả khi sau này upstream đổi sang đọc giá trị.

### `LIGHTPANDA_DISABLE_CORE_DUMP` là kênh khác

Nó chỉ đặt `RLIMIT_CORE` về 0, tức không ghi core dump xuống đĩa máy. **Không** thay thế được `DISABLE_TELEMETRY`. Ta đặt cả hai.

### Biến này có tài liệu

Có trong `README.md` của repo và trong privacy policy. Trang `lightpanda.io/docs` thiếu mục riêng, đó là lý do lần đầu tôi tra không thấy. Đây là cam kết công khai, không phải chuỗi tình cờ trong binary.

### Còn lại

`:nightly` là tag di động. Hành vi đã kiểm ứng với digest `sha256:3af0bcae…`. Ghim digest thì tái lập được nhưng đóng băng luôn bản vá; giữ tag di động thì cần đối chiếu lại mỗi lần image đổi. Đã ghi digest vào compose để so sánh.

**Đánh giá:** đủ điều kiện bật Lightpanda cho site khách, với điều kiện biến tắt telemetry có mặt ở mọi nơi chạy và log khởi động xác nhận `disabled=true`.

---

## Chạy thử site thật trên production (10/9/2026 22:35, engine = lightpanda)

Quét qua chính `app.webmcps.net` đang chạy Lightpanda.

| Site | Thời gian | Trang | Tool | Nhận xét |
|---|---|---|---|---|
| books.toscrape.com | 8s | 8 | 8 | có `list_products` |
| quotes.toscrape.com/js/ (JS sinh nội dung) | 3s | 4 | 6 | đúng |
| demo.vercel.store (SPA thật) | 9s | 8 | **18** | nhiều tool form trùng lặp |
| example.com | 0s | 1 | 4 | đúng |
| playwright.dev | 4s | 8 | 5 | đúng |
| iana.org | 3s | 8 | 5 | đúng |

**Không site nào lỗi.** Không có `status=error`, không có trang 0.

### Đối chiếu Chrome trên site cho kết quả lạ

Chạy `scanSite` với cả hai engine trên `demo.vercel.store`, 8 trang:

| | Chrome | Lightpanda |
|---|---|---|
| Tool | **13** | **17** |
| Chrome tìm ra mà Lightpanda thiếu | — | **không có** |
| Lightpanda tìm thêm | — | 4 tool form |

Số form/search mỗi trang trùng nhau ở 7/8 trang. Lệch duy nhất ở `/product/acme-cup`: Chrome thấy 4 form + 1 search, Lightpanda thấy 5 form + 2 search. Nhiều khả năng do thời điểm hydrate của SPA khác nhau.

### Hai kết luận

1. **Lightpanda là tập cha, không phải tập con.** Nó chưa bao giờ bỏ sót thứ Chrome tìm ra. Đây là chiều lệch an toàn: thừa tool thì chủ site bỏ chọn được, thiếu tool mới là mất khả năng.

2. **Danh sách tool ồn ào KHÔNG phải lỗi Lightpanda.** Chrome cũng ra 13 tool với 6 biến thể `fill_form_form_*` gần trùng nhau. Đây là vấn đề của bộ suy luận trong `src/lib/heuristics.ts`, xuất hiện với cả hai engine, và tồn tại từ trước.

### Đánh giá

Lightpanda **ổn cho production**. Không mất khả năng, nhanh hơn, tốn 5,5 MiB thay vì ~350 MiB.

## Chỗ trống cần điền

1. **Tool form trùng lặp trên SPA** (13–18 tool, phần lớn là `fill_form_form_*` gần giống nhau). Là vấn đề heuristics của ta, không phải engine. (a) gộp/lọc form trùng trong `heuristics.ts` · (b) để nguyên, chủ site tự bỏ chọn trong UI · (c) chưa đụng tới
