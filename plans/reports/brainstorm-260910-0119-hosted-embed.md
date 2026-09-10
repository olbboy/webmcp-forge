---
type: brainstorm
date: 2026-09-10
slug: hosted-embed
status: review-complete, awaiting 5 decisions
---

# Brainstorm: Hosted Embed cho WebMCP Forge — kiểm chứng plan + trả lời câu hỏi

## Contract
- **Outcome:** khách dán 1 thẻ `<script src="https://cdn…/e/{publicId}/embed.js">`; Forge tự publish lên Cloudflare (Worker + KV) sau generate; self-host download giữ nguyên.
- **Constraints:** Cloudflare free; Forge chạy Node + Playwright (không chạy được trên Worker); job anonymous, file JSON local; Next.js 16 (đọc docs bundled trong package `next` trước khi code, theo AGENTS.md).
- **Non-goals:** như plan §2.
- **Acceptance:** generate → GET CDN URL trả JS đúng version → inject vào fixture-shop → `getTools()` có tool; bad id → 404; publish sai token → 401; unpublish → 410; generate vẫn OK khi CDN lỗi (publishStatus=failed).

## Bằng chứng đã kiểm trong repo
1. `src/components/job-catalog.tsx:31-33` — UI **đã** hiện snippet "hosted" trỏ về origin Forge (`/api/jobs/{id}/embed.js`). README chỉ chạy local, không có config deploy → snippet này vô dụng với khách. Plan phải **thay** card này, không thêm bên cạnh.
2. `src/lib/jobs.ts:6` — jobId = `job_` + 16 hex = 64 bit. Đủ chống đoán, **nhưng jobId vừa là khoá công khai vừa là khoá quản trị**: `POST /api/jobs/:id/generate` không có auth. Với hosted, ai xem nguồn HTML của khách → mở `/jobs/{id}` → sửa mô tả tool (agent đọc mô tả → prompt injection), tắt tool, bật local-relay (tải script bên thứ ba) → generate → auto-publish đè bản CDN. Không chèn được JS tuỳ ý (`JSON.stringify`), nhưng đủ nguy hiểm. **P0: tách `publicId` khỏi jobId.**
3. `src/lib/generator.ts:46` — `version: "1.0.0"` hardcode. Cần số tăng dần cho ETag / `?v=`.
4. `src/app/api/jobs/[id]/embed.js/route.ts` — `cache-control: no-store` + `content-disposition: attachment`; không phù hợp hot path.
5. Tests hiện import route handler trực tiếp, inject bằng `page.addScriptTag({content})` (tests/generator.test.ts). E2E hosted cần `wrangler dev` (miniflare) + `addScriptTag({url})`.

## Bằng chứng Cloudflare (đã mở docs 10/9/2026)
| Mục | Số | Nguồn |
|---|---|---|
| Workers Free | 100.000 req/ngày, 10 ms CPU/req | developers.cloudflare.com/workers/platform/limits |
| KV Free | 100.000 reads/ngày, 1.000 writes/ngày, 1 write/giây/cùng key, value 25 MiB, 1 GB | developers.cloudflare.com/kv/platform/limits |
| KV nhất quán | "up to 60 seconds or more" để lan toàn cầu; cacheTtl mặc định 60s, min 30s | developers.cloudflare.com/kv/concepts/how-kv-works |
| Custom Domain | cần zone active trên Cloudflare; không ghi yêu cầu gói trả phí | developers.cloudflare.com/workers/configuration/routing/custom-domains |
| R2 Free | 10 GB, 1M Class A, 10M Class B/tháng, egress free | developers.cloudflare.com/r2/pricing |
| Chưa kiểm | giá Workers Paid; r2.dev có phù hợp production; R2 có cần thẻ thanh toán | — |

## Sửa plan (P0 bắt buộc)
- **publicId riêng** (random 128 bit) tạo lúc publish; KV key `embed:{publicId}`; snippet không bao giờ chứa jobId. jobId = link quản trị, cảnh báo "đừng chia sẻ".
- **version** = số nguyên tăng mỗi generate, lưu trong job + KV metadata; Worker trả `ETag: "v{n}"`.
- **Snippet khách dán KHÔNG có `?v=`** (nếu có, mỗi regenerate phải dán lại → mất ý nghĩa). `?v=` chỉ cho nút Test.
- Header: `Cache-Control: public, max-age=300, stale-while-revalidate=60`; KV `cacheTtl: 60`. UI ghi rõ: "bản mới lan tới khách trong ~5–6 phút; unpublish cũng không tức thì".
- **Publish best-effort**: generate vẫn thành công khi CDN lỗi; `publishStatus: published|failed|skipped|unpublished`; nút "Publish lại". Không có `CDN_BASE_URL` → ẩn panel hosted.
- Chống spam: KV giới hạn 1 write/giây/key → Forge debounce hoặc retry 1 lần.
- Worker: so sánh token bằng `crypto.subtle.timingSafeEqual`; `wrangler secret put`; thêm `Access-Control-Allow-Origin: *` (rẻ, hỗ trợ `crossorigin`).
- Docs: SRI không dùng được với hosted (nội dung đổi) → đó là lý do chọn self-host.
- Lưu 2 key (`…:js`, `…:manifest`) + KV metadata `{version, updatedAt}` → GET trả text thẳng, không JSON.parse.

## So sánh hướng
| | A. Worker + KV push (plan) | B. R2 public bucket + custom domain | C. Serve từ Forge |
|---|---|---|---|
| Giả định chính | Forge có outbound + secret | có domain trên CF; r2.dev không dùng production (chưa kiểm) | Forge deploy public |
| Gãy đầu tiên khi | >100k tải/ngày → Workers Paid | không có domain; publish vẫn cần ký S3 hoặc 1 Worker | Forge chỉ local; box Playwright gánh hot path |
| Khuyến nghị | **Chọn cho P0** | đường mở rộng, cùng publish API (Worker bind R2 sau) | loại |

## Trả lời 4 câu hỏi
1. **Domain:** câu hỏi thật là "có domain trong CF DNS trước khi khách đầu tiên dán snippet không?". Snippet + CSP của khách ghi hostname cứng; đổi từ `*.workers.dev` sang domain riêng sau này = mọi khách phải sửa tay. → Có domain: custom domain ngay P0. Chưa có: workers.dev, gắn nhãn beta "URL có thể đổi"; `CDN_BASE_URL` từ env.
2. **Default:** hosted tự publish sau generate; self-host bên cạnh. Điều kiện: best-effort, ẩn khi chưa cấu hình, UI nói rõ "công khai, ai có link đều tải được".
3. **Repo:** thư mục `cdn/` trong repo này (package.json + wrangler.jsonc riêng, `npm --prefix cdn`). Lý do: E2E §9 chạy qua cả hai bên; contract token/URL đổi trong 1 PR. Tách repo khi có đội vận hành riêng.
4. **Unpublish P0:** có — Worker DELETE + 1 nút (~1 giờ). Là kill switch cho thứ đã công khai. Version history → P1.

## Chỗ trống cần điền
- [ ] Q1: (a) đã có domain trên Cloudflare → custom domain P0 · (b) chưa có → workers.dev beta
- [ ] Q2: (a) auto-publish (khuyến nghị) · (b) opt-in checkbox
- [ ] Q3: (a) `cdn/` monorepo (khuyến nghị) · (b) repo tách
- [ ] Q4: (a) Unpublish P0 (khuyến nghị) · (b) P1
- [ ] Q5 (mới): (a) tách publicId khỏi jobId ở P0 (khuyến nghị) · (b) chấp nhận rủi ro tạm

## Handoff
`/ak:plan` với contract trên + 5 quyết định đã chốt.
