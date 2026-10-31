# Cách tìm kiếm bài viết hiện tại

Tìm kiếm nằm ở màn danh sách bài. Giao diện gọi `GET /api/posts`. Server ghép các điều kiện bằng `AND`, rồi trả một trang. Chưa chia lô, chưa bật WAL.

Có hai kiểu xem:

- `view=post`: từng bài, mới nhất trước.
- `view=phone`: gom theo số điện thoại.

Mở một số trong kiểu xem theo số thì gọi lại `view=post` với `phoneExact` đúng số đó.

## Dữ liệu dùng để tìm chữ

Khi lưu bài, `keyword` là nội dung `postMessage` đã bỏ dấu và viết thường. Cột này là `TEXT` trong bảng `posts`.

Chỉ mục tìm kiếm là bảng ảo FTS5 `post_keyword_fts`:

- Cột index: `keyword`
- Nội dung lấy từ `posts`, khóa là `id`
- Tokenizer: `trigram` (cụm 3 ký tự, nên từ ngắn hơn 3 ký tự không vào được chỉ mục)

Ba trigger giữ chỉ mục khớp với bảng `posts`:

- Thêm bài: thêm dòng FTS.
- Xóa bài: xóa dòng FTS.
- Sửa cột `keyword`: xóa dòng cũ rồi thêm dòng mới.

Bảng `post_keyword_indexed` nhớ những `id` đã được đưa vào FTS. Lúc mở app, server đếm bài chưa có trong bảng này và bổ sung một lần. Nếu không thiếu bài thì chỉ in `Bảng tìm kiếm đã có đủ bài viết`.

Cùng lúc mở app, server tải mọi bài (`id`, `postMessage`, `keyword`) và tính lại `keyword`. Bài nào lệch thì `UPDATE` từng dòng. Mỗi lần sửa chạy trigger FTS.

## Từ khóa trên giao diện

Bộ lọc từ khóa là một sơ đồ: `START` → các ô từ khóa / từ loại trừ → `END`.

`findKeywordPaths` đi từ `START` tới `END`. Mỗi đường thành một nhánh:

- Ô `keyword` đưa vào `include` (bài phải chứa).
- Ô `exclude` đưa vào `exclude` (bài không được chứa).
- Nhiều nhánh là `OR`: khớp một nhánh là được.

Chuỗi hiện trên màn hình chỉ để đọc, ví dụ `"biet thu" AND "ha noi" AND NOT "cho thue"`. Request không gửi chuỗi đó. Request gửi JSON `paths`:

```json
[{ "include": ["biet thu", "ha noi"], "exclude": ["cho thue"] }]
```

Server chuẩn hóa lại từng từ: bỏ dấu, viết thường, bỏ từ rỗng.

## Câu lọc từ khóa

Các nhánh nối bằng `OR`. Trong một nhánh, mọi điều kiện nối bằng `AND`.

Với từng từ trong `include`:

- Dài từ 3 ký tự: `id IN (SELECT rowid FROM post_keyword_fts WHERE post_keyword_fts MATCH '"từ"')`. Nhiều từ thì một câu `MATCH` với `AND`.
- Ngắn hơn 3 ký tự: `instr(IFNULL(keyword, ''), 'từ') > 0`, quét cột `keyword` của bảng `posts`.

Với từng từ trong `exclude`:

- Dài từ 3 ký tự: `id NOT IN (SELECT rowid FROM post_keyword_fts WHERE post_keyword_fts MATCH '"từ"')`. Mỗi từ loại trừ là một subquery riêng.
- Ngắn hơn 3 ký tự: `instr(IFNULL(keyword, ''), 'từ') = 0`.

Dấu `"` trong từ được nhân đôi trước khi đưa vào `MATCH`.

Ví dụ hai nhánh, một từ loại trừ dài và một từ cần có ngắn, ra dạng:

```sql
(
  id IN (
    SELECT rowid FROM post_keyword_fts
    WHERE post_keyword_fts MATCH '"biet thu" AND "ha noi"'
  )
  AND id NOT IN (
    SELECT rowid FROM post_keyword_fts
    WHERE post_keyword_fts MATCH '"cho thue"'
  )
)
OR
(
  instr(IFNULL(keyword, ''), 'nh') > 0
)
```

Toàn bộ biểu thức này là một `literal` trong `WHERE`, không tách thành nhiều câu và không giới hạn theo khoảng `id`.

## Các điều kiện khác

Gắn thêm bằng `AND`, cùng lúc với từ khóa nếu có.

| Tham số | Cách so khớp |
|---|---|
| `phone` | `phone LIKE '%...%'`. Ký tự `\`, `%`, `_` được escape. |
| `phoneExact` | Bằng đúng số. Giá trị rỗng hoặc `Không có SĐT` nghĩa là `phone` null hoặc chuỗi rỗng. |
| `userName` | `userName LIKE '%...%'`. |
| `groupId` | Bằng đúng `group_id`. |
| `pushedFrom`, `pushedTo` | `scanned_at` trong ngày đó, tính theo giờ máy. `from` / `to` dùng khi không có hai tên trên. |
| `campaignId` + `campaignMembership=in` | `phone` nằm trong danh sách số của chiến dịch. Danh sách được tải hết lên bộ nhớ rồi đưa vào `IN`. Không có số nào thì trả về rỗng. |
| `campaignId` + `campaignMembership=out` | `phone` không nằm trong danh sách đó, hoặc `phone` null / rỗng. |

`scanned_at` lưu mili giây. Không lọc theo `created_time`.

## Kiểu xem từng bài

`Post.findAndCountAll`:

- Đếm mọi bài khớp điều kiện.
- Lấy một trang, `ORDER BY created_time DESC, id DESC`.
- `limit` chỉ được 50, 100, 200, 500, 1000 hoặc 10000. Giá trị khác thành 100.
- `offset` là số bài bỏ qua.

Khi có `phoneExact`, hoặc `includeUserNames=1`, server chạy thêm một câu lấy `userName` phân biệt. Câu này dùng cùng bộ lọc nhưng bỏ điều kiện tên, để dropdown tên còn đủ lựa chọn.

## Kiểu xem theo số điện thoại

Ba câu chạy song song trên cùng `WHERE`:

1. Đếm số nhóm: `GROUP BY` số điện thoại, kéo mọi nhóm về Node rồi lấy độ dài mảng. Số rỗng gom vào nhãn `Không có SĐT`.
2. `COUNT(*)` số bài khớp.
3. Một trang nhóm: mỗi nhóm có số bài, `MAX(scanned_at)`, `MAX(created_time)`, một `id` mẫu, và `GROUP_CONCAT` mọi `user_name` phân biệt trong nhóm. Sắp theo lần quét mới nhất, rồi theo số điện thoại. Sau đó tải các bài mẫu theo `id`.

Trang này không trả mọi bài trong nhóm. Danh sách bài của một số nằm ở request `phoneExact`.

## Phân trang phía giao diện

Mỗi lần đổi từ khóa, số điện thoại, nhóm, ngày quét hoặc chiến dịch thì về trang 1 và gọi lại API. Đổi trang chỉ tăng `offset`. Tổng số trang lấy từ `total` server trả về.
