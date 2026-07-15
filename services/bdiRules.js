const PARAMETROS_VERSAO = '2026-07-15';

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

function calcularRegimeComum(perfil = {}, grupos = {}) {
  const anoOriginal = Math.trunc(num(perfil.ano_orcamento, 2026));
  const ano = anoCalculo(anoOriginal);
  const parametros = parametrosDoAno(ano);
  const K = fatorK(grupos);
  const redutores = redutoresPerfil(perfil);
  const aliquotas = aliquotasIva(perfil, ano);
  const matcd = limitar(num(perfil.percentual_mat_ivaeq, 0.4), 0, 1);
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
    : Math.max(0, (aliquotas.ivaNominal / 100) * ((K * redutores.fatorEfetivo - matcd) / K)) * 100;
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
    ano: anoOriginal,
    bdi: Math.max(0, bdi),
    regime_calculo: 'comum',
  };
}

function faixaSimples(rbt12, faixaInformada) {
  const receita = Math.max(0, num(rbt12));
  if (receita > 0) return SIMPLES_ANEXO_IV.find(faixa => receita <= faixa.limite) || SIMPLES_ANEXO_IV[5];
  const id = Math.trunc(num(faixaInformada));
  return SIMPLES_ANEXO_IV.find(faixa => faixa.id === id) || null;
}

function decomporSimples(aliquotaEfetiva, faixa) {
  if (!faixa) return { irpj: 0, csll: 0, pis: 0, cofins: 0, iss: 0 };
  const efetiva = Math.max(0, num(aliquotaEfetiva));
  const parcelas = {
    irpj: efetiva * faixa.irpj / 100,
    csll: efetiva * faixa.csll / 100,
    pis: efetiva * faixa.pis / 100,
    cofins: efetiva * faixa.cofins / 100,
    iss: efetiva * faixa.iss / 100,
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
  const resultado = { pis: 0, cofins: 0, cbs: 0, ibs: 0, iss: 0 };
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
  const rbt12Informado = Math.max(0, num(perfil.simples_rbt12));
  const faixa = faixaSimples(rbt12Informado, perfil.simples_faixa);
  const rbt12Calculo = rbt12Informado > 0 ? rbt12Informado : (faixa?.limite || 0);
  const aliquotaEfetiva = rbt12Calculo > 0 && faixa
    ? Math.max(0, ((rbt12Calculo * faixa.nominal / 100) - faixa.deducao) / rbt12Calculo * 100)
    : Math.max(0, num(perfil.simples_aliquota_efetiva));
  const parcelasOriginais = decomporSimples(aliquotaEfetiva, faixa);
  const parcelas = transformarSimples(parcelasOriginais, ano);
  const CPRB = contratoDesonerado(perfil) ? parametrosDoAno(ano).cprb : 0;
  const T = parcelas.pis + parcelas.cofins + parcelas.cbs + parcelas.ibs + parcelas.iss + CPRB;
  const K = fatorK(grupos);
  const bdi = (K / Math.max(0.000001, 1 - T / 100) - 1) * 100;

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
    IVAeq: 0,
    IVA_NOMINAL: 0,
    IVA_APLICAVEL: 0,
    FATOR_EFETIVO: 0,
    PERCENTUAL_MATCD: limitar(num(perfil.percentual_mat_ivaeq, 0.4), 0, 1) * 100,
    ano,
    bdi: Math.max(0, bdi),
    regime_calculo: 'simples_das_unificado',
    simples: {
      rbt12: rbt12Calculo,
      rbt12_informado: rbt12Informado,
      faixa: faixa?.id || null,
      aliquota_nominal: faixa?.nominal || 0,
      parcela_deduzir: faixa?.deducao || 0,
      aliquota_efetiva: aliquotaEfetiva,
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
  parametrosDoAno,
  regimePrevidenciarioEfetivo,
  contratoDesonerado,
  fatorK,
  redutoresPerfil,
  aliquotasIva,
  decomporSimples,
  transformarSimples,
  calcularRegimeComum,
  calcularSimples,
  calcularBdi,
};
