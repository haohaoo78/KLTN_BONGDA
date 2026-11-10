# **3.1.2. Yêu cầu chức năng**

## **1\. Quản lý tài khoản và xác thực người dùng**

Hệ thống cung cấp cơ chế đăng ký, xác minh email, đăng nhập, khôi phục mật khẩu và quản lý tài khoản. Mỗi tài khoản được xác định bằng một định danh duy nhất và chỉ được thực hiện các chức năng tương ứng với quyền hạn đã được cấp.

### **1.1. Đăng ký tài khoản**

- Cho phép người dùng đăng ký tài khoản bằng họ tên, địa chỉ email, mật khẩu và xác nhận mật khẩu.
- Kiểm tra các trường bắt buộc, định dạng email, chính sách mật khẩu và tính duy nhất của email.
- Sau khi thông tin hợp lệ, hệ thống tạo tài khoản ở trạng thái Chờ xác minh email.
- Hệ thống gửi email xác minh đến địa chỉ email đã đăng ký. Email chứa liên kết xác minh có mã xác thực duy nhất, thời hạn sử dụng và chỉ được sử dụng một lần.
- Người dùng phải truy cập liên kết trong email để xác minh quyền sở hữu địa chỉ email.
- Khi liên kết hợp lệ, hệ thống cập nhật trạng thái tài khoản thành Đang hoạt động, ghi nhận thời điểm xác minh và thông báo xác minh thành công.
- Tài khoản chưa xác minh email không được đăng nhập để sử dụng các chức năng nội bộ.
- Cho phép người dùng yêu cầu gửi lại email xác minh khi email cũ hết hạn hoặc không nhận được thư, đồng thời giới hạn tần suất gửi để tránh lạm dụng.
- Không cho phép đăng ký nhiều tài khoản bằng cùng một địa chỉ email đã được sử dụng.
- Không tự động cấp quyền Quản trị viên, Ban tổ chức hoặc Trọng tài khi người dùng đăng ký tài khoản.

### **1.2. Đăng nhập và đăng xuất**

- Cho phép người dùng đăng nhập bằng email và mật khẩu.
- Chỉ cho phép đăng nhập khi thông tin xác thực hợp lệ, email đã được xác minh và tài khoản đang hoạt động.
- Sau khi đăng nhập, hệ thống xác định vai trò, phạm vi dữ liệu và các quyền được cấp.
- Điều hướng người dùng đến giao diện phù hợp với quyền hạn của họ.
- Cho phép người dùng đăng xuất và kết thúc phiên làm việc.
- Từ chối đăng nhập đối với tài khoản đang chờ xác minh, bị khóa hoặc đã ngừng hoạt động.
- Áp dụng giới hạn đối với các lần đăng nhập thất bại liên tiếp và ghi nhận các sự kiện bảo mật cần thiết.

### **1.3. Khôi phục và thay đổi mật khẩu**

- Cho phép người dùng yêu cầu khôi phục mật khẩu thông qua email đã đăng ký.
- Gửi liên kết đặt lại mật khẩu có mã xác thực riêng, thời hạn sử dụng và chỉ sử dụng một lần.
- Kiểm tra tính hợp lệ của liên kết trước khi cho phép đặt mật khẩu mới.
- Yêu cầu mật khẩu mới đáp ứng chính sách bảo mật của hệ thống.
- Thu hồi hoặc vô hiệu hóa liên kết đặt lại sau khi sử dụng thành công.
- Cho phép người dùng đang đăng nhập chủ động thay đổi mật khẩu sau khi xác thực thông tin cần thiết.
- Không tiết lộ thông tin nhạy cảm về sự tồn tại của tài khoản thông qua thông báo khôi phục mật khẩu.

### **1.4. Quản lý trạng thái tài khoản**

Hệ thống quản lý trạng thái tài khoản theo các giá trị nghiệp vụ sau:

| **Trạng thái** | **Ý nghĩa** | **Khả năng đăng nhập** |
| --- | --- | --- |
| Chờ xác minh email | Người dùng đã gửi biểu mẫu đăng ký nhưng chưa xác minh địa chỉ email | Không được đăng nhập |
| --- | --- | --- |
| Đang hoạt động | Email đã xác minh và tài khoản được phép sử dụng | Được đăng nhập nếu đáp ứng các điều kiện bảo mật |
| --- | --- | --- |
| Bị khóa | Tài khoản tạm thời bị vô hiệu hóa theo quyết định quản trị hoặc cơ chế bảo mật | Không được đăng nhập |
| --- | --- | --- |
| Ngừng hoạt động | Tài khoản đã bị vô hiệu hóa theo quy trình quản lý tài khoản | Không được đăng nhập |
| --- | --- | --- |

Các trạng thái trên là trạng thái nghiệp vụ của tài khoản. Việc người dùng có được quyền quản lý đội, tổ chức giải hay cập nhật kết quả trận đấu được xác định riêng bằng vai trò và phạm vi quyền.

### **1.5. Quản lý thông tin cá nhân**

- Cho phép người dùng xem và cập nhật các thông tin cá nhân được phép thay đổi.
- Không cho phép thay đổi email đăng nhập mà không thực hiện quy trình xác minh email mới.
- Yêu cầu người dùng xác nhận các thay đổi quan trọng khi cần thiết.
- Lưu thời điểm cập nhật và thông tin cần thiết để kiểm tra lịch sử thay đổi.

### **1.6. Quản lý vai trò và quyền hạn**

- Cho phép Quản trị viên tạo, cấp, điều chỉnh hoặc thu hồi vai trò theo chính sách phân quyền.
- Phân biệt vai trò toàn hệ thống với quyền thao tác trong một trường hoặc một giải cụ thể.
- Chỉ cho phép Ban tổ chức thao tác trên các giải thuộc phạm vi được giao.
- Chỉ cho phép Đại diện đội bóng quản lý đội mà họ được xác lập quyền đại diện.
- Chỉ cho phép Trọng tài cập nhật nghiệp vụ chuyên môn đối với các trận được phân công.
- Không cho phép người dùng tự thay đổi vai trò của mình thông qua giao diện thông thường.
- Kiểm tra quyền ở phía máy chủ đối với mọi thao tác cần bảo vệ.

## **2\. Quản lý trường học và đơn vị tổ chức**

- Quản lý thông tin các trường cao đẳng và đại học thuộc phạm vi khảo sát tại TP.HCM.
- Lưu tên trường, địa chỉ, thông tin liên hệ, trạng thái hoạt động và các thông tin cần thiết khác.
- Cho phép Quản trị viên thêm mới, cập nhật, tra cứu và thay đổi trạng thái trường.
- Cho phép lưu thông tin khoa, lớp hoặc đơn vị trực thuộc khi nghiệp vụ giải đấu yêu cầu.
- Liên kết trường với đội bóng và đơn vị tổ chức giải.
- Hỗ trợ tổ chức giải nội bộ một trường hoặc giải có sự tham gia của nhiều trường.
- Kiểm tra trường đại diện của đội có thuộc phạm vi tham gia giải hay không.
- Không cho phép xóa dữ liệu trường theo cách làm mất tính toàn vẹn của các giải và kết quả đã lưu.
- Không tự động xác minh tư cách pháp lý của trường thông qua hệ thống bên ngoài; việc xác nhận dữ liệu trường do người có thẩm quyền thực hiện.

## **3\. Quản lý đội bóng và cầu thủ**

- Cho phép người có quyền tạo và cập nhật hồ sơ đội bóng.
- Lưu tên đội, tên viết tắt, logo nếu có, trường đại diện, đơn vị trực thuộc, màu áo và thông tin liên hệ.
- Xác định người đại diện chịu trách nhiệm quản lý thông tin và hồ sơ đăng ký của đội.
- Quản lý thông tin cầu thủ gồm họ tên, ngày sinh, mã số sinh viên hoặc thông tin định danh theo yêu cầu của điều lệ, số áo và vị trí thi đấu.
- Phân biệt hồ sơ cầu thủ trên hệ thống với danh sách cầu thủ đăng ký cho từng giải.
- Phân biệt danh sách cầu thủ đăng ký của đội với danh sách cầu thủ đủ điều kiện thi đấu trong từng trận nếu nghiệp vụ yêu cầu.
- Cho phép Đại diện đội cập nhật danh sách cầu thủ trong thời gian được phép.
- Kiểm tra số lượng cầu thủ tối thiểu, tối đa, trùng số áo và các điều kiện theo điều lệ.
- Kiểm tra một cầu thủ có đang đăng ký cho đội khác trong cùng giải hay không.
- Cho phép cầu thủ gửi yêu cầu tham gia đội và Đại diện đội xử lý yêu cầu.
- Chỉ cho phép người có quyền xác nhận thay đổi ảnh hưởng đến danh sách cầu thủ đã được chốt.
- Hỗ trợ lưu minh chứng tư cách cầu thủ nếu điều lệ yêu cầu, đồng thời giới hạn quyền xem các tài liệu cá nhân.

## **4\. Quản lý giải đấu và điều lệ**

- Cho phép người được cấp quyền tạo giải đấu ở trạng thái Bản nháp.
- Quản lý tên giải, đơn vị tổ chức, Ban tổ chức, thời gian dự kiến, địa điểm và mô tả.
- Xác định phạm vi giải đấu là nội bộ trường hoặc liên trường.
- Với giải nội bộ, khóa phạm vi vào trường tổ chức; chỉ câu lạc bộ của trường đó được đăng ký.
- Với giải liên trường, cấu hình bậc Đại học, Cao đẳng hoặc cả hai; cho phép mọi trường thuộc bậc đã chọn hoặc allowlist các trường cụ thể.
- Lưu cấu hình trường, bậc đào tạo và hạn mức theo từng giải, không dùng cấu hình dùng chung giữa các giải.
- Cho phép đặt hạn mức đội theo từng trường hoặc không giới hạn, đồng thời vẫn áp dụng giới hạn tổng số đội của giải.
- Hỗ trợ hình thức bóng đá sân 7 và sân 11.
- Hỗ trợ thể thức vòng tròn, vòng bảng kết hợp loại trực tiếp và loại trực tiếp.
- Thiết lập thời gian mở đăng ký, hạn đăng ký, số đội tối thiểu/tối đa và giới hạn cầu thủ.
- Thiết lập điều lệ cho từng giải, bao gồm cách tính điểm, thứ tự tiêu chí xếp hạng, điều kiện đi tiếp, quy định thẻ phạt, treo giò, xử lý vắng mặt/bỏ cuộc và khiếu nại. Cấu hình nghiệp vụ được lưu bằng các trường có cấu trúc trong cơ sở dữ liệu (bảng cấu hình điều lệ/tiêu chí xếp hạng), không lưu toàn bộ quy tắc chỉ dưới dạng văn bản tự do hoặc JSON không kiểm tra; mỗi tiêu chí có thứ tự ưu tiên và tham số rõ ràng.
- Kiểm tra điều kiện bắt buộc trước khi cho phép công bố điều lệ hoặc mở đăng ký.
- Lưu phiên bản điều lệ đã công bố và lịch sử thay đổi.
- Hạn chế chỉnh sửa các thông tin ảnh hưởng đến quyền lợi đội bóng sau khi đã mở đăng ký hoặc bắt đầu thi đấu.
- Quản lý trạng thái giải theo một vòng đời thống nhất: Bản nháp → Mở đăng ký → Đóng đăng ký → Chốt danh sách → Chuẩn bị thi đấu → Đang diễn ra → Đã kết thúc. Giải có thể chuyển sang Tạm dừng từ giai đoạn Đang diễn ra; giải có thể chuyển sang Đã hủy trước khi kết thúc theo thẩm quyền và phải lưu lý do. Điều kiện chuyển trạng thái được quy định tại mục 3.5.
- Chỉ cho phép chuyển trạng thái khi các điều kiện nghiệp vụ tương ứng được đáp ứng.

## **5\. Quản lý đăng ký tham gia giải đấu**

- Cho phép người dùng tra cứu các giải đang mở đăng ký.
- Hiển thị điều lệ, thời hạn, phạm vi trường tham gia và điều kiện đăng ký.
- Giải nội bộ chỉ nhận câu lạc bộ thuộc trường tổ chức; đội trưởng gửi hồ sơ trực tiếp đến Ban tổ chức của giải.
- Giải liên trường chỉ nhận câu lạc bộ thuộc các bậc đào tạo và trường được cấu hình trong giải.
- Không chuyển hồ sơ về Ban tổ chức của trường đại diện đội; người nhận xét duyệt là BTC được phân công cho chính giải đó.
- Chỉ cho phép Đại diện đội gửi hồ sơ cho đội mình phụ trách; trường đại diện được xác định từ dữ liệu đội, không nhận từ dữ liệu do trình duyệt tự khai.
- Tiếp nhận thông tin đội, trường đại diện, danh sách cầu thủ và các minh chứng được yêu cầu.
- Kiểm tra các điều kiện có thể xác định tự động trước khi tiếp nhận hồ sơ.
- Kiểm tra hạn mức tổng giải và hạn mức theo trường trước khi tiếp nhận; giữ chỗ đăng ký nguyên tử để các yêu cầu đồng thời không vượt hạn mức.
- Tính đội đã duyệt và đội đang chờ xét duyệt vào số chỗ được giữ; đội bị từ chối hoặc rút hồ sơ không còn chiếm chỗ.
- Khi duyệt, từ chối hoặc rút hồ sơ, đồng bộ trạng thái giữ chỗ với trạng thái hồ sơ.
- Quản lý trạng thái hồ sơ gồm Nháp, Đã gửi, Cần bổ sung, Đã duyệt và Bị từ chối.
- Cho phép Ban tổ chức xem xét hồ sơ, yêu cầu bổ sung, phê duyệt hoặc từ chối kèm lý do.
- Cung cấp bộ lọc theo trường, trạng thái và tên đội; hiển thị số đội đã duyệt, đang chờ và hạn mức tối đa theo từng trường.
- Cho phép Đại diện đội theo dõi kết quả xét duyệt và gửi lại hồ sơ khi được yêu cầu bổ sung.
- Chỉ đưa hồ sơ đã được duyệt vào danh sách chờ chốt chính thức.
- Chỉ cho phép chốt danh sách sau khi đã xử lý các hồ sơ liên quan theo quy trình.
- Không cho phép một đội đăng ký trùng nhiều lần cho cùng một giải.
- Không cho phép hồ sơ đăng ký mới được gửi sau khi giải đóng đăng ký, trừ khi Ban tổ chức mở lại đăng ký theo quyền hạn và quy định.

## **6\. Quản lý bảng đấu và lịch thi đấu**

- Cho phép Ban tổ chức lập phương án thi đấu dựa trên danh sách đội chính thức và thể thức đã cấu hình.
- Hỗ trợ phân bảng hoặc thiết lập nhánh đấu.
- Quản lý các thông tin trận đấu gồm đội tham gia, thời gian, địa điểm, sân, giai đoạn và lượt đấu.
- Kiểm tra xung đột lịch giữa các trận trên cùng sân, đội và trọng tài; hai khoảng thời gian được xem là xung đột khi giao nhau, kể cả khi chỉ trùng một phần. MVP không cho phép thời gian chồng lấn và yêu cầu khoảng nghỉ tối thiểu mặc định 30 phút giữa hai trận của cùng đội; Ban tổ chức có thể cấu hình khoảng nghỉ cao hơn nhưng không được thấp hơn 30 phút.
- Kiểm tra một đội không được bố trí hai trận trùng thời gian.
- Hỗ trợ cập nhật lịch trước và sau khi công bố theo quyền hạn.
- Ghi nhận lý do thay đổi lịch và thông báo đến các đội, trọng tài liên quan.
- Chỉ cho phép công bố lịch chính thức khi các kiểm tra bắt buộc đã đạt yêu cầu.
- Hỗ trợ xác định đội đi tiếp từ kết quả chính thức và điều lệ của giải.

## **7\. Quản lý trọng tài**

- Quản lý hồ sơ trọng tài và trạng thái hoạt động.
- Cho phép Ban tổ chức phân công trọng tài cho từng trận.
- Kiểm tra xung đột thời gian trong lịch phân công.
- Cho phép trọng tài xem lịch và thông tin trận được giao.
- Cho phép thay đổi phân công theo quyền hạn và ghi nhận lịch sử thay đổi.
- Chỉ cho phép trọng tài được phân công cập nhật thông tin chuyên môn của trận đấu.
- Không cho phép trọng tài tự thay đổi điều lệ hoặc lịch chính thức nếu không được cấp quyền.

## **8\. Quản lý trận đấu và kết quả**

- Cho phép trọng tài xem thông tin trận đấu được phân công.
- Ghi nhận tỷ số, bàn thắng, thẻ phạt và diễn biến thuộc phạm vi hệ thống hỗ trợ.
- Cho phép trọng tài lưu nháp thông tin trận và gửi kết quả sau khi hoàn tất.
- Quản lý trạng thái trận đấu như Chưa diễn ra, Đang diễn ra, Chờ xác nhận kết quả, Đã xác nhận, Hoãn, Hủy hoặc Kết thúc theo quy tắc nghiệp vụ.
- Cho phép Ban tổ chức kiểm tra và xác nhận kết quả.
- Cho phép yêu cầu làm rõ hoặc chỉnh sửa kết quả trước khi xác nhận.
- Chỉ sử dụng kết quả chính thức để cập nhật bảng xếp hạng.
- Lưu lịch sử cập nhật kết quả và người thực hiện.
- Hỗ trợ ghi nhận các trường hợp hoãn trận, đội vắng mặt hoặc xử lý kết quả theo quyết định của Ban tổ chức căn cứ vào điều lệ.
- Không tự áp dụng tỷ số xử thua chung cho tất cả giải.

## **9\. Quản lý bảng xếp hạng và đội đi tiếp**

- Tính số trận, thắng, hòa, thua, bàn thắng, bàn thua, hiệu số và điểm.
- Áp dụng cách tính điểm theo điều lệ của từng giải; ví dụ thắng 3 điểm, hòa 1 điểm, thua 0 điểm nếu giải áp dụng quy tắc phổ biến này.
- Cho phép thiết lập thứ tự tiêu chí phân hạng khi các đội bằng điểm.
- Tự động tính lại bảng xếp hạng sau khi kết quả chính thức được xác nhận hoặc điều chỉnh hợp lệ.
- Xác định đội đi tiếp dựa trên thể thức và điều lệ.
- Không tính kết quả chưa xác nhận vào bảng xếp hạng chính thức.
- Cung cấp bảng xếp hạng để người dùng có quyền tra cứu.

## **10\. Quản lý thẻ phạt, kỷ luật và khiếu nại**

- Ghi nhận thẻ vàng, thẻ đỏ và tình huống vi phạm do trọng tài xác nhận.
- Theo dõi số thẻ và tình trạng treo giò theo quy định của từng giải.
- Cảnh báo trường hợp cầu thủ đạt ngưỡng treo giò hoặc đang trong thời gian đình chỉ.
- Cho phép Đại diện đội gửi khiếu nại trong thời hạn do điều lệ quy định.
- Tiếp nhận nội dung, trận đấu liên quan, lý do, tài liệu minh chứng và thời điểm gửi.
- Cho phép Ban tổ chức xem xét, ghi nhận kết luận và thông báo kết quả.
- Lưu lịch sử xử lý và các quyết định liên quan.
- Không tự động thay đổi kết quả trận đấu chỉ vì đã nhận được khiếu nại.
- Chỉ cập nhật kết quả hoặc kỷ luật khi có quyết định hợp lệ của người có thẩm quyền.

## **11\. Tra cứu thông tin và thông báo**

- Cho phép tra cứu giải đấu, điều lệ công khai, đội tham gia, lịch thi đấu, kết quả và bảng xếp hạng.
- Hỗ trợ tìm kiếm theo tên giải, trạng thái và thời gian.
- Cho phép Trọng tài xem lịch được phân công và thông tin trận cần thiết.
- Cho phép Đại diện đội theo dõi trạng thái hồ sơ, lịch đấu và thông báo liên quan.
- Gửi thông báo về xác minh email, khôi phục mật khẩu, xét duyệt đăng ký, yêu cầu bổ sung, lịch thi đấu, thay đổi lịch, kết quả và quyết định khiếu nại.
- Gửi thông báo đến đúng người nhận theo tài khoản, đội bóng, vai trò và giải đấu liên quan.
- Chỉ công khai dữ liệu phù hợp; không hiển thị tài liệu cá nhân hoặc thông tin nội bộ cho người không có quyền truy cập.

# **3.1.3. Yêu cầu phi chức năng**

## **1\. Bảo mật**

- Mật khẩu phải được băm bằng thuật toán phù hợp; không lưu mật khẩu dạng văn bản thuần.
- Liên kết xác minh email và đặt lại mật khẩu phải sử dụng mã ngẫu nhiên an toàn, có thời hạn và chỉ sử dụng một lần.
- Hệ thống phải xác minh quyền ở phía máy chủ đối với từng thao tác.
- Tài khoản chưa xác minh, bị khóa hoặc ngừng hoạt động không được đăng nhập.
- Giới hạn tần suất gửi email xác minh, đặt lại mật khẩu và đăng nhập thất bại để giảm nguy cơ lạm dụng.
- Không lưu mã xác minh hoặc mã đặt lại mật khẩu dưới dạng có thể sử dụng lại sau khi đã hết hạn hoặc được sử dụng.
- Các thao tác quan trọng phải có thông tin người thực hiện và thời điểm thực hiện.

## **2\. Tính toàn vẹn dữ liệu**

- Các quan hệ giữa trường, đội, cầu thủ, giải, trận đấu và kết quả phải được bảo đảm nhất quán.
- Không cho phép email đăng ký bị trùng.
- Không cho phép một đội có nhiều hồ sơ đăng ký chính thức trùng nhau trong cùng một giải.
- Không cho phép đội chưa được duyệt tham gia lịch thi đấu chính thức.
- Không cập nhật bảng xếp hạng từ kết quả chưa xác nhận.
- Các thay đổi trạng thái phải tuân theo điều kiện chuyển trạng thái.
- Những thao tác cập nhật nhiều dữ liệu liên quan phải được xử lý sao cho không tạo trạng thái dữ liệu mâu thuẫn.

## **3\. Khả năng sử dụng**

- Giao diện sử dụng tiếng Việt và thuật ngữ nghiệp vụ nhất quán.
- Biểu mẫu phải thể hiện trường bắt buộc, định dạng dữ liệu và thông báo lỗi rõ ràng.
- Trạng thái tài khoản, hồ sơ đăng ký, giải đấu và trận đấu phải được trình bày dễ hiểu.
- Các bước xác minh email, gửi lại email và khôi phục mật khẩu phải có hướng dẫn rõ ràng.
- Các chức năng tra cứu công khai không yêu cầu đăng nhập nếu không cần truy cập dữ liệu hạn chế.

## **4\. Hiệu năng**

- Trong điều kiện kiểm thử mục tiêu gồm tối đa 100 người dùng đồng thời, dữ liệu thử nghiệm 100 giải, 2.000 đội và 20.000 cầu thủ/trận ghi nhận, 95% yêu cầu đăng nhập hợp lệ và tra cứu giải/lịch/bảng xếp hạng phải phản hồi trong không quá 2 giây; yêu cầu ghi kết quả hoặc lưu hồ sơ trong không quá 3 giây, không tính thời gian gửi email hoặc mạng ngoài. Đây là mục tiêu kiểm thử cho đồ án, cần đo bằng kiểm thử tải và báo cáo kết quả thực tế.
- Danh sách có nhiều dữ liệu phải hỗ trợ phân trang, tìm kiếm hoặc lọc.
- Các thao tác tính bảng xếp hạng phải trả về kết quả chính xác khi có kết quả mới được xác nhận.
- Các ngưỡng trên là tiêu chí mục tiêu cho phạm vi MVP, không phải cam kết vận hành thực tế trước khi kiểm thử tải; báo cáo kiểm thử phải ghi rõ cấu hình máy, dữ liệu và số người dùng đồng thời.

## **5\. Khả năng bảo trì và mở rộng**

- Mã nguồn được tổ chức theo các nhóm nghiệp vụ rõ ràng.
- Điều lệ, cách tính điểm, tiêu chí xếp hạng và giới hạn đội/cầu thủ phải có khả năng cấu hình theo giải.
- Các API phải có quy ước thống nhất và tài liệu mô tả.
- Các chức năng quan trọng cần có kiểm thử tự động để hạn chế lỗi khi mở rộng.
- Có thể bổ sung trường học và giải đấu mới mà không phải thay đổi cấu trúc toàn bộ hệ thống.

## **6\. Tương thích**

- Hệ thống hoạt động trên các trình duyệt máy tính hiện đại.
- Giao diện web thích ứng với máy tính bảng và điện thoại; phạm vi dự án không bao gồm ứng dụng di động native. Các biểu mẫu, nút thao tác và thông báo lỗi phải có nhãn rõ ràng, thứ tự bàn phím hợp lý, độ tương phản đủ đọc và không chỉ dùng màu sắc để biểu thị trạng thái.
- Các liên kết xác minh email và khôi phục mật khẩu phải mở được từ trình duyệt trên thiết bị người dùng.
- API phải có định dạng phản hồi và xử lý lỗi thống nhất.

## **7\. Độ tin cậy và khả năng kiểm thử**

- Hệ thống phải kiểm tra dữ liệu đầu vào ở phía máy chủ.
- Khi gửi email thất bại, hệ thống phải ghi nhận lỗi để có thể xử lý lại theo cơ chế được thiết kế.
- Các thao tác quan trọng phải có thể truy vết qua nhật ký nghiệp vụ.
- Các luồng đăng ký tài khoản, xác minh email, đăng nhập, xét duyệt đội, lập lịch và xác nhận kết quả phải được kiểm thử cả trường hợp thành công lẫn thất bại.
- Không thông báo thao tác thành công khi dữ liệu chưa được lưu hoặc trạng thái chưa được cập nhật hợp lệ.

# **3.2. Xác định tác nhân (Actors)**

| **Tác nhân** | **Vai trò trong hệ thống** |
| --- | --- |
| Người dùng chưa có tài khoản | Đăng ký tài khoản và xác minh email để kích hoạt tài khoản. |
| --- | --- |
| Người dùng đã đăng nhập | Cập nhật thông tin cá nhân, khôi phục hoặc thay đổi mật khẩu và sử dụng chức năng theo quyền được cấp. |
| --- | --- |
| Quản trị viên hệ thống | Quản lý tài khoản, vai trò, quyền truy cập và thông tin trường trong phạm vi quản trị. |
| --- | --- |
| Đại diện trường/đơn vị tổ chức | Quản lý thông tin trường hoặc tạo giải đấu trong phạm vi được cấp quyền. |
| --- | --- |
| Ban tổ chức giải | Quản lý điều lệ, xét duyệt đăng ký, chốt danh sách, lập lịch, phân công trọng tài, xác nhận kết quả và xử lý khiếu nại. |
| --- | --- |
| Đại diện đội bóng | Quản lý đội được phụ trách, gửi hồ sơ đăng ký, quản lý danh sách cầu thủ và theo dõi thông báo. |
| --- | --- |
| Cầu thủ | Quản lý thông tin được phép cập nhật, gửi yêu cầu tham gia đội và tra cứu thông tin liên quan. |
| --- | --- |
| Trọng tài | Xem trận được phân công, ghi nhận diễn biến và gửi kết quả trận đấu. |
| --- | --- |
| Khán giả | Tra cứu thông tin được công khai về giải đấu, lịch thi đấu, kết quả và bảng xếp hạng. |
| --- | --- |
| Dịch vụ email | Gửi email xác minh tài khoản, khôi phục mật khẩu và các thông báo qua email. |
| --- | --- |

Lưu ý về thiết kế: Dịch vụ email là tác nhân phụ bên ngoài hệ thống. “Người dùng chưa có tài khoản” và “Người dùng đã đăng nhập” là các vai trò tác nhân theo ngữ cảnh Use Case; chúng không nhất thiết phải là các vai trò phân quyền được lưu riêng trong cơ sở dữ liệu.

# **3.3. Use Case tổng quát**

| **STT** | **Use Case** | **Tác nhân chính** |
| --- | --- | --- |
| 1   | Đăng ký tài khoản | Người dùng chưa có tài khoản |
| --- | --- | --- |
| 2   | Xác minh email | Người dùng chưa xác minh email, Dịch vụ email |
| --- | --- | --- |
| 3   | Gửi lại email xác minh | Người dùng chưa xác minh email, Dịch vụ email |
| --- | --- | --- |
| 4   | Đăng nhập | Người dùng đã có tài khoản |
| --- | --- | --- |
| 5   | Đăng xuất | Người dùng đã đăng nhập |
| --- | --- | --- |
| 6   | Khôi phục mật khẩu | Người dùng |
| --- | --- | --- |
| 7   | Thay đổi mật khẩu | Người dùng đã đăng nhập |
| --- | --- | --- |
| 8   | Cập nhật thông tin cá nhân | Người dùng đã đăng nhập |
| --- | --- | --- |
| 9   | Quản lý tài khoản và phân quyền | Quản trị viên hệ thống |
| --- | --- | --- |
| 10  | Quản lý thông tin trường | Quản trị viên, Đại diện trường được cấp quyền |
| --- | --- | --- |
| 11  | Tạo và cập nhật đội bóng | Đại diện đội bóng được cấp quyền |
| --- | --- | --- |
| 12  | Quản lý danh sách cầu thủ | Đại diện đội bóng |
| --- | --- | --- |
| 13  | Gửi yêu cầu tham gia đội bóng | Cầu thủ |
| --- | --- | --- |
| 14  | Xử lý yêu cầu tham gia đội bóng | Đại diện đội bóng |
| --- | --- | --- |
| 15  | Tạo giải đấu | Đại diện trường/đơn vị tổ chức được cấp quyền |
| --- | --- | --- |
| 16  | Thiết lập và công bố điều lệ | Ban tổ chức giải |
| --- | --- | --- |
| 17  | Mở đăng ký giải đấu | Ban tổ chức giải |
| --- | --- | --- |
| 18  | Tra cứu giải đấu mở đăng ký | Đại diện đội bóng |
| --- | --- | --- |
| 19  | Gửi hồ sơ đăng ký tham gia giải | Đại diện đội bóng |
| --- | --- | --- |
| 20  | Xét duyệt hồ sơ đăng ký | Ban tổ chức giải |
| --- | --- | --- |
| 21  | Chốt danh sách đội tham gia | Ban tổ chức giải |
| --- | --- | --- |
| 22  | Phân bảng và lập phương án thi đấu | Ban tổ chức giải |
| --- | --- | --- |
| 23  | Lập và công bố lịch thi đấu | Ban tổ chức giải |
| --- | --- | --- |
| 24  | Phân công trọng tài | Ban tổ chức giải |
| --- | --- | --- |
| 25  | Xem lịch được phân công | Trọng tài |
| --- | --- | --- |
| 26  | Ghi nhận và gửi kết quả trận đấu | Trọng tài |
| --- | --- | --- |
| 27  | Xác nhận kết quả trận đấu | Ban tổ chức giải |
| --- | --- | --- |
| 28  | Cập nhật bảng xếp hạng | Hệ thống |
| --- | --- | --- |
| 29  | Theo dõi thẻ phạt và treo giò | Ban tổ chức giải |
| --- | --- | --- |
| 30  | Gửi khiếu nại trận đấu | Đại diện đội bóng |
| --- | --- | --- |
| 31  | Xử lý khiếu nại | Ban tổ chức giải |
| --- | --- | --- |
| 32  | Tra cứu lịch thi đấu và kết quả | Khán giả, Cầu thủ, Đại diện đội bóng |
| --- | --- | --- |
| 33  | Xem bảng xếp hạng và đội đi tiếp | Khán giả, Cầu thủ, Đại diện đội bóng |
| --- | --- | --- |
| 34  | Nhận thông báo | Người dùng liên quan |
| --- | --- | --- |

# **3.4. ĐẶC TẢ CHI TIẾT CÁC USE CASE**

## **3.4.1. Đăng ký tài khoản**

| **Nội dung** | **Mô tả** |
| --- | --- |
| Tiền điều kiện | Người dùng chưa có tài khoản và truy cập được trang đăng ký của hệ thống. |
| --- | --- |
| Hậu điều kiện | Tài khoản được tạo với trạng thái Chờ xác minh email. Hệ thống gửi email xác minh đến địa chỉ email đã đăng ký. Người dùng chưa thể đăng nhập cho đến khi xác minh email thành công. |
| --- | --- |
| Actor chính | Người dùng chưa có tài khoản. |
| --- | --- |
| Actor phụ | Dịch vụ email. |
| --- | --- |

**Basic flow**

| **Người dùng** | **Hệ thống** |
| --- | --- |
| 1\. Chọn chức năng “Đăng ký”. | 2\. Hiển thị biểu mẫu đăng ký gồm bốn trường: **Họ và tên, Email, Mật khẩu, Xác nhận mật khẩu**. |
| --- | --- |
| 3\. Nhập họ và tên, địa chỉ email, mật khẩu và xác nhận mật khẩu. | 4\. Kiểm tra họ và tên không được để trống; email phải đúng định dạng; mật khẩu phải đáp ứng chính sách bảo mật; mật khẩu xác nhận phải trùng khớp với mật khẩu đã nhập. |
| --- | --- |
| 5\. Chọn “Đăng ký”. | 6\. Kiểm tra email đã được sử dụng cho tài khoản khác hay chưa. |
| --- | --- |
|     | 7\. Nếu dữ liệu hợp lệ và email chưa được sử dụng, hệ thống băm mật khẩu bằng thuật toán bảo mật phù hợp, tạo tài khoản và đặt trạng thái Chờ xác minh email. |
| --- | --- |
|     | 8\. Tạo mã xác minh hoặc liên kết xác minh riêng cho tài khoản, có thời hạn sử dụng và chỉ được sử dụng một lần. |
| --- | --- |
|     | 9\. Gửi email chứa liên kết xác minh đến địa chỉ email người dùng đã đăng ký. |
| --- | --- |
|     | 10\. Thông báo yêu cầu đăng ký đã được tiếp nhận và hướng dẫn người dùng kiểm tra hộp thư để xác minh tài khoản. |
| --- | --- |

**Alternative flow**

| **Trường hợp** | **Xử lý** |
| --- | --- |
| 4a. Họ và tên bị bỏ trống | Hệ thống thông báo “Vui lòng nhập họ và tên” và yêu cầu người dùng bổ sung. |
| --- | --- |
| 4b. Email bị bỏ trống hoặc sai định dạng | Hệ thống thông báo “Vui lòng nhập email hợp lệ” và yêu cầu người dùng chỉnh sửa. |
| --- | --- |
| 4c. Mật khẩu không đáp ứng chính sách bảo mật | Hệ thống hiển thị yêu cầu cụ thể về mật khẩu và yêu cầu người dùng nhập lại. |
| --- | --- |
| 4d. Mật khẩu xác nhận không trùng khớp | Hệ thống thông báo “Mật khẩu xác nhận không khớp” và yêu cầu nhập lại. |
| --- | --- |
| 6a. Email đã thuộc tài khoản đang hoạt động | Hệ thống thông báo email đã được đăng ký và hướng dẫn người dùng đăng nhập hoặc sử dụng chức năng quên mật khẩu. |
| --- | --- |
| 6b. Email thuộc tài khoản đang chờ xác minh | Hệ thống không tạo tài khoản trùng email, thông báo tài khoản chưa được xác minh và cung cấp chức năng gửi lại email xác minh. |
| --- | --- |
| 9a. Dịch vụ email không tiếp nhận yêu cầu gửi | Hệ thống ghi nhận lỗi gửi email, giữ tài khoản ở trạng thái Chờ xác minh email và thông báo người dùng thử gửi lại. |
| --- | --- |

**Exception**

| **Trường hợp** | **Xử lý** |
| --- | --- |
| Lỗi lưu tài khoản | Hệ thống thông báo đăng ký chưa hoàn tất và không hiển thị thông báo tạo tài khoản thành công. |
| --- | --- |
| Lỗi hệ thống trong quá trình gửi email | Hệ thống ghi nhận lỗi để xử lý; tài khoản không được tự động chuyển sang trạng thái Đang hoạt động. |
| --- | --- |
| Gửi yêu cầu đăng ký liên tục bất thường | Hệ thống giới hạn tần suất yêu cầu để ngăn hành vi đăng ký tự động hoặc lạm dụng dịch vụ. |
| --- | --- |

## **3.4.2. Xác minh email**

| **Nội dung** | **Mô tả** |
| --- | --- |
| Tiền điều kiện | Tài khoản đã được tạo ở trạng thái Chờ xác minh email. Người dùng có liên kết xác minh được gửi đến địa chỉ email đã đăng ký. |
| --- | --- |
| Hậu điều kiện | Nếu liên kết hợp lệ, tài khoản chuyển sang trạng thái Đang hoạt động; mã xác minh được đánh dấu đã sử dụng. Nếu xác minh thất bại, trạng thái tài khoản không thay đổi. |
| --- | --- |
| Actor chính | Người dùng chưa xác minh email. |
| --- | --- |
| Actor phụ | Không. |
| --- | --- |

**Basic flow**

| **Người dùng** | **Hệ thống** |
| --- | --- |
| 1\. Mở email xác minh được gửi sau khi đăng ký. | 2\. Email hiển thị liên kết xác minh tài khoản. |
| --- | --- |
| 3\. Chọn liên kết xác minh. | 4\. Tiếp nhận yêu cầu và kiểm tra mã xác minh. |
| --- | --- |
|     | 5\. Kiểm tra mã còn hạn, chưa được sử dụng, thuộc đúng tài khoản và tài khoản vẫn ở trạng thái Chờ xác minh email. |
| --- | --- |
|     | 6\. Cập nhật trạng thái tài khoản thành Đang hoạt động, ghi nhận thời điểm xác minh và đánh dấu mã xác minh đã sử dụng. |
| --- | --- |
|     | 7\. Hiển thị thông báo xác minh email thành công và hướng dẫn người dùng đăng nhập. |
| --- | --- |

**Alternative flow**

| **Trường hợp** | **Xử lý** |
| --- | --- |
| 4a. Mã xác minh không hợp lệ | Hệ thống thông báo liên kết không hợp lệ và cung cấp chức năng gửi lại email xác minh. |
| --- | --- |
| 5a. Liên kết đã hết hạn | Hệ thống thông báo liên kết đã hết hạn, không kích hoạt tài khoản và hướng dẫn người dùng yêu cầu liên kết mới. |
| --- | --- |
| 5b. Liên kết đã được sử dụng | Nếu tài khoản đã xác minh, hệ thống thông báo email đã được xác minh. Nếu chưa, hệ thống yêu cầu người dùng lấy liên kết mới. |
| --- | --- |
| 5c. Tài khoản không còn ở trạng thái chờ xác minh | Hệ thống không thực hiện chuyển trạng thái ngoài quy trình và thông báo trạng thái hiện tại phù hợp. |
| --- | --- |

**Exception**

| **Trường hợp** | **Xử lý** |
| --- | --- |
| Lỗi cập nhật trạng thái tài khoản | Hệ thống không thông báo xác minh thành công nếu cập nhật chưa hoàn tất. |
| --- | --- |
| Yêu cầu xác minh bất thường | Hệ thống giới hạn tần suất yêu cầu và ghi nhận nhật ký bảo mật. |
| --- | --- |

## **3.4.3. Gửi lại email xác minh**

| **Nội dung** | **Mô tả** |
| --- | --- |
| Tiền điều kiện | Người dùng có tài khoản ở trạng thái Chờ xác minh email. |
| --- | --- |
| Hậu điều kiện | Hệ thống tạo yêu cầu xác minh mới và gửi email nếu dịch vụ email tiếp nhận yêu cầu. Tài khoản vẫn ở trạng thái Chờ xác minh email cho đến khi xác minh thành công. |
| --- | --- |
| Actor chính | Người dùng chưa xác minh email. |
| --- | --- |
| Actor phụ | Dịch vụ email. |
| --- | --- |

**Basic flow**

| **Người dùng** | **Hệ thống** |
| --- | --- |
| 1\. Chọn “Gửi lại email xác minh”. | 2\. Hiển thị biểu mẫu nhập email đăng ký. |
| --- | --- |
| 3\. Nhập email và gửi yêu cầu. | 4\. Kiểm tra định dạng email và giới hạn tần suất gửi yêu cầu. |
| --- | --- |
|     | 5\. Xác định tài khoản và kiểm tra trạng thái xác minh. |
| --- | --- |
|     | 6\. Nếu tài khoản đang chờ xác minh, tạo liên kết mới có thời hạn sử dụng và vô hiệu hóa liên kết cũ theo chính sách bảo mật. |
| --- | --- |
|     | 7\. Gửi email xác minh mới. |
| --- | --- |
|     | 8\. Thông báo yêu cầu đã được tiếp nhận và hướng dẫn người dùng kiểm tra hộp thư. |
| --- | --- |

**Alternative flow**

| **Trường hợp** | **Xử lý** |
| --- | --- |
| 4a. Email sai định dạng | Hệ thống yêu cầu nhập email đúng định dạng. |
| --- | --- |
| 5a. Tài khoản đã xác minh | Hệ thống thông báo tài khoản đã được xác minh và hướng dẫn đăng nhập. |
| --- | --- |
| 5b. Không tìm thấy tài khoản chờ xác minh | Hệ thống hiển thị thông báo chung, không tiết lộ thông tin nhạy cảm về sự tồn tại của tài khoản. |
| --- | --- |
| 7a. Dịch vụ email không tiếp nhận yêu cầu gửi | Hệ thống ghi nhận lỗi, giữ tài khoản ở trạng thái chờ xác minh và thông báo người dùng thử lại sau. |
| --- | --- |

**Exception**

| **Trường hợp** | **Xử lý** |
| --- | --- |
| Vượt giới hạn gửi email | Hệ thống từ chối gửi thêm trong khoảng thời gian giới hạn và thông báo thời điểm có thể thử lại nếu phù hợp. |
| --- | --- |
| Lỗi dịch vụ email kéo dài | Hệ thống ghi nhận lỗi để quản trị viên kiểm tra; không tự động xác minh tài khoản. |
| --- | --- |

## **3.4.4. Đăng nhập**

| **Nội dung** | **Mô tả** |
| --- | --- |
| Tiền điều kiện | Người dùng đã có tài khoản, email đã được xác minh và tài khoản đang ở trạng thái Đang hoạt động. |
| --- | --- |
| Hậu điều kiện | Nếu xác thực thành công, hệ thống tạo phiên làm việc hoặc cấp JWT token theo cơ chế được triển khai, ghi nhận thời điểm đăng nhập và điều hướng người dùng đến giao diện phù hợp với quyền được cấp. Nếu xác thực thất bại, hệ thống không tạo phiên đăng nhập. |
| --- | --- |
| Actor chính | Người dùng đã có tài khoản. |
| --- | --- |
| Actor phụ | Không. |
| --- | --- |

**Basic flow**

| **Người dùng** | **Hệ thống** |
| --- | --- |
| 1\. Chọn chức năng “Đăng nhập” trên giao diện trang chủ. | 2\. Hiển thị biểu mẫu đăng nhập gồm hai trường: **Email, Mật khẩu**. |
| --- | --- |
| 3\. Nhập email, mật khẩu và chọn “Đăng nhập”. | 4\. Kiểm tra các trường bắt buộc, định dạng email và giới hạn tần suất đăng nhập. |
| --- | --- |
|     | 5\. Tìm tài khoản tương ứng và kiểm tra trạng thái tài khoản. |
| --- | --- |
|     | 6\. Đối chiếu mật khẩu nhập vào với thông tin băm mật khẩu được lưu trữ. |
| --- | --- |
|     | 7\. Nếu xác thực hợp lệ, kiểm tra quyền và phạm vi truy cập của tài khoản. |
| --- | --- |
|     | 8\. Tạo phiên làm việc hoặc cấp JWT token theo cấu hình bảo mật; ghi nhận thời điểm đăng nhập. |
| --- | --- |
|     | 9\. Hiển thị thông báo đăng nhập thành công và điều hướng đến giao diện phù hợp với quyền của người dùng. |
| --- | --- |

**Alternative flow**

| **Trường hợp** | **Xử lý** |
| --- | --- |
| 4a. Email hoặc mật khẩu bị bỏ trống | Hệ thống thông báo trường bắt buộc chưa được nhập và yêu cầu bổ sung. |
| --- | --- |
| 4b. Email sai định dạng | Hệ thống thông báo email không đúng định dạng và yêu cầu nhập lại. |
| --- | --- |
| 5a. Tài khoản đang chờ xác minh email | Hệ thống từ chối đăng nhập, thông báo tài khoản chưa được xác minh và cung cấp chức năng gửi lại email xác minh. |
| --- | --- |
| 5b. Tài khoản bị khóa | Hệ thống từ chối đăng nhập và thông báo tài khoản đang bị khóa. |
| --- | --- |
| 5c. Tài khoản đã ngừng hoạt động | Hệ thống từ chối đăng nhập và hướng dẫn người dùng liên hệ bộ phận có thẩm quyền nếu cần khôi phục. |
| --- | --- |
| 6a. Email hoặc mật khẩu không chính xác | Hệ thống thông báo thông tin đăng nhập không hợp lệ, không tiết lộ email có tồn tại hay không và yêu cầu thử lại. |
| --- | --- |

**Exception**

| **Trường hợp** | **Xử lý** |
| --- | --- |
| Đăng nhập sai vượt ngưỡng | Hệ thống áp dụng giới hạn thử đăng nhập. Theo cấu hình bảo mật, hệ thống có thể tạm khóa đăng nhập trong 15 phút, ghi nhận sự kiện và gửi email cảnh báo. |
| --- | --- |
| Lỗi dịch vụ xác thực | Hệ thống thông báo chưa thể đăng nhập và không tạo phiên làm việc khi chưa xác thực thành công. |
| --- | --- |
| Lỗi cấp token hoặc tạo phiên | Hệ thống không thông báo đăng nhập thành công nếu phiên làm việc chưa được tạo hợp lệ. |
| --- | --- |

## **3.4.5. Đăng xuất**

| **Nội dung** | **Mô tả** |
| --- | --- |
| Tiền điều kiện | Người dùng đã đăng nhập vào hệ thống. |
| --- | --- |
| Hậu điều kiện | Phiên làm việc hiện tại được kết thúc hoặc token được vô hiệu hóa theo cơ chế xác thực đã triển khai. |
| --- | --- |
| Actor chính | Người dùng đã đăng nhập. |
| --- | --- |
| Actor phụ | Không. |
| --- | --- |

**Basic flow**

| **Người dùng** | **Hệ thống** |
| --- | --- |
| 1\. Chọn chức năng “Đăng xuất”. | 2\. Tiếp nhận yêu cầu và xác định phiên làm việc hiện tại. |
| --- | --- |
|     | 3\. Kết thúc phiên hoặc thực hiện cơ chế thu hồi token theo thiết kế bảo mật. |
| --- | --- |
|     | 4\. Xóa thông tin xác thực phía trình duyệt theo cơ chế lưu trữ được sử dụng. |
| --- | --- |
|     | 5\. Điều hướng về trang chủ hoặc trang đăng nhập và thông báo đăng xuất thành công. |
| --- | --- |

**Alternative flow**

| **Trường hợp** | **Xử lý** |
| --- | --- |
| Phiên đã hết hạn | Hệ thống xóa thông tin phiên phía giao diện và điều hướng người dùng đến trang đăng nhập. |
| --- | --- |

**Exception**

| **Trường hợp** | **Xử lý** |
| --- | --- |
| Lỗi kết thúc phiên phía máy chủ | Hệ thống ghi nhận lỗi thu hồi phiên, loại bỏ thông tin xác thực cục bộ và thông báo trạng thái xử lý phù hợp. |
| --- | --- |

## **3.4.6. Quên mật khẩu và đặt lại mật khẩu**

| **Nội dung** | **Mô tả** |
| --- | --- |
| Tiền điều kiện | Người dùng truy cập được chức năng quên mật khẩu. |
| --- | --- |
| Hậu điều kiện | Nếu liên kết đặt lại hợp lệ và mật khẩu mới đáp ứng chính sách, hệ thống cập nhật mật khẩu an toàn và đánh dấu mã đặt lại đã sử dụng. |
| --- | --- |
| Actor chính | Người dùng chưa đăng nhập. |
| --- | --- |
| Actor phụ | Dịch vụ email. |
| --- | --- |

**Basic flow**

| **Người dùng** | **Hệ thống** |
| --- | --- |
| 1\. Chọn “Quên mật khẩu” tại trang đăng nhập. | 2\. Hiển thị biểu mẫu gồm trường Email. |
| --- | --- |
| 3\. Nhập email và gửi yêu cầu đặt lại mật khẩu. | 4\. Kiểm tra định dạng email và giới hạn tần suất yêu cầu. |
| --- | --- |
|     | 5\. Xử lý yêu cầu theo cách không tiết lộ email có tồn tại trong hệ thống hay không. Với tài khoản phù hợp, tạo liên kết đặt lại mật khẩu có thời hạn và chỉ sử dụng một lần. |
| --- | --- |
|     | 6\. Gửi email hướng dẫn đặt lại mật khẩu. |
| --- | --- |
|     | 7\. Thông báo yêu cầu đã được tiếp nhận và hướng dẫn kiểm tra email. |
| --- | --- |
| 8\. Mở email và chọn liên kết đặt lại mật khẩu. | 9\. Kiểm tra mã đặt lại, thời hạn, trạng thái sử dụng và tài khoản tương ứng. |
| --- | --- |
| 10\. Nhập mật khẩu mới, xác nhận mật khẩu mới và gửi biểu mẫu. | 11\. Kiểm tra mật khẩu mới đáp ứng chính sách và hai trường mật khẩu trùng khớp. |
| --- | --- |
|     | 12\. Cập nhật mật khẩu bằng thuật toán băm an toàn, đánh dấu mã đặt lại đã sử dụng và xử lý các phiên đăng nhập cũ theo chính sách bảo mật. |
| --- | --- |
|     | 13\. Thông báo đặt lại mật khẩu thành công và hướng dẫn người dùng đăng nhập lại. |
| --- | --- |

**Alternative flow**

| **Trường hợp** | **Xử lý** |
| --- | --- |
| 4a. Email sai định dạng | Hệ thống yêu cầu nhập email đúng định dạng. |
| --- | --- |
| 5a. Email không gắn với tài khoản phù hợp | Hệ thống vẫn hiển thị thông báo chung về việc tiếp nhận yêu cầu, không tiết lộ sự tồn tại của tài khoản. |
| --- | --- |
| 9a. Liên kết hết hạn hoặc không hợp lệ | Hệ thống từ chối đặt lại mật khẩu và hướng dẫn gửi yêu cầu mới. |
| --- | --- |
| 11a. Mật khẩu mới không đạt yêu cầu | Hệ thống hiển thị yêu cầu cụ thể về mật khẩu và đề nghị nhập lại. |
| --- | --- |
| 11b. Mật khẩu xác nhận không trùng khớp | Hệ thống thông báo hai trường không khớp và giữ người dùng tại biểu mẫu. |
| --- | --- |

**Exception**

| **Trường hợp** | **Xử lý** |
| --- | --- |
| Dịch vụ email gặp lỗi | Hệ thống ghi nhận lỗi gửi email và không thông báo email đã được gửi khi dịch vụ chưa tiếp nhận yêu cầu. |
| --- | --- |
| Lỗi cập nhật mật khẩu | Hệ thống không thông báo thành công nếu giao dịch cập nhật thất bại. |
| --- | --- |

## **3.4.7. Cập nhật thông tin cá nhân**

| **Nội dung** | **Mô tả** |
| --- | --- |
| Tiền điều kiện | Người dùng đã đăng nhập và tài khoản đang hoạt động. |
| --- | --- |
| Hậu điều kiện | Thông tin cá nhân hợp lệ được cập nhật. Các thông tin định danh và quyền hạn không được tự ý thay đổi nếu người dùng không có quyền. |
| --- | --- |
| Actor chính | Người dùng đã đăng nhập. |
| --- | --- |
| Actor phụ | Không. |
| --- | --- |

**Basic flow**

| **Người dùng** | **Hệ thống** |
| --- | --- |
| 1\. Mở chức năng “Thông tin cá nhân”. | 2\. Hiển thị thông tin tài khoản hiện tại gồm họ tên, email, trạng thái tài khoản và các thông tin hồ sơ được phép chỉnh sửa. |
| --- | --- |
| 3\. Chỉnh sửa họ tên hoặc các trường hồ sơ được phép thay đổi. | 4\. Kiểm tra quyền chỉnh sửa và tính hợp lệ của dữ liệu. |
| --- | --- |
| 5\. Chọn “Lưu thay đổi”. | 6\. Lưu thông tin hợp lệ và ghi nhận thời điểm cập nhật. |
| --- | --- |
|     | 7\. Hiển thị thông báo cập nhật thành công và dữ liệu mới. |
| --- | --- |

**Alternative flow**

| **Trường hợp** | **Xử lý** |
| --- | --- |
| Họ tên bị bỏ trống | Hệ thống yêu cầu nhập họ tên hợp lệ. |
| --- | --- |
| Người dùng yêu cầu đổi email | Hệ thống yêu cầu xác minh email mới trước khi công nhận email đó là địa chỉ đã xác minh. |
| --- | --- |
| Người dùng sửa trường không được phép | Hệ thống từ chối thay đổi và thông báo trường đó không thuộc phạm vi chỉnh sửa của người dùng. |
| --- | --- |

**Exception**

| **Trường hợp** | **Xử lý** |
| --- | --- |
| Lỗi lưu dữ liệu | Hệ thống giữ nguyên dữ liệu đã lưu trước đó và thông báo cập nhật chưa hoàn tất. |
| --- | --- |

## **3.4.8. Quản lý tài khoản và phân quyền**

| **Nội dung** | **Mô tả** |
| --- | --- |
| Tiền điều kiện | Quản trị viên hệ thống đã đăng nhập và có quyền quản lý tài khoản, vai trò hoặc phạm vi truy cập. |
| --- | --- |
| Hậu điều kiện | Tài khoản, vai trò hoặc quyền được cập nhật đúng thẩm quyền; thay đổi được ghi nhật ký. |
| --- | --- |
| Actor chính | Quản trị viên hệ thống. |
| --- | --- |
| Actor phụ | Người dùng được quản lý, nếu hệ thống gửi thông báo thay đổi tài khoản. |
| --- | --- |

**Basic flow**

| **Người dùng** | **Hệ thống** |
| --- | --- |
| 1\. Mở chức năng “Quản lý tài khoản”. | 2\. Kiểm tra quyền quản trị và hiển thị danh sách tài khoản. |
| --- | --- |
| 3\. Tìm kiếm tài khoản theo họ tên, email, vai trò hoặc trạng thái. | 4\. Lọc và hiển thị các tài khoản phù hợp. |
| --- | --- |
| 5\. Chọn một tài khoản. | 6\. Hiển thị thông tin tài khoản, trạng thái, vai trò và phạm vi quyền hiện tại. |
| --- | --- |
| 7\. Chọn thao tác cập nhật trạng thái, cấp quyền, thay đổi phạm vi hoặc thu hồi quyền. | 8\. Kiểm tra quyền của quản trị viên, tính hợp lệ của thay đổi và các ràng buộc bảo vệ tài khoản. |
| --- | --- |
| 9\. Xác nhận thao tác. | 10\. Cập nhật thông tin, ghi nhận người thực hiện, thời điểm và nội dung thay đổi. |
| --- | --- |
|     | 11\. Thông báo kết quả xử lý. |
| --- | --- |

**Alternative flow**

| **Trường hợp** | **Xử lý** |
| --- | --- |
| Không tìm thấy tài khoản | Hệ thống thông báo không có tài khoản phù hợp với điều kiện tìm kiếm. |
| --- | --- |
| Vai trò hoặc phạm vi quyền không hợp lệ | Hệ thống từ chối cập nhật và nêu rõ điều kiện không đáp ứng. |
| --- | --- |
| Tài khoản đang chờ xác minh email | Việc cấp vai trò không tự động kích hoạt tài khoản. Người dùng vẫn phải hoàn tất xác minh email. |
| --- | --- |
| Thu hồi quyền của người đang thực hiện công việc | Hệ thống yêu cầu xác nhận khi thao tác ảnh hưởng đến quyền quản lý giải hoặc dữ liệu nghiệp vụ. |
| --- | --- |

**Exception**

| **Trường hợp** | **Xử lý** |
| --- | --- |
| Người thao tác không đủ quyền | Hệ thống từ chối yêu cầu và ghi nhận sự kiện bảo mật. |
| --- | --- |
| Lỗi cập nhật | Hệ thống không áp dụng một phần quyền gây trạng thái không nhất quán và thông báo thao tác chưa hoàn tất. |
| --- | --- |

## **3.4.9. Quản lý trường học và đơn vị tổ chức**

| **Nội dung** | **Mô tả** |
| --- | --- |
| Tiền điều kiện | Người thực hiện đã đăng nhập và được cấp quyền quản lý thông tin trường hoặc đơn vị tổ chức. |
| --- | --- |
| Hậu điều kiện | Thông tin trường hoặc đơn vị được tạo mới, cập nhật hoặc ngừng sử dụng theo quyền được cấp. Dữ liệu giải đấu và đội bóng liên quan được bảo toàn. |
| --- | --- |
| Actor chính | Quản trị viên hệ thống hoặc Đại diện trường/đơn vị tổ chức theo phạm vi quyền. |
| --- | --- |
| Actor phụ | Không. |
| --- | --- |

**Basic flow**

| **Người dùng** | **Hệ thống** |
| --- | --- |
| 1\. Mở chức năng “Quản lý trường học và đơn vị tổ chức”. | 2\. Hiển thị danh sách trường và đơn vị thuộc phạm vi được phép quản lý. |
| --- | --- |
| 3\. Chọn “Thêm mới” hoặc chọn một bản ghi để cập nhật. | 4\. Hiển thị biểu mẫu gồm **Tên trường, Loại hình trường, Địa chỉ, Email liên hệ, Số điện thoại liên hệ và Thông tin đơn vị trực thuộc nếu có**. |
| --- | --- |
| 5\. Nhập hoặc chỉnh sửa thông tin. | 6\. Kiểm tra trường bắt buộc, định dạng email, số điện thoại và khả năng trùng lặp dữ liệu. |
| --- | --- |
| 7\. Chọn “Lưu”. | 8\. Kiểm tra quyền thao tác và các ràng buộc liên quan. |
| --- | --- |
|     | 9\. Lưu thông tin trường hoặc đơn vị và ghi nhận người thực hiện, thời điểm cập nhật. |
| --- | --- |
|     | 10\. Thông báo kết quả xử lý và hiển thị dữ liệu mới. |
| --- | --- |

**Alternative flow**

| **Trường hợp** | **Xử lý** |
| --- | --- |
| Thiếu tên trường hoặc thông tin bắt buộc | Hệ thống chỉ rõ trường cần bổ sung. |
| --- | --- |
| Email hoặc số điện thoại sai định dạng | Hệ thống thông báo lỗi tại trường tương ứng. |
| --- | --- |
| Thông tin có khả năng trùng lặp | Hệ thống cảnh báo và yêu cầu kiểm tra trước khi lưu. |
| --- | --- |
| Trường đã có đội bóng hoặc giải đấu liên quan | Hệ thống không xóa cứng dữ liệu trường làm mất liên kết nghiệp vụ; sử dụng cơ chế ngừng hoạt động có kiểm soát. |
| --- | --- |

**Exception**

| **Trường hợp** | **Xử lý** |
| --- | --- |
| Không đủ quyền quản lý trường | Hệ thống từ chối thao tác và không thay đổi dữ liệu. |
| --- | --- |
| Lỗi lưu dữ liệu | Hệ thống thông báo chưa hoàn tất và giữ nguyên dữ liệu đã lưu trước đó. |
| --- | --- |

## **3.4.10. Tạo đội bóng**

| **Nội dung** | **Mô tả** |
| --- | --- |
| Tiền điều kiện | Người dùng đã đăng nhập, được cấp quyền đại diện đội bóng hoặc quản lý đội trong phạm vi trường phù hợp. Trường đại diện đã tồn tại trong hệ thống. |
| --- | --- |
| Hậu điều kiện | Đội bóng được tạo và liên kết với trường, có người đại diện được xác định. Việc tạo đội không đồng nghĩa đội đã được chấp thuận tham gia giải đấu. |
| --- | --- |
| Actor chính | Đại diện đội bóng hoặc Đại diện trường/đơn vị tổ chức có quyền phù hợp. |
| --- | --- |
| Actor phụ | Không. |
| --- | --- |

**Basic flow**

| **Người dùng** | **Hệ thống** |
| --- | --- |
| 1\. Mở chức năng “Quản lý đội bóng”. | 2\. Hiển thị danh sách đội bóng người dùng được phép quản lý. |
| --- | --- |
| 3\. Chọn “Tạo đội bóng”. | 4\. Hiển thị biểu mẫu gồm **Tên đội bóng, Trường đại diện, Tên người đại diện, Email liên hệ, Số điện thoại liên hệ và Mô tả đội bóng nếu có**. |
| --- | --- |
| 5\. Nhập thông tin đội bóng. | 6\. Kiểm tra trường bắt buộc, định dạng email, số điện thoại và quyền đại diện trường. |
| --- | --- |
| 7\. Chọn “Lưu đội bóng”. | 8\. Kiểm tra trùng lặp theo quy tắc định danh đội được áp dụng. |
| --- | --- |
|     | 9\. Tạo hồ sơ đội bóng, liên kết với trường và người đại diện. |
| --- | --- |
|     | 10\. Thông báo tạo đội thành công và hiển thị hồ sơ đội bóng. |
| --- | --- |

**Alternative flow**

| **Trường hợp** | **Xử lý** |
| --- | --- |
| Trường đại diện không tồn tại | Hệ thống yêu cầu chọn trường đã được quản lý trong hệ thống hoặc thực hiện quy trình bổ sung trường. |
| --- | --- |
| Người dùng không có quyền đại diện trường | Hệ thống từ chối tạo đội trong phạm vi trường đó. |
| --- | --- |
| Thiếu thông tin bắt buộc | Hệ thống chỉ rõ trường cần bổ sung. |
| --- | --- |
| Tên đội trùng trong cùng phạm vi theo quy tắc định danh | Hệ thống cảnh báo và yêu cầu kiểm tra hoặc điều chỉnh. |
| --- | --- |

**Exception**

| **Trường hợp** | **Xử lý** |
| --- | --- |
| Lỗi tạo đội | Hệ thống không hiển thị thông báo thành công nếu hồ sơ chưa được lưu đầy đủ. |
| --- | --- |
| Người dùng không có quyền tạo đội | Hệ thống từ chối thao tác và ghi nhận yêu cầu bị từ chối nếu cần. |
| --- | --- |

## **3.4.11. Quản lý danh sách cầu thủ của đội bóng**

| **Nội dung** | **Mô tả** |
| --- | --- |
| Tiền điều kiện | Người dùng đã đăng nhập và có quyền quản lý đội bóng. Hồ sơ đội đã tồn tại trong hệ thống. |
| --- | --- |
| Hậu điều kiện | Danh sách cầu thủ của đội được cập nhật theo dữ liệu hợp lệ. Danh sách cầu thủ đã nộp hoặc khóa cho một giải không tự động thay đổi khi danh sách đội chung được chỉnh sửa. |
| --- | --- |
| Actor chính | Đại diện đội bóng. |
| --- | --- |
| Actor phụ | Cầu thủ, nếu có quy trình xác nhận tham gia đội. |
| --- | --- |

**Basic flow**

| **Người dùng** | **Hệ thống** |
| --- | --- |
| 1\. Mở chức năng “Danh sách cầu thủ”. | 2\. Kiểm tra quyền và hiển thị danh sách cầu thủ hiện tại của đội. |
| --- | --- |
| 3\. Chọn “Thêm cầu thủ”. | 4\. Hiển thị biểu mẫu gồm **Họ và tên, Ngày sinh, Mã số sinh viên nếu áp dụng, Email hoặc thông tin liên hệ, Số áo, Vị trí thi đấu và Tài liệu minh chứng tư cách sinh viên nếu điều lệ yêu cầu**. |
| --- | --- |
| 5\. Nhập thông tin cầu thủ và tải tài liệu minh chứng nếu được yêu cầu. | 6\. Kiểm tra trường bắt buộc, định dạng ngày sinh, số áo và định dạng tệp minh chứng. |
| --- | --- |
| 7\. Chọn “Lưu cầu thủ”. | 8\. Kiểm tra trùng lặp cầu thủ trong danh sách, trùng số áo theo quy định và quyền quản lý đội. |
| --- | --- |
|     | 9\. Lưu hồ sơ cầu thủ và cập nhật danh sách đội. |
| --- | --- |
|     | 10\. Thông báo kết quả cập nhật. |
| --- | --- |

**Alternative flow**

| **Trường hợp** | **Xử lý** |
| --- | --- |
| Thiếu thông tin bắt buộc | Hệ thống chỉ rõ trường cần bổ sung và không lưu hồ sơ chưa hợp lệ. |
| --- | --- |
| Số áo bị trùng trong cùng danh sách theo quy định giải | Hệ thống thông báo số áo đã được sử dụng và yêu cầu chọn số khác. |
| --- | --- |
| Cầu thủ đã thuộc đội khác trong cùng giải | Hệ thống từ chối đưa cầu thủ vào danh sách đội thứ hai trong cùng giải. |
| --- | --- |
| Cầu thủ cần xác minh tư cách sinh viên | Hệ thống ghi nhận hồ sơ cần kiểm tra; Ban tổ chức hoặc người có thẩm quyền đối chiếu minh chứng. |
| --- | --- |
| Danh sách đã khóa | Hệ thống từ chối chỉnh sửa trực tiếp và hướng dẫn thực hiện quy trình đề nghị điều chỉnh nếu điều lệ cho phép. |
| --- | --- |

**Exception**

| **Trường hợp** | **Xử lý** |
| --- | --- |
| Lỗi lưu hồ sơ cầu thủ | Hệ thống không thêm cầu thủ vào danh sách nếu thông tin chưa được lưu đầy đủ. |
| --- | --- |
| Người dùng không có quyền quản lý đội | Hệ thống từ chối thao tác. |
| --- | --- |

## **3.4.12. Gửi yêu cầu tham gia đội bóng**

| **Nội dung** | **Mô tả** |
| --- | --- |
| Tiền điều kiện | Cầu thủ đã đăng nhập và đội bóng tồn tại trong hệ thống. Đội đang tiếp nhận yêu cầu nếu hệ thống áp dụng cơ chế này. |
| --- | --- |
| Hậu điều kiện | Yêu cầu được ghi nhận ở trạng thái Chờ đội bóng xem xét. Cầu thủ chưa trở thành thành viên chính thức chỉ vì đã gửi yêu cầu. |
| --- | --- |
| Actor chính | Cầu thủ. |
| --- | --- |
| Actor phụ | Đại diện đội bóng. |
| --- | --- |

**Basic flow**

| **Người dùng** | **Hệ thống** |
| --- | --- |
| 1\. Mở danh sách đội bóng và chọn đội muốn tham gia. | 2\. Hiển thị tên đội, trường đại diện, thông tin liên hệ và trạng thái tiếp nhận yêu cầu. |
| --- | --- |
| 3\. Chọn “Gửi yêu cầu tham gia đội”. | 4\. Kiểm tra tài khoản, thông tin cầu thủ, trạng thái đội và các yêu cầu đã tồn tại. |
| --- | --- |
|     | 5\. Kiểm tra cầu thủ chưa có yêu cầu đang chờ xử lý trùng với đội đã chọn. |
| --- | --- |
|     | 6\. Tạo yêu cầu ở trạng thái Chờ đội bóng xem xét. |
| --- | --- |
|     | 7\. Thông báo gửi yêu cầu thành công và thông báo cho đại diện đội bóng. |
| --- | --- |

**Alternative flow**

| **Trường hợp** | **Xử lý** |
| --- | --- |
| Đã có yêu cầu đang chờ xử lý | Hệ thống không tạo yêu cầu trùng và hiển thị trạng thái yêu cầu hiện tại. |
| --- | --- |
| Đội không tiếp nhận thành viên mới | Hệ thống thông báo đội hiện không tiếp nhận yêu cầu. |
| --- | --- |
| Cầu thủ chưa hoàn thiện hồ sơ cá nhân bắt buộc | Hệ thống yêu cầu bổ sung thông tin trước khi gửi yêu cầu. |
| --- | --- |

**Exception**

| **Trường hợp** | **Xử lý** |
| --- | --- |
| Lỗi tạo yêu cầu | Hệ thống không thông báo gửi thành công nếu yêu cầu chưa được lưu. |
| --- | --- |
| Người dùng không có quyền gửi yêu cầu | Hệ thống từ chối thao tác. |
| --- | --- |

## **3.4.13. Xét duyệt yêu cầu tham gia đội bóng**

| **Nội dung** | **Mô tả** |
| --- | --- |
| Tiền điều kiện | Đại diện đội bóng đã đăng nhập, có quyền quản lý đội và có yêu cầu đang ở trạng thái Chờ đội bóng xem xét. |
| --- | --- |
| Hậu điều kiện | Yêu cầu được chấp thuận hoặc từ chối. Nếu chấp thuận, cầu thủ được liên kết với đội theo nghiệp vụ; việc đăng ký cầu thủ vào từng giải vẫn phải tuân thủ điều lệ giải đó. |
| --- | --- |
| Actor chính | Đại diện đội bóng. |
| --- | --- |
| Actor phụ | Cầu thủ. |
| --- | --- |

**Basic flow**

| **Người dùng** | **Hệ thống** |
| --- | --- |
| 1\. Mở chức năng “Yêu cầu tham gia đội”. | 2\. Hiển thị các yêu cầu thuộc đội mà người dùng có quyền quản lý. |
| --- | --- |
| 3\. Chọn một yêu cầu. | 4\. Hiển thị họ tên, ngày sinh, thông tin liên hệ và thông tin hồ sơ cầu thủ. |
| --- | --- |
| 5\. Chọn “Chấp thuận” hoặc “Từ chối”. | 6\. Kiểm tra quyền, trạng thái yêu cầu và các ràng buộc về thành viên đội. |
| --- | --- |
| 7\. Xác nhận quyết định. | 8\. Cập nhật trạng thái yêu cầu; nếu chấp thuận, cập nhật quan hệ cầu thủ–đội. |
| --- | --- |
|     | 9\. Gửi thông báo kết quả cho cầu thủ. |
| --- | --- |

**Alternative flow**

| **Trường hợp** | **Xử lý** |
| --- | --- |
| Yêu cầu đã được xử lý trước đó | Hệ thống thông báo yêu cầu không còn ở trạng thái chờ và không xử lý lặp. |
| --- | --- |
| Cầu thủ không đáp ứng điều kiện | Hệ thống yêu cầu người quản lý kiểm tra lại trước khi chấp thuận. |
| --- | --- |
| Đại diện đội không có quyền | Hệ thống từ chối thao tác. |
| --- | --- |

**Exception**

| **Trường hợp** | **Xử lý** |
| --- | --- |
| Lỗi cập nhật quan hệ cầu thủ–đội | Hệ thống không ghi nhận yêu cầu đã chấp thuận nếu chưa cập nhật được quan hệ thành viên một cách nhất quán. |
| --- | --- |

## **3.4.14. Tạo giải đấu**

| **Nội dung** | **Mô tả** |
| --- | --- |
| Tiền điều kiện | Người dùng đã đăng nhập và được cấp quyền tổ chức giải đấu trong phạm vi trường hoặc đơn vị tổ chức. Thông tin đơn vị tổ chức đã tồn tại trong hệ thống. |
| --- | --- |
| Hậu điều kiện | Hồ sơ giải đấu được tạo ở trạng thái Bản nháp. Giải chưa được mở đăng ký công khai cho đến khi hoàn thành điều lệ và được công bố theo quy trình. |
| --- | --- |
| Actor chính | Ban tổ chức giải hoặc Đại diện trường/đơn vị tổ chức có quyền tạo giải. |
| --- | --- |
| Actor phụ | Không. |
| --- | --- |

**Basic flow**

| **Người dùng** | **Hệ thống** |
| --- | --- |
| 1\. Mở chức năng “Quản lý giải đấu”. | 2\. Hiển thị danh sách giải đấu người dùng được phép quản lý. |
| --- | --- |
| 3\. Chọn “Tạo giải đấu”. | 4\. Hiển thị biểu mẫu gồm **Tên giải đấu, Đơn vị tổ chức, Phạm vi trường được phép tham gia, Ngày bắt đầu, Ngày kết thúc dự kiến, Địa điểm tổ chức chính, Mô tả giải đấu và Thông tin liên hệ của Ban tổ chức**. |
| --- | --- |
| 5\. Nhập thông tin và chọn “Lưu bản nháp”. | 6\. Kiểm tra dữ liệu bắt buộc, quyền tổ chức, ngày bắt đầu, ngày kết thúc và các trường thông tin liên hệ. |
| --- | --- |
|     | 7\. Tạo hồ sơ giải đấu ở trạng thái Bản nháp, liên kết với đơn vị tổ chức và người tạo. |
| --- | --- |
|     | 8\. Hiển thị thông báo tạo giải đấu thành công và chuyển đến trang quản lý giải đấu. |
| --- | --- |

**Alternative flow**

| **Trường hợp** | **Xử lý** |
| --- | --- |
| Thiếu tên giải hoặc đơn vị tổ chức | Hệ thống yêu cầu bổ sung thông tin còn thiếu. |
| --- | --- |
| Ngày bắt đầu sau ngày kết thúc | Hệ thống từ chối lưu thông tin thời gian và yêu cầu chỉnh sửa. |
| --- | --- |
| Người dùng không có quyền tổ chức tại đơn vị đã chọn | Hệ thống từ chối tạo giải trong phạm vi đó. |
| --- | --- |

**Exception**

| **Trường hợp** | **Xử lý** |
| --- | --- |
| Lỗi lưu giải đấu | Hệ thống không tạo bản ghi dở dang và không thông báo thành công khi thao tác chưa hoàn tất. |
| --- | --- |

## **3.4.15. Thiết lập và công bố điều lệ giải đấu**

| **Nội dung** | **Mô tả** |
| --- | --- |
| Tiền điều kiện | Giải đấu đã được tạo và đang ở trạng thái Bản nháp. Người dùng có quyền thiết lập điều lệ và công bố giải. |
| --- | --- |
| Hậu điều kiện | Điều lệ được lưu và phiên bản công bố được ghi nhận. Khi đủ điều kiện, giải chuyển sang trạng thái Mở đăng ký. Điều lệ đã công bố được lưu vết; việc sửa đổi sau công bố phải tuân theo quy trình thay đổi điều lệ. |
| --- | --- |
| Actor chính | Ban tổ chức giải. |
| --- | --- |
| Actor phụ | Đại diện trường/đơn vị tổ chức có quyền tổ chức giải. |
| --- | --- |

**Basic flow**

| **Người dùng** | **Hệ thống** |
| --- | --- |
| 1\. Chọn giải đấu cần thiết lập. | 2\. Hiển thị thông tin giải đấu và tình trạng hoàn thiện điều lệ. |
| --- | --- |
| 3\. Mở chức năng “Thiết lập điều lệ”. | 4\. Hiển thị các mục cấu hình gồm: **Phạm vi trường tham gia; Hình thức sân 7 hoặc sân 11; Thể thức thi đấu; Thời gian mở và đóng đăng ký; Số lượng đội tối thiểu và tối đa; Số lượng cầu thủ tối thiểu và tối đa; Điều kiện cầu thủ; Quy định về danh sách cầu thủ; Cách tính điểm; Tiêu chí xếp hạng; Quy định thẻ phạt; Điều kiện treo giò; Thời hạn khiếu nại; Quy định xử lý đội bỏ cuộc hoặc không có mặt; Quy định xử lý trận đấu bị hoãn hoặc hủy**. |
| --- | --- |
| 5\. Nhập hoặc chỉnh sửa các quy định của giải. | 6\. Kiểm tra các trường bắt buộc, tính hợp lệ của thời gian, số lượng đội, số lượng cầu thủ và tính nhất quán giữa các cấu hình. |
| --- | --- |
| 7\. Chọn “Lưu điều lệ”. | 8\. Lưu nội dung điều lệ ở trạng thái bản nháp. |
| --- | --- |
| 9\. Chọn “Công bố điều lệ và mở đăng ký”. | 10\. Kiểm tra điều lệ đã đầy đủ, thời gian đăng ký hợp lệ, thông tin đơn vị tổ chức và điều kiện mở đăng ký. |
| --- | --- |
|     | 11\. Ghi nhận phiên bản điều lệ, người công bố và thời điểm công bố; chuyển giải sang trạng thái Mở đăng ký nếu tất cả điều kiện đều đạt. |
| --- | --- |
|     | 12\. Công khai thông tin giải và điều lệ; thông báo kết quả cho người dùng theo phạm vi công bố. |
| --- | --- |

**Alternative flow**

| **Trường hợp** | **Xử lý** |
| --- | --- |
| Điều lệ chưa đầy đủ | Hệ thống chỉ rõ mục còn thiếu và không cho mở đăng ký. |
| --- | --- |
| Thời gian đăng ký không hợp lệ | Hệ thống yêu cầu điều chỉnh thời gian trước khi công bố. |
| --- | --- |
| Số lượng đội hoặc điều kiện cầu thủ không nhất quán với thể thức | Hệ thống cảnh báo và yêu cầu kiểm tra cấu hình. |
| --- | --- |
| Sửa điều lệ sau khi đã công bố | Hệ thống tạo bản sửa đổi, lưu nội dung và thời điểm thay đổi; yêu cầu người có thẩm quyền xác nhận. Nếu thay đổi ảnh hưởng đến đội đã đăng ký, hệ thống thông báo cho các bên liên quan. |
| --- | --- |

**Exception**

| **Trường hợp** | **Xử lý** |
| --- | --- |
| Người dùng không có quyền công bố | Hệ thống từ chối thao tác. |
| --- | --- |
| Lỗi khi công bố | Hệ thống không chuyển trạng thái giải nếu chưa lưu được phiên bản điều lệ và trạng thái công bố một cách nhất quán. |
| --- | --- |

## **3.4.16. Tìm kiếm và xem thông tin giải đấu**

| **Nội dung** | **Mô tả** |
| --- | --- |
| Tiền điều kiện | Người dùng truy cập được hệ thống. Đối với thông tin công khai, không bắt buộc đăng nhập. |
| --- | --- |
| Hậu điều kiện | Người dùng xem được thông tin giải đấu thuộc phạm vi công khai hoặc phạm vi quyền của mình. Dữ liệu không bị thay đổi. |
| --- | --- |
| Actor chính | Khán giả, Cầu thủ, Đại diện đội bóng, Đại diện trường/đơn vị tổ chức. |
| --- | --- |
| Actor phụ | Không. |
| --- | --- |

**Basic flow**

| **Người dùng** | **Hệ thống** |
| --- | --- |
| 1\. Mở chức năng “Giải đấu”. | 2\. Hiển thị danh sách giải đấu được phép công khai. |
| --- | --- |
| 3\. Nhập từ khóa hoặc chọn bộ lọc theo tên giải, trường tổ chức, trạng thái hoặc thời gian. | 4\. Kiểm tra điều kiện tìm kiếm và truy vấn dữ liệu phù hợp. |
| --- | --- |
| 5\. Chọn một giải đấu trong kết quả. | 6\. Hiển thị tên giải, đơn vị tổ chức, phạm vi tham gia, thời gian, địa điểm, điều lệ đã công bố, thời hạn đăng ký, danh sách đội được công khai, lịch thi đấu và kết quả nếu đã có. |
| --- | --- |

**Alternative flow**

| **Trường hợp** | **Xử lý** |
| --- | --- |
| Không có kết quả phù hợp | Hệ thống thông báo không tìm thấy giải đấu phù hợp và cho phép thay đổi điều kiện tìm kiếm. |
| --- | --- |
| Giải chưa được công bố | Hệ thống không hiển thị giải trong danh sách công khai, trừ người có quyền quản lý giải. |
| --- | --- |
| Thông tin chưa được phép công khai | Hệ thống chỉ hiển thị dữ liệu đã được công bố, không hiển thị dữ liệu nội bộ. |
| --- | --- |

**Exception**

| **Trường hợp** | **Xử lý** |
| --- | --- |
| Lỗi truy vấn dữ liệu | Hệ thống thông báo chưa thể tải thông tin và cho phép thử lại. |
| --- | --- |

## **3.4.17. Đăng ký đội bóng tham gia giải đấu**

| **Nội dung** | **Mô tả** |
| --- | --- |
| Tiền điều kiện | Người dùng đã đăng nhập với vai trò Đại diện đội và là người đại diện của đội. Giải đang ở trạng thái Mở đăng ký trong thời hạn nhận hồ sơ. Đội và trường đại diện đã tồn tại, đang hoạt động. |
| --- | --- |
| Hậu điều kiện | Hồ sơ đăng ký được tạo ở trạng thái Chờ xét duyệt nếu đáp ứng kiểm tra ban đầu. Việc gửi hồ sơ không đồng nghĩa đội đã được chấp thuận tham gia giải. |
| --- | --- |
| Actor chính | Đại diện đội bóng có quyền quản lý đội. |
| --- | --- |
| Actor phụ | Ban tổ chức được phân công trực tiếp cho giải đấu. |
| --- | --- |

**Basic flow**

| **Người dùng** | **Hệ thống** |
| --- | --- |
| 1\. Chọn đội và mở danh sách giải đấu. | 2\. Hiển thị giải đáp ứng phạm vi trường/bậc đào tạo, thời hạn và hạn mức của trường; nêu lý do với giải không đủ điều kiện. |
| --- | --- |
| 3\. Chọn giải muốn tham gia. | 4\. Hiển thị điều lệ, thời gian đăng ký, phạm vi trường được phép tham gia, giới hạn số đội và điều kiện hồ sơ. |
| --- | --- |
| 5\. Chọn “Đăng ký tham gia”. | 6\. Kiểm tra quyền đại diện đội, trạng thái và thời hạn giải, trường/bậc đào tạo, allowlist và hạn mức. |
| --- | --- |
| 7\. Chọn đội bóng, nhập ghi chú nếu cần và gửi hồ sơ. | 8\. Xác định trường từ hồ sơ đội, không nhận trường do client tự khai. |
| --- | --- |
| 9\. Xác nhận gửi đăng ký. | 10\. Kiểm tra quyền quản lý đội, trường/bậc đào tạo, phạm vi giải, thời hạn, hạn mức và đăng ký trùng. |
| --- | --- |
|     | 11\. Giữ chỗ hạn mức theo giải và trường một cách nguyên tử; lưu hồ sơ Chờ xét duyệt cùng mã trường và thời điểm gửi. |
| --- | --- |
|     | 12\. Gửi xác nhận và đưa hồ sơ vào hàng chờ của BTC giải được phân công. |
| --- | --- |

**Alternative flow**

| **Trường hợp** | **Xử lý** |
| --- | --- |
| Giải đã đóng đăng ký | Hệ thống từ chối tiếp nhận hồ sơ mới. |
| --- | --- |
| Trường không thuộc phạm vi được tham gia | Hệ thống thông báo trường không đáp ứng điều kiện của giải. |
| --- | --- |
| Bậc đào tạo không được phép hoặc giải nội bộ khác trường | Hệ thống từ chối hồ sơ và nêu rõ điều kiện trường/bậc đào tạo của giải. |
| --- | --- |
| Đã có hồ sơ đăng ký của đội trong giải | Hệ thống không tạo hồ sơ trùng; hiển thị hồ sơ hiện có và trạng thái xử lý. |
| --- | --- |
| Số lượng đội đã đạt giới hạn | Hệ thống từ chối tiếp nhận hồ sơ mới và hiển thị lý do đạt hạn mức. |
| --- | --- |
| Nhiều hồ sơ được gửi đồng thời khi sắp hết hạn mức | Hệ thống chỉ cấp giữ chỗ cho các hồ sơ còn hạn mức; các yêu cầu còn lại nhận lỗi giới hạn và không tạo hồ sơ. |
| --- | --- |
| Thiếu hồ sơ bắt buộc | Hệ thống chỉ rõ tài liệu hoặc thông tin còn thiếu và yêu cầu bổ sung. |
| --- | --- |
| Cần xác minh giấy tờ thực tế | BTC kiểm tra điều kiện đội/cầu thủ theo điều lệ trong quá trình xét duyệt; hồ sơ đăng ký hiện không nhận tệp minh chứng riêng. |
| --- | --- |

**Exception**

| **Trường hợp** | **Xử lý** |
| --- | --- |
| Lỗi tải tệp | Hệ thống thông báo tệp chưa được tiếp nhận và không ghi nhận hồ sơ hoàn chỉnh nếu thiếu tài liệu bắt buộc. |
| --- | --- |
| Lỗi lưu hồ sơ | Hệ thống không thông báo gửi thành công nếu hồ sơ chưa được lưu. |
| --- | --- |

## **3.4.18. Xét duyệt hồ sơ đăng ký giải đấu**

| **Nội dung** | **Mô tả** |
| --- | --- |
| Tiền điều kiện | Ban tổ chức đã đăng nhập, có quyền xét duyệt giải và có hồ sơ đăng ký ở trạng thái Chờ xét duyệt hoặc Yêu cầu bổ sung. |
| --- | --- |
| Hậu điều kiện | Hồ sơ được chuyển sang trạng thái Đã duyệt, Từ chối hoặc Yêu cầu bổ sung. Quyết định và người thực hiện được lưu lại. |
| --- | --- |
| Actor chính | Ban tổ chức giải. |
| --- | --- |
| Actor phụ | Đại diện đội bóng hoặc Đại diện trường đăng ký. |
| --- | --- |

**Basic flow**

| **Người dùng** | **Hệ thống** |
| --- | --- |
| 1\. Mở chức năng “Hồ sơ đăng ký”. | 2\. Hiển thị hồ sơ thuộc giải mà người dùng có quyền quản lý. |
| --- | --- |
| 3\. Chọn hồ sơ cần xét duyệt. | 4\. Hiển thị thông tin đội, trường, người đại diện, tài liệu minh chứng và kết quả kiểm tra điều kiện ban đầu. |
| --- | --- |
| 5\. Kiểm tra hồ sơ và tài liệu minh chứng. | 6\. Hiển thị điều kiện trong điều lệ và thông tin cần đối chiếu. |
| --- | --- |
| 7\. Chọn “Phê duyệt”, “Từ chối” hoặc “Yêu cầu bổ sung”. | 8\. Kiểm tra quyền xét duyệt, trạng thái hiện tại của hồ sơ và nội dung quyết định. |
| --- | --- |
| 9\. Nhập lý do nếu từ chối hoặc yêu cầu bổ sung. | 10\. Kiểm tra lý do và cập nhật trạng thái hồ sơ theo quyết định. |
| --- | --- |
|     | 11\. Ghi nhận người xét duyệt, thời điểm và nội dung quyết định. |
| --- | --- |
|     | 12\. Thông báo kết quả cho đại diện đội hoặc trường đăng ký. |
| --- | --- |

**Alternative flow**

| **Trường hợp** | **Xử lý** |
| --- | --- |
| Hồ sơ thiếu thông tin | Ban tổ chức chọn Yêu cầu bổ sung; hệ thống ghi nhận nội dung cần bổ sung và gửi thông báo. |
| --- | --- |
| Hồ sơ không đáp ứng điều lệ | Ban tổ chức chọn Từ chối, nhập lý do và xác nhận quyết định. |
| --- | --- |
| Hồ sơ đã được xử lý trước đó | Hệ thống không xử lý lặp và hiển thị trạng thái hiện tại. |
| --- | --- |
| Đội bổ sung hồ sơ | Đại diện đội cập nhật tài liệu hoặc thông tin được yêu cầu và gửi lại; hệ thống ghi nhận thời điểm bổ sung, chuyển hồ sơ về trạng thái Chờ xét duyệt. |
| --- | --- |

**Exception**

| **Trường hợp** | **Xử lý** |
| --- | --- |
| Người xét duyệt không có quyền | Hệ thống từ chối thao tác. |
| --- | --- |
| Lỗi cập nhật trạng thái | Hệ thống không thông báo kết quả xét duyệt nếu quyết định chưa được lưu đầy đủ. |
| --- | --- |

## **3.4.19. Quản lý danh sách cầu thủ đăng ký theo giải**

| **Nội dung** | **Mô tả** |
| --- | --- |
| Tiền điều kiện | Đội đã có hồ sơ đăng ký giải đấu. Người dùng có quyền quản lý danh sách cầu thủ của đội. Giải chưa khóa danh sách hoặc đang cho phép điều chỉnh theo điều lệ. |
| --- | --- |
| Hậu điều kiện | Danh sách cầu thủ đăng ký giải được lưu riêng cho giải đó. Danh sách chỉ được xem là chính thức khi đáp ứng điều kiện và được xác nhận theo quy trình của Ban tổ chức. |
| --- | --- |
| Actor chính | Đại diện đội bóng. |
| --- | --- |
| Actor phụ | Ban tổ chức giải. |
| --- | --- |

**Basic flow**

| **Người dùng** | **Hệ thống** |
| --- | --- |
| 1\. Mở hồ sơ đăng ký của đội trong giải. | 2\. Hiển thị thông tin giải, trạng thái hồ sơ và danh sách cầu thủ đăng ký hiện tại. |
| --- | --- |
| 3\. Chọn “Quản lý danh sách cầu thủ”. | 4\. Hiển thị danh sách cầu thủ thuộc đội và số lượng cầu thủ tối thiểu, tối đa theo điều lệ. |
| --- | --- |
| 5\. Chọn cầu thủ cần đưa vào danh sách giải. | 6\. Kiểm tra thông tin cầu thủ, điều kiện tham gia, số lượng cầu thủ và các ràng buộc trong điều lệ. |
| --- | --- |
| 7\. Xác nhận danh sách cầu thủ đăng ký. | 8\. Kiểm tra cầu thủ không thuộc đội khác trong cùng giải và không bị loại khỏi giải theo quyết định kỷ luật có hiệu lực. |
| --- | --- |
|     | 9\. Lưu danh sách cầu thủ đăng ký theo giải và ghi nhận thời điểm cập nhật. |
| --- | --- |
|     | 10\. Thông báo kết quả cập nhật danh sách. |
| --- | --- |

**Alternative flow**

| **Trường hợp** | **Xử lý** |
| --- | --- |
| Số lượng cầu thủ ít hơn mức tối thiểu | Hệ thống thông báo danh sách chưa đáp ứng điều lệ và không cho xác nhận danh sách chính thức. |
| --- | --- |
| Số lượng cầu thủ vượt mức tối đa | Hệ thống yêu cầu loại bớt cầu thủ trước khi xác nhận. |
| --- | --- |
| Cầu thủ thuộc đội khác trong cùng giải | Hệ thống từ chối đăng ký cầu thủ vào đội hiện tại. |
| --- | --- |
| Thiếu giấy tờ minh chứng | Hệ thống đánh dấu hồ sơ cầu thủ cần kiểm tra và không tự xác nhận đủ điều kiện. |
| --- | --- |
| Danh sách đã khóa | Hệ thống từ chối sửa trực tiếp và yêu cầu thực hiện quy trình đề nghị điều chỉnh nếu điều lệ cho phép. |
| --- | --- |

**Exception**

| **Trường hợp** | **Xử lý** |
| --- | --- |
| Lỗi lưu danh sách | Hệ thống giữ nguyên danh sách đã lưu trước đó và thông báo thao tác chưa hoàn tất. |
| --- | --- |
| Người dùng không có quyền quản lý danh sách | Hệ thống từ chối thao tác. |
| --- | --- |

## **3.4.20. Khóa danh sách đội tham gia giải**

| **Nội dung** | **Mô tả** |
| --- | --- |
| Tiền điều kiện | Giải đã kết thúc thời gian đăng ký hoặc Ban tổ chức được phép khóa danh sách theo kế hoạch. Các hồ sơ đăng ký cần được xử lý theo quy định của giải. |
| --- | --- |
| Hậu điều kiện | Danh sách đội được xác định chính thức; danh sách cầu thủ được khóa theo quy định. Mọi thay đổi sau đó phải đi qua quy trình điều chỉnh được cho phép. |
| --- | --- |
| Actor chính | Ban tổ chức giải. |
| --- | --- |
| Actor phụ | Đại diện đội bóng. |
| --- | --- |

**Basic flow**

| **Người dùng** | **Hệ thống** |
| --- | --- |
| 1\. Mở chức năng “Danh sách đội tham gia”. | 2\. Hiển thị danh sách hồ sơ đăng ký, trạng thái xét duyệt và danh sách cầu thủ theo từng đội. |
| --- | --- |
| 3\. Kiểm tra các hồ sơ đã được duyệt. | 4\. Kiểm tra số lượng đội, điều kiện trường tham gia, số lượng cầu thủ và các yêu cầu trong điều lệ. |
| --- | --- |
| 5\. Chọn “Khóa danh sách”. | 6\. Hiển thị danh sách đội chính thức và các cảnh báo nếu còn hồ sơ chưa xử lý. |
| --- | --- |
| 7\. Xác nhận khóa danh sách. | 8\. Kiểm tra quyền thực hiện và điều kiện khóa danh sách. |
| --- | --- |
|     | 9\. Ghi nhận phiên bản danh sách đội, danh sách cầu thủ, người khóa và thời điểm khóa. |
| --- | --- |
|     | 10\. Chuyển danh sách sang trạng thái Đã khóa và thông báo cho các đội liên quan. |
| --- | --- |

**Alternative flow**

| **Trường hợp** | **Xử lý** |
| --- | --- |
| Còn hồ sơ đăng ký chưa được xử lý | Hệ thống hiển thị danh sách hồ sơ còn tồn đọng và yêu cầu Ban tổ chức xử lý hoặc xác nhận cách giải quyết theo quy định. |
| --- | --- |
| Số lượng đội không đáp ứng điều lệ | Hệ thống cảnh báo và không cho khóa danh sách nếu điều lệ yêu cầu số lượng tối thiểu. |
| --- | --- |
| Có cầu thủ chưa đáp ứng điều kiện | Hệ thống liệt kê các cầu thủ chưa đủ điều kiện để Ban tổ chức xử lý. |
| --- | --- |

**Exception**

| **Trường hợp** | **Xử lý** |
| --- | --- |
| Lỗi lưu phiên bản danh sách | Hệ thống không chuyển danh sách sang trạng thái đã khóa nếu chưa lưu được dữ liệu và lịch sử liên quan. |
| --- | --- |

## **3.4.21. Chia bảng và bốc thăm**

| **Nội dung** | **Mô tả** |
| --- | --- |
| Tiền điều kiện | Danh sách đội tham gia đã được khóa. Giải đang trong giai đoạn chuẩn bị thi đấu. Thể thức thi đấu và quy tắc chia bảng đã được thiết lập trong điều lệ. |
| --- | --- |
| Hậu điều kiện | Kết quả chia bảng hoặc bốc thăm được lưu và công bố theo quyền của Ban tổ chức. Danh sách đội được gắn với bảng hoặc nhánh đấu tương ứng. |
| --- | --- |
| Actor chính | Ban tổ chức giải. |
| --- | --- |
| Actor phụ | Đại diện đội bóng, nếu được quyền theo dõi kết quả công bố. |
| --- | --- |

**Basic flow**

| **Người dùng** | **Hệ thống** |
| --- | --- |
| 1\. Mở chức năng “Chia bảng và bốc thăm”. | 2\. Hiển thị danh sách đội chính thức, thể thức thi đấu và quy tắc chia bảng đã thiết lập. |
| --- | --- |
| 3\. Chọn phương án chia bảng hoặc bốc thăm phù hợp với điều lệ. | 4\. Kiểm tra số lượng đội, số bảng, số đội mỗi bảng và các ràng buộc của phương án đã chọn. |
| --- | --- |
| 5\. Xác nhận thực hiện chia bảng hoặc bốc thăm. | 6\. Tạo kết quả phân bổ đội theo phương án đã chọn. |
| --- | --- |
|     | 7\. Lưu kết quả, thời điểm thực hiện, người thực hiện và thông tin cần thiết để truy vết kết quả bốc thăm. |
| --- | --- |
| 8\. Kiểm tra kết quả và chọn “Công bố”. | 9\. Ghi nhận thời điểm công bố và hiển thị kết quả theo phạm vi được phép. |
| --- | --- |

**Alternative flow**

| **Trường hợp** | **Xử lý** |
| --- | --- |
| Số lượng đội không phù hợp với cấu hình chia bảng | Hệ thống thông báo số lượng đội và đề nghị điều chỉnh số bảng hoặc quy tắc chia bảng. |
| --- | --- |
| Cần thực hiện lại bốc thăm | Hệ thống yêu cầu nhập lý do, kiểm tra quyền và lưu cả kết quả cũ lẫn kết quả mới trong lịch sử. |
| --- | --- |
| Kết quả đã công bố | Hệ thống không cho thay đổi trực tiếp mà yêu cầu quy trình điều chỉnh có lưu vết và thông báo cho đội liên quan. |
| --- | --- |

**Exception**

| **Trường hợp** | **Xử lý** |
| --- | --- |
| Lỗi tạo hoặc lưu kết quả | Hệ thống không công bố kết quả chưa được lưu đầy đủ. |
| --- | --- |
| Người dùng không có quyền thực hiện | Hệ thống từ chối thao tác. |
| --- | --- |

## **3.4.22. Lập lịch thi đấu và phân công sân**

| **Nội dung** | **Mô tả** |
| --- | --- |
| Tiền điều kiện | Danh sách đội đã được khóa; thể thức và kết quả chia bảng đã được xác định nếu giải sử dụng vòng bảng. Ban tổ chức có quyền lập lịch. |
| --- | --- |
| Hậu điều kiện | Lịch thi đấu được lưu với thời gian, sân và các đội tham gia. Hệ thống kiểm tra xung đột lịch trước khi cho công bố. |
| --- | --- |
| Actor chính | Ban tổ chức giải. |
| --- | --- |
| Actor phụ | Đại diện đội bóng, Trọng tài. |
| --- | --- |

**Basic flow**

| **Người dùng** | **Hệ thống** |
| --- | --- |
| 1\. Mở chức năng “Lịch thi đấu”. | 2\. Hiển thị danh sách đội, vòng đấu, bảng đấu và các trận cần lập lịch. |
| --- | --- |
| 3\. Chọn trận đấu cần bố trí lịch. | 4\. Hiển thị biểu mẫu gồm **Vòng đấu, Đội nhà, Đội khách, Ngày thi đấu, Giờ bắt đầu, Giờ kết thúc dự kiến, Sân thi đấu và Ghi chú**. |
| --- | --- |
| 5\. Nhập thông tin thời gian và chọn sân. | 6\. Kiểm tra đội tham gia, thời gian, sân và các ràng buộc lịch thi đấu. |
| --- | --- |
|     | 7\. Kiểm tra sân không bị bố trí cho hai trận trùng thời gian; đội không phải thi đấu hai trận trùng thời gian; lịch phù hợp với kế hoạch giải. |
| --- | --- |
| 8\. Chọn “Lưu lịch”. | 9\. Lưu lịch thi đấu ở trạng thái Bản nháp. |
| --- | --- |
| 10\. Sau khi kiểm tra toàn bộ lịch, chọn “Công bố lịch”. | 11\. Kiểm tra các trận đã có thời gian, sân và thông tin đội hợp lệ; xác nhận không còn xung đột lịch chưa được xử lý. |
| --- | --- |
|     | 12\. Chuyển lịch sang trạng thái Đã công bố và thông báo cho các đội, trọng tài có liên quan. |
| --- | --- |

**Alternative flow**

| **Trường hợp** | **Xử lý** |
| --- | --- |
| Sân đã có trận đấu trùng thời gian | Hệ thống thông báo sân bị trùng lịch và yêu cầu chọn thời gian hoặc sân khác. |
| --- | --- |
| Đội có hai trận trùng thời gian | Hệ thống cảnh báo xung đột và không cho công bố lịch bị trùng. |
| --- | --- |
| Thiếu thời gian hoặc sân | Hệ thống chỉ rõ trận đấu chưa đủ thông tin lập lịch. |
| --- | --- |
| Thay đổi lịch đã công bố | Hệ thống yêu cầu nhập lý do, lưu lịch cũ và lịch mới, ghi nhận người thay đổi và thông báo cho các bên liên quan. |
| --- | --- |

**Exception**

| **Trường hợp** | **Xử lý** |
| --- | --- |
| Lỗi lưu lịch | Hệ thống không công bố lịch nếu chưa lưu đầy đủ các trận đấu và dữ liệu liên quan. |
| --- | --- |
| Người dùng không có quyền lập lịch | Hệ thống từ chối thao tác. |
| --- | --- |

## **3.4.23. Phân công trọng tài**

| **Nội dung** | **Mô tả** |
| --- | --- |
| Tiền điều kiện | Trận đấu đã được tạo và có lịch thi đấu dự kiến hoặc chính thức. Ban tổ chức có quyền phân công trọng tài. |
| --- | --- |
| Hậu điều kiện | Danh sách trọng tài được phân công cho trận đấu được lưu; thông báo phân công được gửi đến trọng tài liên quan. |
| --- | --- |
| Actor chính | Ban tổ chức giải. |
| --- | --- |
| Actor phụ | Trọng tài. |
| --- | --- |

**Basic flow**

| **Người dùng** | **Hệ thống** |
| --- | --- |
| 1\. Mở chức năng “Phân công trọng tài”. | 2\. Hiển thị danh sách trận đấu và thông tin phân công hiện tại. |
| --- | --- |
| 3\. Chọn trận đấu cần phân công. | 4\. Hiển thị ngày giờ, sân, đội tham gia và danh sách trọng tài có trạng thái hoạt động. |
| --- | --- |
| 5\. Chọn trọng tài chính và các trọng tài khác theo cơ cấu của giải. | 6\. Kiểm tra trọng tài được chọn đang hoạt động, không bị trùng lịch và không bị phân công vào các trận trùng thời gian. |
| --- | --- |
| 7\. Chọn “Lưu phân công”. | 8\. Lưu danh sách phân công, người thực hiện và thời điểm cập nhật. |
| --- | --- |
|     | 9\. Gửi thông báo phân công cho các trọng tài được chọn. |
| --- | --- |
|     | 10\. Hiển thị kết quả phân công. |
| --- | --- |

**Alternative flow**

| **Trường hợp** | **Xử lý** |
| --- | --- |
| Trọng tài đã có lịch trùng thời gian | Hệ thống cảnh báo và yêu cầu chọn trọng tài khác hoặc điều chỉnh lịch theo thẩm quyền. |
| --- | --- |
| Trọng tài đã ngừng hoạt động | Hệ thống không cho phân công trọng tài đó. |
| --- | --- |
| Thay đổi trọng tài sau khi công bố | Hệ thống lưu lịch sử phân công cũ và mới, yêu cầu nhập lý do và gửi thông báo cập nhật. |
| --- | --- |

**Exception**

| **Trường hợp** | **Xử lý** |
| --- | --- |
| Lỗi lưu phân công | Hệ thống không thông báo phân công thành công nếu dữ liệu chưa được lưu. |
| --- | --- |
| Người dùng không có quyền phân công | Hệ thống từ chối thao tác. |
| --- | --- |

## **3.4.24. Xem lịch thi đấu được phân công**

| **Nội dung** | **Mô tả** |
| --- | --- |
| Tiền điều kiện | Người dùng truy cập hệ thống. Đối với lịch nội bộ, người dùng đã đăng nhập và có quyền xem lịch tương ứng. |
| --- | --- |
| Hậu điều kiện | Người dùng xem được lịch thi đấu thuộc phạm vi công khai hoặc phạm vi quyền của mình. |
| --- | --- |
| Actor chính | Trọng tài, Đại diện đội bóng, Cầu thủ, Khán giả. |
| --- | --- |
| Actor phụ | Không. |
| --- | --- |

**Basic flow**

| **Người dùng** | **Hệ thống** |
| --- | --- |
| 1\. Mở chức năng “Lịch thi đấu”. | 2\. Hiển thị lịch thi đấu được công khai hoặc thuộc phạm vi quyền của người dùng. |
| --- | --- |
| 3\. Chọn bộ lọc theo giải đấu, ngày thi đấu, đội bóng hoặc sân. | 4\. Truy vấn và hiển thị các trận phù hợp với điều kiện lọc. |
| --- | --- |
| 5\. Chọn một trận đấu. | 6\. Hiển thị tên giải, vòng đấu, hai đội, thời gian, sân, trạng thái trận và thông tin trọng tài được phép công khai. |
| --- | --- |

**Alternative flow**

| **Trường hợp** | **Xử lý** |
| --- | --- |
| Không có trận phù hợp | Hệ thống thông báo không có trận đấu phù hợp với điều kiện tìm kiếm. |
| --- | --- |
| Lịch chưa công bố | Hệ thống không hiển thị lịch nội bộ cho người không có quyền. |
| --- | --- |
| Trận bị hoãn hoặc đổi lịch | Hệ thống hiển thị trạng thái và lịch mới nhất đã được công bố. |
| --- | --- |

**Exception**

| **Trường hợp** | **Xử lý** |
| --- | --- |
| Lỗi tải lịch | Hệ thống thông báo chưa thể tải dữ liệu và cho phép thử lại. |
| --- | --- |

## **3.4.25. Ghi nhận diễn biến và kết quả trận đấu**

| **Nội dung** | **Mô tả** |
| --- | --- |
| Tiền điều kiện | Trận đấu đã có lịch và trọng tài được phân công. Trọng tài đã đăng nhập và có quyền ghi nhận trận đấu đó. |
| --- | --- |
| Hậu điều kiện | Tỷ số và diễn biến được lưu ở trạng thái Chờ xác nhận hoặc trạng thái chờ xử lý tương ứng. Kết quả chưa được sử dụng để cập nhật bảng xếp hạng chính thức trước khi được xác nhận. |
| --- | --- |
| Actor chính | Trọng tài được phân công. |
| --- | --- |
| Actor phụ | Ban tổ chức giải. |
| --- | --- |

**Basic flow**

| **Người dùng** | **Hệ thống** |
| --- | --- |
| 1\. Mở danh sách trận đấu được phân công. | 2\. Hiển thị các trận thuộc phạm vi trọng tài được phép xử lý. |
| --- | --- |
| 3\. Chọn trận đấu cần ghi nhận kết quả. | 4\. Hiển thị thông tin trận, đội tham gia, thời gian, sân và trạng thái hiện tại. |
| --- | --- |
| 5\. Nhập tỷ số đội nhà và đội khách. | 6\. Kiểm tra giá trị tỷ số là số nguyên không âm và trận đang ở trạng thái cho phép cập nhật. |
| --- | --- |
| 7\. Nhập các diễn biến cần ghi nhận như thời điểm ghi bàn, cầu thủ ghi bàn, thẻ vàng, thẻ đỏ và ghi chú trận đấu. | 8\. Kiểm tra cầu thủ được ghi nhận thuộc danh sách cầu thủ của đội trong giải; kiểm tra dữ liệu sự kiện và thời gian diễn ra sự kiện. |
| --- | --- |
| 9\. Chọn “Gửi kết quả”. | 10\. Kiểm tra tính đầy đủ của dữ liệu và yêu cầu xác nhận trước khi gửi. |
| --- | --- |
|     | 11\. Lưu tỷ số và diễn biến, chuyển trạng thái kết quả sang Chờ xác nhận, ghi nhận trọng tài nhập dữ liệu và thời điểm gửi. |
| --- | --- |
|     | 12\. Thông báo đã gửi kết quả và chuyển thông tin đến Ban tổ chức để xác nhận. |
| --- | --- |

**Alternative flow**

| **Trường hợp** | **Xử lý** |
| --- | --- |
| Tỷ số không hợp lệ | Hệ thống thông báo tỷ số phải là số nguyên không âm và yêu cầu nhập lại. |
| --- | --- |
| Cầu thủ không thuộc danh sách hợp lệ của đội | Hệ thống cảnh báo và yêu cầu kiểm tra thông tin cầu thủ trước khi lưu sự kiện. |
| --- | --- |
| Trận đã được xác nhận | Hệ thống không cho sửa trực tiếp kết quả đã xác nhận; yêu cầu quy trình điều chỉnh có thẩm quyền. |
| --- | --- |
| Trận bị hoãn hoặc hủy | Hệ thống không yêu cầu nhập kết quả thi đấu bình thường; xử lý theo nghiệp vụ hoãn, hủy hoặc quyết định hành chính. |
| --- | --- |

**Exception**

| **Trường hợp** | **Xử lý** |
| --- | --- |
| Lỗi lưu kết quả | Hệ thống không chuyển trận sang trạng thái chờ xác nhận nếu dữ liệu chưa được lưu đầy đủ. |
| --- | --- |
| Trọng tài không được phân công cho trận | Hệ thống từ chối cập nhật và ghi nhận sự kiện truy cập không hợp lệ. |
| --- | --- |

## **3.4.26. Xác nhận kết quả trận đấu**

| **Nội dung** | **Mô tả** |
| --- | --- |
| Tiền điều kiện | Kết quả trận đấu đã được trọng tài gửi và đang ở trạng thái Chờ xác nhận. Người thực hiện có quyền xác nhận kết quả. |
| --- | --- |
| Hậu điều kiện | Kết quả được xác nhận hoặc trả lại để chỉnh sửa. Chỉ kết quả đã xác nhận mới được sử dụng để cập nhật bảng xếp hạng và xác định đội đi tiếp. |
| --- | --- |
| Actor chính | Ban tổ chức giải. |
| --- | --- |
| Actor phụ | Trọng tài. |
| --- | --- |

**Basic flow**

| **Người dùng** | **Hệ thống** |
| --- | --- |
| 1\. Mở danh sách kết quả chờ xác nhận. | 2\. Hiển thị các trận có kết quả ở trạng thái Chờ xác nhận. |
| --- | --- |
| 3\. Chọn một trận đấu. | 4\. Hiển thị tỷ số, diễn biến trận đấu, cầu thủ ghi bàn, thẻ phạt và thông tin trọng tài gửi kết quả. |
| --- | --- |
| 5\. Kiểm tra kết quả và dữ liệu liên quan. | 6\. Kiểm tra tính đầy đủ, trạng thái trận đấu và các ràng buộc nghiệp vụ. |
| --- | --- |
| 7\. Chọn “Xác nhận kết quả”. | 8\. Kiểm tra quyền xác nhận và trạng thái hiện tại của kết quả. |
| --- | --- |
|     | 9\. Cập nhật trạng thái kết quả thành Đã xác nhận, ghi nhận người xác nhận và thời điểm xác nhận. |
| --- | --- |
|     | 10\. Cập nhật bảng xếp hạng và dữ liệu tiến trình giải theo thể thức đã thiết lập. |
| --- | --- |
|     | 11\. Công bố kết quả theo cấu hình hiển thị và thông báo cho các bên liên quan. |
| --- | --- |

**Alternative flow**

| **Trường hợp** | **Xử lý** |
| --- | --- |
| Kết quả có sai sót | Ban tổ chức chọn “Trả lại chỉnh sửa”, nhập lý do; hệ thống chuyển kết quả về trạng thái cần điều chỉnh và thông báo trọng tài. |
| --- | --- |
| Kết quả đã được xác nhận | Hệ thống không cho xác nhận lần nữa; mọi điều chỉnh phải qua quy trình sửa kết quả có lưu vết. |
| --- | --- |
| Dữ liệu diễn biến không đầy đủ | Hệ thống chỉ rõ dữ liệu cần bổ sung trước khi xác nhận. |
| --- | --- |

**Exception**

| **Trường hợp** | **Xử lý** |
| --- | --- |
| Lỗi cập nhật bảng xếp hạng | Hệ thống phải bảo đảm kết quả xác nhận và dữ liệu xếp hạng không bị cập nhật lệch nhau. Nếu quy trình cập nhật chưa hoàn tất, hệ thống ghi nhận trạng thái xử lý để tiếp tục hoặc khôi phục an toàn. |
| --- | --- |
| Người dùng không có quyền xác nhận | Hệ thống từ chối thao tác. |
| --- | --- |

## **3.4.27. Cập nhật bảng xếp hạng và xác định đội đi tiếp**

| **Nội dung** | **Mô tả** |
| --- | --- |
| Tiền điều kiện | Giải đã thiết lập thể thức, quy tắc tính điểm và tiêu chí xếp hạng. Có kết quả trận đấu đã được xác nhận. |
| --- | --- |
| Hậu điều kiện | Bảng xếp hạng được tính theo kết quả đã xác nhận và điều lệ giải. Đội đi tiếp được xác định khi đủ điều kiện theo thể thức. |
| --- | --- |
| Actor chính | Ban tổ chức giải. |
| --- | --- |
| Actor phụ | Khán giả, Đại diện đội bóng, Cầu thủ. |
| --- | --- |

**Basic flow**

| **Người dùng** | **Hệ thống** |
| --- | --- |
| 1\. Mở chức năng “Bảng xếp hạng”. | 2\. Hiển thị bảng xếp hạng theo giải và bảng đấu. |
| --- | --- |
| 3\. Chọn giải hoặc bảng muốn xem. | 4\. Lấy danh sách trận đã xác nhận và quy tắc tính điểm của giải. |
| --- | --- |
|     | 5\. Tính số trận, số trận thắng, hòa, thua, bàn thắng, bàn thua, hiệu số và điểm của từng đội. |
| --- | --- |
|     | 6\. Sắp xếp đội theo tiêu chí ưu tiên đã được cấu hình trong điều lệ. |
| --- | --- |
|     | 7\. Nếu kết thúc vòng đấu, xác định các đội đủ điều kiện đi tiếp theo thể thức đã thiết lập. |
| --- | --- |
|     | 8\. Hiển thị bảng xếp hạng và danh sách đội đi tiếp nếu đã đủ điều kiện xác định. |
| --- | --- |

**Alternative flow**

| **Trường hợp** | **Xử lý** |
| --- | --- |
| Chưa có kết quả được xác nhận | Hệ thống hiển thị bảng xếp hạng chưa có dữ liệu hoặc dữ liệu hiện tại chưa phát sinh điểm. |
| --- | --- |
| Có kết quả đang chờ xác nhận | Hệ thống không tính kết quả đang chờ xác nhận vào bảng xếp hạng chính thức. |
| --- | --- |
| Các đội bằng điểm | Hệ thống áp dụng lần lượt các tiêu chí phân hạng đã cấu hình trong điều lệ. |
| --- | --- |
| Kết quả được điều chỉnh hợp lệ | Hệ thống tính lại bảng xếp hạng và cập nhật đội đi tiếp nếu có thay đổi, đồng thời ghi nhận lịch sử điều chỉnh. |
| --- | --- |

**Exception**

| **Trường hợp** | **Xử lý** |
| --- | --- |
| Điều lệ chưa có tiêu chí xếp hạng cần thiết | Hệ thống cảnh báo Ban tổ chức và không tự áp dụng tiêu chí ngoài điều lệ. |
| --- | --- |
| Lỗi tính toán hoặc cập nhật | Hệ thống không công bố bảng xếp hạng mới nếu dữ liệu chưa được tính toán và lưu nhất quán. |
| --- | --- |

## **3.4.28. Ghi nhận thẻ phạt và xử lý kỷ luật**

| **Nội dung** | **Mô tả** |
| --- | --- |
| Tiền điều kiện | Trận đấu đã được tạo. Người thực hiện có quyền ghi nhận diễn biến hoặc xử lý kỷ luật. Quy định thẻ phạt và kỷ luật đã được thiết lập trong điều lệ. |
| --- | --- |
| Hậu điều kiện | Sự kiện thẻ phạt hoặc quyết định kỷ luật được lưu và liên kết với trận đấu, cầu thủ, đội bóng và giải đấu. Trạng thái treo giò được xác định theo quy định áp dụng. |
| --- | --- |
| Actor chính | Trọng tài hoặc Ban tổ chức giải theo phạm vi quyền. |
| --- | --- |
| Actor phụ | Đại diện đội bóng, nếu cần thông báo quyết định kỷ luật. |
| --- | --- |

**Basic flow**

| **Người dùng** | **Hệ thống** |
| --- | --- |
| 1\. Mở trận đấu hoặc chức năng “Kỷ luật”. | 2\. Hiển thị thông tin trận, danh sách cầu thủ và các sự kiện kỷ luật đã ghi nhận. |
| --- | --- |
| 3\. Chọn cầu thủ và loại sự kiện: thẻ vàng, thẻ đỏ hoặc quyết định kỷ luật. | 4\. Hiển thị biểu mẫu gồm **Trận đấu, Đội bóng, Cầu thủ, Loại thẻ hoặc hình thức kỷ luật, Thời điểm xảy ra, Lý do và Ghi chú**. |
| --- | --- |
| 5\. Nhập thông tin và xác nhận. | 6\. Kiểm tra cầu thủ thuộc đội trong giải, thời điểm sự kiện và quyền ghi nhận. |
| --- | --- |
|     | 7\. Lưu sự kiện thẻ phạt hoặc quyết định kỷ luật. |
| --- | --- |
|     | 8\. Đối chiếu quy định điều lệ về số thẻ, mức phạt và điều kiện treo giò. |
| --- | --- |
|     | 9\. Cập nhật trạng thái kỷ luật hoặc trạng thái treo giò nếu đủ điều kiện theo quy định. |
| --- | --- |
|     | 10\. Thông báo kết quả cho Ban tổ chức và đội liên quan theo phạm vi được phép. |
| --- | --- |

**Alternative flow**

| **Trường hợp** | **Xử lý** |
| --- | --- |
| Cầu thủ không thuộc danh sách của trận | Hệ thống từ chối ghi nhận sự kiện và yêu cầu kiểm tra cầu thủ. |
| --- | --- |
| Chưa đủ điều kiện xác định treo giò | Hệ thống lưu sự kiện nhưng chưa tạo quyết định treo giò nếu điều lệ chưa đáp ứng điều kiện. |
| --- | --- |
| Cần sửa sự kiện đã lưu | Hệ thống yêu cầu người có quyền nhập lý do, lưu lịch sử trước và sau khi sửa. |
| --- | --- |
| Cầu thủ đã có quyết định kỷ luật | Hệ thống hiển thị quyết định hiện có để tránh tạo quyết định trùng. |
| --- | --- |

**Exception**

| **Trường hợp** | **Xử lý** |
| --- | --- |
| Lỗi lưu sự kiện | Hệ thống không cập nhật trạng thái kỷ luật nếu sự kiện gốc chưa được lưu đầy đủ. |
| --- | --- |
| Người dùng không có quyền | Hệ thống từ chối thao tác. |
| --- | --- |

## **3.4.29. Gửi khiếu nại về trận đấu hoặc quyết định liên quan**

| **Nội dung** | **Mô tả** |
| --- | --- |
| Tiền điều kiện | Người gửi đã đăng nhập và có quyền đại diện đội liên quan đến giải hoặc trận đấu. Khiếu nại nằm trong phạm vi được điều lệ cho phép và còn trong thời hạn tiếp nhận. |
| --- | --- |
| Hậu điều kiện | Khiếu nại được tạo ở trạng thái Chờ xử lý, có mã hồ sơ, thời điểm gửi và tài liệu kèm theo nếu có. |
| --- | --- |
| Actor chính | Đại diện đội bóng. |
| --- | --- |
| Actor phụ | Ban tổ chức giải. |
| --- | --- |

**Basic flow**

| **Người dùng** | **Hệ thống** |
| --- | --- |
| 1\. Mở giải đấu hoặc trận đấu có liên quan. | 2\. Hiển thị chức năng khiếu nại nếu người dùng có quyền và thời hạn tiếp nhận còn hiệu lực. |
| --- | --- |
| 3\. Chọn “Gửi khiếu nại”. | 4\. Hiển thị biểu mẫu gồm **Giải đấu, Trận đấu liên quan nếu có, Đội gửi khiếu nại, Loại khiếu nại, Nội dung, Căn cứ khiếu nại và Tài liệu minh chứng**. |
| --- | --- |
| 5\. Nhập nội dung và tải tài liệu minh chứng nếu có. | 6\. Kiểm tra các trường bắt buộc, quyền đại diện đội, thời hạn khiếu nại và định dạng tệp. |
| --- | --- |
| 7\. Chọn “Gửi khiếu nại”. | 8\. Kiểm tra khiếu nại trùng lặp và các điều kiện tiếp nhận. |
| --- | --- |
|     | 9\. Tạo hồ sơ khiếu nại ở trạng thái Chờ xử lý, cấp mã hồ sơ và ghi nhận thời điểm gửi. |
| --- | --- |
|     | 10\. Thông báo tiếp nhận khiếu nại cho người gửi và Ban tổ chức. |
| --- | --- |

**Alternative flow**

| **Trường hợp** | **Xử lý** |
| --- | --- |
| Đã hết thời hạn khiếu nại | Hệ thống từ chối tiếp nhận theo quy định, trừ trường hợp điều lệ có cơ chế ngoại lệ được cấp có thẩm quyền chấp thuận. |
| --- | --- |
| Thiếu nội dung hoặc căn cứ bắt buộc | Hệ thống chỉ rõ thông tin cần bổ sung. |
| --- | --- |
| Người gửi không đại diện đội liên quan | Hệ thống từ chối gửi khiếu nại. |
| --- | --- |
| Đã có khiếu nại trùng về cùng nội dung | Hệ thống cảnh báo và hiển thị hồ sơ liên quan nếu người dùng có quyền xem. |
| --- | --- |

**Exception**

| **Trường hợp** | **Xử lý** |
| --- | --- |
| Lỗi tải tài liệu | Hệ thống thông báo tài liệu chưa được tiếp nhận và không ghi nhận hồ sơ hoàn chỉnh nếu tài liệu đó bắt buộc. |
| --- | --- |
| Lỗi lưu khiếu nại | Hệ thống không cấp trạng thái đã tiếp nhận chính thức nếu hồ sơ chưa được lưu. |
| --- | --- |

## **3.4.30. Tiếp nhận và xử lý khiếu nại**

| **Nội dung** | **Mô tả** |
| --- | --- |
| Tiền điều kiện | Ban tổ chức có quyền xử lý khiếu nại và có hồ sơ ở trạng thái Chờ xử lý hoặc Đang xử lý. |
| --- | --- |
| Hậu điều kiện | Khiếu nại được giải quyết theo quyết định có thẩm quyền. Kết quả xử lý, lý do, người xử lý và thời điểm xử lý được lưu lại. |
| --- | --- |
| Actor chính | Ban tổ chức giải. |
| --- | --- |
| Actor phụ | Đại diện đội gửi khiếu nại, các bên liên quan. |
| --- | --- |

**Basic flow**

| **Người dùng** | **Hệ thống** |
| --- | --- |
| 1\. Mở danh sách khiếu nại. | 2\. Hiển thị hồ sơ khiếu nại thuộc giải mà người dùng có quyền xử lý. |
| --- | --- |
| 3\. Chọn một hồ sơ. | 4\. Hiển thị nội dung, đội gửi, trận đấu liên quan, tài liệu minh chứng và lịch sử xử lý. |
| --- | --- |
| 5\. Kiểm tra hồ sơ và bằng chứng. | 6\. Hiển thị thông tin trận đấu, kết quả, điều lệ và dữ liệu liên quan để hỗ trợ kiểm tra. |
| --- | --- |
| 7\. Chọn “Tiếp nhận xử lý” hoặc yêu cầu bổ sung thông tin. | 8\. Cập nhật trạng thái hồ sơ và ghi nhận nội dung yêu cầu bổ sung nếu có. |
| --- | --- |
| 9\. Sau khi xem xét, chọn quyết định giải quyết và nhập lý do. | 10\. Kiểm tra quyền xử lý, nội dung quyết định và các ràng buộc liên quan. |
| --- | --- |
| 11\. Xác nhận quyết định. | 12\. Cập nhật trạng thái khiếu nại thành Đã giải quyết hoặc trạng thái kết thúc tương ứng; lưu quyết định và lịch sử xử lý. |
| --- | --- |
|     | 13\. Thông báo kết quả cho đội gửi khiếu nại và các bên có liên quan. |
| --- | --- |

**Alternative flow**

| **Trường hợp** | **Xử lý** |
| --- | --- |
| Hồ sơ chưa đủ căn cứ | Ban tổ chức yêu cầu bổ sung và hệ thống chuyển trạng thái sang Yêu cầu bổ sung. |
| --- | --- |
| Khiếu nại không có căn cứ | Ban tổ chức ghi nhận lý do và kết luận không chấp nhận khiếu nại. |
| --- | --- |
| Khiếu nại làm thay đổi kết quả trận | Hệ thống yêu cầu xử lý quyết định điều chỉnh kết quả theo quy trình riêng có lưu vết; không tự sửa tỷ số chỉ từ nội dung khiếu nại. |
| --- | --- |
| Người xử lý không có thẩm quyền | Hệ thống từ chối thao tác và không cập nhật quyết định. |
| --- | --- |

**Exception**

| **Trường hợp** | **Xử lý** |
| --- | --- |
| Lỗi lưu quyết định | Hệ thống không thông báo khiếu nại đã được giải quyết nếu quyết định chưa được lưu đầy đủ. |
| --- | --- |
| Lỗi thông báo kết quả | Hệ thống lưu trạng thái xử lý và ghi nhận việc gửi thông báo chưa hoàn tất để có thể gửi lại. |
| --- | --- |

## **3.4.31. Tra cứu đội bóng, cầu thủ và kết quả thi đấu**

| **Nội dung** | **Mô tả** |
| --- | --- |
| Tiền điều kiện | Người dùng truy cập được hệ thống. Dữ liệu được tra cứu đã được công khai hoặc nằm trong phạm vi quyền của người dùng. |
| --- | --- |
| Hậu điều kiện | Người dùng xem được thông tin phù hợp với điều kiện tìm kiếm và quyền truy cập. Dữ liệu không bị thay đổi. |
| --- | --- |
| Actor chính | Khán giả, Cầu thủ, Đại diện đội bóng. |
| --- | --- |
| Actor phụ | Không. |
| --- | --- |

**Basic flow**

| **Người dùng** | **Hệ thống** |
| --- | --- |
| 1\. Mở chức năng “Tra cứu”. | 2\. Hiển thị các loại dữ liệu có thể tra cứu: giải đấu, đội bóng, cầu thủ, lịch thi đấu, kết quả và bảng xếp hạng. |
| --- | --- |
| 3\. Chọn loại dữ liệu cần tra cứu. | 4\. Hiển thị các trường tìm kiếm phù hợp với loại dữ liệu đã chọn. |
| --- | --- |
| 5\. Nhập từ khóa hoặc chọn bộ lọc. | 6\. Kiểm tra điều kiện tìm kiếm và truy vấn dữ liệu được phép hiển thị. |
| --- | --- |
| 7\. Chọn một kết quả. | 8\. Hiển thị thông tin chi tiết đã được công khai hoặc được phép truy cập. |
| --- | --- |

**Alternative flow**

| **Trường hợp** | **Xử lý** |
| --- | --- |
| Không có kết quả | Hệ thống thông báo không tìm thấy dữ liệu phù hợp. |
| --- | --- |
| Thông tin chưa được công khai | Hệ thống không hiển thị dữ liệu nội bộ hoặc thông tin cá nhân không được phép công khai. |
| --- | --- |
| Người dùng yêu cầu dữ liệu ngoài phạm vi quyền | Hệ thống từ chối truy cập. |
| --- | --- |

**Exception**

| **Trường hợp** | **Xử lý** |
| --- | --- |
| Lỗi truy vấn | Hệ thống thông báo chưa thể thực hiện tra cứu và cho phép thử lại. |
| --- | --- |

## **3.4.32. Quản lý thông báo**

| **Nội dung** | **Mô tả** |
| --- | --- |
| Tiền điều kiện | Người dùng đã đăng nhập nếu thông báo thuộc tài khoản cá nhân. Hệ thống có sự kiện nghiệp vụ cần gửi thông báo. |
| --- | --- |
| Hậu điều kiện | Thông báo được tạo và liên kết với người nhận. Trạng thái đọc được cập nhật khi người dùng mở thông báo. |
| --- | --- |
| Actor chính | Người dùng đã đăng nhập. |
| --- | --- |
| Actor phụ | Dịch vụ email nếu loại thông báo được gửi qua email. |
| --- | --- |

**Basic flow**

| **Người dùng** | **Hệ thống** |
| --- | --- |
| 1\. Mở mục “Thông báo”. | 2\. Hiển thị danh sách thông báo thuộc tài khoản, gồm tiêu đề, nội dung tóm tắt, thời điểm gửi và trạng thái đã đọc/chưa đọc. |
| --- | --- |
| 3\. Chọn một thông báo. | 4\. Hiển thị nội dung chi tiết và liên kết đến hồ sơ hoặc nghiệp vụ liên quan nếu người dùng có quyền truy cập. |
| --- | --- |
|     | 5\. Cập nhật trạng thái thông báo thành Đã đọc. |
| --- | --- |

**Alternative flow**

| **Trường hợp** | **Xử lý** |
| --- | --- |
| Không có thông báo | Hệ thống hiển thị thông báo hiện chưa có dữ liệu. |
| --- | --- |
| Thông báo dẫn đến dữ liệu người dùng không có quyền xem | Hệ thống từ chối mở dữ liệu đích và không tiết lộ nội dung ngoài quyền. |
| --- | --- |
| Gửi email thông báo thất bại | Hệ thống ghi nhận lỗi gửi; thông báo trong hệ thống vẫn được lưu nếu đã tạo thành công. |
| --- | --- |

**Exception**

| **Trường hợp** | **Xử lý** |
| --- | --- |
| Lỗi tải danh sách thông báo | Hệ thống thông báo chưa thể tải dữ liệu và cho phép thử lại. |
| --- | --- |
| Lỗi cập nhật trạng thái đã đọc | Hệ thống hiển thị nội dung nếu người dùng có quyền, đồng thời ghi nhận trạng thái cập nhật chưa hoàn tất. |
| --- | --- |

## **3.4.33. Hoãn, đổi lịch hoặc hủy trận đấu**

| **Nội dung** | **Mô tả** |
| --- | --- |
| Tiền điều kiện | Trận đấu đã được tạo. Ban tổ chức có quyền điều chỉnh lịch và có lý do nghiệp vụ phù hợp, chẳng hạn thời tiết không bảo đảm, sân không sử dụng được hoặc thiếu trọng tài. |
| --- | --- |
| Hậu điều kiện | Trạng thái trận đấu và lịch mới được cập nhật theo quyết định. Lịch sử thay đổi được lưu và các bên liên quan được thông báo. |
| --- | --- |
| Actor chính | Ban tổ chức giải. |
| --- | --- |
| Actor phụ | Trọng tài, Đại diện đội bóng. |
| --- | --- |

**Basic flow**

| **Người dùng** | **Hệ thống** |
| --- | --- |
| 1\. Mở trận đấu cần điều chỉnh. | 2\. Hiển thị lịch hiện tại, đội tham gia, sân, trọng tài và trạng thái trận. |
| --- | --- |
| 3\. Chọn “Điều chỉnh trận đấu”. | 4\. Hiển thị các thao tác được phép theo trạng thái trận: đổi lịch, hoãn hoặc hủy. |
| --- | --- |
| 5\. Chọn thao tác và nhập lý do. | 6\. Kiểm tra quyền, trạng thái trận và nội dung lý do. |
| --- | --- |
| 7\. Nếu đổi lịch, nhập ngày, giờ và sân mới. | 8\. Kiểm tra sân, lịch của hai đội và lịch trọng tài để phát hiện xung đột. |
| --- | --- |
| 9\. Xác nhận điều chỉnh. | 10\. Cập nhật trạng thái trận và lịch mới; lưu lịch sử trước và sau thay đổi. |
| --- | --- |
|     | 11\. Gửi thông báo cho các đội, trọng tài và các bên liên quan. |
| --- | --- |

**Alternative flow**

| **Trường hợp** | **Xử lý** |
| --- | --- |
| Lịch mới bị trùng sân hoặc trùng đội | Hệ thống từ chối lưu lịch mới và yêu cầu điều chỉnh. |
| --- | --- |
| Trận đã kết thúc và kết quả đã xác nhận | Hệ thống không cho đổi lịch hoặc hủy trận theo quy trình thông thường; yêu cầu quy trình điều chỉnh có thẩm quyền nếu có căn cứ. |
| --- | --- |
| Chỉ hoãn trận nhưng chưa xác định lịch mới | Hệ thống chuyển trận sang trạng thái Hoãn, lưu lý do và để lịch mới ở trạng thái chưa xác định. |
| --- | --- |

**Exception**

| **Trường hợp** | **Xử lý** |
| --- | --- |
| Lỗi lưu thay đổi | Hệ thống giữ nguyên lịch đã lưu trước đó nếu thay đổi chưa được ghi nhận đầy đủ. |
| --- | --- |
| Lỗi gửi thông báo | Hệ thống lưu thay đổi lịch và ghi nhận thông báo chưa gửi để xử lý tiếp. |
| --- | --- |

## **3.4.34. Kết thúc giải đấu**

| **Nội dung** | **Mô tả** |
| --- | --- |
| Tiền điều kiện | Các trận đấu thuộc giải đã hoàn thành hoặc đã được xử lý theo quyết định cuối cùng; kết quả và bảng xếp hạng đã được kiểm tra. Ban tổ chức có quyền kết thúc giải. |
| --- | --- |
| Hậu điều kiện | Giải đấu chuyển sang trạng thái Đã kết thúc. Kết quả, bảng xếp hạng và dữ liệu lịch sử được giữ lại để tra cứu theo quyền. |
| --- | --- |
| Actor chính | Ban tổ chức giải. |
| --- | --- |
| Actor phụ | Khán giả, Đại diện đội bóng, Cầu thủ. |
| --- | --- |

**Basic flow**

| **Người dùng** | **Hệ thống** |
| --- | --- |
| 1\. Mở chức năng quản lý giải đấu và chọn giải cần kết thúc. | 2\. Hiển thị tình trạng giải, danh sách trận, kết quả, bảng xếp hạng, khiếu nại và các vấn đề chưa xử lý. |
| --- | --- |
| 3\. Kiểm tra dữ liệu tổng kết. | 4\. Kiểm tra các trận chưa có kết quả cuối cùng, kết quả đang chờ xác nhận, khiếu nại chưa giải quyết và các nghiệp vụ còn tồn đọng. |
| --- | --- |
| 5\. Chọn “Kết thúc giải”. | 6\. Hiển thị cảnh báo về các vấn đề chưa xử lý nếu có. |
| --- | --- |
| 7\. Xác nhận kết thúc giải. | 8\. Kiểm tra quyền và điều kiện kết thúc theo quy định của giải. |
| --- | --- |
|     | 9\. Chuyển giải sang trạng thái Đã kết thúc, ghi nhận người thực hiện và thời điểm kết thúc. |
| --- | --- |
|     | 10\. Lưu trạng thái tổng kết và cho phép tra cứu kết quả, bảng xếp hạng theo quyền được cấp. |
| --- | --- |

**Alternative flow**

| **Trường hợp** | **Xử lý** |
| --- | --- |
| Còn trận đấu chưa có kết quả cuối cùng | Hệ thống liệt kê các trận chưa hoàn tất và không cho kết thúc giải nếu chưa xử lý theo điều lệ. |
| --- | --- |
| Còn kết quả chờ xác nhận | Hệ thống yêu cầu xác nhận hoặc xử lý kết quả trước khi kết thúc giải. |
| --- | --- |
| Còn khiếu nại chưa giải quyết | Hệ thống cảnh báo và yêu cầu xử lý hoặc xác nhận ngoại lệ theo quy định có thẩm quyền. |
| --- | --- |
| Giải đã kết thúc | Hệ thống thông báo giải đã kết thúc và không thực hiện lặp thao tác. |
| --- | --- |

**Exception**

| **Trường hợp** | **Xử lý** |
| --- | --- |
| Lỗi cập nhật trạng thái giải | Hệ thống không thông báo kết thúc thành công nếu trạng thái chưa được lưu. |
| --- | --- |
| Người dùng không có quyền kết thúc giải | Hệ thống từ chối thao tác. |
| --- | --- |

# **3.5. QUY ĐỊNH TRẠNG THÁI NGHIỆP VỤ**

Để bảo đảm các Use Case vận hành thống nhất, hệ thống sử dụng trạng thái riêng cho từng đối tượng. Trạng thái dưới đây không thay thế cho vai trò hoặc quyền truy cập.

| **Đối tượng** | **Trạng thái** | **Ý nghĩa** |
| --- | --- | --- |
| Tài khoản | Chờ xác minh email | Tài khoản đã được tạo nhưng người dùng chưa xác minh email; chưa được đăng nhập. |
| --- | --- | --- |
| Tài khoản | Đang hoạt động | Email đã xác minh và tài khoản được phép đăng nhập, nếu không có hạn chế khác. |
| --- | --- | --- |
| Tài khoản | Bị khóa | Tài khoản tạm thời hoặc theo quyết định quản trị không được phép đăng nhập. |
| --- | --- | --- |
| Tài khoản | Ngừng hoạt động | Tài khoản không còn được phép sử dụng hệ thống theo quyết định có thẩm quyền. |
| --- | --- | --- |
| Giải đấu | Bản nháp | Giải đang được thiết lập; chưa công khai đăng ký. Chỉ chuyển sang Mở đăng ký khi thông tin bắt buộc và điều lệ đã được công bố. |
| --- | --- | --- |
| Giải đấu | Mở đăng ký | Đã công bố điều lệ và đang tiếp nhận hồ sơ trong thời hạn; có thể chuyển sang Đóng đăng ký khi hết hạn hoặc Ban tổ chức đóng đăng ký có lý do. |
| --- | --- | --- |
| Giải đấu | Đóng đăng ký | Không tiếp nhận hồ sơ mới; Ban tổ chức hoàn tất xét duyệt hồ sơ trước khi chốt danh sách. |
| --- | --- | --- |
| Giải đấu | Đang diễn ra | Lịch thi đấu chính thức đã được công bố và giải đã bắt đầu có trận đấu. |
| Giải đấu | Tạm dừng | Hoạt động thi đấu tạm dừng theo quyết định có thẩm quyền; phải lưu lý do và thời điểm, chỉ được tiếp tục sau khi Ban tổ chức xác nhận kế hoạch tiếp tục. |
| Giải đấu | Đã kết thúc | Các trận đã có kết quả cuối cùng hoặc quyết định xử lý hợp lệ; bảng xếp hạng/tổng kết đã được kiểm tra. Dữ liệu chỉ đọc, không sửa theo luồng thông thường. |
| Hồ sơ đăng ký | Chờ xét duyệt | Hồ sơ đã được gửi và đang chờ Ban tổ chức xử lý. |
| Hồ sơ đăng ký | Yêu cầu bổ sung | Ban tổ chức yêu cầu bổ sung thông tin hoặc minh chứng. |
| Hồ sơ đăng ký | Đã duyệt | Hồ sơ đáp ứng điều kiện và được chấp thuận. |
| Hồ sơ đăng ký | Từ chối | Hồ sơ không được chấp thuận; lý do phải được ghi nhận. |
| Hồ sơ đăng ký | Đã rút | Hồ sơ đã được rút theo quy trình được cho phép. |
| Danh sách đội/cầu thủ | Đang cập nhật | Danh sách chưa được xác nhận chính thức. |
| Danh sách đội/cầu thủ | Đã khóa | Danh sách chính thức, không được sửa trực tiếp ngoài quy trình điều chỉnh. |
| Trận đấu | Chưa diễn ra | Trận đã được tạo nhưng chưa bắt đầu. |
| Trận đấu | Đang diễn ra | Trận đang được tổ chức và ghi nhận diễn biến. |
| Trận đấu | Chờ xác nhận kết quả | Trọng tài đã gửi kết quả nhưng Ban tổ chức chưa xác nhận. |
| Trận đấu | Đã hoàn thành | Kết quả đã được xác nhận và trận đấu được xem là hoàn tất. |
| Trận đấu | Hoãn | Trận chưa diễn ra hoặc chưa thể tiếp tục và đang chờ xử lý lịch. |
| Trận đấu | Hủy | Trận bị hủy theo quyết định có thẩm quyền. |
| Khiếu nại | Chờ xử lý | Khiếu nại đã được tiếp nhận và chờ người có thẩm quyền xem xét. |
| Khiếu nại | Đang xử lý | Hồ sơ đang được kiểm tra, xác minh hoặc lấy thêm thông tin. |
| Khiếu nại | Yêu cầu bổ sung | Người gửi cần cung cấp thêm thông tin hoặc minh chứng. |
| Khiếu nại | Đã giải quyết | Đã có quyết định xử lý được ghi nhận. |
|     |

# **3.6. CÁC QUY TẮC NGHIỆP VỤ BẮT BUỘC**

1.  Người dùng phải xác minh email thành công trước khi đăng nhập. Việc gửi email thất bại không làm tài khoản tự động chuyển sang trạng thái hoạt động.
2.  Người dùng không tự cấp cho mình quyền Quản trị viên hệ thống, Ban tổ chức giải hoặc quyền đại diện trường. Các quyền này được cấp bởi người có thẩm quyền theo quy trình phân quyền.
3.  Mỗi giải đấu có điều lệ và điều kiện tham gia riêng. Hệ thống kiểm tra điều kiện dựa trên dữ liệu đã có và quy tắc được cấu hình cho giải đó.
4.  Hệ thống hỗ trợ giải nội bộ một trường và giải có sự tham gia của nhiều trường cao đẳng, đại học thuộc phạm vi dự án tại Thành phố Hồ Chí Minh.
5.  Hệ thống hỗ trợ bóng đá sân 7 và sân 11; thể thức vòng tròn, vòng bảng kết hợp loại trực tiếp và loại trực tiếp.
6.  Một cầu thủ không được đăng ký thi đấu cho hai đội khác nhau trong cùng một giải.
7.  Đội chỉ được đưa vào danh sách tham gia chính thức sau khi hồ sơ đăng ký được Ban tổ chức phê duyệt.
8.  Danh sách cầu thủ đã khóa không được sửa trực tiếp; mọi điều chỉnh phải theo quy trình được điều lệ cho phép và có lưu vết.
9.  Một sân không được bố trí hai trận trùng thời gian. Một đội không được có hai trận trùng thời gian. Trọng tài không được phân công vào các trận trùng lịch.
10. Chỉ kết quả đã được xác nhận mới được tính vào bảng xếp hạng và dùng để xác định đội đi tiếp.
11. Bảng xếp hạng phải tuân theo cách tính điểm và thứ tự tiêu chí phân hạng được công bố trong điều lệ. Hệ thống không tự áp dụng tiêu chí ngoài điều lệ.
12. Thẻ phạt, treo giò và quyết định kỷ luật phải được liên kết với cầu thủ, đội bóng, giải đấu và trận đấu liên quan; việc áp dụng kỷ luật phải theo điều lệ.
13. Khiếu nại phải được tiếp nhận và xử lý theo thời hạn, điều kiện và thẩm quyền đã công bố. Việc gửi khiếu nại không tự động làm thay đổi kết quả trận đấu.
14. Việc đổi lịch, hoãn, hủy trận, sửa kết quả hoặc thay đổi điều lệ sau khi công bố phải có người thực hiện, thời điểm, lý do và lịch sử thay đổi.
15. Thông tin công khai chỉ bao gồm dữ liệu được phép công bố. Hồ sơ cá nhân, giấy tờ minh chứng và dữ liệu nội bộ chỉ được hiển thị cho người có quyền.
16. Hệ thống không tích hợp trực tiếp với cơ sở dữ liệu của trường để tự động xác minh tình trạng sinh viên. Các trường hợp cần xác minh thực tế do người có thẩm quyền kiểm tra hồ sơ minh chứng.
17. Hệ thống không bao gồm quản lý thu phí, thanh toán trực tuyến, bán vé, chuyển nhượng cầu thủ, các môn thể thao khác hoặc giải đấu chuyên nghiệp cấp quốc gia và quốc tế.

# 3.7. PHẠM VI TRIỂN KHAI VÀ CÁC QUY ĐỊNH BỔ SUNG SAU RÀ SOÁT

## 3.7.1. Phạm vi MVP và phân kỳ triển khai

Để bảo đảm khả thi trong khuôn khổ khóa luận, phiên bản MVP tập trung vào luồng nghiệp vụ cốt lõi: (1) tài khoản, xác minh email và phân quyền; (2) trường học/đơn vị tổ chức; (3) đội bóng và danh sách cầu thủ; (4) tạo giải và công bố điều lệ; (5) đăng ký, xét duyệt và chốt danh sách; (6) chia bảng/lập lịch và phân công trọng tài; (7) ghi nhận, xác nhận kết quả; (8) bảng xếp hạng cơ bản; (9) tra cứu và thông báo cơ bản. Đây là phạm vi bắt buộc để nghiệm thu.

Các chức năng nâng cao được triển khai sau khi MVP ổn định, tùy thời gian còn lại: quản lý thẻ phạt/treo giò tự động; quy trình khiếu nại đầy đủ; xử lý nhiều loại tình huống kỷ luật; thống kê nâng cao; dashboard giám sát. Nếu không đủ thời gian, các chức năng này chỉ dừng ở mức ghi nhận thủ công và lưu quyết định, không mở rộng sang tự động hóa phức tạp.

Ngoài phạm vi: thanh toán/phí đăng ký, bán vé, chuyển nhượng cầu thủ, xác minh sinh viên qua API của trường, ứng dụng di động native, tích hợp hệ thống bên ngoài, các môn thể thao khác và giải chuyên nghiệp cấp quốc gia/quốc tế. Sản phẩm là ứng dụng web responsive.

## 3.7.2. Vòng đời giải đấu và điều kiện chuyển trạng thái

Bộ trạng thái thống nhất của giải đấu: Bản nháp, Mở đăng ký, Đóng đăng ký, Chốt danh sách, Chuẩn bị thi đấu, Đang diễn ra, Tạm dừng, Đã kết thúc, Đã hủy. Các trạng thái này áp dụng xuyên suốt yêu cầu chức năng, đặc tả Use Case, bảng trạng thái và quy tắc nghiệp vụ.

Bản nháp → Mở đăng ký: bắt buộc có tên giải, đơn vị tổ chức, phạm vi trường, thời gian, thể thức, điều lệ hợp lệ và phiên bản điều lệ đã công bố.

• Bản nháp → Mở đăng ký: bắt buộc có tên giải, đơn vị tổ chức, phạm vi trường, thời gian, thể thức, điều lệ hợp lệ và phiên bản điều lệ đã công bố.

• Mở đăng ký → Đóng đăng ký: khi hết hạn hoặc Ban tổ chức chủ động đóng đăng ký; hệ thống ngừng nhận hồ sơ mới.

• Đóng đăng ký → Chốt danh sách: mọi hồ sơ đã gửi phải có quyết định cuối cùng (đã duyệt/từ chối/đã rút); đội được chốt phải đáp ứng điều kiện tối thiểu và giới hạn của điều lệ.

• Chốt danh sách → Chuẩn bị thi đấu: danh sách đội/cầu thủ đã khóa; thể thức, bảng/nhánh, sân và phương án lịch được xác lập.

• Chuẩn bị thi đấu → Đang diễn ra: lịch chính thức đã công bố và trận đầu tiên bắt đầu. Chỉ công bố lịch chính thức khi không còn xung đột sân, đội hoặc trọng tài.

• Đang diễn ra ↔ Tạm dừng: chỉ Ban tổ chức có thẩm quyền được tạm dừng/tiếp tục, phải ghi lý do, thời điểm và thông báo các bên liên quan.

• Đang diễn ra → Đã kết thúc: tất cả trận đã có kết quả cuối cùng hoặc quyết định xử lý hợp lệ; bảng xếp hạng/tổng kết được kiểm tra; không còn vấn đề ngăn cản việc kết thúc theo điều lệ.

• Trước khi Đã kết thúc, giải có thể chuyển sang Đã hủy theo quyết định có thẩm quyền. Không cho phép hủy giải đã kết thúc qua luồng thông thường. Mọi chuyển trạng thái đều lưu người thao tác, thời điểm, trạng thái trước/sau và lý do.

## 3.7.3. Cấu hình điều lệ, tính điểm và xếp hạng

Điều lệ được lưu thành phiên bản có mã phiên bản, thời điểm công bố, người công bố và nội dung có cấu trúc. Các tham số dùng để hệ thống xử lý tự động được lưu ở các trường/bảng cấu hình riêng: điểm thắng, điểm hòa, điểm thua; danh sách tiêu chí xếp hạng có thứ tự ưu tiên; điều kiện đi tiếp; giới hạn số đội/cầu thủ; ngưỡng thẻ và số trận treo giò; thời hạn khiếu nại; cách xử lý vắng mặt/bỏ cuộc. Không dùng văn bản điều lệ tự do làm nguồn duy nhất cho phép tính tự động.

Mặc định tham khảo nếu điều lệ không cấu hình khác: thắng 3 điểm, hòa 1 điểm, thua 0 điểm. Thứ tự tiêu chí mặc định của vòng bảng: tổng điểm; hiệu số bàn thắng-bàn thua; tổng bàn thắng; kết quả đối đầu trực tiếp giữa các đội bằng điểm (nếu áp dụng được); sau đó là tiêu chí bổ sung do Ban tổ chức công bố trước khi mở đăng ký. Thứ tự này phải được lưu thành cấu hình theo giải, không hard-code cố định trong chương trình. Khi có nhiều đội bằng điểm, hệ thống áp dụng lần lượt đúng thứ tự đã công bố. Với tiêu chí đối đầu trực tiếp, chỉ sử dụng các trận đã diễn ra và có kết quả cuối cùng giữa đúng nhóm đội đang bằng điểm; nếu thiếu dữ liệu trận đấu cần thiết hoặc chưa đủ cơ sở so sánh, bỏ qua tiêu chí đối đầu và chuyển sang tiêu chí tiếp theo trong điều lệ.

Khi sửa điều lệ sau khi đã mở đăng ký, hệ thống tạo phiên bản mới và yêu cầu Ban tổ chức ghi lý do, phạm vi ảnh hưởng, thời điểm hiệu lực. Mọi đội đã nộp hồ sơ và người dùng liên quan phải được thông báo. Nếu thay đổi ảnh hưởng điều kiện tham gia, thể thức, tính điểm hoặc quyền lợi thi đấu sau khi giải đã bắt đầu, không tự áp dụng hồi tố; cần quyết định của người có thẩm quyền, lưu xác nhận và chỉ áp dụng theo phạm vi/thời điểm được ghi nhận. Phiên bản cũ vẫn được giữ để đối chiếu.

## 3.7.4. Kiểm tra xung đột lịch và quản lý sân

Mỗi sân có mã định danh, tên sân, địa điểm, loại sân (7 người/11 người), trạng thái (Đang hoạt động/Bảo trì/Ngừng sử dụng), thông tin liên hệ và ghi chú. Chỉ sân Đang hoạt động, phù hợp loại sân của giải và nằm trong phạm vi giải mới được chọn lập lịch. Sân Bảo trì hoặc Ngừng sử dụng không được phân công trận trong khoảng thời gian tương ứng. MVP chỉ cần quản lý thông tin sân, trạng thái và kiểm tra xung đột; không quản lý đặt sân độc lập hoặc thanh toán sân.

Một trận có khoảng thời gian từ giờ bắt đầu đến giờ kết thúc dự kiến. Hai trận bị xem là xung đột khi khoảng thời gian giao nhau trên cùng sân, hoặc có đội/trọng tài trùng trong các khoảng thời gian đó. Với cùng một đội, khoảng cách giữa giờ kết thúc trận trước và giờ bắt đầu trận sau phải tối thiểu 30 phút; Ban tổ chức có thể đặt mức nghỉ cao hơn theo điều lệ, không được thấp hơn mức tối thiểu của hệ thống. Không cho phép “chồng lấn nhẹ”. Việc kiểm tra phải chạy lại ở phía máy chủ khi lưu và khi công bố lịch để tránh hai thao tác đồng thời tạo lịch xung đột.

## 3.7.5. Xử lý vắng mặt, bỏ cuộc và xử thua

Bổ sung Use Case nghiệp vụ “Ghi nhận đội vắng mặt/bỏ cuộc và quyết định xử lý kết quả”. Trọng tài hoặc Ban tổ chức ghi nhận trận, đội liên quan, thời điểm, tình trạng thực tế và minh chứng/biên bản nếu có. Ban tổ chức có thẩm quyền đối chiếu điều lệ, nhập quyết định (đá lại, hoãn, xử thua, công nhận kết quả hoặc phương án khác được điều lệ cho phép), tỷ số xử lý nếu áp dụng, lý do và người phê duyệt. Hệ thống không tự gán tỷ số xử thua chung cho mọi giải.

Sau khi quyết định được xác nhận, trận được cập nhật trạng thái/kết quả theo quyết định; lịch sử quyết định được lưu và các đội liên quan được thông báo. Chỉ kết quả cuối cùng đã được xác nhận mới tác động đến bảng xếp hạng. Nếu quyết định chưa được phê duyệt hoặc đang có khiếu nại chưa đủ điều kiện kết luận, hệ thống đánh dấu chờ xử lý và không cập nhật bảng xếp hạng chính thức.

## 3.7.6. Kiểm tra tư cách cầu thủ và phân biệt tác nhân với vai trò dữ liệu

Hệ thống không kết nối trực tiếp với cơ sở dữ liệu của trường. Đại diện đội nộp thông tin và minh chứng theo điều lệ; Ban tổ chức kiểm tra thủ công, ghi nhận trạng thái “Chưa kiểm tra/Đạt/Không đạt”, người kiểm tra, thời điểm và lý do. Tài liệu minh chứng chỉ hiển thị cho người có quyền; không công khai trên trang tra cứu.

“Người dùng chưa có tài khoản” và “Người dùng đã đăng nhập” là tác nhân theo ngữ cảnh Use Case, không phải vai trò phân quyền được lưu riêng. Vai trò nghiệp vụ được lưu độc lập (Quản trị viên, Ban tổ chức, Đại diện trường/đơn vị tổ chức, Đại diện đội bóng, Cầu thủ, Trọng tài); Khán giả có thể tra cứu dữ liệu công khai và không bắt buộc có tài khoản. Mỗi thao tác được kiểm tra đồng thời theo vai trò, phạm vi giải/trường/đội và trạng thái đối tượng.

## 3.7.7. Yêu cầu bảo mật, dữ liệu, vận hành và sao lưu

• Phiên xác thực: sử dụng JWT access token thời hạn ngắn (mục tiêu 15 phút) và refresh token có cơ chế thu hồi; refresh token được lưu an toàn, không đặt trong localStorage nếu có thể tránh. Khi đăng xuất, đổi mật khẩu, khóa tài khoản hoặc thu hồi quyền, refresh token/phiên liên quan phải bị vô hiệu hóa. Nếu triển khai cookie xác thực, áp dụng HttpOnly, Secure, SameSite phù hợp và biện pháp chống CSRF.

• Nhật ký kiểm toán ghi tối thiểu: người thực hiện, vai trò/phạm vi, thời điểm, hành động, đối tượng bị tác động, giá trị trước/sau ở mức cần thiết, lý do và kết quả. Không ghi mật khẩu, token, mã xác minh hoặc nội dung tài liệu cá nhân vào log. Log phải được giới hạn quyền xem.

• Dữ liệu cá nhân chỉ thu thập ở mức cần thiết cho tài khoản, đội và giải; chỉ người có quyền mới xem được. Cho phép cập nhật thông tin hợp lệ và quy trình xử lý yêu cầu chỉnh sửa/ngừng sử dụng dữ liệu theo chính sách của đơn vị triển khai và quy định pháp luật Việt Nam hiện hành. Thời hạn lưu hồ sơ và minh chứng phải do đơn vị vận hành quy định; đồ án không tuyên bố đạt chứng nhận tuân thủ pháp lý.

• Sao lưu cơ sở dữ liệu tối thiểu mỗi ngày trong môi trường triển khai thử nghiệm; giữ tối thiểu 7 bản sao gần nhất. Tài liệu nộp kèm mô tả cách khôi phục và phải kiểm thử khôi phục ít nhất một lần. Mục tiêu tham khảo: RPO không quá 24 giờ và RTO không quá 4 giờ trong môi trường thử nghiệm.

• Monitoring tối thiểu ghi nhận trạng thái dịch vụ, lỗi API, lỗi gửi email, thời gian phản hồi và dung lượng lưu trữ. Có health check cho các dịch vụ chính; khi dịch vụ lỗi, không được trả về thông báo thành công giả. Dữ liệu log/monitoring không chứa bí mật xác thực.

• Kiểm thử khả năng truy cập ở mức cơ bản: thao tác bằng bàn phím, nhãn trường nhập, thông báo lỗi có nội dung, độ tương phản dễ đọc và giao diện không phụ thuộc duy nhất vào màu sắc.

## 3.7.8. Các tiêu chí nghiệm thu MVP

• Tài khoản chỉ đăng nhập sau khi xác minh email; phân quyền được kiểm tra ở máy chủ.

• Ban tổ chức tạo giải, công bố điều lệ phiên bản đầu và mở đăng ký khi đủ điều kiện.

• Đội gửi hồ sơ, được xét duyệt và đưa vào danh sách chính thức; danh sách đã khóa không thể sửa trực tiếp.

• Ban tổ chức tạo bảng/nhánh, lập lịch và công bố lịch không có xung đột sân, đội hoặc trọng tài.

• Trọng tài gửi kết quả; Ban tổ chức xác nhận; chỉ kết quả chính thức mới cập nhật bảng xếp hạng.

• Người dùng tra cứu được giải, lịch, kết quả và bảng xếp hạng công khai; dữ liệu cá nhân và minh chứng không bị lộ.

• Các thao tác quan trọng có audit log; có tài liệu mô tả sao lưu, khôi phục và kết quả kiểm thử hiệu năng.

Bảng trạng thái chuẩn dưới đây là bảng tham chiếu chính thức; nếu bảng trạng thái trước đó có cách gọi khác thì áp dụng bảng này và cập nhật các sơ đồ/Use Case khi hoàn thiện tài liệu.

|     |     |     |
| --- | --- | --- |
| Trạng thái giải đấu | Điều kiện vào trạng thái | Điều kiện/ràng buộc khi rời trạng thái |
| Bản nháp | Giải vừa được tạo. | Chỉ mở đăng ký khi đủ dữ liệu bắt buộc và điều lệ đã công bố. |
| Mở đăng ký | Điều lệ và thông tin công khai hợp lệ. | Đóng khi hết hạn hoặc Ban tổ chức đóng có lý do; tiếp nhận hồ sơ mới trong trạng thái này. |
| Đóng đăng ký | Hết hạn hoặc Ban tổ chức chủ động đóng. | Không nhận hồ sơ mới; phải xử lý hết hồ sơ đã gửi trước khi chốt danh sách. |
| Chốt danh sách | Các hồ sơ đã có quyết định cuối cùng; đội hợp lệ được chọn. | Khóa danh sách đội/cầu thủ; chỉnh sửa chỉ qua quy trình ngoại lệ có lý do và lưu vết. |
| Chuẩn bị thi đấu | Danh sách đã khóa; đang hoàn tất bảng/nhánh, lịch, sân và trọng tài. | Chỉ chuyển sang Đang diễn ra khi lịch chính thức được công bố và trận đầu bắt đầu. |
| Đang diễn ra | Đã bắt đầu thi đấu. | Có thể Tạm dừng hoặc Đã kết thúc theo điều kiện được quy định. |
| Tạm dừng | Ban tổ chức có thẩm quyền tạm dừng và ghi lý do. | Chỉ tiếp tục khi có quyết định tiếp tục và kế hoạch thi đấu được cập nhật/thông báo. |
| Đã kết thúc | Mọi trận có kết quả cuối cùng hoặc quyết định hợp lệ; bảng tổng kết được kiểm tra. | Trạng thái kết thúc; chỉ tra cứu, không sửa qua luồng thông thường. |
| Đã hủy | Có quyết định hủy của người có thẩm quyền trước khi giải kết thúc. | Bắt buộc lưu lý do, người quyết định và thời điểm; không tiếp tục giải đã hủy. |

## 3.7.9. Bảng tóm tắt điều kiện chuyển trạng thái giải đấu

Bảng dưới đây dùng để đối chiếu khi thiết kế API, kiểm tra quyền và viết kiểm thử. Mọi chuyển trạng thái phải được kiểm tra tại máy chủ; không chỉ dựa vào nút/ẩn hiện trên giao diện.

|     |     |     |     |
| --- | --- | --- | --- |
| Trạng thái hiện tại | Trạng thái đích | Điều kiện bắt buộc | Người/tiến trình được phép |
| Bản nháp | Mở đăng ký | Đủ thông tin bắt buộc; điều lệ hợp lệ đã được công bố; thời gian đăng ký hợp lệ. | Ban tổ chức được phân công cho giải |
| Mở đăng ký | Đóng đăng ký | Đến hạn hoặc có quyết định đóng đăng ký; ngừng nhận hồ sơ mới. | Ban tổ chức được phân công; hệ thống có thể tự đóng khi đến hạn |
| Đóng đăng ký | Chốt danh sách | Mọi hồ sơ đã gửi có quyết định cuối cùng; số đội hợp lệ đáp ứng điều lệ; danh sách cầu thủ đã được kiểm tra. | Ban tổ chức được phân công cho giải |
| Chốt danh sách | Chuẩn bị thi đấu | Danh sách đã khóa; thể thức/bảng/nhánh được xác lập; có phương án lịch, sân và trọng tài hợp lệ. | Ban tổ chức được phân công cho giải |
| Chuẩn bị thi đấu | Đang diễn ra | Lịch chính thức đã công bố; trận đầu tiên bắt đầu/được xác nhận bắt đầu. | Ban tổ chức; người có quyền ghi nhận bắt đầu trận |
| Đang diễn ra | Tạm dừng | Có lý do và quyết định tạm dừng; lưu người quyết định, thời điểm và thông báo liên quan. | Ban tổ chức có thẩm quyền |
| Tạm dừng | Đang diễn ra | Có quyết định tiếp tục; lịch/kế hoạch cập nhật đã được kiểm tra và thông báo. | Ban tổ chức có thẩm quyền |
| Đang diễn ra | Đã kết thúc | Tất cả trận có kết quả cuối cùng hoặc quyết định xử lý hợp lệ; bảng tổng kết đã kiểm tra. | Ban tổ chức có thẩm quyền |
| Trạng thái trước Đã kết thúc | Đã hủy | Có quyết định hủy và lý do; lưu người quyết định, thời điểm và thông báo. | Ban tổ chức có thẩm quyền |

## 3.7.10. Đồng thời và toàn vẹn dữ liệu cho thao tác quan trọng

Các thao tác Chốt danh sách, Công bố lịch thi đấu và Xác nhận kết quả phải chống ghi đè khi nhiều người thao tác đồng thời. MVP ưu tiên optimistic locking bằng trường version/updated_at: khi đọc dữ liệu, client giữ phiên bản hiện tại; khi ghi, máy chủ chỉ cập nhật nếu phiên bản chưa thay đổi. Nếu dữ liệu đã được người khác cập nhật, máy chủ từ chối lần ghi cũ, trả thông báo xung đột để người dùng tải lại và xác nhận lại thao tác. Với thao tác ảnh hưởng nhiều bản ghi (ví dụ khóa danh sách hoặc công bố lịch), thực hiện trong transaction và kiểm tra lại điều kiện nghiệp vụ ngay trước khi commit. Không coi việc khóa nút trên giao diện là biện pháp đủ.

## 3.7.11. Rate limiting và chống thử sai

Các ngưỡng dưới đây là giá trị khởi đầu để cấu hình và kiểm thử, không phải giới hạn cố định của mọi môi trường: (1) gửi lại email xác minh tối đa 3 lần trong 15 phút cho mỗi email; (2) đăng nhập sai tối đa 5 lần trong 15 phút cho mỗi tài khoản, sau đó áp dụng thời gian chờ tăng dần hoặc yêu cầu xác minh bổ sung; (3) yêu cầu đặt lại mật khẩu tối đa 3 lần trong 15 phút cho mỗi email; (4) API công khai tra cứu có giới hạn theo IP/người dùng, ngưỡng cụ thể được cấu hình theo tải thử nghiệm. Hệ thống phải trả thông báo chung, không tiết lộ email/tài khoản có tồn tại hay không; ghi nhận sự kiện an ninh nhưng không ghi mã xác minh, mật khẩu hoặc token vào log.

## 3.7.12. Rà soát trạng thái trong các Use Case 3.4.x

Khi hoàn thiện đặc tả và sơ đồ, các Use Case trọng yếu phải dùng đúng bộ trạng thái chuẩn tại mục 3.7.2 và bảng trạng thái chuẩn: UC 3.4.20 “Khóa danh sách đội tham gia giải” là thao tác chuyển giải sang Chốt danh sách; UC 3.4.21 và UC 3.4.22 chỉ thực hiện khi giải ở Chốt danh sách hoặc Chuẩn bị thi đấu theo bước nghiệp vụ; UC 3.4.22 chỉ cho phép Công bố lịch khi không có xung đột và chuyển/duy trì trạng thái Chuẩn bị thi đấu; UC 3.4.26 chỉ xác nhận kết quả cuối cùng khi người xác nhận có quyền và dữ liệu chưa bị thay đổi bởi phiên cập nhật khác; UC 3.4.33 khi hoãn/đổi lịch phải kiểm tra xung đột lại và thông báo; UC 3.4.34 chỉ cho phép kết thúc khi đủ điều kiện, không dùng “kết thúc” thay cho “tạm dừng” hoặc “hủy”. Nếu mô tả cũ ở các UC này dùng tên trạng thái khác, thay bằng bộ tên chuẩn: Bản nháp, Mở đăng ký, Đóng đăng ký, Chốt danh sách, Chuẩn bị thi đấu, Đang diễn ra, Tạm dừng, Đã kết thúc, Đã hủy.

## 3.7.13. Kịch bản kiểm thử bắt buộc cho MVP

Ngoài kiểm thử luồng thành công (happy path), cần có tối thiểu các kịch bản sau. Mỗi kiểm thử ghi rõ dữ liệu đầu vào, vai trò thực hiện, kết quả mong đợi và bằng chứng/log:

Tài khoản chưa xác minh email đăng nhập: bị từ chối; tài khoản đã xác minh và đang hoạt động đăng nhập thành công.

• Tài khoản chưa xác minh email đăng nhập: bị từ chối; tài khoản đã xác minh và đang hoạt động đăng nhập thành công.

• Người dùng không đúng vai trò hoặc ngoài phạm vi giải/trường/đội gọi API trực tiếp: bị từ chối ở máy chủ.

• Đội gửi đăng ký trùng cùng giải: hệ thống ngăn hồ sơ trùng hoặc xử lý theo quy tắc đã công bố; không tạo hai bản ghi hợp lệ.

• Hai trận trùng sân, trùng đội hoặc trùng trọng tài; sân đang bảo trì/ngừng sử dụng hoặc sai loại sân: không cho lưu/công bố lịch.

• Hai người cùng chốt danh sách, công bố lịch hoặc xác nhận kết quả: chỉ một phiên bản hợp lệ được ghi; phiên bản cũ nhận lỗi xung đột và phải tải lại.

• Kết quả mới nhập nhưng chưa được xác nhận: không ảnh hưởng bảng xếp hạng chính thức; sau khi xác nhận hợp lệ thì bảng xếp hạng được cập nhật đúng.

• Hai hoặc nhiều đội bằng điểm: hệ thống áp dụng đúng thứ tự tiêu chí đã cấu hình; thiếu dữ liệu đối đầu thì bỏ qua tiêu chí này.

• Đội vắng mặt/bỏ cuộc hoặc kết quả đang chờ phê duyệt: không tự áp dụng tỷ số xử thua mặc định; bảng xếp hạng chỉ đổi sau quyết định cuối cùng được xác nhận.

• Chuyển trạng thái không hợp lệ (ví dụ Bản nháp sang Đang diễn ra, hoặc Đã kết thúc sang Đã hủy): máy chủ từ chối và ghi nhận sự kiện cần thiết.

• Rate limiting: gửi email xác minh/đăng nhập sai vượt ngưỡng tham khảo thì yêu cầu bị giới hạn; thông báo không tiết lộ tài khoản có tồn tại hay không.

• Kiểm tra dữ liệu cá nhân và minh chứng cầu thủ: người không có quyền không thể xem qua giao diện hoặc API.

• Kiểm thử hiệu năng theo mục tiêu NFR đã nêu và thử khôi phục một bản sao lưu; ghi lại kết quả thực tế, không chỉ mô tả kế hoạch.