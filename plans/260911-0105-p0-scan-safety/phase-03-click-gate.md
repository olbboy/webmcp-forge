---
title: "Phase 3: Click-Gate"
status: todo
---

# Phase 3: Click-Gate

## Overview

`click_by_text` là tool nguy hiểm nhất trong bộ mà được canh lỏng nhất. Khoá nó vào danh sách phần tử đã thấy lúc quét, cho nhãn an toàn thật sự tới trình duyệt, và **không làm chết tool của job đã sinh trước đó**.

## Requirements

- [ ] Chức năng: `click_by_text` chỉ bấm phần tử khớp **đúng bằng** một mục trong allowlist
- [ ] Chức năng: chuỗi không khớp → `ok:false` kèm allowlist, **không có cú click nào**
- [ ] Chức năng: allowlist phủ **cả link `<a>`**, không chỉ `<button>`
- [ ] Chức năng: job cũ (không có allowlist) vẫn dùng được `click_by_text`
- [ ] Chức năng: `annotations` tới `registerTool` và thấy được qua `getTools()`
- [ ] Chức năng: nhãn dùng đúng từ vựng WebMCP, không phải từ vựng MCP
- [ ] Phi chức năng: `next build` typecheck sạch — `webmcp.d.ts` phải khai `annotations`
- [ ] Phi chức năng: có công tắc runtime tắt riêng cổng này để hoàn tác

## Architecture

### Vấn đề hiện tại

`src/lib/generator.ts:343-356` khớp **chuỗi con** trên mọi `a, button, [role=button], input[type=submit|button]` rồi `.click()` thẳng. Agent gửi `"xoá"` có thể trúng "Xoá tài khoản". So sánh: `fill_form` cần **hai** cờ mới gửi. Cùng một bộ tool, hai chuẩn an toàn.

### Ba cái bẫy rà soát đối kháng chỉ ra

**Bẫy 1 — nhánh chuỗi con dự phòng mở lại đúng lỗ này.** Bản đầu cho phép: khớp bằng thất bại thì `allowed.find(a => norm(a).indexOf(needle) !== -1)`. Allowlist `["Delete account","Add to cart","Checkout"]`, agent gửi `text:"a"` → khớp `"delete account"` → bấm. `Array.find` trả mục **đầu tiên theo thứ tự allowlist**, không theo ý định. → **Bỏ hẳn nhánh chuỗi con.** Nhiều mục cùng khớp → `ok:false` kèm danh sách để agent chọn lại.

**Bẫy 2 — allowlist thiếu `<a>`.** Extractor và runtime dùng **hai selector khác nhau**:

| | Selector | Có `a`? |
|---|---|---|
| `src/lib/extract.ts:207` (lúc quét) | `button, [role="button"], input[type="submit"], input[type="button"]` | **không** |
| `src/lib/generator.ts:347` (lúc gọi) | `a, button, [role="button"], input[type="submit"], input[type="button"]` | **có** |

Khoá cổng bằng allowlist dựng từ `buttons` sẽ giết mọi cú bấm vào link — trong khi mô tả tool nói *"button **or link**"*. Và không test nào đỏ: fixture có 9 thẻ `<button>` nên "allowlist không rỗng" vẫn đạt.

→ Mở rộng `extract.ts:207` thu **cả `a`**. Đây là đổi hình dạng `PageSnapshot.buttons`, nên xem Bẫy 3.

**Bẫy 3 — job cũ mất tool, ở cùng số phiên bản CDN dùng làm cache validator.** Cổng đọc `tool.metadata.allowlist`, nhưng allowlist chỉ dựng lúc **quét**. Job quét trước khi deploy có `click_by_text` **không có `metadata`** (`heuristics.ts:188-206`). Mà bundle được dựng lại từ candidates **đã lưu**: `generator.ts:10-35 applySelection` làm `{...base}` với `base` lấy từ `job.candidates`.

Hai đường hỏng: khách bấm Generate lại → tool chết được publish lên CDN; hoặc artifact mất khỏi đĩa → `jobs.ts:333-349 rebuildArtifacts` dựng lại **bằng generator mới với candidates cũ** → `allowed = []` → mọi cú click hỏng vĩnh viễn, **ghi đè ở cùng `version`**. Chính comment ở `jobs.ts:329-332` cảnh báo: hai bundle khác nhau dưới một số phiên bản, mà CDN dùng số đó làm cache validator.

→ Phân biệt **`undefined`** (job cũ) với **`[]`** (job mới, trang không có nút):
- `undefined` → dựng allowlist ngay tại `applySelection` từ `job.pages.flatMap(p => p.buttons ?? [])` — dữ liệu đã nằm sẵn trong job đã lưu (`types.ts:67`). Job cũ hơn nữa, chưa có `buttons`, thì `?? []` giữ hành vi cũ thay vì chết.
- `[]` → không đề xuất tool.

### Nhãn: từ vựng WebMCP, không phải MCP

Chuẩn WebMCP bản 9/9/2026 định nghĩa **ba** hint:

```
dictionary ToolAnnotations {
  boolean readOnlyHint = false;           // chỉ đọc
  boolean untrustedContentHint = false;   // đầu ra chứa nội dung không tin cậy
  boolean consequentialHint = false;      // hệ quả thật, khó hoàn tác
};
```

MCP có `destructiveHint`/`idempotentHint`/`openWorldHint` — **không** dùng ở đây. Chỉ `readOnlyHint` trùng tên.

| Tool | `readOnlyHint` | `consequentialHint` | `untrustedContentHint` |
|---|---|---|---|
| `get_page_info`, `get_site_nav`, `list_links`, `list_products` | ✅ | — | ✅ |
| `search_on_page` | — | — | — |
| `fill_form_*` | — | ✅ | — |
| `click_by_text` | — | ✅ | ✅ — mô tả chứa text nút do site quét kiểm soát |
| `open_path` | — | ✅ | — |

`untrustedContentHint` cho `click_by_text` là bắt buộc: bước 1 nhét 40 mục × 80 ký tự nội dung do **site được quét** kiểm soát vào `description` mà agent đọc, và nó đi thẳng vào bundle qua `generator.ts:70 JSON.stringify(manifest)`. Đó là kênh prompt injection.

⚠️ **Nhãn không phải rào chắn.** Blog MCP chính chủ: *"A server can claim readOnlyHint: true and delete your files anyway… Clients must treat hints as untrusted by default."* Client thực thi không đều — Codex CLI có bảng quyết định thật, Claude Code thì không tự duyệt theo `readOnlyHint`. **Cổng thật là allowlist trong `executeImpl`.**

### Tiêu chí nhãn phải kiểm được

`installPolyfill()` (`generator.ts:91-105`) trả về context **native** nguyên vẹn khi trang đã có `document.modelContext` — không vá gì. Nên "thấy `annotations` trên trang thật" phụ thuộc trình duyệt, không phụ thuộc Forge, và test trong Chrome trần luôn đi nhánh polyfill. Tách thành hai câu kiểm được:

1. embed truyền `annotations` vào `registerTool` — **spy trên `document.modelContext` giả** cài trước khi tiêm (bắt đúng nhánh native passthrough)
2. polyfill của Forge trả `annotations` qua `getTools()`

## Related Code Files

- Modify: `src/lib/extract.ts` — thu cả `a` vào `buttons`
- Modify: `src/lib/heuristics.ts` — dựng allowlist; `annotations` cho cả 8 kiểu
- Modify: `src/lib/generator.ts` — cổng khớp-đúng-bằng; `annotations` vào `registerTool`; `getTools()` trả `annotations`; **`applySelection` backfill allowlist cho job cũ**
- Modify: **`src/types/webmcp.d.ts`** — khai `annotations` ở `registerTool` và `WebMcpToolInfo`; thiếu là `next build` đỏ (`tsconfig.json` include `**/*.ts`, typecheck cả `tests/`)
- Modify: `tests/generator.test.ts` · `tests/scanner.test.ts` · **`tests/form-merging.test.ts`** (gọi `proposeTools` trực tiếp)
- Modify: `README.md` · `docs/decisions.md`
- Đọc để đối chiếu: `src/lib/jobs.ts:333-349` (`rebuildArtifacts`), `src/components/job-catalog.tsx:49,179`

## Implementation Steps

1. **`src/lib/extract.ts`.** Thêm `a` vào selector ở dòng 207. Giữ nguyên trần 40/trang và cắt 80 ký tự. Lưu ý: 40 là **mỗi trang**; gộp 8 trang có thể tới 320 trước dedupe — cắt lại 40 **sau** khi gộp và dedupe.
2. **`src/lib/heuristics.ts` — allowlist.** Gom `pages.flatMap(p => p.buttons ?? [])`, chuẩn hoá text, bỏ rỗng, dedupe, cắt 40. Gắn `metadata: { allowlist, annotations: {...} }`. Cập nhật `description` nêu rõ chỉ bấm được các mục này. **Allowlist rỗng → không đề xuất tool.**
3. **`src/lib/heuristics.ts` — nhãn.** Gắn `annotations` theo bảng trên cho cả 8 kiểu.
4. **`src/lib/generator.ts` — backfill.** Trong `applySelection`, khi `base.kind === "click_by_text"` và `base.metadata?.allowlist === undefined`, dựng allowlist từ `job.pages` rồi gắn vào bản sao. Phân biệt `undefined` với `[]`.
5. **`src/lib/generator.ts` — cổng.** Viết lại nhánh `click_by_text`:
   ```js
   if (!GATE_ENABLED) { /* hành vi cũ — công tắc hoàn tác */ }
   var allowed = (tool.metadata && tool.metadata.allowlist) || [];
   var needle = norm(args.text);
   if (!needle) return wrap({ ok:false, error:"text is required", allowlist: allowed });
   var hits = allowed.filter(function(a){ return norm(a) === needle; });   // CHỈ khớp đúng bằng
   if (hits.length === 0) return wrap({ ok:false, error:"text is not in the allowlist",
                                        text: args.text, allowlist: allowed });
   if (hits.length > 1)  return wrap({ ok:false, error:"text is ambiguous", matches: hits });
   // tìm phần tử theo hits[0], KHÔNG theo args.text
   ```
   Điểm mấu chốt: định vị phần tử theo **`hits[0]`** (mục trong allowlist), không theo chuỗi người gọi gửi. Tìm theo `args.text` thì cổng chỉ là trang trí.
   Theo mẫu sẵn có của `open_path` (`heuristics.ts:213-227`): thêm `enum: allowlist` vào `inputSchema` để agent thấy lựa chọn hợp lệ ngay trong schema.
6. **`src/lib/generator.ts` — truyền nhãn.** `registerTool({ name, description, inputSchema, annotations: tool.metadata?.annotations, execute })`. Và `getTools()` của polyfill trả thêm `annotations`.
7. **`src/types/webmcp.d.ts`.** Khai `annotations?: { readOnlyHint?: boolean; untrustedContentHint?: boolean; consequentialHint?: boolean }` ở cả tham số `registerTool` và `WebMcpToolInfo`.
8. **Test.**
   - chuỗi trong allowlist → `ok:true, clicked:true`
   - chuỗi ngoài allowlist → `ok:false` **và phần tử không bị bấm** — gắn listener đếm click để chứng minh, không chỉ đọc giá trị trả về
   - chuỗi khớp nhiều mục → `ok:false, error:"ambiguous"`, không bấm
   - **link `<a>` trong allowlist bấm được** — ca bảo vệ Bẫy 2
   - **job cố định không có `metadata`** đi qua `applySelection` vẫn ra tool dùng được — ca bảo vệ Bẫy 3
   - allowlist rỗng → tool không tồn tại
   - `tests/scanner.test.ts`: `click_by_text` có `metadata.allowlist.length > 0` trên fixture
   - nhãn: spy trên `document.modelContext` giả thấy `annotations`; `getTools()` của polyfill trả `annotations`
9. **Tài liệu.** `README.md` sửa mô tả tool. `docs/decisions.md`: vì sao allowlist thay vì cổng xác nhận — chuẩn khuyến khích tool có phạm vi cụ thể, và nhãn không được client thực thi nhất quán.

## Todo

- [ ] `extract.ts` thu cả `a`; cắt 40 **sau** khi gộp
- [ ] Allowlist trong `heuristics.ts`; rỗng → không đề xuất tool
- [ ] `annotations` theo bảng cho cả 8 kiểu, gồm `untrustedContentHint` cho `click_by_text`
- [ ] Backfill allowlist trong `applySelection` cho job cũ (`undefined` ≠ `[]`)
- [ ] Cổng khớp-đúng-bằng, định vị theo `hits[0]`; **không có nhánh chuỗi con**
- [ ] `enum: allowlist` trong `inputSchema`
- [ ] Công tắc runtime tắt cổng
- [ ] `annotations` vào `registerTool` và `getTools()`
- [ ] `webmcp.d.ts` khai `annotations`
- [ ] 8 nhóm ca test ở bước 8
- [ ] `README.md` + `docs/decisions.md`

## Success Criteria

- [ ] `npm test` xanh và **`next build` typecheck sạch**
- [ ] Ca "ngoài allowlist" chứng minh **không có cú click nào xảy ra**
- [ ] Link `<a>` trong allowlist bấm được
- [ ] Job cố định không có `metadata` vẫn ra `click_by_text` dùng được
- [ ] Spy trên `modelContext` giả thấy `annotations` đúng bảng
- [ ] Quét lại fixture shop: số tool không đổi, allowlist không rỗng

## Risk Assessment

| Rủi ro | Dấu hiệu | Phản ứng đã định trước |
|---|---|---|
| Cổng chỉ là trang trí nếu định vị theo `args.text` | Ca "không-bị-bấm" đỏ | Nêu rõ ở bước 5; đây là chỗ dễ làm sai nhất |
| Job đã publish trên CDN mất `click_by_text` | Khách báo tool hỏng sau deploy | Backfill ở bước 4 + ca test job cố định. Đếm trước số job có `click_by_text` (`plan.md` Open Question #4) |
| Đổi hình dạng `PageSnapshot.buttons` phá job cũ hơn nữa | `undefined.flatMap` lúc `rebuildArtifacts` | `p.buttons ?? []` ở mọi chỗ đọc |
| Allowlist chụp lúc quét, site đổi nút sau đó | Agent luôn nhận `ok:false` | Đúng bản chất selector tĩnh của Forge; health check (P1, ngoài đợt này) là chỗ xử. Ở đây trả allowlist trong lỗi để agent tự sửa |
| `annotations` làm `registerTool` ném ở trình duyệt chưa hỗ trợ | Console báo `failed to register` | `boot()` đã có `.catch` từng tool; thêm ca test trên polyfill tự dựng |
| Bundle phình vì allowlist | Kích thước embed tăng mạnh | Trần 40 mục sau dedupe, mỗi mục 80 ký tự |
