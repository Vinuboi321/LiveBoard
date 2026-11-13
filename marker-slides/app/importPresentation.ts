import type { Slide } from './data';

const MAX_SLIDES = 40;
const MAX_FILE_BYTES = 25 * 1024 * 1024;
const MAX_DECK_CHARS = 5_000_000;

export const importAccept = '.pdf,.png,.jpg,.jpeg,.webp,.json';

function imageSlide(title: string, image: string): Slide {
  return { title, image, visual: 'uploaded-slide', kicker: '', body: '', detail: '', notes: '' };
}

function compress(canvas: HTMLCanvasElement, budget: number) {
  for (let attempt = 0; attempt < 5; attempt++) {
    for (const quality of [0.86, 0.68, 0.48]) {
      const image = canvas.toDataURL('image/jpeg', quality);
      if (image.length <= budget) return image;
    }
    const reduced = document.createElement('canvas');
    reduced.width = Math.max(1, Math.round(canvas.width * 0.8));
    reduced.height = Math.max(1, Math.round(canvas.height * 0.8));
    const context = reduced.getContext('2d');
    if (!context) break;
    context.drawImage(canvas, 0, 0, reduced.width, reduced.height);
    canvas = reduced;
  }
  throw new Error('A slide is too large to import. Try a smaller file.');
}

async function importPdf(file: File, onProgress: (message: string) => void) {
  const [pdf, worker] = await Promise.all([
    import('pdfjs-dist'),
    import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
  ]);
  pdf.GlobalWorkerOptions.workerSrc = worker.default;
  const task = pdf.getDocument({ data: await file.arrayBuffer(), isEvalSupported: false });
  try {
    const document = await task.promise;
    if (document.numPages > MAX_SLIDES) throw new Error('Import a PDF with 40 pages or fewer.');
    const slides: Slide[] = [];
    const budget = Math.floor(4_650_000 / document.numPages);
    for (let number = 1; number <= document.numPages; number++) {
      onProgress(`Rendering page ${number} of ${document.numPages}…`);
      const page = await document.getPage(number);
      const size = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: 1440 / Math.max(size.width, size.height) });
      const canvas = window.document.createElement('canvas');
      canvas.width = Math.max(1, Math.ceil(viewport.width));
      canvas.height = Math.max(1, Math.ceil(viewport.height));
      const context = canvas.getContext('2d');
      if (!context) throw new Error('This browser could not render the PDF.');
      await page.render({ canvasContext: context, viewport, background: '#ffffff' }).promise;
      slides.push(imageSlide('Page ' + number, compress(canvas, budget)));
      page.cleanup();
    }
    return slides;
  } finally {
    await task.destroy();
  }
}

async function importImage(file: File, budget: number) {
  const bitmap = await createImageBitmap(file);
  try {
    const canvas = document.createElement('canvas');
    const scale = Math.min(1, 1440 / Math.max(bitmap.width, bitmap.height));
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('This browser could not render the image.');
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return imageSlide(file.name.replace(/\.[^.]+$/, '').slice(0, 100), compress(canvas, budget));
  } finally {
    bitmap.close();
  }
}

function isSlide(value: unknown): value is Slide {
  if (!value || typeof value !== 'object') return false;
  const slide = value as Record<string, unknown>;
  return ['title', 'kicker', 'body', 'detail', 'visual', 'notes'].every(key => typeof slide[key] === 'string') &&
    (slide.image === undefined || typeof slide.image === 'string' && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/.test(slide.image));
}

export async function importPresentation(files: File[], onProgress: (message: string) => void) {
  if (!files.length || files.length > MAX_SLIDES) throw new Error('Choose between 1 and 40 files.');
  if (files.some(file => file.size > MAX_FILE_BYTES)) throw new Error('Each file must be 25 MB or smaller.');
  const first = files[0];
  let title = first.name.replace(/\.[^.]+$/, '').slice(0, 100);
  let slides: Slide[];
  if (files.length === 1 && /\.pdf$/i.test(first.name)) {
    slides = await importPdf(first, onProgress);
  } else if (files.length === 1 && /\.json$/i.test(first.name)) {
    const deck = JSON.parse(await first.text());
    if (!Array.isArray(deck?.slides) || !deck.slides.length || deck.slides.length > MAX_SLIDES || !deck.slides.every(isSlide)) {
      throw new Error('Choose a valid LiveBoard JSON export with 1–40 slides.');
    }
    if (typeof deck.title === 'string' && deck.title.trim()) title = deck.title.trim().slice(0, 100);
    slides = deck.slides.map(({title,kicker,body,detail,visual,notes,image}:Slide)=>({title,kicker,body,detail,visual,notes,image}));
  } else if (files.every(file => /\.(png|jpe?g|webp)$/i.test(file.name))) {
    slides = [];
    for (const [index,file] of files.entries()) {
      onProgress(`Preparing image ${index + 1} of ${files.length}…`);
      slides.push(await importImage(file, Math.floor(4_650_000 / files.length)));
    }
  } else {
    throw new Error('Choose one PDF, one LiveBoard JSON file, or a set of PNG, JPEG, or WebP images.');
  }
  if (!slides.length || JSON.stringify(slides).length > MAX_DECK_CHARS) {
    throw new Error('The imported presentation is too large for a live lesson. Try splitting the file.');
  }
  return {title: title || 'Imported presentation', slides};
}
