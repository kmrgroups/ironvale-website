# Engineering Drawing / Ballooning v131

## Purpose
Fix the failure modes observed in the supplied GOST-style drawing and its v130 balloon PDF.

## Changes
- Requires visible callout evidence (`calloutText`, `evidenceText`, `calloutBBox`) before an automatic balloon is allowed.
- Automatic ballooning now requires **High** verifier confidence plus a verified printed-callout box.
- Separates the printed callout from the actual feature anchor.
- Semantic normalization prevents `M34x0.75` from becoming both a diameter and a thread.
- Semantic normalization prevents `0.8x45°` from becoming a chamfer plus a separate 45° characteristic when both describe the same printed callout.
- GD&T symbol `⊥` is protected as perpendicularity and cannot be renamed concentricity by the model.
- Diameter claims require a visible diameter symbol (`Ø`/`⌀`) or explicit Dia/Diameter wording.
- Duplicate identity uses the exact printed callout plus local position when available, so different 16 mm callouts can remain separate.
- ± tolerance signs remain explicit.

## Important validation status
This is a stricter release. A characteristic without high-confidence visual callout evidence is intentionally left **unballooned** rather than guessed. This is a safety/correctness behavior, not a missing feature.

The supplied drawing remains the regression reference. Runtime AI vision still requires validation in the deployed environment with the actual drawing/model.
