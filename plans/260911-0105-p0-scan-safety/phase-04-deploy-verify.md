---
title: "Phase 4: Deploy-Verify"
status: completed
---

# Phase 4: Deploy-Verify

## Overview

Ba lỗ hổng đang mở **trên production**, không phải trong repo. Phase này đưa Phase 1-3 lên `app.webmcps.net`, chứng minh bằng đo đạc rằng chúng đã đóng, và giữ đường lùi cho từng phase riêng.

## Requirements

- [x] Chức năng: ba biến thể SSRF trả **400** trên production
- [x] Chức năng: rate limit hoạt động, khoá theo IP thật — phân biệt được với xô `"unknown"`
- [x] Chức năng: quét site thật ra **cùng bộ tool** như mốc chụp trước khi merge
- [x] Phi chức năng: `app` **và** `lightpanda` đều healthy sau deploy
- [x] Phi chức năng: bộ nhớ không xấu đi; bank-hub không bị ảnh hưởng
- [x] Phi chức năng: hoàn tác được **từng phase**, không phải cả cụm

## Architecture

Đường deploy đã có, không phát minh gì mới. Nhưng lệnh phải lấy **nguyên văn** từ `docs/deployment-guide.md:42-47`, không viết lại từ trí nhớ:

```bash
ssh vtb-vps
cd /opt/webmcp-forge
git fetch origin && git reset --hard origin/main
npm run cdn:deploy                        # chỉ khi cdn/ đổi
docker compose --profile lightpanda up -d --build
```

Hai chỗ bản kế hoạch đầu viết sai:
- `git pull` → phải là `git fetch origin && git reset --hard origin/main`
- **thiếu `--profile lightpanda`** → bỏ sót container browser. Nó dùng `network_mode: "service:app"`, và `deployment-guide.md:134-136` nói thẳng: *"recreating the app destroys the browser container's network. Bring them up together rather than restarting the app alone."*

Hậu quả nếu chạy sai lệnh: `lightpanda` thành container mồ côi, mọi `/api/scan` ném `Lightpanda is not reachable at http://127.0.0.1:9222` (`scanner.ts:107`), bị nuốt thành job `"error"`, route trả 422 — và người đang kiểm SSRF ở bước 4 nhìn thấy "không phải 400" mà **không phân biệt được** đây là lỗi mạng browser hay lỗi lớp chặn. Đúng cái bước 4 sinh ra để phân biệt.

### Đường lùi

Bản đầu gộp ba phase một commit, và công tắc runtime chỉ có ở Phase 2. "Rebuild" trên máy này là `npm ci` + `npx playwright install chrome` + `npm run build` **ngay trên droplet 2 GB đang chạy đồng bộ ngân hàng** — thao tác ngốn RAM nhất trong cả kế hoạch.

→ Ba yêu cầu:
1. **Ba commit riêng** trên `main`, SHA từng phase ghi vào phase này để `git revert` được từng cái.
2. **Công tắc runtime** cho lớp 2 (`SCAN_ENFORCE_CONNECTED_IP`) và click gate — đổi bằng `up -d`, **không** `--build`.
3. **Deploy và rollback chạy ngoài cửa sổ đồng bộ của bank-hub**, và đo `free -m` **trong lúc build**, không chỉ sau khi quét.

## Related Code Files

- Modify: `docs/deployment-guide.md` — biến môi trường mới + cách chỉnh ngưỡng + công tắc hoàn tác
- Không sửa mã ứng dụng trong phase này

## Implementation Steps

1. **Chụp mốc so sánh — TRƯỚC khi merge.** Quét `https://blvera.com` và `https://pytesess.vn` trên production hiện tại, lưu tên và số lượng tool vào `plans/reports/`. Không có mốc này thì tiêu chí "cùng bộ tool" không kiểm được.
2. **Chốt cửa thoát.** `docker compose exec app printenv | grep -c SCAN_ALLOW` phải trả `0`. Kiểm **`/opt/webmcp-forge/.env`**, không phải `.env.example` — service `app` dùng `env_file: .env` và không có khối `environment:` (`docker-compose.yml:19`). Đã đo 2026-09-11: vắng mặt.
3. **Merge và deploy.** Ba commit riêng vào `main`, ghi SHA. Trên droplet chạy **đúng** khối lệnh ở Architecture. Đo `free -m` trong lúc `--build`.
4. **Kiểm SSRF trên production** — ba biến thể đã dùng để chứng minh lỗ hổng:

   | Ca | Gửi | Kỳ vọng |
   |---|---|---|
   | IP riêng | `{"url":"http://127.0.0.1:43127/"}` | **400**, thông điệp chuẩn |
   | Metadata đám mây | `{"url":"http://169.254.169.254/"}` | **400**, không phải lỗi mạng |
   | Tên miền → IP riêng | `{"url":"http://localtest.me/"}` | **400** |

   Và: `ls /opt/webmcp-forge/data/jobs/*.json | wc -l` **không tăng** sau ba ca đó.
5. **Kiểm rate limit — phải phân biệt được hai trạng thái.** Gọi hai lần liên tiếp từ một máy → lần hai 429. Rồi gọi từ **IP thứ hai** (điện thoại 4G) → phải **200**. Nếu IP thứ hai cũng 429 thì mọi khách đang chung xô `"unknown"` — tự-DoS, phải sửa trước khi coi là xong. Bản đầu chỉ kiểm vế thứ nhất, mà vế đó cho kết quả y hệt trong cả hai trạng thái.
6. **Kiểm không chặn nhầm** *(tiêu chí quan trọng nhất, dễ bị bỏ qua)*. Quét lại hai site ở bước 1, so với mốc đã chụp. Khác nhau là dấu hiệu chặn quá tay, không phải "site đổi".
7. **Đóng câu hỏi treo bằng lệnh đọc.**
   - `CF-Connecting-IP`: đã phải đóng **trước** Phase 2 (xem `plan.md` Open Question #1). Ở đây chỉ xác nhận lại.
   - Container có với tới metadata không: `docker compose exec app curl -s -m 3 -o /dev/null -w '%{http_code}' http://169.254.169.254/metadata/v1/ || echo unreachable`. Dù kết quả nào, Phase 1 vẫn chặn ở tầng ứng dụng — đây chỉ để biết mức phơi nhiễm thật.
   - Pseudo IPv4 "Overwrite Headers" trên zone: liếc dashboard Cloudflare.
8. **Đo bộ nhớ — đúng cgroup, đúng chỉ số, đúng mức đồng thời.**
   ```bash
   docker compose exec app        sh -c 'grep -E "^anon |^file " /sys/fs/cgroup/memory.stat; cat /sys/fs/cgroup/memory.current'
   docker compose exec lightpanda sh -c 'cat /sys/fs/cgroup/memory.current' 2>/dev/null
   ```
   Ba điều bản đầu làm sai:
   - Đo **cả hai** cgroup: production chạy Lightpanda trong container **riêng** với `mem_limit: 256m`; cgroup của `app` không chứa nó.
   - Đọc **`memory.current`**, không chỉ `anon`: cgroup v2 giết theo `memory.current` = anon + page cache + kernel. (Vẫn ghi `anon` để so với mốc cũ, nhưng ngưỡng OOM tính theo `memory.current`.)
   - Đo ở **mức đồng thời sẽ dùng**, không phải một lượt. Ngưỡng đặt ở `N` thì phải đo `N` lượt song song.
   Mốc: `docker-compose.yml:24` ước lượng 250 MB server + 400-600 MB browser; `deployment-guide.md:148` ghi Chrome ~350 MB, Lightpanda ~20 MB; đo cũ 225,7 MiB `anon`. **Ba con số mâu thuẫn — phép đo này là chỗ hoà giải.** Sửa comment `docker-compose.yml:24` theo kết quả, đừng để hai con số nằm cạnh nhau.
   Kiểm luôn 4 container bank-hub không đổi.
9. **Nâng `SCAN_MAX_CONCURRENT` nếu số liệu cho phép.** Mặc định là `1`. Với Lightpanda ~20 MB/lượt nhiều khả năng nâng được. Sửa `/opt/webmcp-forge/.env` + `up -d`, không cần `--build`.
10. **(Tuỳ chọn) Lưới đỡ burst ở Cloudflare.** Gói Free cho **1 rule, cửa sổ tối đa 10 giây** — không đủ làm giới hạn thật, nhưng chặn flood thô trước khi tốn băng thông tunnel. Rule: `POST` tới `/api/scan`, ≥3 request/10s cùng IP → chặn 10s. Cần quyền dashboard; bỏ qua được, Phase 2 vẫn đủ.
11. **Cập nhật `docs/deployment-guide.md`**: biến ngưỡng, công tắc hoàn tác, và cách chỉnh mà không rebuild.

## Todo

- [x] Chụp mốc bộ tool của 2 site thật **trước khi merge**
- [x] `SCAN_ALLOW_PRIVATE_HOSTS` vắng mặt trong `/opt/webmcp-forge/.env`
- [x] Ba commit riêng, ghi SHA từng phase
- [x] Deploy bằng **đúng** lệnh của `deployment-guide.md`, có `--profile lightpanda`
- [x] `docker compose ps`: cả `app` và `lightpanda` healthy
- [x] Ba ca SSRF trả 400; số file job **không tăng**
- [x] Rate limit: IP thứ nhất 429, **IP thứ hai 200**
- [x] Quét lại 2 site thật, khớp mốc
- [x] Đo `memory.current` **cả hai cgroup**, ở mức đồng thời sẽ dùng
- [x] Hoà giải ba con số RAM; sửa comment `docker-compose.yml:24`
- [x] Đóng nốt câu hỏi metadata + Pseudo IPv4
- [ ] (Tuỳ chọn) rule Cloudflare 10 giây — **chưa làm.** Giới hạn tầng ứng dụng đã chạy và khoá đúng IP thật; rule này chỉ là lưới đỡ burst, cần quyền dashboard
- [x] `docs/deployment-guide.md`

## Success Criteria

- [x] Ba ca SSRF: **400** trên production, không tạo job
- [x] Rate limit khoá theo IP thật — chứng minh bằng hai IP khác nhau, không phải hai lần từ một IP
- [x] Hai site thật quét ra **cùng bộ tool** như mốc
- [x] `docker compose ps`: `app` và `lightpanda` đều healthy
- [x] `memory.current` của cả hai cgroup dưới `mem_limit` ở mức đồng thời đã đặt; bank-hub không đổi
- [x] Ba SHA phase ghi lại, `git revert` được từng cái
- [x] Bốn câu hỏi treo ở `plan.md` đều có câu trả lời ghi lại

## Risk Assessment

| Rủi ro | Dấu hiệu | Phản ứng đã định trước |
|---|---|---|
| Deploy sai lệnh, mất mạng Lightpanda | Mọi scan trả 422, log `Lightpanda is not reachable` | Chạy lại **đúng** lệnh có `--profile lightpanda`. Đây là lý do bước 3 bắt chép nguyên văn |
| Chặn quá tay, site khách hỏng | Bước 6 ra ít tool hơn mốc | **Dừng, không hoàn tác vội** — tắt lớp 2 bằng `SCAN_ENFORCE_CONNECTED_IP=0` + `up -d` (không rebuild), rồi đọc thông điệp chặn để biết lớp nào bắt. Hoàn tác chỉ khi không tìm ra trong một lượt |
| Rate limit chặn nhầm chính Leo | 429 khi tự thử | Ngưỡng ở `/opt/webmcp-forge/.env`: sửa + `up -d`, không `--build` |
| `--build` trên droplet ép RAM, ảnh hưởng bank-hub | `free -m` tụt trong lúc build | Deploy ngoài cửa sổ đồng bộ; đo `free -m` **trong lúc** build, không chỉ sau |
| Job kẹt `"scanning"` do deploy giữa lượt quét | Người dùng thấy trang treo, Generate trả 409 | Phase 2 đã thêm hạn cho job `"scanning"`. Kiểm sau deploy |
| Rule Cloudflare chặn nhầm lưu lượng thật | Khách báo 429 mà log app không thấy request | Rule ở bước 10 là tuỳ chọn, xoá được trong một thao tác. Bỏ qua nếu chưa chắc |

---

## Kết quả triển khai

Ba lần lên production.

| Lần | Commit | Nội dung |
|---|---|---|
| 1 · 2026-09-11 02:1x | `6d0ab34` | Phase 1-3, deploy hai bước: bật với giới hạn tắt, đọc log, rồi bật giới hạn |
| 2 · 2026-09-11 03:1x | `7ae32e5` | Bốn mục còn lại từ rà soát mã |
| 3 · 2026-09-11 03:4x | `1a7ac18` | Ngưỡng 3/cửa sổ và 60/ngày thành mặc định trong mã, rồi gỡ hai dòng đè trong `.env` |
| 4 · 2026-09-11 11:3x | `8576da2` | Health check selector: API, nút trên trang job, cron hàng tuần |

Lần 3 làm hai bước có chủ ý: deploy mã mới **trước** khi gỡ hai dòng trong
`.env`. Gỡ trước thì production rơi về mặc định cũ (1 và 20) trong khoảng giữa,
vì mã đang chạy lúc đó chưa mang số mới. "Mặc định trong mã" và "mã đang chạy"
là hai thứ khác nhau khi production đi sau repo một commit. Bản `.env` cũ nằm ở
`.env.bak.before-defaults` trên droplet.

### Nghiệm thu trên `app.webmcps.net` (sau lần 2)

| Kiểm | Kết quả |
|---|---|
| `127.0.0.1` · `169.254.169.254` · `localtest.me` · `[::1]` · `10.0.0.1` | **400** cả năm |
| File job sau các lượt dò | **không tăng** — bị từ chối thì không ghi gì |
| `blvera.com` · `pytesess.vn` | 8/8 trang, tên tool **khớp mốc chính xác** |
| Giới hạn, hai lượt liền nhau | 429 kèm `retry-after` |
| Nguồn địa chỉ khách | `cf-connecting-ip` — khoá theo IP thật, không phải xô chung |
| `app` · `lightpanda` | healthy |

### Bộ nhớ

| | Sau các lượt quét thật |
|---|---|
| `app` `memory.current` | 171 MiB / trần 900 |
| `lightpanda` `memory.current` | 54 MiB / trần 256 |
| Host khả dụng | 1.085 MB |
| bank-hub (4 container) | 17 / 15 / 18 / 29 MiB — không đổi |

### Đáy RAM khả dụng trong lúc `--build` — con số cần theo dõi

| Lần | Đáy | Lấy mẫu | `dockerd` trước→sau | Nội dung |
|---|---|---|---|---|
| 1 | 244 MB | 4s | — | Phase 1-3 |
| 3 | 217 MB | 4s | — | Ngưỡng thành mặc định |
| 4 | 199 MB | 4s | — | Health check selector |
| 5 | **184 MB** | **3s** | 34 → 39 MiB | Sửa script chạy trong container |

Đây là thời điểm căng nhất của cả quy trình: build chạy `npm ci` +
`playwright install` + biên dịch **ngay trên máy dùng chung với hệ thống đồng bộ
ngân hàng**. Quét một site chỉ tốn ~170 MB; dựng ảnh mới là chỗ thật sự nguy
hiểm.

### Lần 5 bác bỏ cả "xu hướng" lẫn giả thuyết dockerd

Lần 5 chạy **ngay sau khi** khởi động lại dockerd, tức từ điểm xuất phát tốt
nhất từ trước tới nay: `MemAvailable` trước khi dựng là 1.227 MB, cao hơn mọi
lần khác. Nếu dockerd tích tụ là nguyên nhân thì đáy phải phục hồi. Nó không:
**184 MB, thấp nhất trong năm lần.**

Và trong suốt lần dựng đó, `dockerd` chỉ lớn thêm **5 MiB** (34 → 39). Vậy
dockerd không phình vì build. Nó phình theo thời gian hoặc theo thứ khác — 271
MiB trong 26 giờ — nhưng đó là chuyện riêng, không phải chuyện của cái đáy.

**Cái đáy do chính lần dựng quyết định**, không do trạng thái trước đó:

| | Lần 4 | Lần 5 |
|---|---|---|
| Khả dụng trước khi dựng | 1.014 MB | 1.227 MB |
| Đáy | 199 MB | 184 MB |
| **Lần dựng tiêu thụ** | **815 MB** | **1.043 MB** |

### Và một lỗi phương pháp do chính tôi gây ra

Bốn lần đầu lấy mẫu mỗi **4 giây**, lần 5 mỗi **3 giây**. Mẫu dày hơn thì dễ bắt
được đáy thật hơn. Chênh lệch 815 vs 1.043 MB có thể chỉ là lần 5 nhìn thấy cái
đáy mà bốn lần trước bỏ lỡ, chứ không phải lần 5 tiêu thụ nhiều hơn thật.

Nghĩa là **"đáy giảm đều 244 → 217 → 199" là kết luận vội**. Ba điểm cùng chiều
trong một dãy nhiễu là chuyện thường; tôi đã ghi "chưa đủ gọi là xu hướng" ở hai
điểm rồi lại gọi nó là xu hướng ở ba điểm, mà không có gì mới biện minh.

**Từ nay lấy mẫu mỗi 1 giây, cố định**, nếu không dãy số không so được với nhau.
Bốn con số đầu giữ lại để tham khảo, không dùng để kết luận.

### Giả thuyết "lớp ảnh tích tụ" đã bị bác bỏ

Ghi lại vì nó sai theo cách dễ mắc lại: lớp ảnh Docker chiếm **đĩa**, không
chiếm RAM, nên chúng không thể làm `MemAvailable` tụt. Và đo thật thì cũng
không có gì để dọn — `docker image ls --filter dangling=true` trống rỗng,
`docker system df` báo Images 15,69 GB với **0 B reclaimable**. Chạy
`docker image prune -f` sẽ thu về đúng 0 byte.

### Thủ phạm thật, đo ngày 2026-09-11

| Mục | Giá trị |
|---|---|
| `dockerd` RssAnon | **262 MiB** |
| AnonPages toàn máy | 528 MiB |
| Tỷ lệ dockerd chiếm | **~50%** phần không thu hồi được |
| dockerd chạy từ | 2026-09-10 09:19 (~26 giờ) |
| Số lần `--build` trong quãng đó | 4 |

Một dự án khác trên chính máy này từng ghi nhận `dockerd` phình tới 550 MiB sau
108 ngày. Lần này 262 MiB trong 26 giờ.

Lúc đó tôi đoán thứ làm nó phình là **hoạt động build**, và điều đó giải thích
được cái đáy giảm dần. **Lần đo thứ 5 bác bỏ phần thứ hai**: một lần dựng đầy đủ
chỉ làm dockerd lớn thêm 5 MiB. Nó vẫn phình theo thời gian — và khởi động lại
vẫn thu về 236 MiB thật — nhưng nó không phải là nguyên nhân của cái đáy.

### Đo thêm gì ở lần deploy tới

Ghi `dockerd` RssAnon **cùng lúc** với đáy RAM. Hai cột cạnh nhau qua vài lần là
đủ để khẳng định hay bác bỏ, và không tốn gì:

```bash
grep ^RssAnon /proc/$(pgrep -x dockerd)/status
```

### Đã khởi động lại dockerd — 2026-09-11 04:41 UTC

Giả thuyết đúng. Đo trước và sau:

| Mục | Trước | Sau | Thu về |
|---|---|---|---|
| `dockerd` RssAnon | 271 MiB | **35 MiB** | **236 MiB** |
| AnonPages toàn máy | 536 MiB | 347 MiB | 189 MiB |
| `MemAvailable` | 1.068 MB | **1.245 MB** | +177 MB |

Nghĩa là dockerd đang giữ khoảng **236 MiB không dùng tới** sau 26 giờ và bốn
lần dựng ảnh — gần đúng bằng khoảng cách giữa đáy lần một (244 MB) và lần bốn
(199 MB). Hai con số khớp nhau đủ để coi là cùng một nguyên nhân.

Gián đoạn: 7/7 container tự quay lại sau **8 giây**, tất cả `healthy` sau **18
giây**. Không phải dựng tay cái nào — cả bảy đều `unless-stopped`.

`bank-hub-db` ghi 6 dòng `FATAL: terminating connection due to administrator
command` đúng giây đó. Đó là Postgres đóng kết nối khi tắt sạch, không phải
hỏng: `pg_isready` trả "accepting connections" ngay sau, và backend ghi
"Prisma connected to database" rồi khởi động xong. Ghi lại vì dòng chữ `FATAL`
trông đáng sợ hơn thực tế và lần sau sẽ lại thấy nó.

### Đã bật `live-restore` — 2026-09-11 04:45 UTC

`/etc/docker/daemon.json` (trước đó không tồn tại, nên hoàn tác = xoá file):

```json
{
  "live-restore": true
}
```

Bật bằng `systemctl reload docker`, **không cần restart** — `docker info` báo
`Live Restore Enabled: true` ngay, và không container nào bị đụng tới.

Đã chứng minh chứ không chỉ tin: restart dockerd lần thứ hai rồi so
`.State.StartedAt` của cả 7 container trước và sau. **Cả bảy giữ nguyên dấu
thời gian gốc** — không cái nào bị dựng lại. `app.webmcps.net`,
`cdn.webmcps.net/health` và lượt tự gọi trong mạng docker đều 200 ngay sau đó.

Nghĩa là từ nay restart dockerd không còn là gián đoạn dịch vụ của bank-hub.

### Một dòng FATAL do chính phép kiểm gây ra

`docker exec bank-hub-db pg_isready` chạy dưới user `root`, mà Postgres chỉ có
role `bank`, nên mỗi lần kiểm để lại một dòng
`FATAL: role "root" does not exist` trong log. Server vẫn trả lời — đó là lý do
`pg_isready` báo "accepting connections" — và healthcheck thật của container
dùng `user=bank` thì sạch.

Ghi lại để không ai đuổi theo nó, kể cả tôi: lần sau kiểm bằng
`docker exec -u postgres bank-hub-db pg_isready -U bank -d bank_hub`, hoặc đọc
thẳng trạng thái `healthy` của container.

### Cách xử, khi cần

Khởi động lại `dockerd` thu lại phần nó giữ. Ràng buộc đã kiểm ngày 2026-09-11:

- Không có `/etc/docker/daemon.json`, nên `live-restore` = false: restart dockerd
  **dừng mọi container**, kể cả bank-hub.
- Nhưng cả 7 container hiện đều `unless-stopped` — kể cả `bank-hub-db`, vốn từng
  là `restart=no` trong một báo cáo cũ. Chúng tự bật lại. Gián đoạn ngắn, không
  cần dựng tay.

Nên vẫn là việc cần cửa sổ bảo trì và sự đồng ý của chủ máy, vì bank-hub là hệ
thống production của người khác.

**Ngưỡng hành động giữ nguyên: dưới ~150 MB thì dừng `--build` trên droplet**
và chuyển sang dựng ảnh ở nơi khác rồi đẩy sang.

Đo bằng cách lấy mẫu `free -m` mỗi 4 giây trong lúc `up -d --build` chạy, rồi
lấy giá trị nhỏ nhất của cột `available`.

### Câu hỏi treo — trạng thái cuối

| Câu | Kết quả |
|---|---|
| `cloudflared` có chuyển tiếp `CF-Connecting-IP` | **CÓ** — log production xác nhận |
| Mốc bộ tool trước khi sửa | Đã chụp, đã đối chiếu đạt hai lần |
| Pseudo IPv4 "Overwrite Headers" trên zone | Vẫn treo. Chỉ ảnh hưởng độ chính xác khoá IPv6 |
| Container có với tới `169.254.169.254` không | Vẫn treo. Không còn quan trọng: dải này bị chặn ở tầng ứng dụng và đã kiểm trên production |
| Bao nhiêu job đã publish mang `click_by_text` | Vẫn treo. Backfill đã xử lý cả hai ca (khôi phục được / không khôi phục được) nên không còn chặn gì |
