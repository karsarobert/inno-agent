# Vendorizált szkriptek

[English](README.md) | [Magyar](README.hu.md)

## `pptx_to_svg/` + `pptx_to_svg.py` + `console_encoding.py`

Tiszta Python-megvalósítású PPTX → SVG átalakító, amely a
[ppt-master](https://github.com/hugohe3/ppt-master) Skillből
(`skills/ppt-master/scripts/`) került vendorizálásra.

A backend `/api/workspace/pptx-preview` útvonala (`src/server.ts`) ezt használja
PowerPoint-diák SVG-ként való megjelenítésére, **LibreOffice nélkül**. Alfolyamatként fut:

```
python3 pptx_to_svg.py <file.pptx> --embed-images --inheritance-mode flat -o <outdir>
```

### Garanciák és megjegyzések

- **Csak szabványos könyvtár** — nincs `pip`-függőség. Közvetlenül olvassa a `.pptx` ZIP-fájlt, és alakzatszintű SVG-t állít elő (szöveg, alakzatok, színátmenetek, táblázatok, base64-be ágyazott képek).
- A `console_encoding.py` fájlt a CLI importálja (`configure_utf8_stdio`), ezért **a `pptx_to_svg.py` mellett kell maradnia**.
- Opcionális: az EMF/WMF-erőforrások az ImageMagicket (`magick`) használják, ha elérhető; ennek hiányában fokozatosan korlátozottan működnek, tehát nem kötelező függőség.
- **Ne módosítsd a Python-kódot**: a belső importok relatívak, és a CLI a `sys.path.insert(0, <script dir>)` hívással oldja fel a csomagot és a segédmodult a saját könyvtárából.

A diagramok és a SmartArt elemek lehetőség szerint a PowerPoint által beágyazott előnézeti képre támaszkodnak; ennek hiányában feliratozott helyőrző doboz jelenik meg.
