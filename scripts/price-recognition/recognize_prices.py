#!/usr/bin/env python3
"""Offline price OCR prototype for account-card images.

The script deliberately keeps recognition separate from the storefront. It emits
one JSON object per supplied image, allowing a caller to review candidates
before copying a price into the catalog.
"""

from __future__ import annotations

import argparse
from concurrent.futures import ProcessPoolExecutor, as_completed
import json
import math
import re
import sys
import unicodedata
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable


MIN_PRICE = 300
MAX_PRICE = 500_000
DEFAULT_MIN_CONFIDENCE = 0.72
_OCR_RUNTIME: tuple[Any, Any] | None = None
LABEL_RE = re.compile(r"(?P<label>售價|價格|價錢|PRICE)\s*[:：]?\s*(?P<currency>NT\s?\$|NTD|TWD|USD|\$)?\s*(?P<amount>\d(?:[\d,\s]*\d)?)", re.IGNORECASE)
CURRENCY_RE = re.compile(r"(?P<currency>NT\s?\$|NTD|TWD|USD|\$)\s*(?P<amount>\d(?:[\d,\s]*\d)?)", re.IGNORECASE)
BARE_NUMBER_RE = re.compile(r"(?<!\d)(?P<amount>\d{3,8})(?!\d)")
DECIMAL_WAN_RE = re.compile(r"(?<!\d)(?P<amount>\d{1,2}[.,]\d{1,2})(?!\d)")
PRICE_WORD_RE = re.compile(r"售價|價格|價錢|PRICE|NT\s?\$|NTD|TWD|USD|\$", re.IGNORECASE)


@dataclass(frozen=True)
class OcrToken:
    text: str
    confidence: float
    variant: str
    center_x: float = 0.5
    center_y: float = 0.5
    width: float = 0.0
    height: float = 0.0


def clamp(value: float, lower: float = 0.0, upper: float = 1.0) -> float:
    return max(lower, min(upper, value))


def normalized_text(value: str) -> str:
    return unicodedata.normalize("NFKC", value).strip()


def parse_amount(value: str) -> int | None:
    digits = re.sub(r"[^0-9]", "", normalized_text(value))
    if not digits:
        return None
    amount = int(digits)
    return amount if MIN_PRICE <= amount <= MAX_PRICE else None


def candidate_score(evidence: str, token: OcrToken, neighbor_is_price: bool) -> tuple[float, float]:
    # Context dominates: game-stat numbers should not outrank an explicitly priced item.
    context_score = {"label+currency": 0.68, "label": 0.62, "currency": 0.51, "neighbor": 0.47, "decimal-wan": 0.34, "number": 0.24}[evidence]
    score = context_score + 0.30 * clamp(token.confidence) + (0.04 if evidence == "label+currency" else 0.0)
    if neighbor_is_price:
        score += 0.08
    if evidence in {"number", "decimal-wan"}:
        # Prices are intentionally overlaid as large text around the middle of
        # these account cards. Game statistics cluster at the left/top/bottom.
        size_score = clamp((token.height - 0.025) / 0.075)
        width_score = clamp((token.width - 0.08) / 0.22)
        horizontal_score = clamp(1.0 - abs(token.center_x - 0.5) / 0.42)
        vertical_score = clamp(1.0 - abs(token.center_y - 0.38) / 0.38)
        score += 0.24 * size_score + 0.08 * width_score + 0.08 * horizontal_score + 0.06 * vertical_score
        if token.center_x < 0.30 or token.center_y < 0.10 or token.center_y > 0.72:
            score -= 0.20
    return clamp(score), context_score


def token_candidates(tokens: Iterable[OcrToken]) -> list[dict[str, Any]]:
    token_list = list(tokens)
    candidates: list[dict[str, Any]] = []

    for index, token in enumerate(token_list):
        text = normalized_text(token.text)
        if not text:
            continue
        neighbors = " ".join(
            normalized_text(token_list[position].text)
            for position in (index - 1, index + 1)
            if 0 <= position < len(token_list)
        )
        neighbor_is_price = bool(PRICE_WORD_RE.search(neighbors))
        matches: list[tuple[re.Match[str], str]] = []
        matches.extend((match, "label+currency" if match.group("currency") else "label") for match in LABEL_RE.finditer(text))
        matches.extend((match, "currency") for match in CURRENCY_RE.finditer(text))

        decimal_matches = list(DECIMAL_WAN_RE.finditer(text)) if not matches else []

        # A bare number is useful only as a review candidate. It becomes stronger
        # when an adjacent OCR line contains a price label or currency marker.
        if not matches:
            matches.extend((match, "neighbor" if neighbor_is_price else "number") for match in BARE_NUMBER_RE.finditer(text))

        for match, evidence in matches:
            amount = parse_amount(match.group("amount"))
            if amount is None:
                continue
            score, context_score = candidate_score(evidence, token, neighbor_is_price)
            candidates.append({
                "value": amount,
                "text": text,
                "ocrConfidence": round(clamp(token.confidence), 3),
                "contextScore": round(context_score, 3),
                "score": round(score, 3),
                "evidence": evidence,
                "variant": token.variant,
                "geometry": {"x": round(token.center_x, 3), "y": round(token.center_y, 3), "width": round(token.width, 3), "height": round(token.height, 3)},
            })
        for match in decimal_matches:
            amount = round(float(match.group("amount").replace(",", ".")) * 10_000)
            if not MIN_PRICE <= amount <= MAX_PRICE:
                continue
            score, context_score = candidate_score("decimal-wan", token, neighbor_is_price)
            candidates.append({
                "value": amount,
                "text": text,
                "ocrConfidence": round(clamp(token.confidence), 3),
                "contextScore": round(context_score, 3),
                "score": round(score, 3),
                "evidence": "decimal-wan",
                "variant": token.variant,
                "geometry": {"x": round(token.center_x, 3), "y": round(token.center_y, 3), "width": round(token.width, 3), "height": round(token.height, 3)},
            })
    return candidates


def style_similarity(candidate: dict[str, Any], styles: list[dict[str, Any]]) -> tuple[str | None, float]:
    geometry = candidate.get("geometry")
    if not geometry:
        return None, 0.0
    best_id: str | None = None
    best_similarity = 0.0
    for style in styles:
        signature = style.get("signature", {})
        target = signature.get("geometry")
        if not target or int(signature.get("measuredSamples", 0)) < 3:
            continue
        distance = math.sqrt(
            ((geometry["x"] - target["x"]) / 0.25) ** 2
            + ((geometry["y"] - target["y"]) / 0.20) ** 2
            + ((geometry["height"] - target["height"]) / 0.10) ** 2
        )
        similarity = math.exp(-(distance ** 2))
        if similarity > best_similarity:
            best_id = style.get("id")
            best_similarity = similarity
    return best_id, best_similarity


def merge_candidates(candidates: Iterable[dict[str, Any]], styles: list[dict[str, Any]] | None = None) -> list[dict[str, Any]]:
    best_by_value: dict[int, dict[str, Any]] = {}
    variants_by_value: dict[int, set[str]] = {}
    for candidate in candidates:
        variants_by_value.setdefault(candidate["value"], set()).add(candidate["variant"])
        existing = best_by_value.get(candidate["value"])
        if existing is None or candidate["score"] > existing["score"]:
            best_by_value[candidate["value"]] = dict(candidate)
    for value, candidate in best_by_value.items():
        candidate["variantCount"] = len(variants_by_value[value])
        candidate["score"] = round(clamp(candidate["score"] + min(0.12, 0.03 * (candidate["variantCount"] - 1))), 3)
        style_id, similarity = style_similarity(candidate, styles or [])
        if style_id and similarity >= 0.20:
            candidate["styleId"] = style_id
            candidate["styleSimilarity"] = round(similarity, 3)
            candidate["score"] = round(clamp(candidate["score"] + 0.12 * similarity), 3)
    return sorted(best_by_value.values(), key=lambda candidate: (-candidate["score"], candidate["value"]))


def result_from_tokens(image: str, tokens: Iterable[OcrToken], min_confidence: float, styles: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    candidates = merge_candidates(token_candidates(tokens), styles)
    if not candidates:
        return {"image": image, "price": None, "confidence": 0.0, "candidates": [], "reason": "No price-like number was found."}

    best = candidates[0]
    confidence = best["score"]
    if confidence < min_confidence:
        return {
            "image": image,
            "price": None,
            "confidence": confidence,
            "candidates": candidates,
            "reason": f"Best candidate {best['value']} is below the review threshold ({min_confidence:.2f}); evidence={best['evidence']}.",
        }
    return {
        "image": image,
        "price": best["value"],
        "confidence": confidence,
        "candidates": candidates,
        "styleId": best.get("styleId"),
        "reason": f"Selected {best['value']} from {best['variant']} OCR; evidence={best['evidence']}.",
    }


def load_ocr_dependencies() -> tuple[Any, Any]:
    try:
        import cv2  # type: ignore[import-not-found]
        from rapidocr_onnxruntime import RapidOCR  # type: ignore[import-not-found]
    except ImportError as error:
        raise RuntimeError("OpenCV/RapidOCR is unavailable. Install with: python -m pip install -r scripts/price-recognition/requirements.txt") from error
    return cv2, RapidOCR


def image_variants(cv2: Any, image_path: Path) -> list[tuple[str, Any]]:
    import numpy as np
    image = cv2.imdecode(np.fromfile(str(image_path), dtype=np.uint8), cv2.IMREAD_COLOR)
    if image is None:
        raise RuntimeError("The image could not be opened by OpenCV.")
    height, width = image.shape[:2]
    if max(height, width) < 1600:
        scale = 1600 / max(height, width)
        image = cv2.resize(image, None, fx=scale, fy=scale, interpolation=cv2.INTER_CUBIC)

    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    contrast = cv2.createCLAHE(clipLimit=2.5, tileGridSize=(8, 8)).apply(gray)
    adaptive = cv2.adaptiveThreshold(contrast, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, 31, 8)
    return [
        ("original", image),
        ("contrast", contrast),
        ("adaptive-inverted", cv2.bitwise_not(adaptive)),
    ]


def unpack_ocr_output(output: Any, variant: str, image_shape: tuple[int, ...]) -> list[OcrToken]:
    # rapidocr_onnxruntime returns (rows, elapsed); newer RapidOCR builds may
    # expose txts/scores on a result object, so accept both local package shapes.
    if isinstance(output, tuple):
        output = output[0]
    if output is None:
        return []
    if hasattr(output, "txts") and hasattr(output, "scores"):
        return [OcrToken(str(text), float(score), variant) for text, score in zip(output.txts, output.scores)]

    tokens: list[OcrToken] = []
    for row in output:
        if not isinstance(row, (list, tuple)) or len(row) < 3:
            continue
        box, text, score = row[0], row[1], row[2]
        try:
            height, width = image_shape[:2]
            xs = [float(point[0]) for point in box]
            ys = [float(point[1]) for point in box]
            tokens.append(OcrToken(
                str(text), float(score), variant,
                (min(xs) + max(xs)) / 2 / width,
                (min(ys) + max(ys)) / 2 / height,
                (max(xs) - min(xs)) / width,
                (max(ys) - min(ys)) / height,
            ))
        except (TypeError, ValueError):
            continue
    return tokens


def recognize_image(image_path: str, min_confidence: float, styles: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    path = Path(image_path)
    if not path.is_file():
        return {"image": image_path, "price": None, "confidence": 0.0, "candidates": [], "reason": "Image file does not exist."}
    try:
        global _OCR_RUNTIME
        if _OCR_RUNTIME is None:
            cv2, RapidOCR = load_ocr_dependencies()
            _OCR_RUNTIME = (cv2, RapidOCR(intra_op_num_threads=1, inter_op_num_threads=1))
        cv2, engine = _OCR_RUNTIME
        variants = image_variants(cv2, path)
        tokens: list[OcrToken] = []
        for index, (variant, image) in enumerate(variants):
            tokens.extend(unpack_ocr_output(engine(image), variant, image.shape))
            provisional = result_from_tokens(image_path, tokens, min_confidence, styles)
            if index == 0 and provisional["price"] is not None and provisional["confidence"] >= 0.72:
                return provisional
        return result_from_tokens(image_path, tokens, min_confidence, styles)
    except Exception as error:  # Batch callers must receive a record for every image.
        return {"image": image_path, "price": None, "confidence": 0.0, "candidates": [], "reason": str(error)}


def recognize_image_job(image_path: str, min_confidence: float, styles: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    return recognize_image(image_path, min_confidence, styles)


def load_style_registry(path: str | None) -> dict[str, Any]:
    if not path:
        return {"suppliers": []}
    return json.loads(Path(path).read_text(encoding="utf-8-sig"))


def styles_for_image(image_path: str, registry: dict[str, Any]) -> list[dict[str, Any]]:
    path_text = str(Path(image_path)).casefold()
    hash_match = re.search(r"[a-f0-9]{64}", Path(image_path).name, re.IGNORECASE)
    image_hash = hash_match.group(0).lower() if hash_match else None
    for supplier in registry.get("suppliers", []):
        styles = supplier.get("styles", [])
        if image_hash and any(image_hash == sample.get("hash") for style in styles for sample in style.get("samples", [])):
            return styles
        supplier_name = str(supplier.get("supplierName", "")).casefold()
        if supplier_name and supplier_name in path_text:
            return styles
    return []


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Extract reviewable price candidates from local images with RapidOCR and OpenCV.")
    parser.add_argument("images", nargs="*", help="Image paths to inspect.")
    parser.add_argument("--directory", help="Recursively inspect supported images in a directory.")
    parser.add_argument("--output", help="Write UTF-8 JSON to this file instead of stdout.")
    parser.add_argument("--workers", type=int, default=4, help="Parallel local OCR workers (default: 4).")
    parser.add_argument("--text", action="append", default=[], help="Run candidate extraction on supplied OCR text (useful for tests).")
    parser.add_argument("--min-confidence", type=float, default=DEFAULT_MIN_CONFIDENCE, help="Confidence required to emit price (0-1).")
    parser.add_argument("--style-registry", help="Supplier-specific price style registry JSON used to rank OCR candidates.")
    parser.add_argument("--pretty", action="store_true", help="Pretty-print JSON output.")
    args = parser.parse_args(argv)
    if not args.images and not args.text and not args.directory:
        parser.error("provide at least one image path, --directory, or --text value")
    if not math.isfinite(args.min_confidence) or not 0 <= args.min_confidence <= 1:
        parser.error("--min-confidence must be between 0 and 1")
    if not 1 <= args.workers <= 8:
        parser.error("--workers must be between 1 and 8")
    return args


def main(argv: list[str] | None = None) -> int:
    args = parse_args(sys.argv[1:] if argv is None else argv)
    style_registry = load_style_registry(args.style_registry)
    images = list(args.images)
    if args.directory:
        root = Path(args.directory)
        supported = {".jpg", ".jpeg", ".png", ".webp", ".avif", ".bmp"}
        images.extend(str(path) for path in sorted(root.rglob("*")) if path.is_file() and path.suffix.lower() in supported)
    results: list[dict[str, Any]] = [None] * len(images)  # type: ignore[list-item]
    if args.workers == 1 or len(images) <= 1:
        completed = ((index, recognize_image(image_path, args.min_confidence, styles_for_image(image_path, style_registry))) for index, image_path in enumerate(images))
        for completed_count, (index, result) in enumerate(completed, start=1):
            results[index] = result
            if args.output:
                state = result["price"] if result["price"] is not None else "REVIEW"
                print(f"[{completed_count}/{len(images)}] {state} {Path(images[index]).name}", file=sys.stderr, flush=True)
    else:
        with ProcessPoolExecutor(max_workers=args.workers) as executor:
            pending = {executor.submit(recognize_image_job, image_path, args.min_confidence, styles_for_image(image_path, style_registry)): index for index, image_path in enumerate(images)}
            for completed_count, future in enumerate(as_completed(pending), start=1):
                index = pending[future]
                result = future.result()
                results[index] = result
                if args.output:
                    state = result["price"] if result["price"] is not None else "REVIEW"
                    print(f"[{completed_count}/{len(images)}] {state} {Path(images[index]).name}", file=sys.stderr, flush=True)
    results.extend(
        result_from_tokens(f"<text:{index + 1}>", [OcrToken(text, 1.0, "provided-text")], args.min_confidence)
        for index, text in enumerate(args.text)
    )
    payload = json.dumps(results, ensure_ascii=False, indent=2 if args.pretty else None)
    if args.output:
        Path(args.output).write_text(payload, encoding="utf-8")
        summary = {"output": str(Path(args.output).resolve()), "total": len(results), "recognized": sum(result["price"] is not None for result in results), "review": sum(result["price"] is None for result in results)}
        print(json.dumps(summary, ensure_ascii=False))
    else:
        print(payload)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
