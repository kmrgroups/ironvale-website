# Engineering Drawing Ballooning v133

## Hybrid evidence pipeline

The Engineering drawing reader now uses a layered evidence model instead of relying on a single vision response:

1. Lossless/high-resolution PNG conversion for raster readability.
2. PDF text-layer coordinates are preserved when the source PDF is vector.
3. Tesseract.js dual-preprocess OCR supplies independent printed-text boxes.
4. Fuzzy text + numeric + spatial matching attaches AI characteristics to observed callout boxes.
5. Hard/ambiguous callouts are re-read from a focused lossless crop.
6. Semantic cleanup rejects inferred dimensions, unsupported GD&T, thread-as-diameter, and split chamfer-angle duplicates.
7. Balloon layout selects one of eight nearby positions and avoids the verified callout box.
8. Leader endpoints terminate on the verified callout-box edge.
9. Export requires high-confidence visual evidence from OCR or PDF vector text.

## Safety rule

A characteristic not visibly evidenced on the drawing is not automatically ballooned. It remains unresolved/manual-review work.

## Regression case

The supplied GOST drawing remains the required regression fixture, including the two distinct `16` callouts, signed one-sided tolerances, `16 ±0.05`, `M34×0.75`, `0.8×45°`, `⊥ 0.01 A`, and title-block information.
