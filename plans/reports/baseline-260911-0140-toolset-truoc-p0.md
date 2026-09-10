---
type: baseline
slug: toolset-truoc-p0
status: mốc đã chụp — dùng để đối chiếu ở Phase 4
plan: plans/260911-0105-p0-scan-safety/
---

# Mốc bộ tool trước khi vá P0

Chụp trên **production** (`app.webmcps.net`) trước khi merge bất kỳ thay đổi nào của
`plans/260911-0105-p0-scan-safety/`. Đây là mốc để Phase 4 bước 6 chứng minh bản vá SSRF
**không chặn nhầm site thật**.

Nếu sau khi vá, hai site này quét ra khác bảng dưới đây thì đó là dấu hiệu chặn quá tay —
không phải "site đổi".

## Điều kiện lúc chụp

| Mục | Giá trị |
|---|---|
| Endpoint | `POST https://app.webmcps.net/api/scan` |
| Engine | `SCANNER_ENGINE=lightpanda` (đo qua SSH cùng ngày) |
| Nhánh production | `main`, chưa có thay đổi P0 nào |
| HTTP | 200 cho cả hai site |
| Thời gian quét | blvera.com 2,8s · pytesess.vn 3,4s |

### blvera.com

- Job quét mốc: `job_814d820e83544b2b` · trạng thái `ready` · origin `https://blvera.com`
- Trang quét được: **8/8**
- Tổng thô trước dedupe: 33 nút · 1 form · 0 thẻ sản phẩm

**6 tool:**

| tool | kind | ghi chú |
|---|---|---|
| `get_page_info` | get_page_info | readOnlyHint |
| `get_site_nav` | get_site_nav | readOnlyHint |
| `list_links` | list_links | readOnlyHint |
| `fill_form_form_0` | fill_form | 7 trường · action `None` · 1 selector |
| `click_by_text` | click_by_text |  |
| `open_path` | open_path | allowlist 16 đường dẫn |

### pytesess.vn

- Job quét mốc: `job_d6b4b5d481424e74` · trạng thái `ready` · origin `https://pytesess.vn`
- Trang quét được: **8/8**
- Tổng thô trước dedupe: 61 nút · 3 form · 0 thẻ sản phẩm

**8 tool:**

| tool | kind | ghi chú |
|---|---|---|
| `get_page_info` | get_page_info | readOnlyHint |
| `get_site_nav` | get_site_nav | readOnlyHint |
| `list_links` | list_links | readOnlyHint |
| `fill_form_form_0` | fill_form | 1 trường · action `None` · 1 selector |
| `fill_form_form_0_2` | fill_form | 15 trường · action `None` · 1 selector |
| `fill_form_form_0_3` | fill_form | 7 trường · action `None` · 1 selector |
| `click_by_text` | click_by_text |  |
| `open_path` | open_path | allowlist 6 đường dẫn |

## Cách đối chiếu ở Phase 4

```bash
curl -s -X POST https://app.webmcps.net/api/scan \
  -H 'content-type: application/json' \
  -d '{"url":"https://blvera.com"}' --max-time 120 \
| python3 -c "import json,sys; j=json.load(sys.stdin); \
print(len([p for p in j['pages'] if not p.get('error')]),'/',len(j['pages']),'trang'); \
print(sorted(c['name'] for c in j['candidates']))"
```

Đạt khi: **cùng số trang quét được** và **cùng tập tên tool**.

Hai thay đổi dưới đây là **dự kiến, không phải hồi quy** — Phase 3 cố ý gây ra:

| Thay đổi dự kiến | Vì sao |
|---|---|
| `click_by_text` có thêm `metadata.allowlist` | Phase 3 bước 2 |
| Số nút thô tăng | Phase 3 bước 1 thu thêm thẻ `<a>` vào `PageSnapshot.buttons` |

Mọi thay đổi khác — **mất tool, mất trang, đổi tên tool** — là hồi quy.

## Ghi chú

- Hai lượt quét này tạo hai job trên production (`job_814d820e83544b2b`,
  `job_d6b4b5d481424e74`). Cả hai site đều thuộc sở hữu của Leo. Chưa cài snippet
  nên chưa có gì chạy trên site thật.
- `action` của mọi form đều `None`: các form này gửi bằng JavaScript, không có
  thuộc tính `action` trong HTML. Không ảnh hưởng mốc.
- Không có thẻ sản phẩm nào được nhận diện trên cả hai site, nên `list_products`
  không xuất hiện — đúng như hiện trạng, không phải lỗi.

## Câu hỏi chưa giải quyết

Không có. Mốc đã đủ để đối chiếu.
