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

若要掃描一個指定的圖片資料夾，可使用通用掃描工具：

```powershell
npm run prices:setup
$env:AOV_IMAGE_DIR = 'C:\\path\\to\\images'
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

## Cloud catalog workflow

This utility is optional and only produces a review report from images supplied
by the operator. It does not connect to a local account database, local folders,
or the hosted catalog. After manual review, `npm run prices:fingerprints`
can generate generic SHA-256 price fingerprints for an administrator to apply
to the cloud D1 database.

Use `--text '價格 888'` to exercise only the candidate-ranking stage without
installing OCR dependencies.
