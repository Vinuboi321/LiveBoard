import { marked } from "marked";
import DOMPurify from "dompurify";

marked.setOptions({ gfm: true, breaks: false });

export function mdToHtml(md: string) {
  const html = marked.parse(md || "", { async: false }) as string;
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: ["p", "h1", "h2", "h3", "h4", "ul", "ol", "li", "strong", "em", "code", "pre", "blockquote", "table", "thead", "tbody", "tr", "th", "td", "br", "hr", "a", "s"],
    ALLOWED_ATTR: ["href"]
  });
}

/** Note-safe HTML: tables aren't part of the editor schema yet, so they become lists of rows. */
export function mdToNoteHtml(md: string) {
  const html = mdToHtml(md);
  const box = document.createElement("div");
  box.innerHTML = html;
  box.querySelectorAll("table").forEach(t => {
    const rows = [...t.querySelectorAll("tr")].map(tr => [...tr.children].map(c => c.textContent?.trim() || ""));
    const [head, ...body] = rows;
    const ul = document.createElement("ul");
    (body.length ? body : rows).forEach(r => {
      const li = document.createElement("li");
      li.textContent = head && body.length ? r.map((v, i) => (head[i] ? `${head[i]}: ${v}` : v)).join(" · ") : r.join(" · ");
      ul.appendChild(li);
    });
    t.replaceWith(ul);
  });
  box.querySelectorAll("h1").forEach(h => { const h2 = document.createElement("h2"); h2.innerHTML = h.innerHTML; h.replaceWith(h2); });
  box.querySelectorAll("h4").forEach(h => { const h3 = document.createElement("h3"); h3.innerHTML = h.innerHTML; h.replaceWith(h3); });
  return box.innerHTML;
}
