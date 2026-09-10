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
4. **Telemetry bật mặc định.** Log khởi động: `telemetry status disabled=false`. `serve --help` **không** thấy cờ tắt (chỉ có `--obey-robots`). Ta quét site của khách, nên cần biết cái gì được gửi đi đâu. **Chưa giải quyết được.**
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
