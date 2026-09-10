---
title: "Hosted Embed P0"
description: "Khách dán 1 thẻ script từ CDN Cloudflare (Worker + KV) thay vì tự host embed.js; self-host vẫn giữ."
status: in-progress
priority: P1
effort: "2d"
tags: [cdn, cloudflare, worker, kv, embed]
created: 2026-09-10
blockedBy: []
blocks: []
---

# Hosted Embed P0

## Overview

Sau khi generate, Forge tự publish `embed.js` + `manifest.json` lên một Cloudflare Worker đọc KV. Khách dán `<script src="https://<worker>.workers.dev/e/<publicId>/embed.js">`. Self-host download giữ nguyên. Snippet chỉ lộ `publicId`, không bao giờ lộ `jobId` (khoá quản trị).

Nguồn quyết định: `plans/reports/brainstorm-260910-0119-hosted-embed.md`, `plans/reports/plan-verify-260910-0139-hosted-embed-p0.md`. File cũ `plans/hosted-embed-p0-implement.md` chỉ còn là con trỏ tới thư mục này.

## Quyết định đã chốt

| # | Quyết định |
|---|---|
| 1 | CDN trên `*.workers.dev`, nhãn **beta** tới khi có custom domain. Hostname đọc từ env `CDN_BASE_URL`. |
| 2 | **Auto-publish** sau generate, best-effort: generate luôn thành công; `publishStatus` = `skipped` (chưa cấu hình) / `published` / `failed` / `unpublished`; nút Publish lại. |
| 3 | Worker nằm ở thư mục **`cdn/`** trong repo này: chỉ `wrangler.jsonc`, `src/`, `README.md`. **Không** có `cdn/package.json`; `wrangler` là devDependency ở root. |
| 4 | **Unpublish** trong P0 (Worker DELETE + nút). |
| 5 | **`publicId` ≠ `jobId`**: `pub_` + 32 hex (128 bit), sinh 1 lần ở generate đầu tiên khi CDN được cấu hình, **ổn định** qua unpublish/republish. |
| 6 | **`job.version`** (số nguyên) **tăng ở đầu mỗi lần generate**, kể cả khi CDN lỗi. `manifest.version = String(job.version)`. Publish thành công → `publishedVersion = job.version`. Retry publish gửi lại cùng số. Worker trả 409 nếu `body.version < stored.version`. |
| 7 | Mọi test (Worker, client CDN, API, E2E) chạy từ **vitest gốc** qua `createTestHarness()` của `wrangler`. Không dùng `vitest-pool-workers` (đòi vitest 4, repo dùng vitest 5) và không dùng `unstable_dev` (deprecated). |
| 8 | Snippet khách dán **không** có `?v=`; `?v=<version>` chỉ dùng cho link Test. |
| 9 | `generateJobBundle` giữ thuần (chỉ sinh file). Publish chỉ xảy ra trong `generateAndPublish` do `POST …/generate` gọi. Đường tái sinh lười trong `getEmbedJs`/`getManifestJson` **không bao giờ** publish hay tăng version. |

## Kiến trúc

```
Visitor  --GET /e/:publicId/embed.js-->  Worker (cdn/src/index.ts)  --KV get (cacheTtl 60)-->  embed:{publicId}
Owner    --POST /api/jobs/:jobId/generate-->  Forge  --Bearer PUBLISH_TOKEN-->  Worker PUT /e/:publicId
Owner    --POST /api/jobs/:jobId/publish | unpublish-->  Forge  --Bearer-->  Worker PUT | DELETE
Owner UI --hosted panel: publicId only; self-host panel: /api/jobs/:jobId/embed.js (admin)
```

### KV record (`embed:{publicId}`)

```ts
type CdnRecord = {
  publicId: string;
  version: number;      // monotonic, >= 1
  embedJs: string;
  manifestJson: string;
  updatedAt: string;    // ISO
  jobOrigin?: string;   // origin site khách, không phải secret
};
```

### Header GET (Worker)

`Cache-Control: public, max-age=300, stale-while-revalidate=60` · `ETag: "<version>"` · `Content-Type: application/javascript; charset=utf-8` hoặc `application/json; charset=utf-8` · `Access-Control-Allow-Origin: *` · `X-Content-Type-Options: nosniff`.

### Độ trễ đã chấp nhận (ghi lên UI)

KV lan toàn cầu tới 60 giây + cache trình duyệt 5 phút → bản mới/unpublish tới khách trong tối đa ~6 phút.

## Goals

| # | Goal | Priority |
|---|------|----------|
| 1 | Khách dán 1 thẻ script CDN là có tool; không cần host file | P1 |
| 2 | `jobId` không bao giờ xuất hiện trong snippet hay URL CDN | P1 |
| 3 | Generate không bao giờ thất bại vì CDN; trạng thái publish luôn hiển thị | P1 |
| 4 | Unpublish gỡ file khỏi CDN | P1 |
| 5 | Self-host download và 6 test hiện có không đổi hành vi | P1 |

## Phases

| # | Phase | Status |
|---|-------|--------|
| 1 | [Phase 1: Worker `cdn/` + test harness](./phase-01-cdn-worker.md) | Completed |
| 2 | [Phase 2: Forge data, client CDN, API](./phase-02-forge-data-and-api.md) | Pending |
| 3 | [Phase 3: UI hosted / self-host panels](./phase-03-ui-panels.md) | Pending |
| 4 | [Phase 4: Docs, E2E, scripts](./phase-04-docs-tests-scripts.md) | Pending |

Phụ thuộc: 2 → 1 · 3 → 2 · 4 → 3. Tách PR: PR1 = phase 1 · PR2 = phase 2 · PR3 = phase 3 + 4.

## Success Criteria

- [ ] `npm test` exit 0, gồm 6 test cũ + test mới của 4 phase.
- [ ] Demo shop → generate → snippet chứa `pub_…`, không chứa `job_…` → GET qua harness trả JS → inject fixture → `getTools()` có tool.
- [ ] Unpublish → GET qua harness trả 404.
- [ ] Không có `CDN_BASE_URL`: generate OK, panel hosted ẩn, self-host download OK, `publishStatus: skipped`.
- [ ] Snippet giả trỏ về origin Forge đã bị gỡ.
- [ ] UI hiện nhãn beta, độ trễ cache, cảnh báo link admin.
- [ ] `.env.example` được commit; `.wrangler/` và `.dev.vars` bị ignore.

## Out of scope (P1+)

Custom domain cutover · lịch sử version · rotate `publicId` · R2 · auth tài khoản / cookie admin ký · regional Playwright scan · rate limit GET.

## Ops (Leo, ngoài code)

1. Tạo tài khoản Cloudflare, `npx wrangler login`.
2. `npx wrangler kv namespace create EMBEDS` → dán `id` vào `cdn/wrangler.jsonc`.
3. `npx wrangler secret put PUBLISH_TOKEN -c cdn/wrangler.jsonc` (giá trị ngẫu nhiên ≥ 32 byte).
4. `npm run cdn:deploy` → lấy URL `https://<name>.<account>.workers.dev`.
5. Forge env: `CDN_BASE_URL=<URL trên>`, `CDN_PUBLISH_TOKEN=<cùng giá trị>`.

## Ghi chú kỹ thuật

- Next.js 16: đọc docs kèm trong package `next` (`dist/docs/`) trước khi sửa App Router, theo `AGENTS.md`.
- `createTestHarness` được docs Cloudflare (10/9/2026) khuyến nghị thay `unstable_dev`; pin `wrangler@^4.130.0` (bản mới nhất khi kiểm). Phiên bản tối thiểu hỗ trợ API này: chưa kiểm — nếu import lỗi, nâng wrangler.
- `crypto.subtle.timingSafeEqual(a, b)` có trên Workers (non-standard extension, đã kiểm docs).

<!-- slug: hosted-embed-p0 -->
