import { db, putCourse, putMarker, putMeta, putNote, state } from "./store";
import type { Course, Marker, MarkerType, Mastery, Note, ThreadMsg } from "./types";
import { DAY, H, dayKey, esc } from "./util";

/* Sample notes for the preview build only (never in the installed app). Everything here uses "demo-" ids
   so Settings can remove it in one tap. */

const COURSES: [string, string, string][] = [
  ["demo-bio", "BIO 101", "#10C49B"], ["demo-psych", "PSYCH 202", "#FF4FA3"], ["demo-math", "MATH 234", "#3A86FF"],
  ["demo-econ", "ECON 101", "#FF7A1A"], ["demo-cs", "CS 300", "#00B4D8"], ["demo-chem", "CHEM 103", "#A24BFF"],
  ["demo-calc", "AP CALC BC", "#F15BB5"], ["demo-phys", "AP PHYSICS C", "#FFB703"], ["demo-csa", "AP CSA", "#2EC4B6"], ["demo-stats", "AP STATS", "#FF5A5F"]
];

interface M { id: string; text: string; type: MarkerType; free?: [number, number]; mastery?: Mastery; ago?: number; dueIn?: number; thread?: [ThreadMsg["role"], string, string?, string?][]; q?: string; a?: string; links?: string[]; remindIn?: number; out?: string }
const pin = (m: M) => m.free ? `<span data-pin="${m.id}" data-dx="${m.free[0]}" data-dy="${m.free[1]}"></span>` : `<span data-marker="${m.id}">${esc(m.text)}</span><span data-pin="${m.id}"></span>`;

export async function seedDemo() {
  if ((state.meta.demoVersion || 0) >= 3) return;
  const now = Date.now();
  for (const [id, name, color] of COURSES) {
    const c: Course = { id, name, color, updatedAt: now };
    await putCourse(c);
  }
  const markers: (M & { noteId: string })[] = [];
  const notes: { id: string; course: string; title: string; kind: Note["kind"]; ago: number; html: (ms: Record<string, M>) => string; ms: M[] }[] = [
    {
      id: "demo-n-bio", course: "demo-bio", title: "The little powerhouses", kind: "lecture", ago: 2 * H,
      ms: [
        { id: "demo-m-atp", text: "As protons flow back through ATP synthase, ATP is produced.", type: "question", ago: 2 * H, dueIn: -H,
          thread: [["user", "How does the gradient actually turn the enzyme?"], ["self", "Protons move down their gradient through the channel, which spins part of ATP synthase like a turbine; the spinning drives ADP + Pi together."]],
          q: "How does the proton gradient help a mitochondrion produce ATP?", a: "Protons flowing back through ATP synthase spin it, and that motion joins ADP and phosphate into ATP.", links: ["demo-m-etc", "demo-m-free"] },
        { id: "demo-m-free", text: "", type: "question", free: [46, 18], ago: 90 * 60000, dueIn: DAY, links: ["demo-m-atp", "demo-m-spaced"],
          thread: [["user", "Is this the same thing chloroplasts do?"], ["self", "Yes. Chloroplasts also use a proton gradient and ATP synthase, but the energy comes from light instead of food."]],
          q: "What do mitochondria and chloroplasts have in common for making ATP?", a: "Both build a proton gradient and let protons flow back through ATP synthase." },
        { id: "demo-m-etc", text: "The electron transport chain pumps protons into the intermembrane space", type: "explain", mastery: 1, ago: 3 * H, dueIn: -H,
          thread: [["user", "Explain this simpler"], ["marker", "Think of the chain as a series of pumps. As electrons are handed down it, the energy released is used to push H⁺ out of the matrix, building up a crowd of protons on one side of the membrane. That crowd is the stored energy ATP synthase uses next.", "", ""]],
          q: "Where does the electron transport chain pump protons, and why does that matter?", a: "Into the intermembrane space, building the gradient that powers ATP synthase.", links: ["demo-m-atp"],
          out: "Plain version: each step of the chain uses electron energy to pump H⁺ out of the matrix. The pile-up of protons is stored energy." },
        { id: "demo-m-yield", text: "about 30 ATP per glucose", type: "math", mastery: 2, ago: 4 * H, dueIn: 4 * DAY,
          thread: [["user", "30 * 30.5 kJ/mol"], ["marker", "", "30 * 30.5 kJ/mol", "915 kJ / mol"]],
          q: "Roughly how much energy is captured as ATP from one glucose?", a: "About 30 ATP × 30.5 kJ/mol ≈ 915 kJ/mol." }
      ],
      html: ms => `<h2>Mitochondria${pin(ms["demo-m-free"])}</h2><p>Mitochondria are where most of a cell's ATP is made. The inner membrane is folded into cristae, which gives it a large surface area for the reactions below.</p>
<p>${pin(ms["demo-m-etc"])}, using energy from electrons carried by NADH and FADH₂.</p>
<div data-marker-output="demo-m-etc" data-status="accepted"><p>${esc(ms["demo-m-etc"].out!)}</p></div>
<p>${pin(ms["demo-m-atp"])} This is called chemiosmosis.</p>
<p>Overall, aerobic respiration yields ${pin(ms["demo-m-yield"])}, far more than glycolysis alone (2 ATP).</p>`
    },
    {
      id: "demo-n-psych", course: "demo-psych", title: "How memory sticks", kind: "lecture", ago: 6 * H,
      ms: [
        { id: "demo-m-spaced", text: "Spaced practice distributes learning over time.", type: "explain", mastery: 1, ago: 6 * H, dueIn: -H, links: ["demo-m-attempt", "demo-m-free"],
          thread: [["user", "Give me an example"], ["marker", "Instead of studying a chapter for 3 hours the night before, study it for 45 minutes on four different days. Same total time, much better recall a week later.", "", ""]],
          q: "Why does spacing study sessions beat cramming?", a: "Gaps let some forgetting happen, so each review has to rebuild the memory, which makes it stronger." },
        { id: "demo-m-attempt", text: "Attempting", type: "question", ago: 7 * H, dueIn: -H, links: ["demo-m-spaced"],
          q: "What is the testing effect?", a: "Attempting to recall information strengthens memory more than rereading it." },
        { id: "demo-m-forget", text: "the forgetting curve", type: "reminder", ago: 7 * H, remindIn: DAY,
          thread: [["user", "remind me tomorrow"], ["marker", "This marker will come back in your recall tomorrow morning.", "", ""]],
          q: "What does the forgetting curve show?", a: "Memory of new material drops fast in the first days unless it's reviewed." }
      ],
      html: ms => `<h2>Encoding and retrieval</h2><p>${pin(ms["demo-m-spaced"])} Cramming feels productive but fades quickly.</p>
<p>${pin(ms["demo-m-attempt"])} to recall something, even if you fail, makes it easier to recall later. This is the testing effect.</p>
<p>Ebbinghaus measured ${pin(ms["demo-m-forget"])}: most forgetting happens in the first day or two.</p>`
    },
    {
      id: "demo-n-taylor", course: "demo-math", title: "Lecture 14 · Taylor & Maclaurin Series", kind: "lecture", ago: 14 * H,
      ms: [
        { id: "demo-m-taylor", text: "The Taylor series of f centered at a is Σ f⁽ⁿ⁾(a)/n! · (x − a)ⁿ", type: "explain", ago: 14 * H, dueIn: -H,
          thread: [["user", "Why is there an n! in each term?"], ["marker", "Differentiating (x − a)ⁿ n times leaves n!. Dividing by n! cancels it, so the nth derivative of the series at a matches f⁽ⁿ⁾(a) exactly.", "", ""]],
          q: "What is the general term of a Taylor series centered at a?", a: "f⁽ⁿ⁾(a)/n! · (x − a)ⁿ" },
        { id: "demo-m-rem", text: "the remainder is bounded by |Rₙ(x)| ≤ M|x − a|ⁿ⁺¹ / (n + 1)!", type: "math", ago: 13 * H, dueIn: -H,
          thread: [["user", "e^0.5 * 0.5^4 / 4!"], ["marker", "", "e^0.5 * 0.5^4 / 4!", "0.004293544976"]],
          q: "How do you bound the error of a degree-n Taylor polynomial?", a: "Taylor's inequality: |Rₙ(x)| ≤ M|x − a|ⁿ⁺¹/(n+1)!, where M bounds the next derivative." }
      ],
      html: ms => `<h3>Slide 3</h3><p>If f has derivatives of every order at x = a, we can build a power series that matches f and all its derivatives there. ${pin(ms["demo-m-taylor"])}. When a = 0 it is a Maclaurin series.</p>
<h3>Slide 4</h3><p>Worth memorizing: eˣ = Σ xⁿ/n!, sin x = Σ (−1)ⁿ x²ⁿ⁺¹/(2n+1)!, and 1/(1 − x) = Σ xⁿ for |x| &lt; 1.</p>
<h3>Slide 6</h3><p>Taylor's inequality: if |f⁽ⁿ⁺¹⁾(x)| ≤ M near a, then ${pin(ms["demo-m-rem"])}.</p><p><em>Prof said a remainder question shows up on every exam.</em></p>`
    },
    {
      id: "demo-n-hash", course: "demo-cs", title: "Lab 7 · Hash tables", kind: "blank", ago: 20 * H,
      ms: [{ id: "demo-m-load", text: "Load factor = entries / buckets", type: "math", mastery: 1, ago: 20 * H, dueIn: 2 * DAY,
        thread: [["user", "12 / 16"], ["marker", "", "12 / 16", "0.75"]], q: "When should a hash table resize?", a: "When the load factor (entries / buckets) passes about 0.75." }],
      html: ms => `<p>Chaining keeps a list in each bucket. ${pin(ms["demo-m-load"])}; resize when it passes 0.75 so lookups stay close to O(1).</p>`
    },
    {
      id: "demo-n-elastic", course: "demo-econ", title: "Elasticity", kind: "blank", ago: 3 * DAY,
      ms: [{ id: "demo-m-elas", text: "Price elasticity of demand = %ΔQd / %ΔP", type: "math", mastery: 2, ago: 3 * DAY, dueIn: 5 * DAY,
        thread: [["user", "(-20/100) / (10/50)"], ["marker", "", "(-20/100) / (10/50)", "-1"]], q: "What is price elasticity of demand, and when is demand elastic?", a: "%ΔQd / %ΔP. Elastic when |E| > 1." }],
      html: ms => `<p>Elasticity is how responsive quantity is to a change in price.</p><p>${pin(ms["demo-m-elas"])}. If |E| &gt; 1 demand is elastic; if |E| &lt; 1 it is inelastic.</p><p>Section example: price went 50 → 60, quantity went 100 → 80.</p>`
    },
    { id: "demo-n-power", course: "demo-math", title: "Lecture 13 · Power Series", kind: "lecture", ago: 3.5 * DAY, ms: [], html: () => `<p>A power series Σ cₙ(x − a)ⁿ converges on an interval centered at a. Use the ratio test to find the radius of convergence R, then check both endpoints separately.</p>` },
    {
      id: "demo-n-stoich", course: "demo-chem", title: "Stoichiometry practice", kind: "lecture", ago: 5 * DAY,
      ms: [{ id: "demo-m-limit", text: "The limiting reagent is whichever runs out first.", type: "question", ago: 5 * DAY, dueIn: -2 * H,
        q: "How do you find the limiting reagent?", a: "Convert each reactant to moles, divide by its coefficient; the smallest result runs out first." }],
      html: ms => `<p>Convert grams to moles with molar mass, use the mole ratio from the balanced equation, then convert back to grams. ${pin(ms["demo-m-limit"])}</p>`
    },
    { id: "demo-n-titr", course: "demo-chem", title: "Lab report draft · Titration", kind: "blank", ago: 6 * DAY, ms: [], html: () => `<p>Endpoint reached at 23.4 mL of 0.100 M NaOH. Moles of acid = 0.100 × 0.0234 = 0.00234 mol.</p>` },
    { id: "demo-n-supply", course: "demo-econ", title: "Supply & demand shifts", kind: "lecture", ago: 12 * DAY, ms: [], html: () => `<p>A change in price moves along the curve. A change in income, tastes, or input costs shifts the whole curve.</p>` },
    {
      id: "demo-n-limits", course: "demo-math", title: "Making sense of limits", kind: "blank", ago: 18 * DAY,
      ms: [{ id: "demo-m-lim", text: "A limit describes where a function is heading, not where it is.", type: "note", mastery: 2, ago: 18 * DAY, dueIn: 9 * DAY,
        q: "What does a limit describe?", a: "The value a function approaches near a point, whether or not it's defined there." }],
      html: ms => `<p>${pin(ms["demo-m-lim"])} The function can even be undefined at the point.</p>`
    },
    { id: "demo-n-gas", course: "demo-chem", title: "Gas laws", kind: "lecture", ago: 26 * DAY, ms: [], html: () => `<p>PV = nRT. Use R = 0.08206 L·atm/(mol·K) and always convert temperature to kelvin.</p>` },
    { id: "demo-n-java", course: "demo-cs", title: "Lecture 2 · Java review", kind: "lecture", ago: 41 * DAY, ms: [], html: () => `<p>Primitive types live on the stack; objects live on the heap and variables hold references to them.</p>` },
    { id: "demo-n-syll", course: "demo-math", title: "Lecture 1 · Syllabus & review", kind: "lecture", ago: 58 * DAY, ms: [], html: () => `<p>Exams are 60% of the grade. Review integration by parts and partial fractions before week 3.</p>` },
    { id: "demo-n-series", course: "demo-calc", title: "Series test review", kind: "blank", ago: 150 * DAY, ms: [], html: () => `<p>Divergence test first. Then ratio test for factorials, comparison for rational functions, alternating series test for (−1)ⁿ.</p>` },
    { id: "demo-n-rot", course: "demo-phys", title: "Rotational motion", kind: "blank", ago: 215 * DAY, ms: [], html: () => `<p>τ = Iα. Moment of inertia of a solid disk is ½MR². Angular momentum is conserved without external torque.</p>` },
    { id: "demo-n-rec", course: "demo-csa", title: "Recursion notes", kind: "blank", ago: 420 * DAY, ms: [], html: () => `<p>Every recursive method needs a base case and a step that moves toward it.</p>` },
    { id: "demo-n-hyp", course: "demo-stats", title: "Hypothesis testing", kind: "blank", ago: 490 * DAY, ms: [], html: () => `<p>Reject H₀ when p &lt; α. A Type I error is rejecting a true null hypothesis.</p>` }
  ];

  for (const n of notes) {
    const byId: Record<string, M> = Object.fromEntries(n.ms.map(m => [m.id, m]));
    const html = n.html(byId);
    const t = now - n.ago;
    const rec: Note = { id: n.id, courseId: n.course, title: n.title, kind: n.kind, doc: null, html, plain: html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(), createdAt: t, updatedAt: t, openedAt: t };
    await putNote(rec, false);
    n.ms.forEach(m => markers.push({ ...m, noteId: n.id }));
  }
  for (const m of [...markers].reverse()) { // oldest first, so the newest are the most recently touched
    const created = now - (m.ago || DAY);
    const rec: Marker = {
      id: m.id, noteId: m.noteId, type: m.type, text: m.text, mastery: m.mastery ?? 0,
      thread: (m.thread || []).map(([role, text, calc, result], i) => ({ role, text, at: created + i * 60000, ...(calc ? { calc, result } : {}), ...(role !== "user" ? { inserted: role === "marker" && !calc && m.id === "demo-m-etc" } : {}) })),
      recallQ: m.q || null, recallA: m.a || null, due: m.remindIn ? now + m.remindIn : now + (m.dueIn ?? DAY), ivl: m.mastery === 2 ? 6 : m.mastery === 1 ? 2.5 : 1,
      links: m.links, remindAt: m.remindIn ? now + m.remindIn : null, createdAt: created, updatedAt: created
    };
    state.markers.set(rec.id, rec);
    await putMarker(rec);
    // keep the sample times (putMarker stamps "now")
    rec.updatedAt = created + (rec.thread.length ? rec.thread.length * 60000 : 0);
    state.markers.set(rec.id, rec);
    await db.markers.put(rec);
  }
  const days = [1, 2, 3, 4, 5].map(i => dayKey(now - i * DAY));
  await putMeta({ demoSeeded: true, demoVersion: 3, studyDays: [...new Set([...state.meta.studyDays, ...days])], points: Math.max(state.meta.points, 58) });
}

export async function removeDemo() {
  for (const n of [...state.notes.values()]) if (n.id.startsWith("demo-")) await putNote({ ...n, deleted: true });
  for (const m of [...state.markers.values()]) if (m.id.startsWith("demo-")) await putMarker({ ...m, deleted: true });
  for (const c of [...state.courses.values()]) if (c.id.startsWith("demo-")) await putCourse({ ...c, deleted: true });
}
