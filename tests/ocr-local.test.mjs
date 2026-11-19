/* Teste do parser do OCR local (sem navegador, sem dependências):  node tests/ocr-local.test.mjs
   As "fixtures" são a saída REAL do Tesseract (palavras + posições) lida em fotos de prateleira SINTÉTICAS (etiquetas desenhadas por
   script). Valem como regressão do parser, não como prova de precisão em fotos reais do estoque. */
import { createRequire } from "node:module"; import { readFileSync } from "node:fs"; import assert from "node:assert/strict";
const O = createRequire(import.meta.url)("../ocr-local.js"), F = n => JSON.parse(readFileSync(new URL("./fixtures/" + n, import.meta.url)));
const iou = (a, b) => { const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x), h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y); if (w <= 0 || h <= 0) return 0; const i = w * h; return i / (a.w * a.h + b.w * b.h - i); };
let falhas = 0; const ok = (nome, f) => { try { f(); console.log("✓", nome); } catch (e) { falhas++; console.log("✗", nome, "\n   ", e.message.split("\n")[0]); } };

ok("gerarTiles cobre a foto inteira com sobreposição", () => {
  const T = O.gerarTiles(3600, 2400); assert.equal(T.length, 6);
  assert.equal(Math.max(...T.map(t => t.x + t.w)), 3600); assert.equal(Math.max(...T.map(t => t.y + t.h)), 2400);
  assert.deepEqual(O.gerarTiles(1000, 800), [{ x: 0, y: 0, w: 1000, h: 800 }]);
});
ok("corrigeMedida: letras no lugar de número", () => { assert.equal(O.corrigeMedida("SEXF MB×1.25x18"), "SEXF M8x1,25x18"); assert.equal(O.corrigeMedida("PORCA M12x1,75"), "PORCA M12x1,75"); });
ok("lerRodape: qtd, data e lote", () => {
  const w = (t, x) => ({ t, c: 90, x0: x, x1: x + 50, y0: 0, y1: 20 });
  assert.deepEqual({ ...O.lerRodape([w("QTDE/QTY", 0), w("1500", 60), w("DATA/DATE", 120), w("12/1l/26", 200), w("CQ/QC", 280), w("6J885", 340)]), duv: undefined }, { qtd: 1500, data: "12/11/26", lote: "6J885", duv: undefined });
});
ok("temSelo: mancha preta larga sim, texto comum não", () => {
  const w = 400, h = 100, g = new Uint8Array(w * h).fill(255);
  for (let y = 0; y < h; y += 6) for (let x = 20; x < 380; x += 3) g[y * w + x] = 0; /* "texto": traços finos */
  assert.equal(O.temSelo(g, w, h, { x0: 0, x1: w, y0: 0, y1: h }, 40), false);
  for (let y = 30; y < 70; y++) for (let x = 150; x < 300; x++) g[y * w + x] = 0; /* selo */
  assert.equal(O.temSelo(g, w, h, { x0: 0, x1: w, y0: 0, y1: h }, 40), true);
});
for (const n of ["1", "2"]) {
  const b = F(`prateleira${n}.blocos.json`), gab = F(`prateleira${n}.gabarito.json`), Z = F(`prateleira${n}.zoom.json`);
  const ent = O.analisar(O.fundirTiles(b.blocos, b.W, b.H), b.W, b.H);
  const itens = ent.map((e, i) => { const z = Z[i], pc = z.palavras.map(p => ({ t: p.text, c: p.confidence, x0: z.R.x0 + p.bbox.x0 / z.s, x1: z.R.x0 + p.bbox.x1 / z.s, y0: z.R.y0 + p.bbox.y0 / z.s, y1: z.R.y0 + p.bbox.y1 / z.s })); const it = O.refinar(e, pc, b.W, b.H); if (z.selo) it.saldo = true; return it; });
  ok(`prateleira ${n}: acha as ${gab.length} etiquetas, uma por caixa`, () => {
    assert.equal(itens.length, gab.length);
    for (const t of gab) { const m = itens.map(i => iou(i.caixa, { x: t.box[0], y: t.box[1], w: t.box[2], h: t.box[3] })).sort((a, c) => c - a); assert.ok(m[0] > 0.5, "caixa de " + t.pa + " não casou"); }
  });
  ok(`prateleira ${n}: cliente, código, descrição, qtd e data corretos (≥ 90%)`, () => {
    let certos = 0, total = 0;
    for (const t of gab) { const i = itens.find(x => iou(x.caixa, { x: t.box[0], y: t.box[1], w: t.box[2], h: t.box[3] }) > 0.5); for (const k of ["cliente", "codCliente", "descricao", "qtd", "data"]) { total++; if (i[k] === t[k]) certos++; } }
    assert.ok(certos / total >= 0.9, certos + "/" + total);
  });
  ok(`prateleira ${n}: selo SALDO detectado`, () => { for (const t of gab) { const i = itens.find(x => iou(x.caixa, { x: t.box[0], y: t.box[1], w: t.box[2], h: t.box[3] }) > 0.5); assert.equal(i.saldo, t.saldo, t.pa); } });
}
process.exit(falhas ? 1 : 0);
