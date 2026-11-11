/* Pictures in notes. A pasted screenshot or a photo of the board is shrunk on the device and kept inside the note
   itself, so it works offline, syncs with the note and never loads anything from the internet. The price is room:
   a note syncs as one record of about 2 MB, so each picture is squeezed to roughly 100–160 KB and a note holds
   about a dozen. Past that, LiveBoard says so instead of silently failing to sync. */

/** The only kind of image source a note may contain: an inline picture, never a web address. */
export const PIC_SRC = /^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/;
/** Leave headroom under the server's limit for the note's own text and markers. */
export const NOTE_PICTURE_BUDGET = 1_500_000;
const TRIES: [number, number][] = [[1400, 0.8], [1200, 0.72], [1000, 0.64], [820, 0.56]];
const TARGET = 170_000; // characters of data URL, about 125 KB of image

export const isPicture = (f: { type: string }) => /^image\/(png|jpe?g|webp|gif|bmp|heic|heif|avif)$/i.test(f.type) || f.type.startsWith("image/");

/** Shrink an image file to an inline picture. Rejects with a readable message if the browser can't open it. */
export async function shrink(file: Blob): Promise<string> {
  let bmp: ImageBitmap;
  try { bmp = await createImageBitmap(file); } catch { throw new Error("That picture couldn't be opened. Try a PNG or JPEG."); }
  try {
    let out = "";
    for (const [edge, q] of TRIES) {
      const k = Math.min(1, edge / Math.max(bmp.width, bmp.height));
      const c = document.createElement("canvas");
      c.width = Math.max(1, Math.round(bmp.width * k)); c.height = Math.max(1, Math.round(bmp.height * k));
      const g = c.getContext("2d");
      if (!g) throw new Error("This browser can't prepare pictures.");
      g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height); // transparent screenshots get a white page, not black
      g.drawImage(bmp, 0, 0, c.width, c.height);
      out = c.toDataURL("image/webp", q);
      if (!out.startsWith("data:image/webp")) out = c.toDataURL("image/jpeg", q); // Safari versions without WebP encoding
      if (out.length <= TARGET) break;
    }
    if (!PIC_SRC.test(out)) throw new Error("That picture couldn't be prepared.");
    return out;
  } finally { bmp.close?.(); }
}
