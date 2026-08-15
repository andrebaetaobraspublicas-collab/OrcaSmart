const PARAMETROS_VERSAO = '2026-08-15';

const PARAMETROS_TRIBUTARIOS = Object.freeze({
  2026: Object.freeze({ cbs: 0, ibs: 0, pis: 0.65, cofins: 3, iss: 3, cprb: 2.7 }),
  2027: Object.freeze({ cbs: 8.7, ibs: 0.1, pis: 0, cofins: 0, iss: 3, cprb: 1.8 }),
  2028: Object.freeze({ cbs: 8.7, ibs: 0.1, pis: 0, cofins: 0, iss: 3, cprb: 0 }),
  2029: Object.freeze({ cbs: 8.8, ibs: 1.77, pis: 0, cofins: 0, iss: 2.7, cprb: 0 }),
  2030: Object.freeze({ cbs: 8.8, ibs: 3.54, pis: 0, cofins: 0, iss: 2.4, cprb: 0 }),
  2031: Object.freeze({ cbs: 8.8, ibs: 5.31, pis: 0, cofins: 0, iss: 2.1, cprb: 0 }),
  2032: Object.freeze({ cbs: 8.8, ibs: 7.08, pis: 0, cofins: 0, iss: 1.8, cprb: 0 }),
  2033: Object.freeze({ cbs: 8.8, ibs: 17.7, pis: 0, cofins: 0, iss: 0, cprb: 0 }),
});

// LC 123/2006, Anexo IV. Percentuais de reparticao expressos sobre a aliquota efetiva.
const SIMPLES_ANEXO_IV = Object.freeze([
  Object.freeze({ id: 1, limite: 180000, nominal: 4.5, deducao: 0, irpj: 18.8, csll: 15.2, cofins: 17.67, pis: 3.83, iss: 44.5 }),
  Object.freeze({ id: 2, limite: 360000, nominal: 9, deducao: 8100, irpj: 19.8, csll: 15.2, cofins: 20.55, pis: 4.45, iss: 40 }),
  Object.freeze({ id: 3, limite: 720000, nominal: 10.2, deducao: 12420, irpj: 20.8, csll: 15.2, cofins: 19.73, pis: 4.27, iss: 40 }),
  Object.freeze({ id: 4, limite: 1800000, nominal: 14, deducao: 39780, irpj: 17.8, csll: 19.2, cofins: 18.9, pis: 4.1, iss: 40 }),
  Object.freeze({ id: 5, limite: 3600000, nominal: 22, deducao: 183780, irpj: 18.8, csll: 19.2, cofins: 18.08, pis: 3.92, iss: 40 }),
  Object.freeze({ id: 6, limite: 4800000, nominal: 33, deducao: 828000, irpj: 53.5, csll: 21.5, cofins: 20.55, pis: 4.45, iss: 0 }),
]);

const SIMPLES_ANEXOS = Object.freeze({
  III: Object.freeze([
    { id: 1, limite: 180000, nominal: 6, deducao: 0, irpj: 4, csll: 3.5, pis: 2.78, cofins: 12.82, iss: 33.5, cpp: 43.4 },
    { id: 2, limite: 360000, nominal: 11.2, deducao: 9360, irpj: 4, csll: 3.5, pis: 3.05, cofins: 14.05, iss: 32, cpp: 43.4 },
    { id: 3, limite: 720000, nominal: 13.5, deducao: 17640, irpj: 4, csll: 3.5, pis: 2.96, cofins: 13.64, iss: 32.5, cpp: 43.4 },
    { id: 4, limite: 1800000, nominal: 16, deducao: 35640, irpj: 4, csll: 3.5, pis: 2.96, cofins: 13.64, iss: 32.5, cpp: 43.4 },
    { id: 5, limite: 3600000, nominal: 21, deducao: 125640, irpj: 4, csll: 3.5, pis: 2.78, cofins: 12.82, iss: 33.5, cpp: 43.4 },
    { id: 6, limite: 4800000, nominal: 33, deducao: 648000, irpj: 35, csll: 15, pis: 3.47, cofins: 16.03, iss: 0, cpp: 30.5 },
  ].map(Object.freeze)),
  IV: SIMPLES_ANEXO_IV,
  V: Object.freeze([
    { id: 1, limite: 180000, nominal: 15.5, deducao: 0, irpj: 25, csll: 15, pis: 3.05, cofins: 14.1, iss: 14, cpp: 28.85 },
    { id: 2, limite: 360000, nominal: 18, deducao: 4500, irpj: 23, csll: 15, pis: 3.05, cofins: 14.1, iss: 17, cpp: 27.85 },
    { id: 3, limite: 720000, nominal: 19.5, deducao: 9900, irpj: 24, csll: 15, pis: 3.23, cofins: 14.92, iss: 19, cpp: 23.85 },
    { id: 4, limite: 1800000, nominal: 20.5, deducao: 17100, irpj: 21, csll: 15, pis: 3.41, cofins: 15.74, iss: 21, cpp: 23.85 },
    { id: 5, limite: 3600000, nominal: 23, deducao: 62100, irpj: 23, csll: 12.5, pis: 3.05, cofins: 14.1, iss: 23.5, cpp: 23.85 },
    { id: 6, limite: 4800000, nominal: 30.5, deducao: 540000, irpj: 35, csll: 15.5, pis: 3.56, cofins: 16.44, iss: 0, cpp: 29.5 },
  ].map(Object.freeze)),
});

function num(value, fallback = 0) {
  const parsed = Number(String(value ?? '').replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function limitar(value, min = 0, max = 1) {
  return Math.min(max, Math.max(min, num(value, min)));
}

function anoCalculo(value) {
  const ano = Math.trunc(num(value, 2026));
  return ano >= 2033 ? 2033 : Math.max(2026, ano);
}

function parametrosDoAno(ano) {
  return PARAMETROS_TRIBUTARIOS[anoCalculo(ano)];
}

function regimePrevidenciarioEfetivo(perfil = {}) {
  if (perfil.regime_previdenciario === 'Desonerado') return 'Desonerado';
  if (perfil.regime_previdenciario === 'Onerado') return 'Onerado';
  return perfil.regime_tributario === 'Desonerado' ? 'Desonerado' : 'Onerado';
}

function contratoDesonerado(perfil = {}) {
  return regimePrevidenciarioEfetivo(perfil) === 'Desonerado';
}

function fatorK({ AC = 0, S = 0, R = 0, DF = 0, L = 0 } = {}) {
  return (1 + (num(AC) + num(S) + num(R)) / 100)
    * (1 + num(DF) / 100)
    * (1 + num(L) / 100);
}

function redutoresPerfil(perfil = {}) {
  const temSetorial = perfil.redutor_setorial_ivaeq !== undefined && perfil.redutor_setorial_ivaeq !== null;
  const fatorLegado = limitar(num(perfil.fator_efetivo_ivaeq, 0.5), 0, 1);
  const redutorSetorial = limitar(
    temSetorial ? perfil.redutor_setorial_ivaeq : 1 - fatorLegado,
    0,
    1,
  );
  const redutorGovernamental = limitar(perfil.redutor_governamental_ivaeq, 0, 1);
  return {
    redutorSetorial,
    redutorGovernamental,
    fatorEfetivo: (1 - redutorSetorial) * (1 - redutorGovernamental),
  };
}

function aliquotasIva(perfil, ano) {
  const padrao = parametrosDoAno(ano);
  const manual = Number(perfil?.usa_iva_manual) === 1 || perfil?.usa_iva_manual === true;
  const cbs = manual ? Math.max(0, num(perfil?.cbs_percentual)) : padrao.cbs;
  const ibs = manual ? Math.max(0, num(perfil?.ibs_percentual)) : padrao.ibs;
  return { cbs, ibs, ivaNominal: cbs + ibs, manual };
}

function icmsResidualPorAno(anoOriginal, icms2027Percentual = 18) {
  const ano = Math.trunc(num(anoOriginal, 0));
  const informado = icms2027Percentual === undefined || icms2027Percentual === null || icms2027Percentual === ''
    ? 18
    : num(icms2027Percentual, 18);
  const base = Math.max(0, informado) / 100;
  if (ano === 2027 || ano === 2028) return base;
  if (ano === 2029) return base * 0.9;
  if (ano === 2030) return base * 0.8;
  if (ano === 2031) return base * 0.7;
  if (ano === 2032) return base * 0.6;
  return 0;
}

function matcdAjustadoPorIcms(matcd, ano, icms2027Percentual) {
  return limitar(matcd, 0, 1) * (1 - icmsResidualPorAno(ano, icms2027Percentual));
}

function calcularRegimeComum(perfil = {}, grupos = {}) {
  const anoOriginal = Math.trunc(num(perfil.ano_orcamento, 2026));
  const ano = anoCalculo(anoOriginal);
  const parametros = parametrosDoAno(ano);
  const K = fatorK(grupos);
  const redutores = redutoresPerfil(perfil);
  const aliquotas = aliquotasIva(perfil, ano);
  const matcd = limitar(num(perfil.percentual_mat_ivaeq, 0.4), 0, 1);
  const icms2027 = perfil.icms_2027_percentual === undefined || perfil.icms_2027_percentual === null || perfil.icms_2027_percentual === ''
    ? 18
    : Math.max(0, num(perfil.icms_2027_percentual, 18));
  const icmsResidual = icmsResidualPorAno(anoOriginal, icms2027);
  const matcdAjustado = matcdAjustadoPorIcms(matcd, anoOriginal, icms2027);
  const issManual = perfil.iss_percentual_manual !== ''
    && perfil.iss_percentual_manual !== null
    && perfil.iss_percentual_manual !== undefined;
  const ISS = ano === 2033 ? 0 : (issManual ? Math.max(0, num(perfil.iss_percentual_manual)) : parametros.iss);
  const CPRB = contratoDesonerado(perfil) ? parametros.cprb : 0;
  const PIS = parametros.pis;
  const COFINS = parametros.cofins;
  const T = ISS + CPRB + PIS + COFINS;
  const ivaAplicavel = aliquotas.ivaNominal * redutores.fatorEfetivo;
  const ivaeqCalculado = ano === 2026
    ? 0
    : Math.max(0, (aliquotas.ivaNominal / 100) * ((K * redutores.fatorEfetivo - matcdAjustado) / K)) * 100;
  const IVAeq = ivaeqCalculado;
  const bdi = (K * (1 + IVAeq / 100) / Math.max(0.000001, 1 - T / 100) - 1) * 100;

  return {
    ...grupos,
    K,
    T,
    ISS,
    CPRB,
    PIS,
    COFINS,
    CBS: aliquotas.cbs,
    IBS: aliquotas.ibs,
    IVA_NOMINAL: aliquotas.ivaNominal,
    IVA_APLICAVEL: ivaAplicavel,
    IVAeq,
    IVA_MANUAL: aliquotas.manual,
    REDUTOR_SETORIAL: redutores.redutorSetorial * 100,
    REDUTOR_GOVERNAMENTAL: redutores.redutorGovernamental * 100,
    FATOR_EFETIVO: redutores.fatorEfetivo * 100,
    PERCENTUAL_MATCD: matcd * 100,
    PERCENTUAL_MATCD_AJUSTADO: matcdAjustado * 100,
    ICMS_2027: icms2027,
    ICMS_RESIDUAL: icmsResidual * 100,
    ano: anoOriginal,
    bdi: Math.max(0, bdi),
    regime_calculo: 'comum',
  };
}

function faixaSimples(rbt12, faixaInformada, anexo = 'IV') {
  const tabela = SIMPLES_ANEXOS[anexo] || SIMPLES_ANEXOS.IV;
  const receita = Math.max(0, num(rbt12));
  if (receita > 0) return tabela.find(faixa => receita <= faixa.limite) || tabela[5];
  const id = Math.trunc(num(faixaInformada));
  return tabela.find(faixa => faixa.id === id) || null;
}

function decomporSimples(aliquotaEfetiva, faixa) {
  if (!faixa) return { irpj: 0, csll: 0, pis: 0, cofins: 0, iss: 0, cpp: 0 };
  const efetiva = Math.max(0, num(aliquotaEfetiva));
  const parcelas = {
    irpj: efetiva * faixa.irpj / 100,
    csll: efetiva * faixa.csll / 100,
    pis: efetiva * faixa.pis / 100,
    cofins: efetiva * faixa.cofins / 100,
    iss: efetiva * faixa.iss / 100,
    cpp: efetiva * num(faixa.cpp) / 100,
  };

  if (faixa.id === 5 && parcelas.iss > 5) {
    const excedente = parcelas.iss - 5;
    parcelas.iss = 5;
    const federais = parcelas.irpj + parcelas.csll + parcelas.pis + parcelas.cofins;
    for (const tributo of ['irpj', 'csll', 'pis', 'cofins']) {
      parcelas[tributo] += federais > 0 ? excedente * parcelas[tributo] / federais : 0;
    }
  }
  return parcelas;
}

function transformarSimples(parcelas, anoOriginal) {
  const ano = anoCalculo(anoOriginal);
  const pisCofins = parcelas.pis + parcelas.cofins;
  const resultado = { pis: 0, cofins: 0, cbs: 0, ibs: 0, iss: 0, cpp: parcelas.cpp || 0 };
  if (ano === 2026) {
    resultado.pis = parcelas.pis;
    resultado.cofins = parcelas.cofins;
    resultado.iss = parcelas.iss;
  } else if (ano <= 2028) {
    resultado.cbs = pisCofins * 8.7 / 8.8;
    resultado.ibs = pisCofins * 0.1 / 8.8;
    resultado.iss = parcelas.iss;
  } else if (ano <= 2032) {
    const conversaoIss = (ano - 2028) / 10;
    resultado.cbs = pisCofins;
    resultado.ibs = parcelas.iss * conversaoIss;
    resultado.iss = parcelas.iss * (1 - conversaoIss);
  } else {
    resultado.cbs = pisCofins;
    resultado.ibs = parcelas.iss;
  }
  return resultado;
}

function calcularSimples(perfil = {}, grupos = {}) {
  const ano = Math.trunc(num(perfil.ano_orcamento, 2026));
  const anexo = SIMPLES_ANEXOS[perfil.simples_anexo] ? perfil.simples_anexo : 'IV';
  const modelo = perfil.simples_modelo_bdi === 'hibrido' ? 'hibrido' : 'das';
  const rbt12Informado = Math.max(0, num(perfil.simples_rbt12));
  const faixa = faixaSimples(rbt12Informado, perfil.simples_faixa, anexo);
  const rbt12Calculo = rbt12Informado > 0 ? rbt12Informado : (faixa?.limite || 0);
  const aliquotaPadrao = rbt12Calculo > 0 && faixa
    ? Math.max(0, ((rbt12Calculo * faixa.nominal / 100) - faixa.deducao) / rbt12Calculo * 100)
    : Math.max(0, num(perfil.simples_aliquota_efetiva));
  const usaEfetivaManual = Number(perfil.usa_simples_efetiva_manual) === 1 || perfil.usa_simples_efetiva_manual === true;
  const aliquotaManual = Math.max(0, num(perfil.simples_aliquota_efetiva));
  const aliquotaEfetiva = usaEfetivaManual && aliquotaManual > 0 ? aliquotaManual : aliquotaPadrao;
  const parcelasOriginais = decomporSimples(aliquotaEfetiva, faixa);
  const parcelas = transformarSimples(parcelasOriginais, ano);
  const CPRB = anexo === 'IV' && contratoDesonerado(perfil) ? parametrosDoAno(ano).cprb : 0;
  const K = fatorK(grupos);
  const redutores = redutoresPerfil(perfil);
  const matcd = limitar(num(perfil.percentual_mat_ivaeq, 0.4), 0, 1);
  const icms2027 = perfil.icms_2027_percentual === undefined || perfil.icms_2027_percentual === null || perfil.icms_2027_percentual === ''
    ? 18
    : Math.max(0, num(perfil.icms_2027_percentual, 18));
  const icmsResidual = icmsResidualPorAno(ano, icms2027);
  const matcdAjustado = matcdAjustadoPorIcms(matcd, ano, icms2027);
  const aliquotas = aliquotasIva(perfil, ano);
  const tributosSemIva = parcelas.pis + parcelas.cofins + parcelas.iss + parcelas.cpp + CPRB;
  const T = modelo === 'hibrido' ? tributosSemIva : tributosSemIva + parcelas.cbs + parcelas.ibs;
  const ivaeq = modelo === 'hibrido' && ano !== 2026
    ? Math.max(0, (aliquotas.ivaNominal / 100) * ((K * redutores.fatorEfetivo - matcdAjustado) / K)) * 100
    : 0;
  const bdi = modelo === 'hibrido'
    ? (K * (1 + ivaeq / 100) / Math.max(0.000001, 1 - T / 100) - 1) * 100
    : (K / Math.max(0.000001, 1 - T / 100) - 1) * 100;

  return {
    ...grupos,
    K,
    T,
    ISS: parcelas.iss,
    CPRB,
    PIS: parcelas.pis,
    COFINS: parcelas.cofins,
    CBS: parcelas.cbs,
    IBS: parcelas.ibs,
    IVAeq: ivaeq,
    IVA_NOMINAL: modelo === 'hibrido' ? aliquotas.ivaNominal : 0,
    IVA_APLICAVEL: modelo === 'hibrido' ? aliquotas.ivaNominal * redutores.fatorEfetivo : 0,
    FATOR_EFETIVO: modelo === 'hibrido' ? redutores.fatorEfetivo * 100 : 0,
    PERCENTUAL_MATCD: matcd * 100,
    PERCENTUAL_MATCD_AJUSTADO: matcdAjustado * 100,
    ICMS_2027: icms2027,
    ICMS_RESIDUAL: icmsResidual * 100,
    ano,
    bdi: Math.max(0, bdi),
    regime_calculo: modelo === 'hibrido' ? 'simples_hibrido' : 'simples_das_unificado',
    simples: {
      modelo,
      anexo,
      rbt12: rbt12Calculo,
      rbt12_informado: rbt12Informado,
      faixa: faixa?.id || null,
      aliquota_nominal: faixa?.nominal || 0,
      parcela_deduzir: faixa?.deducao || 0,
      aliquota_efetiva: aliquotaEfetiva,
      aliquota_padrao: aliquotaPadrao,
      manual: usaEfetivaManual,
      original: parcelasOriginais,
      transformado: parcelas,
    },
  };
}

function calcularBdi(perfil = {}, grupos = {}) {
  return perfil.regime_tributario === 'Simples Nacional'
    ? calcularSimples(perfil, grupos)
    : calcularRegimeComum(perfil, grupos);
}

module.exports = {
  PARAMETROS_VERSAO,
  PARAMETROS_TRIBUTARIOS,
  SIMPLES_ANEXO_IV,
  SIMPLES_ANEXOS,
  parametrosDoAno,
  regimePrevidenciarioEfetivo,
  contratoDesonerado,
  fatorK,
  redutoresPerfil,
  aliquotasIva,
  icmsResidualPorAno,
  matcdAjustadoPorIcms,
  decomporSimples,
  transformarSimples,
  calcularRegimeComum,
  calcularSimples,
  calcularBdi,
};
