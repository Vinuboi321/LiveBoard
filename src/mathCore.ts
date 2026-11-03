/* The calculator. Runs inside a worker (mathWorker.ts) so a runaway expression can be stopped; see evaluate() in ai.ts.
   64 significant digits (BigNumber) by default, so large integers and long decimals stay exact.
   A few functions only exist for ordinary floating-point numbers; those fall back to 15-16 digits and say so. */
import { all, create, type MathJsInstance } from "mathjs";

const BLOCKED = ["import", "createUnit", "evaluate", "parse", "compile", "simplify", "derivative", "resolve", "reviver", "rationalize", "chain"];
function harden(m: MathJsInstance) {
  const evaluate = m.evaluate.bind(m);
  const deny = Object.fromEntries(BLOCKED.map(name => [name, () => { throw new Error(`${name} isn't available in the calculator.`); }]));
  m.import(deny, { override: true });
  return evaluate;
}
let big: ReturnType<typeof harden> | null = null, float: ReturnType<typeof harden> | null = null;
let bigM: MathJsInstance, floatM: MathJsInstance;
function engines() {
  if (!big || !float) {
    bigM = create(all, { number: "BigNumber", precision: 64 });
    floatM = create(all, {});
    big = harden(bigM);
    float = harden(floatM);
  }
  return { big: big!, float: float! };
}

export const MAX_EXPR = 300;
const normalize = (expr: string) => expr.replace(/×/g, "*").replace(/÷/g, "/").replace(/−/g, "-").replace(/π/g, "pi").replace(/√\s*\(/g, "sqrt(");

export function calc(expr: string): string {
  if (expr.length > MAX_EXPR) throw new Error("That expression is too long.");
  const { big, float } = engines();
  const e = normalize(expr);
  // factorials and powers of huge numbers can take minutes or exhaust memory; the worker timeout is the backstop
  if (/\d{4,}\s*!|\^\s*\(?\s*\d{6,}/.test(e)) throw new Error("That number is too large to calculate here.");
  const fmt = { precision: 20, lowerExp: -9, upperExp: 30 };
  try {
    const v = big(e);
    if (typeof v === "function" || v === undefined) throw new Error("That isn't something to calculate.");
    return bigM.format(v, fmt);
  } catch (err) {
    const msg = String((err as Error)?.message || err);
    if (/isn't something|isn't available|too large|too long/.test(msg) || /Undefined symbol|Unexpected|Parenthesis|SyntaxError/.test(msg)) throw err;
    const v = float(e);
    if (typeof v === "function" || v === undefined) throw new Error("That isn't something to calculate.");
    return floatM.format(v, { precision: 14 }) + " (≈, 15-digit precision)";
  }
}
