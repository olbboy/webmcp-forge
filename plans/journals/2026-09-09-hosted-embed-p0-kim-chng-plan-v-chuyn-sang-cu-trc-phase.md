---
title: "Hosted Embed P0: kiểm chứng plan và chuyển sang cấu trúc phase"
date: 2026-09-09
summary: "Tìm 4 lỗi chặn trong plan hosted-embed, chốt 1a/2a/3a, tạo plans/260910-0143-hosted-embed-p0 với 4 phase"
---

# Hosted Embed P0: kiểm chứng plan và chuyển sang cấu trúc phase

## Chuyện gì đã xảy ra
- Brainstorm (report `plans/reports/brainstorm-260910-0119-hosted-embed.md`): phát hiện jobId vừa là khoá công khai vừa là khoá quản trị; UI đã có snippet "hosted" giả trỏ về origin Forge; version manifest hardcode "1.0.0". Kiểm số Cloudflare free (Workers 100k req/ngày, KV 100k đọc / 1k ghi / 1 ghi/s/key, lan truyền tới 60s).
- Kiểm chứng `plans/hosted-embed-p0-implement.md` (report `plans/reports/plan-verify-260910-0139-hosted-embed-p0.md`). 4 lỗi chặn:
  1. `getEmbedJs`/`getManifestJson` (src/lib/jobs.ts:96) tái sinh lười qua `generateJobBundle` → nếu publish nằm trong đó, một GET download sẽ publish lên CDN.
  2. Manifest dựng trước khi publish nhưng lấy `publishedVersion` → nhúng số cũ; WP2/WP3 mâu thuẫn thời điểm tăng version.
  3. `@cloudflare/vitest-pool-workers@0.22.0` peer vitest ^4.1; repo vitest ^5 → không dùng được; `unstable_dev` deprecated, docs khuyến nghị `createTestHarness()`.
  4. `.env.example` bị `.env*` trong .gitignore bỏ qua (git check-ignore xác nhận).

## Quyết định
- Leo chốt: 1a (test dồn về vitest gốc + `createTestHarness`, bỏ `cdn/package.json`, wrangler devDependency ở root), 2a (`job.version` tăng mỗi generate kể cả khi CDN lỗi; Worker 409 khi version lùi), 3a (chuyển plan sang thư mục phase).
- `generateJobBundle` giữ thuần; publish chỉ trong `generateAndPublish` do POST generate gọi.
- Plan mới: `plans/260910-0143-hosted-embed-p0/` — 4 phase (Worker cdn/ + harness → Forge data/API → UI panels → Docs/E2E). File cũ thành con trỏ. `ak plan validate` OK, đã `ak plan use`.

## Bước tiếp
- Chạy `/ak:cook plans/260910-0143-hosted-embed-p0` từ phase 1.
- Ops Leo: tạo CF account, KV namespace, secret PUBLISH_TOKEN, deploy, set env Forge.
- Chưa kiểm: phiên bản wrangler tối thiểu có `createTestHarness`; config inline có nhận `vars` không.

> Historical work record — not durable authority. Prefer docs/specs/ADRs for current decisions.
