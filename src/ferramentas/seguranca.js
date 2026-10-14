'use strict';

/**
 * Segurança: proteger com senha, desbloquear e tarjar (ocultar de verdade).
 */

const crypto = require('crypto');
const { PDFName } = require('@cantoo/pdf-lib');

const pdf = require('../nucleo/pdf');
const pdfjs = require('../motores/pdfjs');
const ocr = require('../motores/ocr');
const camada = require('../motores/camada-texto');
const { semExtensao, booleano, limitar, ErroUsuario } = require('../nucleo/util');
const { registrar } = require('./index');

/* ============================================================
   PROTEGER
   ============================================================ */

async function proteger({ arquivos, opcoes }, ctx) {
  const senha = String(opcoes.senha || '');
  if (senha.length < 4) throw new ErroUsuario('Escolha uma senha com pelo menos 4 caracteres.');
  if (senha.length > 127) throw new ErroUsuario('A senha pode ter no máximo 127 caracteres.');
  const editar = booleano(opcoes.editar);
  // Senha do dono aleatória: as restrições não podem ser derrubadas adivinhando-a.
  const dono = crypto.randomBytes(24).toString('base64url');

  for (let i = 0; i < arquivos.length; i += 1) {
    ctx.checar();
    const a = arquivos[i];
    ctx.progresso((i / arquivos.length) * 95, `Protegendo ${a.nome}`);
    const doc = await pdf.abrir(a.caminhoPdf);
    doc.encrypt({
      userPassword: senha,
      ownerPassword: dono,
      algorithm: 'AES-256',
      permissions: {
        printing: booleano(opcoes.imprimir, true) ? 'highResolution' : false,
        copying: booleano(opcoes.copiar),
        contentAccessibility: true,
        modifying: editar,
        annotating: editar,
        fillingForms: editar,
        documentAssembly: editar,
      },
    });
    await ctx.gravar(`${semExtensao(a.nome)} - protegido.pdf`, await pdf.salvar(doc, { objetosCompactos: false }), { paginas: doc.getPageCount() });
  }
}

/* ============================================================
   DESBLOQUEAR
   ============================================================ */

/**
 * Os arquivos já chegam abertos: PDF só com restrições é liberado na entrada,
 * e o que pede senha foi aberto com a senha digitada. Aqui só salvamos a cópia
 * limpa, sem criptografia nenhuma.
 */
async function desbloquear({ arquivos }, ctx) {
  let jaLivres = 0;
  for (let i = 0; i < arquivos.length; i += 1) {
    ctx.checar();
    const a = arquivos[i];
    ctx.progresso((i / arquivos.length) * 95, `Desbloqueando ${a.nome}`);
    if (!a.protegido) jaLivres += 1;
    const doc = await pdf.abrir(a.caminhoPdf);
    await ctx.gravar(`${semExtensao(a.nome)} - desbloqueado.pdf`, await pdf.salvar(doc), { paginas: doc.getPageCount() });
  }
  if (jaLivres) {
    ctx.aviso(jaLivres === arquivos.length
      ? 'Nenhum dos arquivos tinha senha ou trava; eles saíram iguais.'
      : `${jaLivres} arquivo(s) não tinham senha nem trava.`);
  }
}

/* ============================================================
   TARJAR
   ============================================================ */

/** Remove tudo que poderia guardar o texto escondido fora do conteúdo da página. */
function limparEstrutura(doc) {
  for (const chave of ['StructTreeRoot', 'MarkInfo', 'Metadata', 'PieceInfo']) doc.catalog.delete(PDFName.of(chave));
  try {
    const form = doc.getForm();
    if (form.getFields().length) form.flatten();
  } catch (_) { /* sem formulário */ }
}

async function tarjar({ arquivos, opcoes }, ctx) {
  const a = arquivos[0];
  const tarjas = (Array.isArray(opcoes.elementos) ? opcoes.elementos : [])
    .filter((e) => Number(e.w) > 0 && Number(e.h) > 0);
  if (!tarjas.length) throw new ErroUsuario('Marque pelo menos um trecho para tarjar.');
  const comOcr = booleano(opcoes.ocr);
  const dpi = 200;

  ctx.progresso(3, 'Abrindo o documento...');
  const doc = await pdf.abrir(a.caminhoPdf);
  const total = doc.getPageCount();
  const porPagina = new Map();
  for (const t of tarjas) {
    const alvos = t.todas ? Array.from({ length: total }, (_, k) => k + 1) : [Number(t.pagina) || 1];
    for (const n of alvos) {
      if (n < 1 || n > total) continue;
      if (!porPagina.has(n)) porPagina.set(n, []);
      porPagina.get(n).push(t);
    }
  }
  if (!porPagina.size) throw new ErroUsuario('As tarjas estão fora das páginas do documento.');

  limparEstrutura(doc);
  const leitor = await pdfjs.abrir(a.caminhoPdf);
  const numeros = Array.from(porPagina.keys()).sort((x, y) => x - y);
  try {
    for (let i = 0; i < numeros.length; i += 1) {
      ctx.checar();
      const n = numeros[i];
      ctx.progresso(5 + (i / numeros.length) * 85, `Tarjando a página ${n}${comOcr ? ' e relendo o texto' : ''}...`);
      const desenho = await pdfjs.desenhar(leitor, n, {
        dpi,
        qualidade: 90,
        depois(c, vp, largura, altura) {
          c.fillStyle = '#000000';
          for (const t of porPagina.get(n)) {
            const folga = 1.5;
            c.fillRect(
              Math.floor(limitar(t.x, 0, 1, 0) * largura - folga),
              Math.floor(limitar(t.y, 0, 1, 0) * altura - folga),
              Math.ceil(limitar(t.w, 0, 1, 0) * largura + folga * 2),
              Math.ceil(limitar(t.h, 0, 1, 0) * altura + folga * 2),
            );
          }
        },
      });

      // Troca TODO o conteúdo da página pela imagem já tarjada.
      const pagina = doc.getPage(n - 1);
      const largura = desenho.larguraPt;
      const altura = desenho.alturaPt;
      const no = pagina.node;
      for (const chave of ['Contents', 'Annots', 'Thumb', 'PieceInfo', 'StructParents', 'TrimBox', 'BleedBox', 'ArtBox', 'Group', 'AA']) {
        no.delete(PDFName.of(chave));
      }
      no.set(PDFName.of('Resources'), doc.context.obj({}));
      no.normalized = false;
      pagina.setRotation(require('@cantoo/pdf-lib').degrees(0));
      pagina.setMediaBox(0, 0, largura, altura);
      pagina.setCropBox(0, 0, largura, altura);
      const img = await doc.embedJpg(desenho.bytes);
      pagina.drawImage(img, { x: 0, y: 0, width: largura, height: altura });

      if (comOcr) {
        try {
          const lido = await ocr.reconhecer(desenho.bytes, opcoes.idioma || 'por');
          await camada.escrever(doc, pagina, lido, desenho.escala);
        } catch (err) {
          ctx.aviso(err.usuario ? err.message : 'O texto das páginas tarjadas não pôde ser relido.');
        }
      }
    }
  } finally {
    leitor.destroy();
  }

  ctx.progresso(93, 'Apagando o conteúdo original...');
  await doc.flush();
  pdf.coletarLixo(doc); // sem isto, o texto original ainda ficaria escondido no arquivo
  await ctx.gravar(`${semExtensao(a.nome)} - tarjado.pdf`, await pdf.salvar(doc), { paginas: total });
  ctx.aviso(`${numeros.length === 1 ? 'A página tarjada virou imagem' : `As ${numeros.length} páginas tarjadas viraram imagem`}: o que estava embaixo das tarjas foi apagado de verdade.${comOcr ? '' : ' Nessas páginas o texto deixa de ser selecionável.'}`);
}

registrar('proteger', { executar: proteger });
registrar('desbloquear', { executar: desbloquear });
registrar('tarjar', { executar: tarjar, max: 1 });

module.exports = { proteger, desbloquear, tarjar };
