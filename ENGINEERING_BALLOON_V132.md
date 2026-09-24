# Engineering Drawing Reader & Ballooning — v132

## Purpose

v132 is the strict validation release for Engineering Drawing Intelligence and ballooning. It is designed around the real GOST-style validation drawing used during QA.

## v132 controls

1. **Explicit-callout rule** — an inspection characteristic must be supported by visible callout text and visual evidence. Geometry arithmetic, implied dimensions, hidden/internal dimensions and engineering inference cannot create an automatic characteristic.
2. **Signed tolerance preservation** — `±0.05` is stored as upper `+0.05`, lower `-0.05`; one-sided lower deviations remain negative.
3. **Thread protection** — `M34×0.75` remains one Thread characteristic and cannot become a diameter plus a thread.
4. **Chamfer protection** — `0.8×45°` remains one chamfer characteristic; the 45° component is not separately ballooned.
5. **GD&T symbol protection** — datum A alone does not create concentricity. A perpendicularity symbol must remain perpendicularity.
6. **Diameter protection** — a number is not a diameter unless the visible callout contains `Ø/⌀` or explicitly says diameter.
7. **Detail/section coverage** — completeness and adversarial coverage passes explicitly inspect detail and section views and stacked tolerances.
8. **Two-point positioning** — `calloutX/Y` is the printed callout target; `anchorX/Y` is the actual feature anchor when visible. They are not interchangeable.
9. **Evidence box** — every automatic balloon requires `calloutText`, `evidenceText`, and `calloutBBox` plus high-confidence validation.
10. **Strict export gate** — a balloon sheet is visibly marked `NOT VERIFIED — DO NOT USE FOR INSPECTION` until every characteristic has a high-confidence verified callout and no duplicate key.
11. **Human review remains available** — unresolved items can be placed/edited manually, with the person and time recorded separately from the AI reading.

## Validation fixture

`tests/fixtures/engineering-drawing-gost-validation.jpg` is the drawing used to regression-test the failure modes found in v127–v131.

The v132 source-level gate is `tests/engineeringdrawingv132test.mjs`.
