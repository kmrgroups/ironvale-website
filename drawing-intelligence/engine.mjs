/*
 * Ironvale Drawing Intelligence Engine v143
 * Zero-cost/self-hosted core.
 * No cloud API, CDN, or paid connector is required.
 */
export const ENGINE_VERSION = "143.0.0";

export const CHARACTERISTIC_TYPES = Object.freeze([
  "linear_dimension","diameter","radius","angle","chamfer","thread",
  "depth","thickness","hex","gdt","datum","surface_finish",
  "special_characteristic","note","material","marking","general_tolerance"
]);

export function makeCharacteristic(input = {}) {
  return {
    characteristic_id: input.characteristic_id || crypto.randomUUID(),
    balloon_number: input.balloon_number ?? null,
    drawing_id: input.drawing_id || null,
    revision: input.revision || null,
    page: Number(input.page || 1),
    type: input.type || "note",
    dimension_text: input.dimension_text || "",
    nominal: input.nominal ?? null,
    upper_tolerance: input.upper_tolerance ?? null,
    lower_tolerance: input.lower_tolerance ?? null,
    unit: input.unit || "mm",
    gdt_symbol: input.gdt_symbol || null,
    datum_reference: input.datum_reference || null,
    source_bbox: input.source_bbox || null,
    feature_region: input.feature_region || null,
    leader_start: input.leader_start || null,
    balloon_position: input.balloon_position || null,
    special_characteristic: Boolean(input.special_characteristic),
    source: input.source || "manual",
    confidence: Number.isFinite(input.confidence) ? input.confidence : 0,
    validation_status: input.validation_status || "unresolved",
    review_required: input.review_required !== false,
    approved_by: input.approved_by || null,
    approved_date: input.approved_date || null,
    evidence: Array.isArray(input.evidence) ? input.evidence : [],
    created_at: input.created_at || new Date().toISOString()
  };
}

export function assignBalloonNumbers(items, prefix="B") {
  const sorted = [...items].sort((a,b) =>
    (a.page-b.page) ||
    ((a.source_bbox?.y||0)-(b.source_bbox?.y||0)) ||
    ((a.source_bbox?.x||0)-(b.source_bbox?.x||0))
  );
  sorted.forEach((c,i) => { c.balloon_number = `${prefix}${String(i+1).padStart(3,"0")}`; });
  return sorted;
}

export function validateCharacteristics(items) {
  const issues = [];
  const seen = new Set();
  const balloonSeen = new Set();

  for (const c of items) {
    if (seen.has(c.characteristic_id)) issues.push({type:"duplicate_id", id:c.characteristic_id});
    seen.add(c.characteristic_id);

    if (c.balloon_number) {
      if (balloonSeen.has(c.balloon_number)) issues.push({type:"duplicate_balloon", balloon:c.balloon_number});
      balloonSeen.add(c.balloon_number);
    }
    if (!c.dimension_text && !["datum","special_characteristic"].includes(c.type))
      issues.push({type:"missing_text", id:c.characteristic_id});
    if (!c.source_bbox && c.source !== "manual")
      issues.push({type:"missing_evidence_box", id:c.characteristic_id});
    if (c.confidence < 0 || c.confidence > 1)
      issues.push({type:"invalid_confidence", id:c.characteristic_id});
    if (c.confidence < 0.90 || c.validation_status === "unresolved")
      issues.push({type:"review_required", id:c.characteristic_id});
  }

  const numbers = items.map(x => Number(String(x.balloon_number||"").replace(/\D/g,"")))
    .filter(Number.isFinite).sort((a,b)=>a-b);
  for (let i=0;i<numbers.length;i++) {
    if (numbers[i] !== i+1) { issues.push({type:"number_gap", expected:i+1, actual:numbers[i]}); break; }
  }
  return {ok: issues.length === 0, issues};
}

export function confidenceBand(confidence) {
  if (confidence >= .98) return "AUTO";
  if (confidence >= .90) return "REVIEW";
  return "MANDATORY_REVIEW";
}

export function routeBalloon(c, sheet, options={}) {
  const gap = options.gap ?? 28;
  const w = options.balloonSize ?? 26;
  const h = w;
  const b = c.source_bbox;
  if (!b) return null;
  const cx = b.x + b.w/2, cy = b.y + b.h/2;
  const candidates = [
    {x:b.x+b.w+gap,y:cy-h/2},
    {x:b.x-gap-w,y:cy-h/2},
    {x:cx-w/2,y:b.y+b.h+gap},
    {x:cx-w/2,y:b.y-gap-h},
    {x:b.x+b.w+gap,y:b.y+b.h+gap},
    {x:b.x-gap-w,y:b.y-gap-h},
    {x:b.x+b.w+gap,y:b.y-gap-h},
    {x:b.x-gap-w,y:b.y+b.h+gap}
  ];
  const valid = candidates.filter(p =>
    p.x>=4 && p.y>=4 && p.x+w<=sheet.width-4 && p.y+h<=sheet.height-4
  );
  return valid[0] || candidates[0];
}
