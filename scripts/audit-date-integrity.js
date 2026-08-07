const fs = require('fs');
const path = require('path');

const envPath = path.join(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, 'utf8').split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const separator = trimmed.indexOf('=');
    if (separator <= 0) return;
    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim().replace(/^["']|["']$/g, '');
    if (!process.env[key]) process.env[key] = value;
  });
}

const {
  dateOnlyOrNull,
  hasSupabase,
  listCursistasEpc,
  listCursistasSmp,
  listRecords,
} = require('../databaseAdapter');

const summaries = new Map();

const hasValue = (value) => {
  if (value === undefined || value === null) return false;
  if (typeof value === 'string') return Boolean(value.trim());
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.values(value).some(hasValue);
  return true;
};

const summaryFor = (source, field) => {
  const key = `${source}.${field}`;
  if (!summaries.has(key)) {
    summaries.set(key, {
      source,
      field,
      checked: 0,
      present: 0,
      validIso: 0,
      nonCanonical: 0,
      invalid: 0,
      empty: 0,
      requiredMissing: 0,
    });
  }
  return summaries.get(key);
};

const auditDate = (source, field, value, { required = false } = {}) => {
  const summary = summaryFor(source, field);
  summary.checked += 1;
  const raw = value === undefined || value === null ? '' : String(value).trim();
  if (!raw) {
    summary.empty += 1;
    if (required) summary.requiredMissing += 1;
    return;
  }
  summary.present += 1;
  try {
    const normalized = dateOnlyOrNull(raw);
    if (normalized === raw) summary.validIso += 1;
    else summary.nonCanonical += 1;
  } catch {
    summary.invalid += 1;
  }
};

const auditRetreats = (records) => records.forEach((record) => {
  auditDate('retiros', 'dataInicio', record.dataInicio);
  auditDate('retiros', 'dataTermino', record.dataTermino);
});

const auditPeople = (records) => records.forEach((record) => {
  auditDate('pessoas', 'nascimento', record.nascimento, { required: true });
});

const auditEnrolmentKids = (records) => records.forEach((record) => {
  const kids = Array.isArray(record.espacoKids) ? record.espacoKids : [];
  kids.forEach((kid) => auditDate('adesoes.espacoKids', 'nascimento', kid?.nascimento, { required: true }));
});

const auditIndividualStudents = (records) => records.forEach((record) => {
  auditDate('cursistas', 'nascimento', record.nascimento, { required: true });
});

const coupleKidHasData = (record, kidNumber, suffix = '') => [
  `smpKidNome${kidNumber}`,
  `smpKidNascimento${kidNumber}`,
  `smpKidProblemaSaude${kidNumber}${suffix}`,
  `smpKidDescricaoSaude${kidNumber}${suffix}`,
  `smpKidIntolerancia${kidNumber}${suffix}`,
  `smpKidDescricaoIntolerancia${kidNumber}${suffix}`,
].some((field) => hasValue(record[field]));

const auditCoupleKids = (source, records, suffix = '') => records.forEach((record) => {
  for (let kidNumber = 1; kidNumber <= 5; kidNumber += 1) {
    if (!coupleKidHasData(record, kidNumber, suffix)) continue;
    auditDate(source, 'smpKidNascimento', record[`smpKidNascimento${kidNumber}`], { required: true });
  }
});

const auditSmpStudents = (records) => {
  records.forEach((record) => {
    auditDate('cursista_smp', 'nascimentoDele', record.nascimentoDele);
    auditDate('cursista_smp', 'casamentoDele', record.casamentoDele);
    auditDate('cursista_smp', 'nascimentoDela', record.nascimentoDela);
    auditDate('cursista_smp', 'casamentoDela', record.casamentoDela);
    auditDate('cursista_smp', 'uniaoCasal', record.uniaoCasal);
  });
  auditCoupleKids('cursista_smp', records);
};

const auditEpcStudents = (records) => {
  records.forEach((record) => {
    auditDate('cursista_epc', 'nascimentoDele', record.nascimentoDele);
    auditDate('cursista_epc', 'nascimentoDela', record.nascimentoDela);
    auditDate('cursista_epc', 'uniaoCasal', record.uniaoCasal);
  });
  auditCoupleKids('cursista_epc', records, 'Epc');
};

const printSummary = (recordCounts, skippedSources) => {
  console.log('Auditoria de integridade de datas (somente leitura, sem dados pessoais).');
  Object.entries(recordCounts).forEach(([source, count]) => {
    console.log(`${source}: ${count} registro(s).`);
  });
  skippedSources.forEach((source) => {
    console.log(`${source}: nao disponivel no backend local; nenhuma consulta foi executada para esta origem.`);
  });
  [...summaries.values()]
    .sort((first, second) => `${first.source}.${first.field}`.localeCompare(`${second.source}.${second.field}`, 'pt-BR'))
    .forEach((summary) => {
      console.log([
        `${summary.source}.${summary.field}:`,
        `verificadas=${summary.checked}`,
        `ISO=${summary.validIso}`,
        `vazias=${summary.empty}`,
        `nao_canonicas=${summary.nonCanonical}`,
        `invalidas=${summary.invalid}`,
        `obrigatorias_ausentes=${summary.requiredMissing}`,
      ].join(' '));
    });
};

async function main() {
  const [retreats, people, enrolments, individualStudents] = await Promise.all([
    listRecords('retiros'),
    listRecords('pessoas'),
    listRecords('adesoes'),
    listRecords('cursistas'),
  ]);
  let smpStudents = [];
  let epcStudents = [];
  const skippedSources = [];
  if (hasSupabase()) {
    [smpStudents, epcStudents] = await Promise.all([
      listCursistasSmp(),
      listCursistasEpc(),
    ]);
  } else {
    skippedSources.push('cursista_smp', 'cursista_epc');
  }

  auditRetreats(retreats);
  auditPeople(people);
  auditEnrolmentKids(enrolments);
  auditIndividualStudents(individualStudents);
  auditSmpStudents(smpStudents);
  auditEpcStudents(epcStudents);

  printSummary({
    retiros: retreats.length,
    pessoas: people.length,
    adesoes: enrolments.length,
    cursistas: individualStudents.length,
    cursista_smp: smpStudents.length,
    cursista_epc: epcStudents.length,
  }, skippedSources);

  const totals = [...summaries.values()].reduce((result, summary) => ({
    invalid: result.invalid + summary.invalid,
    nonCanonical: result.nonCanonical + summary.nonCanonical,
    requiredMissing: result.requiredMissing + summary.requiredMissing,
  }), { invalid: 0, nonCanonical: 0, requiredMissing: 0 });

  if (totals.invalid || totals.nonCanonical || totals.requiredMissing) {
    console.error(`Auditoria encontrou problemas agregados: invalidas=${totals.invalid}, nao_canonicas=${totals.nonCanonical}, obrigatorias_ausentes=${totals.requiredMissing}.`);
    process.exitCode = 1;
    return;
  }
  console.log('Auditoria concluida sem problemas de integridade nas datas consultadas.');
}

main().catch((error) => {
  console.error(`Auditoria de datas nao concluida: ${error.message || 'falha de leitura'}.`);
  process.exitCode = 1;
});
