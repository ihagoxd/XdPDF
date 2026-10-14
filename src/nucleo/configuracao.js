'use strict';

/**
 * Preferências guardadas no disco (dados/config.json).
 */

const fs = require('fs');
const path = require('path');
const config = require('../config');

const PADRAO = {
  pastaSaida: path.join(config.pastaDownloadsPadrao(), 'XdPDF'),
  abrirPastaAoSalvar: true,
  idiomaOcr: 'por',
};

let atual = null;

function ler() {
  if (atual) return atual;
  try {
    atual = { ...PADRAO, ...JSON.parse(fs.readFileSync(config.ARQUIVO_CONFIG, 'utf8')) };
  } catch (_) {
    atual = { ...PADRAO };
  }
  return atual;
}

function salvar(parcial) {
  const novo = { ...ler() };
  if (typeof parcial.pastaSaida === 'string' && parcial.pastaSaida.trim()) novo.pastaSaida = parcial.pastaSaida.trim();
  if (typeof parcial.abrirPastaAoSalvar === 'boolean') novo.abrirPastaAoSalvar = parcial.abrirPastaAoSalvar;
  if (['por', 'eng', 'por+eng'].includes(parcial.idiomaOcr)) novo.idiomaOcr = parcial.idiomaOcr;
  atual = novo;
  fs.writeFileSync(config.ARQUIVO_CONFIG, JSON.stringify(novo, null, 2), 'utf8');
  return novo;
}

module.exports = { ler, salvar, PADRAO };
