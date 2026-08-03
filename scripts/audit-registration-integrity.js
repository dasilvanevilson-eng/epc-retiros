const fs = require('fs');
const path = require('path');

const databasePath = path.join(__dirname, '..', 'database', 'db.json');

const readDatabase = () => {
  if (!fs.existsSync(databasePath)) throw new Error(`Banco local nao encontrado: ${databasePath}`);
  return JSON.parse(fs.readFileSync(databasePath, 'utf8'));
};

const hasValue = (value) => {
  if (value === undefined || value === null) return false;
  if (typeof value === 'string') return Boolean(value.trim());
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.keys(value).length > 0;
  return true;
};

const missingFields = (record, fields) => fields.filter((field) => !hasValue(record[field]));
const label = (record) => record.nome || record.cpf || record.id || 'registro sem identificacao';

function auditCollection(name, records, requiredFields) {
  const rows = records
    .map((record) => ({ record, missing: missingFields(record, requiredFields) }))
    .filter((row) => row.missing.length);

  console.log(`${name}: ${records.length} registro(s), ${rows.length} com campo(s) critico(s) ausente(s).`);
  rows.slice(0, 50).forEach(({ record, missing }) => {
    console.log(`- ${label(record)} (${record.id || 'sem id'}): ${missing.join(', ')}`);
  });
  if (rows.length > 50) console.log(`- ... mais ${rows.length - 50} registro(s) omitidos.`);
  return rows.length;
}

function auditStudentBusinessKeys(records) {
  const seenCpf = new Map();
  const seenFileNumber = new Map();
  const issues = [];
  records.forEach((record) => {
    const cpf = String(record.cpf || '').replace(/\D/g, '');
    const fileNumber = Number(record.numeroFichaIndividual);
    const cpfKey = cpf ? `${record.retiroId}|${cpf}` : '';
    const fileNumberKey = Number.isInteger(fileNumber) && fileNumber > 0 ? `${record.retiroId}|${fileNumber}` : '';
    if (cpfKey && seenCpf.has(cpfKey)) issues.push(`CPF repetido no retiro entre ${seenCpf.get(cpfKey)} e ${record.id}`);
    else if (cpfKey) seenCpf.set(cpfKey, record.id);
    if (fileNumberKey && seenFileNumber.has(fileNumberKey)) issues.push(`Numero de ficha repetido no retiro entre ${seenFileNumber.get(fileNumberKey)} e ${record.id}`);
    else if (fileNumberKey) seenFileNumber.set(fileNumberKey, record.id);
  });
  console.log(`cursistas: ${issues.length} conflito(s) de identidade por retiro.`);
  issues.slice(0, 50).forEach((issue) => console.log(`- ${issue}`));
  return issues.length;
}

function main() {
  const database = readDatabase();
  const adesoes = Array.isArray(database.adesoes) ? database.adesoes : [];
  const cursistas = Array.isArray(database.cursistas) ? database.cursistas : [];

  const issues = [
    auditCollection('adesoes', adesoes, ['id', 'retiroId', 'pessoaId', 'nome', 'setores', 'dias']),
    auditCollection('cursistas', cursistas, ['id', 'retiroId', 'cpf', 'numeroFichaIndividual', 'nome', 'nascimento']),
    auditStudentBusinessKeys(cursistas),
  ].reduce((total, count) => total + count, 0);

  if (issues) {
    console.error(`Auditoria encontrou ${issues} registro(s) com possivel perda ou ausencia de informacao cadastrada.`);
    process.exitCode = 1;
    return;
  }
  console.log('Auditoria concluida sem campos criticos ausentes.');
}

main();
