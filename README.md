# Game & Việc làm HSE – ứng dụng cá nhân (PWA)

Ứng dụng web cài lên màn hình chính điện thoại Android (Chrome → "Cài đặt ứng dụng"). Giao diện tiếng Việt, chạy offline, dữ liệu cá nhân chỉ lưu trên thiết bị.

## Cấu trúc
```
web/            Ứng dụng (HTML/JS thuần, không cần build)
  app.js        Giao diện + sự kiện        lib/logic.js  Lọc, sắp xếp, chấm điểm liên quan
  lib/match.js  Đối chiếu CV, soạn thư      lib/notify.js Tính thông báo
  lib/db.js     IndexedDB: yêu thích, trạng thái ứng tuyển, ghi chú, hồ sơ
  sw.js         Service worker (offline, đồng bộ nền)   data/*.json  Dữ liệu đã thu thập
tools/          Bộ thu thập dữ liệu (Node ≥ 20, không cần npm install)
  update-data.mjs, sources/{itunes,rss,careerlink}.mjs, serve.mjs, make-icons.mjs
test/           Kiểm thử tự động (npm test)
.github/workflows/update.yml   Cập nhật dữ liệu 2 lần/ngày + triển khai GitHub Pages
```

## Cách chạy
**Trên máy tính (kiểm tra nhanh):**
```bash
npm run update   # thu thập dữ liệu mới
npm run serve    # mở http://localhost:8080
npm test         # chạy kiểm thử
```

**Dùng trên điện thoại, tự cập nhật hằng ngày (khuyến nghị, miễn phí):**
1. Tạo kho GitHub (có thể để private với gói Pages phù hợp, hoặc public), đẩy toàn bộ thư mục này lên nhánh `main`.
2. Settings → Pages → Source: **GitHub Actions**.
3. Workflow sẽ thu thập dữ liệu lúc 07:00 và 19:00 (giờ VN) rồi triển khai. Địa chỉ dạng `https://<tên>.github.io/<kho>/`.
4. Mở địa chỉ đó bằng Chrome Android → menu ⋮ → **Cài đặt ứng dụng / Thêm vào màn hình chính**.

## Tính năng
- **Game**: game iOS phát hành trong 120 ngày (Apple iTunes API chính thức, kho VN: ngày phát hành thật, thể loại, ngôn ngữ, điểm Apple nếu có, game đặt trước có ngày tương lai) + tin game sắp ra/đăng ký trước/soft launch từ Pocket Gamer, TouchArcade (ngày hiển thị là *ngày đăng tin*, không phải ngày phát hành). Tìm kiếm, lọc thể loại/nền tảng, sắp xếp, ★ yêu thích, "đã chơi", nút mở trang nguồn và "Tìm trên Google Play".
- **Việc làm**: 123job.vn và CareerLink.vn (JSON-LD JobPosting công khai; CareerLink hiện chặn IP máy phát triển nên có thể chỉ chạy được khi thu thập từ nơi khác, vd GitHub Actions) lọc theo chủ đề môi trường/HSE/EHS/ATLĐ/ISO/ESG…: lương, kinh nghiệm, địa điểm, ngày đăng, hạn nộp, bằng cấp/chứng chỉ trích từ tin, link gốc, trạng thái xác minh. Lọc/sắp xếp, lưu tin, trạng thái (cần ứng tuyển → đã ứng tuyển → phỏng vấn → kết thúc), ghi chú, hạn nộp CV riêng.
- **Hỗ trợ CV** (tab Hồ sơ): nhập thông tin/dán CV (.txt/.md). Đối chiếu theo quy tắc minh bạch (không gọi AI, không tốn phí): yêu cầu đã đáp ứng / còn thiếu / lý do, gợi ý chỉnh CV, soạn thư ứng tuyển và email dạng bản nháp, sao chép prompt để dán vào AI bạn tự chọn. **Không bịa** kinh nghiệm/chứng chỉ; **không tự gửi** gì cho nhà tuyển dụng.
- **Trang chủ**: game mới, game sắp ra, việc làm mới, việc phù hợp cao (khi có hồ sơ), tin sắp hết hạn, mục đã lưu.
- **Thông báo**: danh sách trong ứng dụng (🔔) + thông báo hệ thống nếu bạn bật. Báo game mới, game yêu thích sắp ra mắt (≤3 ngày), việc làm mới phù hợp, tin đã lưu sắp hết hạn.
- **Nguồn khác**: bảng liên kết tìm kiếm TopCV/VietnamWorks/CareerViet/Indeed/LinkedIn; "Chia sẻ" một liên kết sang ứng dụng (Web Share Target) hoặc "+ Thêm thủ công". Sao lưu/nhập dữ liệu JSON.

## Giới hạn thực tế (đã kiểm chứng)
- **Game Android**: Google Play không có API công khai; không thu thập tự động. Mục Android = tin báo chí (Droid Gamers, Pocket Gamer, Android Central/Authority…) có nhắc Android nên số lượng ít. Ngày phát hành, khu vực và khả năng tải tại Việt Nam của game Android **chưa được xác minh**; dùng nút "Tìm trên Google Play" hoặc thêm thủ công. iOS đã đối chiếu với App Store VN.
- **Game sắp ra mắt**: Apple không công bố danh sách đặt trước; chỉ thấy game có `releaseDate` tương lai trong kết quả tìm kiếm. Tin báo chí phân loại bằng từ khóa nên có thể lẫn tin không phải game cụ thể.
- **Việc làm**: 123job trả HTTP 429 nếu quét dồn dập nên dữ liệu tích lũy dần qua các lần chạy hằng ngày (tin cũ chưa hết hạn được giữ lại). TopCV chặn truy cập tự động (403), VietnamWorks/CareerViet tải danh sách bằng JS/API riêng không công khai, Indeed chặn (403) → không tích hợp, chỉ để liên kết tìm kiếm. CareerLink đọc tốc độ thấp (1 yêu cầu/2 giây, ≤80 trang chi tiết/lần); nếu nguồn không phản hồi sẽ tự dừng và giữ dữ liệu cũ. Mức "liên quan" dựa trên từ khóa nên có thể sót/lẫn.
- **Cập nhật**: *tự động trên máy chủ* chỉ khi dùng GitHub Actions ở trên. Nếu chỉ chạy `npm run serve` thì dữ liệu chỉ đổi khi bạn chạy `npm run update`; ứng dụng trên điện thoại chỉ kiểm tra khi bạn mở nó (hoặc đồng bộ nền định kỳ nếu Chrome hỗ trợ cho PWA đã cài – không đảm bảo).
- **Thông báo**: không có máy chủ đẩy (Web Push) để khỏi tốn phí/khóa; thông báo xuất hiện khi mở ứng dụng hoặc qua đồng bộ nền của Chrome.
- **CV**: chỉ đọc .txt/.md hoặc dán văn bản; chưa đọc PDF/DOCX trong ứng dụng.
- **Tệp APK**: `dist/GameJobAssistant.apk` (vỏ WebView đóng gói sẵn ứng dụng, mã trong `android/`, tạo lại bằng `powershell tools/build-apk.ps1`). Ký bằng khóa debug – chỉ để cài thủ công (bật "Cài từ nguồn không rõ"). **Chưa chạy thử trên thiết bị/emulator** (máy dev tắt ảo hóa BIOS, không có điện thoại kết nối). APK mang theo dữ liệu tại thời điểm build; để tự lấy dữ liệu mới, điền địa chỉ GitHub Pages vào `web/config.js` (`window.GJA_DATA_BASE`) rồi build lại. Thông báo hệ thống không hoạt động trong WebView (chỉ có chuông trong ứng dụng); muốn thông báo hệ thống hãy dùng PWA cài từ Chrome.

## Chi phí
Mọi thứ dùng được miễn phí: GitHub Actions/Pages (hạn mức miễn phí), API iTunes và RSS công khai, đối chiếu CV cục bộ. Không có dịch vụ AI trả phí nào được gọi.

## Quy tắc thu thập
Chỉ đọc trang/API công khai được robots.txt cho phép, User-Agent định danh, tốc độ thấp, không vượt cơ chế chặn. Hãy xem lại điều khoản của từng nguồn nếu bạn mở rộng.
