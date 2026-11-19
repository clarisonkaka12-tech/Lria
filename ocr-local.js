/* FotoLocalizador — ocr-local.js (v12)
   Leitura LOCAL de etiquetas: sem IA, sem chave, sem enviar a foto a ninguém. Roda no navegador com Tesseract.js (OCR) e funciona offline
   depois da primeira vez. Entrega o mesmo formato "fotolocalizador-etiquetas" v1 que a leitura por IA, então passa pela mesma validação
   e pela mesma tela de conferência.
   Duas camadas:
     1) PARSER PURO (sem DOM, testável no Node): palavras do OCR + posições → lista de etiquetas.  → lerPalavras(), fundirTiles(), gerarTiles()
     2) EXECUTOR (só no navegador): fatia a foto em blocos, roda o Tesseract em cada um e junta as palavras. → lerFoto()
   Âncora de cada etiqueta = o código "PA…" (fonte grande, 12 caracteres): é o texto mais fácil de o OCR ler. Os demais campos são
   achados pela posição (acima: cliente, código, descrição; abaixo: QTDE, DATA, LOTE). O que não bater fica vazio → amarelo na conferência. */
"use strict";
(function (g) {
/* ---------- ajustes (mexa aqui) ---------- */
const CFG = {
  BASE: "ocr/",          /* pasta com tesseract.min.js, worker.min.js, core/ e lang/ (criada por "npm run ocr") */
  MAX_LADO: 3600,        /* maior lado de trabalho: foto maior é reduzida; menor é AMPLIADA (o app guarda no máx. 2560 px e texto pequeno rende mais ampliado) */
  AMPLIAR_MAX: 2,        /* teto da ampliação (2 = no máximo o dobro) */
  TILE: 1500, SOBRA: 300,/* blocos de 1500 px com 300 px de sobreposição */
  CONF_MIN: 25,          /* palavras com confiança menor que isso são lixo e nem entram */
  CONF_DUVIDA: 70,       /* campo cuja confiança média fica abaixo disso vai para "duvidas" (amarelo) */
  JANELA_X: 1.35,        /* meia-largura da etiqueta, em larguras do código PA, a partir do centro do PA */
  ACIMA: 6.5, ABAIXO: 1.9,/* alcance vertical (em alturas do PA): texto acima do PA / rodapé abaixo do PA */
  CAIXA_X: 0.30, CAIXA_Y: 0.20, CAIXA_BAIXO: 1.6 /* da etiqueta para a face de papelão: sobra lateral/vertical (fração da etiqueta) e código de barras (alturas do PA) */
};

/* ---------- utilidades ---------- */
const up = t => String(t == null ? "" : t).toUpperCase();
const alnum = t => up(t).replace(/[^A-Z0-9]/g, "");
const dig = t => up(t).replace(/[OQD]/g, "0").replace(/[IL|]/g, "1").replace(/S/g, "5").replace(/B/g, "8").replace(/Z/g, "2").replace(/G/g, "6"); /* só em trechos que SÃO número */
const cx = w => (w.x0 + w.x1) / 2, cy = w => (w.y0 + w.y1) / 2, hh = w => w.y1 - w.y0, ww = w => w.x1 - w.x0;
const media = a => a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const iouPx = (a, b) => {
  const w = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0), h = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
  if (w <= 0 || h <= 0) return 0; const i = w * h; return i / (ww(a) * hh(a) + ww(b) * hh(b) - i);
};
/* aceita o formato do Tesseract.js ({text, confidence, bbox:{x0,y0,x1,y1}}) e o nosso ({t,c,x0,y0,x1,y1}) */
function palavra(w) {
  const b = w.bbox || w, t = w.t != null ? w.t : w.text, c = w.c != null ? w.c : w.confidence;
  return { t: String(t == null ? "" : t).trim(), c: +c || 0, x0: +b.x0, y0: +b.y0, x1: +b.x1, y1: +b.y1 };
}
const palavraOk = w => w.t && [w.x0, w.y0, w.x1, w.y1].every(isFinite) && w.x1 > w.x0 && w.y1 > w.y0 && w.c >= CFG.CONF_MIN;

/* ---------- 1. blocos (tiles) ---------- */
function gerarTiles(W, H, T = CFG.TILE, S = CFG.SOBRA) {
  const eixo = L => { if (L <= T) return [[0, L]]; const passo = T - S, n = Math.ceil((L - S) / passo), out = []; for (let i = 0; i < n; i++) { const a = Math.min(i * passo, L - T); out.push([a, T]); } return out; };
  const xs = eixo(W), ys = eixo(H), out = [];
  for (const [y, h] of ys) for (const [x, w] of xs) out.push({ x, y, w, h });
  return out;
}
/* junta as palavras de todos os blocos (coordenadas locais → da foto). Palavras coladas numa borda INTERNA de bloco estão cortadas: descarta
   (o bloco vizinho, por causa da sobreposição, leu a palavra inteira). Palavras repetidas nas sobreposições são unidas. */
function fundirTiles(blocos, W, H) {
  const todas = [];
  for (const b of blocos) {
    const t = b.tile, margem = 3;
    for (const raw of b.palavras) {
      const w = palavra(raw); if (!palavraOk(w)) continue;
      w.x0 += t.x; w.x1 += t.x; w.y0 += t.y; w.y1 += t.y;
      const cortaE = t.x > 0 && w.x0 - t.x <= margem, cortaD = t.x + t.w < W && t.x + t.w - w.x1 <= margem;
      const cortaC = t.y > 0 && w.y0 - t.y <= margem, cortaB = t.y + t.h < H && t.y + t.h - w.y1 <= margem;
      if (cortaE || cortaD || cortaC || cortaB) continue;
      todas.push(w);
    }
  }
  todas.sort((a, b) => a.x0 - b.x0);
  const out = [];
  for (const w of todas) {
    let dup = false;
    for (let i = out.length - 1; i >= 0 && w.x0 - out[i].x0 < 4 * Math.max(ww(w), 40); i--) {
      const o = out[i];
      if (alnum(o.t) === alnum(w.t) && iouPx(o, w) > 0.4) { if (w.c > o.c) out[i] = w; dup = true; break; }
    }
    if (!dup) out.push(w);
  }
  return out;
}

/* ---------- 2. linhas e âncoras ---------- */
function linhas(ws) {
  const v = ws.slice().sort((a, b) => cy(a) - cy(b)), L = [];
  for (const w of v) {
    const l = L[L.length - 1];
    if (l && Math.abs(l.cy - cy(w)) < 0.6 * Math.min(hh(w), l.h)) { l.ws.push(w); l.cy = media(l.ws.map(cy)); l.h = Math.max(l.h, hh(w)); }
    else L.push({ ws: [w], cy: cy(w), h: hh(w) });
  }
  for (const l of L) {
    l.ws.sort((a, b) => a.x0 - b.x0);
    l.texto = l.ws.map(w => w.t).join(" "); l.y0 = Math.min(...l.ws.map(w => w.y0)); l.y1 = Math.max(...l.ws.map(w => w.y1));
    l.x0 = Math.min(...l.ws.map(w => w.x0)); l.x1 = Math.max(...l.ws.map(w => w.x1));
  }
  return L;
}
/* código PA: "PA" + 10 caracteres (às vezes o OCR separa "PA" do resto; aceita 11–13 caracteres e marca como duvidoso) */
function acharAncoras(ws) {
  const ancoras = [], usadas = new Set();
  for (const l of linhas(ws)) {
    for (let i = 0; i < l.ws.length; i++) {
      let w = l.ws[i], n = alnum(w.t), partes = [w];
      if ((n === "PA" || n === "P4") && l.ws[i + 1] && l.ws[i + 1].x0 - w.x1 < 1.5 * hh(w)) { const nx = l.ws[i + 1], m = alnum(nx.t); if (m.length >= 9 && m.length <= 11) { n = "PA" + m; partes = [w, nx]; } }
      if (!/^P[A4]/.test(n) || n.length < 11 || n.length > 13) continue;
      if (((n.slice(2).match(/[0-9]/g)) || []).length < 4) continue; /* "PARAFUSOSEXT" não é PA */
      const x0 = Math.min(...partes.map(p => p.x0)), x1 = Math.max(...partes.map(p => p.x1)), y0 = Math.min(...partes.map(p => p.y0)), y1 = Math.max(...partes.map(p => p.y1));
      const a = { t: "PA" + n.slice(2), c: Math.min(...partes.map(p => p.c)), x0, x1, y0, y1, partes, duvidoso: n.length !== 12 };
      if (ancoras.some(o => iouPx(o, a) > 0.3)) continue;
      partes.forEach(p => usadas.add(p)); ancoras.push(a);
    }
  }
  return { ancoras, usadas };
}
/* cada palavra restante pertence a UMA etiqueta: a âncora horizontalmente mais próxima, entre as que a alcançam na vertical */
function repartir(ws, ancoras) {
  const grupos = ancoras.map(() => []);
  for (const w of ws) {
    let melhor = -1, mx = 1e9, mv = 1e9;
    ancoras.forEach((a, k) => {
      const pw = Math.max(ww(a), 1), ph = Math.max(hh(a), 1), dx = Math.abs(cx(w) - cx(a)) / pw;
      if (dx > CFG.JANELA_X) return;
      const dy = cy(w) - cy(a), dv = dy > 0 ? (w.y0 - a.y1) / ph : (a.y0 - w.y1) / ph;
      if (dy > 0 ? dv > CFG.ABAIXO : dv > CFG.ACIMA) return;
      const v = Math.abs(dv);
      if (dx < mx - 0.3 || (Math.abs(dx - mx) <= 0.3 && v < mv)) { melhor = k; mx = dx; mv = v; }
    });
    if (melhor >= 0) grupos[melhor].push(w);
  }
  return grupos;
}

/* ---------- 3. leitura dos campos de uma etiqueta ---------- */
const RE_PA = /^PA[A-Z0-9]{10}$/;
const RE_MARCA = /^(M[E3]T[A4]L[A4]C|S[A4]LD[O0])$/;
const RE_DATA = /([0-9OQIL]{2})\s*[\/.\-]\s*([0-9OQIL]{2})\s*[\/.\-]\s*([0-9OQIL]{4}|[0-9OQIL]{2})/;
const RE_MEDIDA = /\d\s*[xX×*]\s*\d/;
function corrigeMedida(s) { /* "SEXF MB×1.25x18" → "SEXF M8x1,25x18": só depois do "M" e só em trechos que são medida */
  return s.replace(/×/g, "x").replace(/\bM([0-9OIBSLZ]{1,2})\s*[xX*]\s*([0-9OIBSLZ.,]+)(?:\s*[xX*]\s*([0-9OIBSLZ.,]+))?/, (_, a, b, c) => "M" + dig(a) + "x" + dig(b).replace(".", ",") + (c ? "x" + dig(c).replace(".", ",") : ""));
}
const texto = ws => ws.slice().sort((a, b) => a.x0 - b.x0).map(w => w.t).join(" ").replace(/\s+/g, " ").trim();
const confMedia = ws => media(ws.map(w => w.c));

function lerRodape(ws) { /* QTDE · DATA · LOTE (CQ) */
  const duv = [], tok = ws.slice().sort((a, b) => a.x0 - b.x0).map(w => ({ w, n: alnum(w.t), t: up(w.t) })).filter(x => x.n);
  const junto = tok.map(x => x.t).join(" ");
  const out = { qtd: "", data: "", lote: "" };
  /* data */
  const md = junto.match(RE_DATA);
  let usadoData = null;
  if (md) { const [d, m, a] = [md[1], md[2], md[3]].map(dig); out.data = d + "/" + m + "/" + a; usadoData = tok.filter(x => RE_DATA.test(x.t) || x.t.includes(md[0].slice(0, 2))).map(x => x.w); }
  const eData = x => RE_DATA.test(x.t) || /^[0-9OQIL]{2}[\/.\-][0-9OQIL]{2}/.test(x.t);
  /* lote: 5 caracteres, maioria dígitos, que não seja a data */
  const cand = tok.filter(x => !eData(x) && x.n.length === 5 && (dig(x.n).match(/[0-9]/g) || []).length >= 3);
  const iCQ = tok.findIndex(x => /^(CQ|QC)/.test(x.n)), depoisCQ = iCQ >= 0 ? cand.find(x => tok.indexOf(x) > iCQ) : null;
  const lt = depoisCQ || cand[cand.length - 1]; if (lt) out.lote = lt.n;
  /* quantidade: número logo depois de QTDE/QTY; senão, o primeiro número puro que não seja data/lote */
  const iQ = tok.findIndex(x => /^(QTDE|QTY|QTD)/.test(x.n)); let q = null;
  const puro = x => x.n.length <= 7 && (x.n.match(/[0-9OQILSB]/g) || []).length === x.n.length && /[0-9]/.test(x.n) && x !== lt && !eData(x);
  if (iQ >= 0) q = tok.slice(iQ + 1).find(puro);
  if (!q) q = tok.find(puro);
  if (q) { const v = +dig(q.n); if (v > 0) out.qtd = v; }
  const cf = { qtd: q ? [q.w] : [], data: usadoData || [], lote: lt ? [lt.w] : [] };
  for (const k of Object.keys(cf)) if (cf[k].length && confMedia(cf[k]) < CFG.CONF_DUVIDA) duv.push(k);
  return { ...out, duv };
}

function lerGrupo(a, ws, W, H) {
  const todos = ws.filter(w => !RE_MARCA.test(alnum(w.t)));
  const saldo = ws.some(w => /^S[A4]LD[O0]$/.test(alnum(w.t)));
  const L = linhas(todos.concat([a])), iPA = L.findIndex(l => l.ws.includes(a));
  const acima = L.slice(0, iPA).filter(l => l.texto.replace(/[^A-Za-z0-9]/g, "").length >= 2), abaixo = L.slice(iPA + 1, iPA + 3);
  const duvidas = [], it = { cliente: "", codCliente: "", descricao: "", pa: a.t, saldo };
  if (a.duvidoso || a.c < CFG.CONF_DUVIDA) duvidas.push("pa");
  /* descrição: a linha de baixo para cima que parece medida (M8x1,25x18); o que está acima dela é cliente / código do cliente */
  let iD = -1;
  for (let i = acima.length - 1; i >= 0; i--) if (RE_MEDIDA.test(acima[i].texto) && /\bM\s?[0-9OIBSL]/i.test(acima[i].texto)) { iD = i; break; }
  if (iD < 0) for (let i = acima.length - 1; i >= 0; i--) if (RE_MEDIDA.test(acima[i].texto)) { iD = i; break; }
  let U = acima;
  if (iD >= 0) {
    const l = acima[iD]; it.descricao = corrigeMedida(up(l.texto)); if (confMedia(l.ws) < CFG.CONF_DUVIDA) duvidas.push("descricao");
    U = acima.slice(0, iD);
  }
  const numerico = l => { const s = l.texto.replace(/[^A-Za-z0-9]/g, ""); return s && (s.match(/[0-9]/g) || []).length / s.length >= 0.3; };
  if (U.length >= 2) {
    const c = U[U.length - 1], cli = U.slice(0, -1);
    it.codCliente = up(c.texto); it.cliente = up(cli.map(l => l.texto).join(" "));
    if (confMedia(c.ws) < CFG.CONF_DUVIDA) duvidas.push("codCliente"); if (confMedia(cli.flatMap(l => l.ws)) < CFG.CONF_DUVIDA) duvidas.push("cliente");
  } else if (U.length === 1) {
    const l = U[0], k = numerico(l) ? "codCliente" : "cliente";
    it[k] = up(l.texto); if (confMedia(l.ws) < CFG.CONF_DUVIDA) duvidas.push(k);
  }
  const rod = lerRodape(abaixo.flatMap(l => l.ws)); it.qtd = rod.qtd; it.data = rod.data; it.lote = rod.lote; duvidas.push(...rod.duv);
  /* caixa: texto da etiqueta → etiqueta com código de barras → face de papelão */
  const usados = todos.filter(w => acima.some(l => l.ws.includes(w)) || abaixo.some(l => l.ws.includes(w))).concat([a]);
  let x0 = Math.min(...usados.map(w => w.x0)), x1 = Math.max(...usados.map(w => w.x1)), y0 = Math.min(...usados.map(w => w.y0)), y1 = Math.max(...usados.map(w => w.y1) ) + CFG.CAIXA_BAIXO * hh(a);
  const lw = x1 - x0, lh = y1 - y0, texto0 = { x0: Math.min(...usados.map(w => w.x0)), x1: Math.max(...usados.map(w => w.x1)), y0: Math.min(...usados.map(w => w.y0)), y1: Math.max(...usados.map(w => w.y1)) };
  x0 -= CFG.CAIXA_X * lw; x1 += CFG.CAIXA_X * lw; y0 -= CFG.CAIXA_Y * lh; y1 += CFG.CAIXA_Y * lh;
  const cortada = x0 < 0 || y0 < 0 || x1 > W || y1 > H;
  x0 = clamp(x0, 0, W); x1 = clamp(x1, 0, W); y0 = clamp(y0, 0, H); y1 = clamp(y1, 0, H);
  const conf = clamp(media([a.c, ...usados.map(w => w.c)]) / 100, 0.3, 0.95);
  return { _r: texto0, caixa: { x: x0 / W, y: y0 / H, w: (x1 - x0) / W, h: (y1 - y0) / H }, ...it, cortada, duvidas: [...new Set(duvidas)], confianca: Math.round(conf * 100) / 100 };
}

/* 1ª passada: palavras da foto inteira (escala W×H) → etiquetas achadas, cada uma com sua âncora PA */
function analisar(palavras, W, H) {
  const ws = palavras.map(palavra).filter(palavraOk);
  const { ancoras, usadas } = acharAncoras(ws);
  const resto = ws.filter(w => !usadas.has(w));
  /* resgate: etiqueta cujo PA o OCR não leu na foto inteira, mas cuja linha de descrição (M8x1,25x18) sobrou sem dono → âncora provisória
     logo abaixo dela; o "zoom" da 2ª passada lê o PA de verdade. Sem o zoom, o item sai com PA vazio (amarelo), nunca some. */
  const dono = new Set(repartir(resto, ancoras).flat()), sobra = resto.filter(w => !dono.has(w)), prov = [];
  for (const l of linhas(sobra)) {
    if (!RE_MEDIDA.test(l.texto) || !/\bM\s?[0-9OIBSL]/i.test(l.texto)) continue;
    const lh = l.y1 - l.y0; prov.push({ t: "", c: 0, x0: l.x0, x1: l.x1, y0: l.y1 + 0.9 * lh, y1: l.y1 + 3.1 * lh, partes: [], duvidoso: true, provisoria: true });
  }
  const todas = ancoras.concat(prov), grupos = repartir(resto, todas);
  return todas.map((a, k) => { const { _r, ...it } = lerGrupo(a, grupos[k], W, H); return { a, r: _r, it }; });
}
const empacotar = itens => ({ format: "fotolocalizador-etiquetas", version: 1, itens });
const lerPalavras = (palavras, W, H) => empacotar(analisar(palavras, W, H).map(e => e.it));

/* 2ª passada ("zoom"): o texto pequeno do rodapé (QTDE, data, lote) quase nunca sai bem na foto inteira. Então cada etiqueta achada é
   recortada na resolução ORIGINAL, ampliada e lida de novo, como um bloco só (modo de página 6). Aqui: onde recortar e como juntar. */
function retanguloRefino(e, W, H) { /* largura da etiqueta = largura do texto achado (não depende do tamanho do PA); altura vai até o rodapé */
  const a = e.a, ph = hh(a), u = { x0: Math.min(e.r.x0, a.x0), x1: Math.max(e.r.x1, a.x1), y0: Math.min(e.r.y0, a.y0) }, m = 0.2 * (u.x1 - u.x0);
  return { x0: clamp(u.x0 - m, 0, W), x1: clamp(u.x1 + m, 0, W), y0: clamp(u.y0 - 0.5 * ph, 0, H), y1: clamp(Math.max(e.r.y1, a.y1 + 2.4 * ph), 0, H) };
}
/* selo preto "SALDO" (letras brancas em fundo preto: o OCR quase não lê). Procura, na faixa logo acima do PA, uma mancha preta larga:
   linhas com sequência escura longa (≥ 0.9 altura do PA) — traço de letra nunca chega a isso. gray = tons de cinza w×h (já com contraste esticado). */
function temSelo(gray, w, h, faixa, ph) {
  const y0 = clamp(Math.round(faixa.y0), 0, h), y1 = clamp(Math.round(faixa.y1), 0, h), x0 = clamp(Math.round(faixa.x0), 0, w), x1 = clamp(Math.round(faixa.x1), 0, w);
  const jan = Math.max(8, Math.round(0.9 * ph)); let linhas = 0;
  if (x1 - x0 < jan) return false;
  for (let y = y0; y < y1; y++) {
    let n = 0, best = 0; /* pretos dentro de uma janela deslizante de 0.9 altura do PA; letra de texto comum fica em ~30%, o selo passa de 60% */
    for (let x = x0; x < x1; x++) { if (gray[y * w + x] < 80) n++; if (x - x0 >= jan && gray[y * w + x - jan] < 80) n--; if (n > best) best = n; }
    if (best >= 0.6 * jan) linhas++;
  }
  return linhas >= 0.15 * ph;
}
function refinar(e, palavrasCrop, W, H) { /* palavrasCrop já em coordenadas da foto W×H; devolve o item mesclado (campo vazio na 2ª passada = mantém o da 1ª) */
  const r2 = analisar(palavrasCrop, W, H).map(x => ({ ...x, d: Math.hypot(cx(x.a) - cx(e.a), cy(x.a) - cy(e.a)) })).sort((p, q) => p.d - q.d)[0];
  if (!r2 || r2.d > 2 * Math.max(hh(e.a), hh(r2.a))) return e.it;
  const i1 = e.it, i2 = r2.it, it = { ...i2 }, duv = new Set();
  for (const k of ["cliente", "codCliente", "descricao", "pa", "qtd", "data", "lote"]) {
    const v1 = i1[k], v2 = i2[k], d1 = i1.duvidas.includes(k), d2 = i2.duvidas.includes(k);
    if (v2 === "" || v2 == null) { it[k] = v1; if (d1) duv.add(k); }
    else if (v1 === "" || v1 == null || v1 === v2) { if (d2) duv.add(k); }
    else if (k === "pa") { /* duas leituras do PA: vale a que tem o formato certo (PA + 10); se as duas têm, a de maior confiança, e fica amarelo */
      const ok1 = RE_PA.test(v1), ok2 = RE_PA.test(v2);
      it.pa = ok1 !== ok2 ? (ok1 ? v1 : v2) : (e.a.c > r2.a.c + 10 ? v1 : v2); if (ok1 === ok2) duv.add("pa");
    } else { it[k] = d2 && !d1 ? v1 : v2; duv.add(k); } /* as duas leituras discordam → amarelo */
  }
  it.saldo = !!(i1.saldo || i2.saldo); it.cortada = i1.cortada && i2.cortada; it.duvidas = [...duv];
  it.caixa = i2.caixa; it.confianca = Math.max(i1.confianca, i2.confianca);
  return it;
}

/* ---------- 4. EXECUTOR (navegador) ---------- */
let tessP = null;
function carregarTesseract() {
  if (g.Tesseract) return Promise.resolve(g.Tesseract);
  return tessP || (tessP = new Promise((ok, no) => {
    const s = document.createElement("script"); s.src = CFG.BASE + "tesseract.min.js";
    s.onload = () => g.Tesseract ? ok(g.Tesseract) : (tessP = null, no(new Error("o arquivo do OCR carregou mas está incompleto (refaça: npm run ocr)")));
    s.onerror = () => { tessP = null; no(new Error("OCR local não instalado: faltam os arquivos da pasta ocr/ (rode “npm install” e “npm run ocr”; veja o README)")); };
    document.head.append(s);
  }));
}
function preparar(ctx, w, h) { /* tons de cinza + esticar o contraste (percentis 2%–98%): ajuda em foto de galpão com luz ruim */
  const im = ctx.getImageData(0, 0, w, h), d = im.data, hist = new Uint32Array(256);
  for (let i = 0; i < d.length; i += 4) { const y = (d[i] * 77 + d[i + 1] * 150 + d[i + 2] * 29) >> 8; d[i] = y; hist[y]++; }
  const total = d.length / 4; let a = 0, lo = 0, hi = 255, s = 0;
  for (; lo < 255; lo++) { s += hist[lo]; if (s >= total * 0.02) break; }
  s = 0; for (hi = 255; hi > 0; hi--) { s += hist[hi]; if (s >= total * 0.02) break; }
  const k = hi - lo > 30 ? 255 / (hi - lo) : 1;
  for (let i = 0; i < d.length; i += 4) { const v = clamp((d[i] - lo) * k, 0, 255); d[i] = d[i + 1] = d[i + 2] = v; }
  ctx.putImageData(im, 0, 0);
}
function palavrasDe(data) { /* Tesseract.js 5: data.words; por garantia, também percorre blocks */
  if (Array.isArray(data.words) && data.words.length) return data.words;
  const out = []; for (const b of data.blocks || []) for (const p of b.paragraphs || []) for (const l of p.lines || []) for (const w of l.words || []) out.push(w);
  return out;
}
const abortou = () => { const e = new Error("cancelado"); e.name = "AbortError"; return e; };

/* blob da foto → { format, version, itens }. opts: { sinal: AbortSignal, aoProgresso(texto) } */
async function lerFoto(blob, opts = {}) {
  const { sinal, aoProgresso = () => {} } = opts;
  if (sinal && sinal.aborted) throw abortou();
  aoProgresso("Carregando o leitor de texto…");
  const Tess = await carregarTesseract();
  const bm = await createImageBitmap(blob), k = Math.min(CFG.AMPLIAR_MAX, CFG.MAX_LADO / Math.max(bm.width, bm.height));
  const W = Math.round(bm.width * k), H = Math.round(bm.height * k), tiles = gerarTiles(W, H);
  let worker = null, cancelou = false;
  const parar = () => { cancelou = true; if (worker) worker.terminate().catch(() => {}); };
  if (sinal) sinal.addEventListener("abort", parar, { once: true });
  try {
    worker = await Tess.createWorker("eng", 1, { workerPath: CFG.BASE + "worker.min.js", corePath: CFG.BASE + "core/", langPath: CFG.BASE + "lang/", gzip: true, workerBlobURL: false, logger: () => {} });
    if (cancelou) throw abortou();
    await worker.setParameters({ tessedit_pageseg_mode: "11", preserve_interword_spaces: "1", user_defined_dpi: "300" });
    const cv = document.createElement("canvas"), ctx = cv.getContext("2d", { willReadFrequently: true }), blocos = [];
    ctx.imageSmoothingQuality = "high";
    for (let i = 0; i < tiles.length; i++) {
      if (cancelou) throw abortou();
      aoProgresso("Lendo a foto: parte " + (i + 1) + " de " + tiles.length + "…");
      const t = tiles[i]; cv.width = t.w; cv.height = t.h;
      ctx.drawImage(bm, t.x / k, t.y / k, t.w / k, t.h / k, 0, 0, t.w, t.h); preparar(ctx, t.w, t.h);
      const img = await new Promise((ok, no) => cv.toBlob(b => b ? ok(b) : no(new Error("não foi possível preparar a foto")), "image/png"));
      let r; try { r = await worker.recognize(img); } catch (e) { if (cancelou) throw abortou(); throw e; }
      blocos.push({ tile: t, palavras: palavrasDe(r.data).map(w => ({ text: w.text, confidence: w.confidence, bbox: w.bbox })) });
    }
    aoProgresso("Montando as etiquetas…");
    const ent = analisar(fundirTiles(blocos, W, H), W, H);
    /* 2ª passada: zoom em cada etiqueta, na resolução original */
    await worker.setParameters({ tessedit_pageseg_mode: "6" });
    for (let i = 0; i < ent.length; i++) {
      if (cancelou) throw abortou();
      aoProgresso("Conferindo etiqueta " + (i + 1) + " de " + ent.length + "…");
      const R = retanguloRefino(ent[i], W, H), s = clamp(120 / Math.max(hh(ent[i].a) / k, 1), 1, 3);
      const sw = Math.max(1, Math.round((R.x1 - R.x0) / k * s)), sh = Math.max(1, Math.round((R.y1 - R.y0) / k * s));
      if (sw * sh > 16e6) continue;
      cv.width = sw; cv.height = sh; ctx.drawImage(bm, R.x0 / k, R.y0 / k, (R.x1 - R.x0) / k, (R.y1 - R.y0) / k, 0, 0, sw, sh); preparar(ctx, sw, sh);
      const e = ent[i], ph = hh(e.a), ks = s / k, gd = ctx.getImageData(0, 0, sw, sh).data, gray = new Uint8Array(sw * sh);
      for (let q = 0; q < gray.length; q++) gray[q] = gd[q * 4];
      const selo = temSelo(gray, sw, sh, { x0: (e.r.x0 - R.x0) * ks, x1: (e.r.x1 - R.x0) * ks, y0: (e.a.y0 - 1.25 * ph - R.y0) * ks, y1: (e.a.y0 - 0.05 * ph - R.y0) * ks }, ph * ks);
      const img = await new Promise((ok, no) => cv.toBlob(b => b ? ok(b) : no(new Error("não foi possível preparar a foto")), "image/png"));
      let r; try { r = await worker.recognize(img); } catch (er) { if (cancelou) throw abortou(); if (selo) e.it.saldo = true; continue; } /* falha só no zoom: fica a 1ª leitura */
      const pc = palavrasDe(r.data).map(palavra).map(w => ({ ...w, x0: R.x0 + w.x0 * k / s, x1: R.x0 + w.x1 * k / s, y0: R.y0 + w.y0 * k / s, y1: R.y0 + w.y1 * k / s }));
      e.it = refinar(e, pc, W, H); if (selo) e.it.saldo = true;
    }
    return empacotar(ent.map(e => e.it));
  } finally {
    if (sinal) sinal.removeEventListener("abort", parar);
    bm.close(); if (worker && !cancelou) await worker.terminate().catch(() => {});
  }
}

const API = { CFG, lerFoto, lerPalavras, analisar, refinar, retanguloRefino, temSelo, empacotar, fundirTiles, gerarTiles, acharAncoras, lerRodape, corrigeMedida };
if (typeof module !== "undefined" && module.exports) module.exports = API; else g.FLOcr = API;
})(typeof window !== "undefined" ? window : globalThis);
