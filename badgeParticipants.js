const text = (value) => String(value || '').trim();
const firstName = (value) => text(value).split(/\s+/)[0] || '';
const communityName = (community = {}) => text(community.nome)
  || (community.ordem ? `Comunidade ${community.ordem}` : 'Comunidade');
const recordIdentifiers = (record = {}) => [record.id, record.numeroFichaSmp, record.cpf]
  .map(text)
  .filter(Boolean);

export function buildCommunityStudentBadgeEntries({ community = {}, students = [], studentFormType = 'cursista-individual', retreatId = '' } = {}) {
  const isEpc = studentFormType === 'cursista-epc';
  const isCouple = isEpc || studentFormType === 'cursista-smp';
  const memberField = isEpc ? 'membroEpcIds' : (isCouple ? 'membroSmpIds' : 'membroIds');
  const memberIds = new Set((community[memberField] || []).map(text).filter(Boolean));
  const label = communityName(community);

  return students
    .filter((student) => (!retreatId || !student.retiroId || student.retiroId === retreatId)
      && recordIdentifiers(student).some((identifier) => memberIds.has(identifier)))
    .map((student) => {
      const sourceId = text(student.id || student.numeroFichaSmp || student.cpf);
      if (isCouple) {
        const fullNames = [student.nomeDele, student.nomeDela].map(text).filter(Boolean);
        const badgeName = fullNames.map(firstName).filter(Boolean).join(' e ');
        if (!sourceId || !badgeName) return null;
        return {
          entry: {
            id: `student-${studentFormType}-${sourceId}`,
            nome: fullNames.join(' e '),
            badgeName,
            setores: [label],
            badgeParticipantType: 'student',
          },
          sector: label,
        };
      }
      const name = text(student.nome);
      if (!sourceId || !name) return null;
      return {
        entry: {
          id: `student-${sourceId}`,
          nome: name,
          badgeName: firstName(name),
          setores: [label],
          badgeParticipantType: 'student',
        },
        sector: label,
      };
    })
    .filter(Boolean);
}
