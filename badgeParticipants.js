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
        const participants = [
          { fullName: text(student.nomeDele), customBadgeName: studentFormType === 'cursista-smp' ? text(student.nomeCrachaDele) : '' },
          { fullName: text(student.nomeDela), customBadgeName: studentFormType === 'cursista-smp' ? text(student.nomeCrachaDela) : '' },
        ].filter((participant) => participant.fullName);
        if (studentFormType === 'cursista-smp' && participants.length >= 2) {
          if (!sourceId) return null;
          return participants.map((participant, index) => {
            const spouse = participants[(index + 1) % participants.length];
            const primaryName = participant.customBadgeName || firstName(participant.fullName);
            const secondaryName = spouse.customBadgeName || firstName(spouse.fullName);
            if (!primaryName || !secondaryName) return null;
            return {
              entry: {
                id: `student-${studentFormType}-${sourceId}-${index}`,
                nome: participants.map((item) => item.fullName).join(' e '),
                badgeName: primaryName,
                badgeSecondaryName: secondaryName,
                setores: [label],
                badgeParticipantType: 'student',
                badgeCoupleVariant: true,
              },
              sector: label,
            };
          }).filter(Boolean);
        }
        const fullNames = participants.map((participant) => participant.fullName);
        const badgeName = participants.map((participant) => participant.customBadgeName || firstName(participant.fullName)).filter(Boolean).join(' e ');
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
      const badgeName = text(student.nomeCracha) || firstName(name);
      return {
        entry: {
          id: `student-${sourceId}`,
          nome: name,
          badgeName,
          setores: [label],
          badgeParticipantType: 'student',
        },
        sector: label,
      };
    })
    .flat()
    .filter(Boolean);
}
