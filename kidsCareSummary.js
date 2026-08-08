const normalizedChoice = (value) => String(value || '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .trim()
  .toLocaleLowerCase('pt-BR');

const hasAffirmativeOrDetail = (answer, detail) => normalizedChoice(answer) === 'sim' || Boolean(String(detail || '').trim());

const sortCareRows = (rows = []) => [...rows].sort((first, second) => {
  const firstBirth = Date.parse(`${first.nascimento || ''}T12:00:00`);
  const secondBirth = Date.parse(`${second.nascimento || ''}T12:00:00`);
  if (Number.isFinite(firstBirth) && Number.isFinite(secondBirth) && firstBirth !== secondBirth) return secondBirth - firstBirth;
  if (Number.isFinite(firstBirth) !== Number.isFinite(secondBirth)) return Number.isFinite(firstBirth) ? -1 : 1;
  return String(first.nome || '').localeCompare(String(second.nome || ''), 'pt-BR', { sensitivity: 'base' });
});

const coupleName = (record = {}) => [record.nomeDele, record.nomeDela]
  .map((name) => String(name || '').trim())
  .filter(Boolean)
  .join(' e ') || (record.numeroFichaSmp || record.id ? `Ficha ${record.numeroFichaSmp || record.id}` : 'Casal não informado');

const coupleStudentKids = ({ coupleStudents = [], studentFormType = '', retreatId = '' } = {}) => {
  if (!['cursista-smp', 'cursista-epc'].includes(studentFormType)) return [];
  const isEpc = studentFormType === 'cursista-epc';
  const suffix = isEpc ? 'Epc' : '';
  return coupleStudents
    .filter((record) => !retreatId || !record.retiroId || record.retiroId === retreatId)
    .filter((record) => !record.smpKidsNotNeeded)
    .flatMap((record) => Array.from({ length: 5 }, (_, index) => {
      const kidNumber = index + 1;
      return {
        nome: String(record[`smpKidNome${kidNumber}`] || '').trim(),
        nascimento: String(record[`smpKidNascimento${kidNumber}`] || '').trim(),
        problemaSaude: record[`smpKidProblemaSaude${kidNumber}${suffix}`] || '',
        descricaoSaude: String(record[`smpKidDescricaoSaude${kidNumber}${suffix}`] || '').trim(),
        intoleranciaAlimentar: record[`smpKidIntolerancia${kidNumber}${suffix}`] || '',
        descricaoIntolerancia: String(record[`smpKidDescricaoIntolerancia${kidNumber}${suffix}`] || '').trim(),
        origin: 'Cursista',
        responsible: coupleName(record),
        contextLabel: 'Comunidade',
        contextValue: String(record.kidsCommunity || 'Sem comunidade').trim() || 'Sem comunidade',
      };
    }))
    .filter((kid) => kid.nome || kid.nascimento);
};

export function buildKidsCareSummary({ teamKids = [], coupleStudents = [], studentFormType = '', retreatId = '' } = {}) {
  const normalizedTeamKids = teamKids.map((kid) => ({
    ...kid,
    nome: String(kid.nome || '').trim(),
    nascimento: String(kid.nascimento || '').trim(),
    problemaSaude: kid.problemaSaude || '',
    descricaoSaude: String(kid.descricaoSaude || '').trim(),
    intoleranciaAlimentar: kid.intoleranciaAlimentar || '',
    descricaoIntolerancia: String(kid.descricaoIntolerancia || '').trim(),
    origin: 'Equipe de trabalho',
    responsible: kid.responsible || kid.volunteer || 'Não informado',
    contextLabel: 'Setor de trabalho',
    contextValue: Array.isArray(kid.sectors) && kid.sectors.length ? kid.sectors.join(', ') : 'Não informado',
  }));
  const children = [...normalizedTeamKids, ...coupleStudentKids({ coupleStudents, studentFormType, retreatId })];
  return {
    children: sortCareRows(children),
    intolerance: sortCareRows(children
      .filter((kid) => hasAffirmativeOrDetail(kid.intoleranciaAlimentar, kid.descricaoIntolerancia))
      .map((kid) => ({ ...kid, detail: kid.descricaoIntolerancia }))),
    health: sortCareRows(children
      .filter((kid) => hasAffirmativeOrDetail(kid.problemaSaude, kid.descricaoSaude))
      .map((kid) => ({ ...kid, detail: kid.descricaoSaude }))),
  };
}
