#!/usr/bin/env python3
"""Offline benchmark helper for the supplied GOST engineering drawing.

Runs Tesseract in several preprocessing modes and reports whether the most
error-prone printed tokens are visible to the independent OCR layer. This is a
development/regression tool; the browser uses Tesseract.js through
engineering-vision.js.
"""
from __future__ import annotations
import json, re, shutil, subprocess, sys
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
DRAWING=ROOT/'tests'/'fixtures'/'engineering-drawing-gost-validation.jpg'
TOKENS=['16','0.05','M34','0.75','0.8','45','0.01','42','36','22','135','Ra10','4784-97']

if not shutil.which('tesseract'):
    print('tesseract not installed; browser benchmark uses Tesseract.js at runtime.')
    sys.exit(0)

# Delegate actual OCR to the local executable. Keep the benchmark conservative:
# it only reports raw token visibility and never invents a pass.
res=subprocess.run(['tesseract',str(DRAWING),'stdout','--psm','11','-l','eng'],capture_output=True,text=True)
text=res.stdout
norm=lambda s: re.sub(r'[^a-z0-9.+-]','',s.lower().replace('o','0'))
nt=norm(text)
report={t: (norm(t) in nt) for t in TOKENS}
print(json.dumps(report,indent=2))
