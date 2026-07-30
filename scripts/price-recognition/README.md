# Offline Price Recognition Prototype

This is a local review tool. It does not call a hosted OCR service, update the
catalog, or publish anything.

## Install

```powershell
python -m pip install -r scripts/price-recognition/requirements.txt
```

## Run

```powershell
python scripts/price-recognition/recognize_prices.py image-1.jpg image-2.png --pretty
```

專案內建的完整圖片庫流程：

```powershell
npm run prices:setup
npm run prices:scan -- --workers 8
npm run prices:classify
```

掃描結果寫入 `price-recognition-report.json`，分類摘要寫入
`price-recognition-summary.json`。兩者都是本機內部檔案，不提交 Git，來源資料夾名稱也不會傳到公開網站。

The command prints a JSON array with one record per image:

```json
{
  "image": "image-1.jpg",
  "price": 1280,
  "confidence": 0.91,
  "candidates": [],
  "reason": "Selected 1280 from contrast OCR; evidence=label+currency."
}
```

`price` remains `null` when no candidate reaches `--min-confidence` (default
`0.62`). The `candidates` array is retained for human review.

## Recognition approach

- RapidOCR runs locally through ONNX Runtime, with no API key or paid service.
- OpenCV runs the original image, grayscale, local-contrast, adaptive-threshold,
  and inverted-threshold variants. This is intended to tolerate different
  fonts and light/dark/color backgrounds.
- Price labels (for example `售價`, `價格`, `NT$`) are ranked above unlabelled
  numbers so account statistics are less likely to be selected.
- Large centered number geometry is ranked above the small statistics at the
  left, top, right and bottom of the game screenshot.
- Decimal overlays such as `14.0` and `3.85` are treated as ten-thousand-unit
  prices (`140000` and `38500`). Text-only overlays such as `自開` and `貼換`
remain in the review queue instead of being assigned a guessed price.

## Supplier price styles

`npm run prices:scan` automatically loads `config/price-style-registry.json`
when it exists. Each confirmed fingerprint is grouped by supplier and a stable
style id such as `supplier-1-style-01`. The recognizer uses the matching
supplier's measured overlay position and size as a ranking hint; it still leaves
low-confidence images for review.

Generate or refresh the registry after reviewing an OCR report:

```powershell
npm run prices:styles -- price-recognition-report.json .sync-staging\priced-catalog.json
```

To introduce another visual style, add representative hashes to the private
`config/price-style-overrides.json` file using the format shown in
`config/price-style-overrides.example.json`, then rebuild the registry. Existing
sample assignments are preserved between rebuilds.

Use `--text '價格 888'` to exercise only the candidate-ranking stage without
installing OCR dependencies.
