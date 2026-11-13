# Teacher Studio

Teacher Studio extends the original LiveBoard application at `#teacher`. The header links to it; Student notes returns to the original note dial.

## Authoring a lesson

1. Upload a PDF, image, Markdown, or text document. PDFs retain their page layout.
2. Select words and choose Add marker, or use Add marker to drag a region.
3. Open the marker to write a question, progressive hints, an explanation, and an optional HTTPS image or video URL.
4. Use the annotation toolbar for handwriting, highlighting, shapes, typed notes, or images.
5. Switch to Student preview to try responses and hints. Export the lesson file to share it; recipients import it with Open lesson file.

Scanned PDFs use local English OCR. Documents, annotations, markers, and preview responses are saved in IndexedDB under the current LiveBoard account boundary. Export includes the source document and lesson content, but omits responses and cached OCR.

## Current scope

This is local lesson authoring and preview. It does not provide a classroom roster, hosted assignment links, teacher collection of submissions, grading, or teacher-document cloud sync. Student preview is an authoring view, not a secure assessment boundary: exported explanations are visible in the lesson file. AI questions use the original LiveBoard provider configuration. Media links display existing images and videos; image/video generation requires a separately configured server integration.

## Checks

`npm run build` checks TypeScript and builds the original app with Teacher Studio. `node tests/teacher-model.cjs`, `node tests/anchors.cjs`, and `node tests/notetools-model.cjs` validate portable lessons, selection bounds, and annotation data. These suites are also registered in `npm test`.
