# Idfoto — FotoLocalizador

## Leitura de etiquetas sem IA e sem chave (OCR local)

O botão **Ler etiquetas → “Ler aqui no aparelho”** lê as etiquetas no próprio navegador, com Tesseract.js. Não usa chave, não envia a foto a ninguém e funciona offline depois da primeira vez. O resultado cai na mesma tela de conferência da leitura por IA, e **nada é salvo sem você ver**.

### Instalar (uma vez)

O app não consegue baixar o OCR sozinho: as bibliotecas (~25 MB) precisam estar na pasta `ocr/`, que o script abaixo cria.

```bash
cd ferramentas
npm install
npm run ocr          # (opcional) OCR_MODELO=fast npm run ocr  → modelo menor (~2 MB), um pouco menos exato
cd ..
git add ocr && git commit -m "OCR local" && git push
```

Sem a pasta `ocr/`, o botão avisa “OCR local não instalado”. A pasta `ferramentas/` fica separada de propósito, para a Vercel não instalar nada.

### Como funciona

1. A foto é fatiada em blocos de 1500 px (com sobreposição) e lida com Tesseract (modo texto esparso).
2. Cada etiqueta é achada pelo código **PA…** (fonte grande, o texto que o OCR lê melhor). Cliente, código, descrição, QTDE, data e lote são achados pela posição em relação ao PA.
3. **Zoom:** cada etiqueta é recortada na resolução original, ampliada e lida de novo como bloco. É isso que salva o rodapé pequeno (QTDE/data/lote).
4. O selo preto **SALDO** (letra branca em fundo preto, que o OCR não lê) é detectado pela mancha preta acima do PA.
5. Tudo passa por `validar()` (etiquetas.js): o que estiver fora do padrão, vazio ou em que as duas leituras discordam fica **amarelo**. A etiqueta cujo PA não foi lido não some: vem com PA vazio.

### Limites (leia antes de confiar)

- Foi testado com fotos de prateleira **sintéticas** (etiquetas desenhadas por script), não com fotos reais do estoque. Lá: 6/6 etiquetas achadas; cliente, código, descrição, quantidade e data corretos; erros restantes em B↔E no PA e J↔3 no lote, que são **os que mais passam sem alerta**. Confira o PA e o lote.
- Em fotos reais, etiquetas pequenas, tortas, com reflexo ou fora de foco rendem menos. Foto de perto (etiqueta com ≥ 450 px de largura) e bem iluminada ajuda muito.
- O retângulo da caixa é estimado a partir da etiqueta (`CAIXA_X/Y/BAIXO` em `ocr-local.js`); arraste/ajuste na conferência. Etiqueta girada (foto em pé de etiqueta deitada) não é lida.
- A leitura leva de ~15 s a ~1 min por foto, conforme o aparelho. Pode cancelar.
- A leitura por IA (`api/ler-etiquetas.js`) continua disponível e opcional; ela é a única que precisa de `ANTHROPIC_API_KEY`.

### Ajustes
Tudo em `CFG`, no topo de `ocr-local.js` (tamanho dos blocos, ampliação, limiares de dúvida, expansão da caixa).

### Teste automático do leitor
```bash
node tests/ocr-local.test.mjs
```
Usa saídas reais do Tesseract gravadas em `tests/fixtures/` (sem navegador e sem dependências).
