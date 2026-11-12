import { courseName, markersOf } from "../store";
import type { Note } from "../types";
import { $, esc, toast } from "../util";

/* The note's "more" menu: an outline to jump around a long lecture, and ways to take the note out of LiveBoard
   (print or save as PDF, copy or download as Markdown), because notes you can't hand in or share aren't finished. */

/** The note's text as Markdown. Marker dots are dropped; what markers wrote into the note is kept as ordinary text. */
export function noteToMarkdown(title: string, course: string, root: HTMLElement): string {
  const inline = (el: Node): string => [...el.childNodes].map(c => {
    if (c.nodeType === Node.TEXT_NODE) return (c.textContent || "").replace(/ /g, " ");
    if (!(c instanceof HTMLElement)) return "";
    if (c.tagName === "BUTTON" || c.classList.contains("pin") || c.classList.contains("mchip") || c.getAttribute("contenteditable") === "false" && !c.textContent?.trim()) return "";
    const t = inline(c), tag = c.tagName;
    if (!t.trim() && tag !== "BR") return t;
    if (tag === "STRONG" || tag === "B") return `**${t.trim()}**${/\s$/.test(t) ? " " : ""}`;
    if (tag === "EM" || tag === "I") return `*${t.trim()}*${/\s$/.test(t) ? " " : ""}`;
    if (tag === "CODE") return "`" + t + "`";
    if (tag === "S" || tag === "DEL") return `~~${t}~~`;
    if (tag === "A") return `[${t}](${c.getAttribute("href") || ""})`;
    if (tag === "BR") return "\n";
    return t;
  }).join("");
  const block = (el: HTMLElement, depth = 0): string => [...el.children].map(c => {
    if (!(c instanceof HTMLElement)) return "";
    // the little bar on anything a marker wrote ("marker ↗", Keep, Remove) is app chrome, not note text
    if (c.tagName === "BUTTON" || (c.querySelector(":scope > button") && !c.querySelector("p, h1, h2, h3, ul, ol, pre, blockquote, table"))) return "";
    const tag = c.tagName, pad = "  ".repeat(depth);
    if (/^H[1-6]$/.test(tag)) return `${"#".repeat(Math.min(6, Number(tag[1]) + 1))} ${inline(c).trim()}\n\n`;
    if (tag === "P") { const t = inline(c).trim(); return t ? `${pad}${t}\n\n` : ""; }
    if (tag === "UL" || tag === "OL") return [...c.children].map((li, i) => {
      const box = li.querySelector(':scope > label input[type="checkbox"]') as HTMLInputElement | null;
      const mark = box ? `- [${box.checked ? "x" : " "}]` : tag === "OL" ? `${i + 1}.` : "-";
      const body = li.querySelector(":scope > div") || li;
      const first = [...body.children].find(x => x.tagName === "P") as HTMLElement | undefined;
      const rest = [...body.children].filter(x => x.tagName === "UL" || x.tagName === "OL").map(x => { const w = document.createElement("div"); w.appendChild(x.cloneNode(true)); return block(w, depth + 1); }).join("");
      return `${pad}${mark} ${(first ? inline(first) : inline(body)).trim()}\n${rest}`;
    }).join("") + (depth ? "" : "\n");
    if (tag === "BLOCKQUOTE") return block(c).trim().split("\n").map(l => `> ${l}`).join("\n") + "\n\n";
    if (tag === "PRE") return "```\n" + (c.textContent || "").replace(/\n$/, "") + "\n```\n\n";
    if (tag === "HR") return "---\n\n";
    if (tag === "TABLE") {
      const rows = [...c.querySelectorAll("tr")].map(r => [...r.children].map(td => inline(td).trim().replace(/\|/g, "\\|")));
      if (!rows.length) return "";
      return [rows[0], rows[0].map(() => "---"), ...rows.slice(1)].map(r => `| ${r.join(" | ")} |`).join("\n") + "\n\n";
    }
    if (c.tagName === "FIGURE" && c.classList.contains("pic")) { const cap = c.querySelector("figcaption")?.textContent?.trim(); return `*[picture${cap ? ": " + cap : ""}]*\n\n`; }
    if (c.querySelector("svg") && !c.querySelector("p,h1,h2,h3,ul,ol")) return "*[diagram]*\n\n";
    return block(c, depth) || (inline(c).trim() ? inline(c).trim() + "\n\n" : "");
  }).join("");
  return `# ${title || "Untitled note"}\n\n${course ? `*${course}*\n\n` : ""}${block(root)}`.replace(/\n{3,}/g, "\n\n").trim() + "\n";
}

export function bindNoteMenu(btn: HTMLElement, menu: HTMLElement, getNote: () => Note | undefined, addPicture?: () => void) {
  const editorEl = () => document.querySelector<HTMLElement>("#editor .ProseMirror");
  const close = () => { menu.hidden = true; btn.setAttribute("aria-expanded", "false"); removeEventListener("resize", place); watch?.disconnect(); };
  const md = () => { const n = getNote(), e = editorEl(); return n && e ? noteToMarkdown(($("#ptitle") as HTMLInputElement | null)?.value || n.title, courseName(n.courseId), e) : ""; };
  const draw = () => {
    const heads = [...(editorEl()?.querySelectorAll<HTMLElement>("h1, h2, h3") || [])].filter(h => h.textContent?.trim());
    const words = (editorEl()?.innerText.trim().match(/\S+/g) || []).length;
    const dyn = menu.querySelector<HTMLElement>("#noteMenuDyn") || menu, top = menu.querySelector<HTMLElement>("#noteMenuTop");
    const n0 = getNote(), mk = n0 ? markersOf(n0.id).filter(m => !m.detachedAt) : [], due = mk.filter(m => !m.recallOff && !m.closedAt && m.due <= Date.now()).length;
    // which heading you're reading now: the last one above the middle of the screen
    const here = heads.reduce((k, h, i) => (h.getBoundingClientRect().top < innerHeight * 0.45 ? i : k), -1);
    if (top) top.innerHTML = `<div class="nmstats"><span><b>${words.toLocaleString()}</b>word${words === 1 ? "" : "s"}</span><span><b>${Math.max(1, Math.round(words / 220))}</b>min read</span><span><b>${mk.length}</b>marker${mk.length === 1 ? "" : "s"}</span><span class="${due ? "due" : ""}"><b>${due}</b>due</span></div>`;
    dyn.innerHTML = `<div class="nmlabel">Outline</div>
      ${heads.length ? `<div class="nmoutline">${heads.map((h, i) => `<button data-h="${i}" class="lv${h.tagName[1]}${i === here ? " here" : ""}" style="--i:${Math.min(i, 12)}">${esc(h.textContent!.trim().slice(0, 70))}</button>`).join("")}</div>` : `<p class="nmempty">Headings in this note show up here, so you can jump around a long lecture.</p>`}
      <div class="nmlabel">Take it with you</div>
      <div class="nmtake"><button data-act="print" title="Clean page, no app chrome"><i aria-hidden="true">⎙</i>Print / PDF</button><button data-act="copy" title="Paste into a doc, email or chat"><i aria-hidden="true">⧉</i>Copy Markdown</button><button data-act="file" title="A .md file that opens anywhere"><i aria-hidden="true">↓</i>Download</button></div>`;
    dyn.querySelectorAll<HTMLButtonElement>("[data-h]").forEach(b => b.onclick = () => {
      const h = heads[Number(b.dataset.h)];
      close();
      h.scrollIntoView({ block: "start", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
      h.classList.remove("jumped"); void h.offsetWidth; h.classList.add("jumped");
      setTimeout(() => h.classList.remove("jumped"), 1600);
    });
    dyn.querySelectorAll<HTMLButtonElement>("[data-act]").forEach(b => b.onclick = async () => {
      const act = b.dataset.act;
      close();
      if (act === "print") return void setTimeout(() => window.print(), 60);
      const text = md();
      if (!text) return;
      if (act === "copy") {
        try { await navigator.clipboard.writeText(text); toast("Copied as Markdown."); } catch { toast("Couldn't reach the clipboard. Try Download instead."); }
        return;
      }
      const a = document.createElement("a"), url = URL.createObjectURL(new Blob([text], { type: "text/markdown" }));
      a.href = url; a.download = `${(getNote()?.title || "note").replace(/[^\w\- ]+/g, "").trim().slice(0, 60) || "note"}.md`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      toast("Markdown file downloaded.");
    });
  };
  /** Keep the whole menu on screen whatever the window size: it hangs under the button, slid left or right as far as
   *  it needs to, and scrolls inside itself when the window is short. */
  const place = () => {
    const wrap = btn.parentElement!.getBoundingClientRect(), b = btn.getBoundingClientRect(), vw = document.documentElement.clientWidth, vh = Math.round(visualViewport?.height || innerHeight);
    const w = Math.min(340, vw - 16);
    const left = Math.max(8, Math.min(vw - w - 8, b.left)); // hangs from the button's left edge, pulled back in if it would run off the right
    menu.style.width = w + "px";
    menu.style.left = left - wrap.left + "px"; menu.style.right = "auto";
    menu.style.top = b.bottom - wrap.top + 10 + "px";
    menu.style.maxHeight = Math.max(200, vh - b.bottom - 22) + "px";
    menu.style.setProperty("--ox", Math.round(b.left + b.width / 2 - left) + "px"); // it unfolds from the button
  };
  // the header can re-wrap while the menu is open (a window resize, a rotation, fonts arriving): follow the button
  const watch = typeof ResizeObserver === "function" ? new ResizeObserver(() => { if (!menu.hidden) place(); }) : null;
  const open = () => {
    draw(); menu.hidden = false; btn.setAttribute("aria-expanded", "true");
    place(); requestAnimationFrame(place);
    addEventListener("resize", place);
    const head = btn.closest(".ptop");
    if (head) watch?.observe(head);
  };
  btn.onclick = e => { e.stopPropagation(); if (menu.hidden) open(); else close(); };
  // the tiles that live in the menu permanently (Lost me here, Test me, Picture) close it once pressed
  menu.querySelectorAll<HTMLElement>("[data-close]").forEach(x => x.addEventListener("click", () => close()));
  const picTile = menu.querySelector<HTMLElement>('.nmquick [data-act="picture"]');
  if (picTile) picTile.onclick = () => { close(); addPicture?.(); };
  menu.addEventListener("click", e => e.stopPropagation());
  const away = () => { if (!btn.isConnected) return document.removeEventListener("click", away); close(); };
  document.addEventListener("click", away);
  btn.addEventListener("keydown", e => { if (e.key === "Escape") close(); });
  menu.addEventListener("keydown", e => { if (e.key === "Escape") { e.stopPropagation(); close(); btn.focus(); } });
}
