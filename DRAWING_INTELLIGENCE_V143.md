# Ironvale Drawing Intelligence Engine v143

## Purpose
A new, isolated drawing-ballooning implementation built beside the existing v142 engine. The v142 implementation is untouched and remains the fallback.

## Zero-cost design
- No OpenAI API
- No ChatGPT connector
- No paid OCR API
- No cloud AI dependency
- No CDN dependency in the new core
- Local/self-hosted AI is optional
- Deterministic validation and balloon numbering work without AI

## Pipeline
1. Drawing intake
2. PDF/vector evidence
3. Targeted OCR
4. Geometry/spatial association
5. Optional local VLM
6. `DrawingCharacteristic` graph
7. Confidence classification
8. Balloon placement
9. Completeness/duplication/orphan validation
10. Engineer approval
11. Ballooned PDF export
12. Downstream characteristic identity for PFMEA / Control Plan / Inspection / FAI / PPAP

## Safety rules
- Never invent a characteristic.
- Never silently reinterpret unsupported GD&T.
- Low-confidence or unsupported evidence remains unresolved.
- AI proposes structured data; deterministic software validates and renders it.
- Human approval is required before production release.

## Thresholds
- >= 98%: AUTO candidate
- 90–97.99%: engineering review
- < 90%: mandatory review

## Version isolation
The old `engineering-vision.js` and current IDMS ballooning implementation are deliberately retained. Do not delete them until the new engine passes the golden benchmark.

## Planned adapters
- PDFBox / equivalent local PDF parser
- PaddleOCR / Tesseract local runtime
- OpenCV
- ezdxf
- Open CASCADE
- Ollama / llama.cpp local VLM

The exact native runtime can be selected during deployment based on server hardware.
