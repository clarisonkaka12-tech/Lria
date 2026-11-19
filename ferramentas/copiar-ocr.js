/* Copia os arquivos do OCR (Tesseract.js) de node_modules para ../ocr, que é a pasta que o app lê.
   Uso (uma vez, e de novo só se trocar de versão):   cd ferramentas && npm install && npm run ocr
   Depois, suba a pasta ocr/ junto com o resto no git. Modelo de idioma: "best" (mais exato, ~10 MB) ou "fast" (~2 MB):
   OCR_MODELO=fast npm run ocr */
"use strict";
const fs = require("fs"), path = require("path");
const destino = path.join(__dirname, "..", "ocr");
const modelo = process.env.OCR_MODELO === "fast" ? "fast" : "best_int";
const erro = m => { console.error("\n✗ " + m + "\n"); process.exit(1); };
const pacote = nome => { try { return path.dirname(require.resolve(nome + "/package.json", { paths: [__dirname] })); } catch (e) { return erro("pacote “" + nome + "” não encontrado. Rode primeiro:  npm install"); } };
const copiar = (de, para) => { fs.mkdirSync(path.dirname(para), { recursive: true }); fs.copyFileSync(de, para); console.log("  ✓ " + path.relative(path.join(__dirname, ".."), para) + "  (" + (fs.statSync(para).size / 1048576).toFixed(1) + " MB)"); };
const existe = f => fs.existsSync(f) || erro("arquivo esperado não existe: " + f + "\n  (versão diferente da 5.1.1? o app foi feito para a 5.1.1)");

const tess = pacote("tesseract.js"), core = pacote("tesseract.js-core"), dados = pacote("@tesseract.js-data/eng");
console.log("Copiando o OCR para " + destino);
for (const f of ["tesseract.min.js", "worker.min.js"]) { existe(path.join(tess, "dist", f)); copiar(path.join(tess, "dist", f), path.join(destino, f)); }
for (const f of ["tesseract-core-lstm.wasm.js", "tesseract-core-simd-lstm.wasm.js"]) { existe(path.join(core, f)); copiar(path.join(core, f), path.join(destino, "core", f)); }
/* idioma: procura eng.traineddata.gz na pasta do modelo escolhido */
const acha = (dir, achado = []) => { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const p = path.join(dir, e.name); if (e.isDirectory()) acha(p, achado); else if (e.name === "eng.traineddata.gz") achado.push(p); } return achado; };
const lista = acha(dados), eng = lista.find(p => p.includes(modelo)) || lista.find(p => p.includes("4.0.0")) || lista[0];
if (!eng) erro("eng.traineddata.gz não encontrado em @tesseract.js-data/eng");
copiar(eng, path.join(destino, "lang", "eng.traineddata.gz"));
console.log("\nPronto. Agora suba a pasta ocr/ no git junto com o app.");
