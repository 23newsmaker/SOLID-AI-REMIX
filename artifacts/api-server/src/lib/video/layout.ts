import sharp from "sharp";

const escapeMarkup = (s: string) => s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]!);
export class TextLayoutError extends Error {}
async function textGraphic(text: string, fontSize: number, maxHeight: number, color: string) {
  if (!text.trim()) return null;
  // librsvg ignores SVG textLength. Pango word/character wrapping uses actual
  // glyph measurements, so wide letters, accents and numbers cannot escape.
  const { data, info } = await sharp({ text: { text: `<span foreground="${color}">${escapeMarkup(text)}</span>`,
    font: `DejaVu Sans ${fontSize}`, dpi: 72, width: 528, wrap: "word-char", align: "centre", spacing: 7, rgba: true } })
    .png().toBuffer({ resolveWithObject: true });
  if (info.width > 528 || info.height > maxHeight) throw new TextLayoutError("Teks tidak muat safe area. Ringkas CTA/disclaimer/subtitle lalu review ulang; teks tidak dipotong atau diperkecil otomatis.");
  return { input: data, left: Math.round(330 - info.width / 2), height: info.height, width: info.width };
}
export async function prepareText(chunks: string[], cta: string, disclaimer: string) {
  return {
    cues: await Promise.all(chunks.map(t => textGraphic(t, 23, 174, "#ffffff"))),
    cta: await textGraphic(cta, 22, 79, "#ffd46c"),
    disclaimer: await textGraphic(disclaimer, 16, 80, "#ffffff"),
  };
}
