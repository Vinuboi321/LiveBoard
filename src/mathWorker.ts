import { calc } from "./mathCore";
self.onmessage = (e: MessageEvent<{ id: number; expr: string }>) => {
  const { id, expr } = e.data;
  try { (self as unknown as Worker).postMessage({ id, ok: true, value: calc(expr) }); }
  catch (err) { (self as unknown as Worker).postMessage({ id, ok: false, error: String((err as Error)?.message || err) }); }
};
