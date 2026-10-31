# Fonts

## Reading face: Noto Serif Devanagari
`NotoSerifDevanagari-Regular-subset.woff2` is a Modified Version (OFL 1.1 term) of
Noto Serif Devanagari 2.006 (variable TTF, 700,096 bytes), made with fontTools:
static Regular instance (wght 400, wdth 100), subset to the whole Devanagari block
(U+0900–097F) plus Basic Latin and a few punctuation marks, hinting dropped, WOFF2.
All OpenType layout features and the Marathi (MAR) and Sanskrit (SAN) language systems are kept.
Noto has no Reserved Font Name, so the family name is unchanged. Licence: `OFL.txt`.

## Cover titles: Gotu (outlines only, no font file)
The calligraphic title lines on the covers are not set in a font at run time. They are SVG
outlines in `../covers/titles.json`, made once with HarfBuzz (correct Devanagari shaping:
conjuncts, reph, matra order) from Gotu Regular as published in google/fonts (`ofl/gotu/Gotu-Regular.ttf`).
Gotu is © 2016 Ek Type (https://github.com/EkType/Gotu), licensed under the SIL Open Font License 1.1;
its licence file, copied from the font's own repository, is `OFL-Gotu.txt`. Gotu has no Reserved Font Name.
The OFL FAQ (questions 1.1 and 1.1.1, https://openfontlicense.org/ofl-faq/) says graphics made with a font
are not themselves covered by the OFL; the credit and the licence are included anyway.

Why outlines and not a font file: the four release-A title lines cost 11.6 KB raw / 3.1 KB gzipped as outlines;
a Gotu font file cut down to the same characters (Google Fonts `text=` subset, as served to Chrome) measured
78,704 bytes, most likely because Devanagari shaping keeps the conjunct and matra glyphs those characters can form. A new title line needs new outlines
(see the dev bundle); until then the cover shows that line in the reading face, and the build prints a warning.
