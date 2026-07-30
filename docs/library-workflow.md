# 帳號圖片庫同步

本機圖片庫預設位於目前使用者家目錄下的 `AOVAccountLibrary`。建議使用 `AOV_LIBRARY_DIR` 指定自己的實際路徑；子資料夾只供本機分類，名稱不會送到網站或顯示給買家。

## 環境變數

```powershell
$env:AOV_API_URL = 'https://your-project.pages.dev'
$env:AOV_ADMIN_USERNAME = '<管理員帳號>'
$env:AOV_ADMIN_PASSWORD = '<管理員密碼>'
```

也可以用短效的 `AOV_ADMIN_TOKEN` 取代帳號與密碼。請勿將密碼或 token 寫入 Git。

## 新增

先預覽，不會修改網站或檔案：

```powershell
npm run library -- add --file 'C:\incoming\account.jpg' --category '供應來源' --price 2500 --status available --dry-run
```

確認後執行：

```powershell
npm run library -- add --file 'C:\incoming\account.jpg' --category '供應來源' --price 2500 --status available
```

圖片會先成功建立網站商品，再複製到本機圖片庫。相同圖片重複執行不會重複上架。

## 移除

```powershell
npm run library -- remove --file 'C:\AOVAccountLibrary\供應來源\account.jpg' --dry-run
npm run library -- remove --file 'C:\AOVAccountLibrary\供應來源\account.jpg'
```

移除時會先將網站商品軟刪除並刪除雲端圖片，全部成功後才刪除本機檔案。操作前建議先使用 `--dry-run`。

## Codex 日常操作

之後可直接提供圖片並說明「新增、價格、是否上架」或指出既有圖片說「移除」。Codex 會先預覽操作、確認對應商品，再執行網站與本機圖片庫同步；本機分類名稱不會公開。
