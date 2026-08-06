const app = document.querySelector('#app');
const token = document.body.dataset.publicStudentToken || location.pathname.match(/^\/cadastro-cursista\/([^/?#]+)/)?.[1] || '';
const escapeHtml = (value = '') => String(value).replace(/[&<>'"]/g, (character) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
}[character]));
const choices = (name, values = ['Sim', 'Não']) => `<div class="choice-grid">${values.map((value) => `<label class="choice"><input type="radio" name="${name}" value="${value}"><span>${value}</span></label>`).join('')}</div>`;
const field = (name, label, attributes = '') => `<label class="field"><span>${label}</span><input name="${name}" ${attributes}></label>`;
const section = (number, title, content) => `<section class="form-section"><div class="section-heading"><span>${String(number).padStart(2, '0')}</span><div><h2>${title}</h2></div></div>${content}</section>`;
const normalizeCpf = (value) => String(value || '').replace(/\D/g, '');
const formatCpf = (value) => normalizeCpf(value).slice(0, 11).replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d{1,2})$/, '$1-$2');
const errorMessage = async (response) => {
  const payload = await response.json().catch(() => ({}));
  return payload.error || 'Não foi possível concluir o cadastro.';
};

function unavailable(title, message) {
  app.innerHTML = `<main class="public-student-shell"><section class="panel public-student-state"><p class="eyebrow">Cadastro de cursista</p><h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p></section></main>`;
}

function individualForm(context) {
  const yesNo = (name) => choices(name).replaceAll(`name="${name}"`, `name="${name}" required`);
  return `${section(1, 'Dados pessoais', `<div class="fields two-columns">${field('cpf', 'CPF <b>*</b>', 'required inputmode="numeric"')}${field('nome', 'Nome completo <b>*</b>', 'required')}${field('nascimento', 'Data de nascimento <b>*</b>', 'required type="date"')}${field('telefone', 'Telefone <b>*</b>', 'required inputmode="tel"')}</div>`)}
  ${section(2, 'Endereço', `<div class="fields address-fields">${field('cep', 'CEP <b>*</b>', 'required inputmode="numeric"')}${field('rua', 'Rua <b>*</b>', 'required')}${field('numero', 'Número <b>*</b>', 'required')}${field('bairro', 'Bairro <b>*</b>', 'required')}${field('cidade', 'Cidade <b>*</b>', 'required')}${field('estado', 'Estado <b>*</b>', 'required maxlength="2"')}</div>`)}
  ${section(3, 'Formação e vivência', `<div class="student-questions"><fieldset><legend>É batizado(a)? <b>*</b></legend>${yesNo('batizado')}</fieldset><fieldset><legend>Fez primeira comunhão? <b>*</b></legend>${yesNo('primeiraComunhao')}</fieldset><fieldset><legend>Estuda? <b>*</b></legend>${yesNo('estuda')}<div class="fields two-columns">${field('serie', 'Série')}${field('escola', 'Escola')}</div></fieldset><fieldset><legend>Fez algum retiro? <b>*</b></legend>${yesNo('fezRetiro')}${field('qualRetiro', 'Qual?')}</fieldset></div>`)}
  ${section(4, 'Família e convite', `<div class="fields two-columns">${field('nomePai', 'Nome do pai')}${field('telefonePai', 'Telefone do pai')}${field('nomeMae', 'Nome da mãe')}${field('telefoneMae', 'Telefone da mãe')}</div><fieldset class="student-fieldset"><legend>Os pais participam de movimento na Igreja? <b>*</b></legend>${yesNo('paisMovimento')}${field('qualMovimento', 'Qual?')}</fieldset><div class="fields">${field('convidou', 'Quem convidou?')}<fieldset class="student-fieldset full"><legend>Tamanho da camiseta <b>*</b></legend>${choices('camiseta', ['8', '10', '12', '14', 'PP', 'P', 'M', 'G', 'GG', 'G1', 'G2', 'G3', 'G4']).replaceAll('name="camiseta"', 'name="camiseta" required')}</fieldset></div>`)}
  ${section(5, 'Saúde e cuidados', `<div class="student-questions"><fieldset><legend>Tem intolerância a alimentos? <b>*</b></legend>${yesNo('intoleranciaAlimentos')}${field('qualIntolerancia', 'Qual?')}</fieldset><fieldset><legend>É alérgico(a) a medicamento? <b>*</b></legend>${yesNo('alergiaMedicamento')}${field('qualAlergia', 'Qual?')}</fieldset><fieldset><legend>Toma medicamento continuamente? <b>*</b></legend>${yesNo('medicamentoContinuo')}${field('qualMedicamentoContinuo', 'Qual?')}</fieldset></div><div class="fields two-columns">${field('medicamentoCabeca', 'Medicamento para dor de cabeça')}${field('medicamentoEstomago', 'Medicamento para dor no estômago')}</div>`)}`;
}

function kidsFields(context) {
  const limit = Number(context.retiro.idadeMaximaEspacoKids) || 0;
  const careSuffix = context.tipoFichaCursista === 'cursista-epc' ? 'Epc' : '';
  return `<div class="choice-block"><div class="kids-heading"><div class="kids-title-with-limit"><h3>Espaço Kids</h3><span class="kids-age-limit-label">${limit > 0 ? `Idade máxima: ${limit} anos` : 'Idade máxima: não definida'}</span></div><label><input type="checkbox" name="smpKidsNotNeeded"> Não necessita do Espaço Kids</label></div><div class="kids-list">${Array.from({ length: 5 }, (_, index) => {
    const number = index + 1;
    return `<details class="smp-kid-panel" ${index === 0 ? 'open' : ''}><summary><strong>Criança ${number}</strong></summary><div class="kids-row"><span>${number}</span>${field(`smpKidNome${number}`, 'Nome')}${field(`smpKidNascimento${number}`, 'Data de nascimento', 'type="date"')}<fieldset><legend>Problema de saúde?</legend>${choices(`smpKidProblemaSaude${number}${careSuffix}`)}</fieldset>${field(`smpKidDescricaoSaude${number}${careSuffix}`, 'Qual problema?')}<fieldset><legend>Intolerância alimentar?</legend>${choices(`smpKidIntolerancia${number}${careSuffix}`)}</fieldset>${field(`smpKidDescricaoIntolerancia${number}${careSuffix}`, 'Qual intolerância?')}</div></details>`;
  }).join('')}</div></div>`;
}

function coupleForm(context) {
  const yesNo = (name) => choices(name);
  const isEpc = context.tipoFichaCursista === 'cursista-epc';
  return `${section(1, 'Dados do casal', `<div class="fields two-columns">${field('nomeDele', 'Nome dele <b>*</b>', 'required')}${field('nascimentoDele', 'Nascimento dele', 'type="date"')}${field('cpfDele', 'CPF dele', 'inputmode="numeric"')}${field('profissaoDele', 'Profissão dele')}${field('foneDele', 'Telefone dele', 'inputmode="tel"')}${field('nomeDela', 'Nome dela <b>*</b>', 'required')}${field('nascimentoDela', 'Nascimento dela', 'type="date"')}${field('cpfDela', 'CPF dela', 'inputmode="numeric"')}${field('profissaoDela', 'Profissão dela')}${field('foneDela', 'Telefone dela', 'inputmode="tel"')}</div>`)}
  ${section(2, 'Endereço e contato', `<div class="fields address-fields">${field('cep', 'CEP', 'inputmode="numeric"')}${field('endereco', 'Endereço')}${field('numero', 'Número')}${field('nrApto', 'Apartamento')}${field('bairro', 'Bairro')}${field('cidade', 'Cidade')}${field('estadoSmp', 'Estado', 'maxlength="2"')}${isEpc ? field('emailEpc', 'E-mail', 'type="email"') : ''}</div>`)}
  ${section(3, 'Vivência religiosa', `<div class="fields two-columns"><fieldset><legend>Crisma dele</legend>${yesNo('crismaDele')}</fieldset><fieldset><legend>Crisma dela</legend>${yesNo('crismaDela')}</fieldset>${isEpc ? '' : `${field('religiaoDele', 'Religião dele')}${field('religiaoDela', 'Religião dela')}${field('missaDele', 'Participação nas missas — ele')}${field('missaDela', 'Participação nas missas — ela')}`}<fieldset><legend>Movimento da Igreja — ele</legend>${yesNo('movimentoIgrejaDele')}</fieldset>${field('qualMovimentoDele', 'Qual movimento dele?')}<fieldset><legend>Movimento da Igreja — ela</legend>${yesNo('movimentoIgrejaDela')}</fieldset>${field('qualMovimentoDela', 'Qual movimento dela?')}</div>`)}
  ${section(4, 'Filhos e casamento', `<div class="fields three-columns">${isEpc ? `${field('uniaoCasal', 'Data do casamento religioso', 'type="date"')}${field('localCasamentoEpc', 'Local do casamento')}${field('idadeFilhosEpc', 'Idade dos filhos')}` : `${field('casamentoDele', 'Data do primeiro casamento dele', 'type="date"')}${field('casamentoDela', 'Data do primeiro casamento dela', 'type="date"')}${field('uniaoCasal', 'Data desta união', 'type="date"')}${field('filhosDele', 'Idade dos filhos dele')}${field('filhosDela', 'Idade dos filhos dela')}${field('filhosUniao', 'Idade dos filhos desta união')}<fieldset><legend>Houve outras uniões?</legend>${yesNo('outrasUnioes')}</fieldset>`}</div>`)}
  ${section(5, 'Espaço Kids', kidsFields(context))}
  ${section(6, 'Saúde e acolhimento', `<div class="fields two-columns"><fieldset><legend>Problema de saúde — ele</legend>${yesNo('saudeDele')}</fieldset>${field('qualSaudeDele', 'Qual?')}<fieldset><legend>Problema de saúde — ela</legend>${yesNo('saudeDela')}</fieldset>${field('qualSaudeDela', 'Qual?')}<fieldset><legend>Intolerância alimentar — ele</legend>${yesNo('intoleranciaAlimentarDele')}</fieldset>${field('qualIntoleranciaAlimentarDele', 'Qual?')}<fieldset><legend>Intolerância alimentar — ela</legend>${yesNo('intoleranciaAlimentarDela')}</fieldset>${field('qualIntoleranciaAlimentarDela', 'Qual?')}<fieldset><legend>Precisa de acolhimento?</legend>${yesNo('precisaAcolhimento')}</fieldset><fieldset><legend>Manequim dele</legend>${choices('manequimDele', ['PP', 'P', 'M', 'G', 'GG', 'G1', 'G2', 'G3'])}</fieldset><fieldset><legend>Manequim dela</legend>${choices('manequimDela', ['PP', 'P', 'M', 'G', 'GG', 'G1', 'G2', 'G3'])}</fieldset></div>`)}
  ${section(7, isEpc ? 'Apresentante e emergência' : 'Apresentante e origem', `<div class="fields two-columns">${field('nomeApresentante', 'Nome do apresentante')}${field('foneApresentante', 'Telefone do apresentante')}${isEpc ? `${field('contatoEmergenciaEpc', 'Contato de emergência')}${field('foneEmergenciaEpc', 'Telefone de emergência')}` : `${field('cursoApresentante', 'Curso do apresentante')}${field('cidadeApresentante', 'Cidade do apresentante')}${field('paroquiaApresentante', 'Paróquia do apresentante')}${field('familiarAmigo', 'Familiar ou amigo')}${field('foneFamiliar', 'Telefone')}`}</div>`)}`;
}

function payloadFromForm(form) {
  const payload = Object.fromEntries(new FormData(form));
  form.querySelectorAll('input[type="checkbox"]').forEach((input) => { payload[input.name] = input.checked; });
  ['cpf', 'cpfDele', 'cpfDela'].forEach((name) => { if (payload[name]) payload[name] = normalizeCpf(payload[name]); });
  return payload;
}

function wireForm(context) {
  const form = app.querySelector('#public-student-form');
  const message = app.querySelector('#public-student-message');
  form.querySelectorAll('[name="cpf"], [name="cpfDele"], [name="cpfDela"]').forEach((input) => input.addEventListener('input', () => { input.value = formatCpf(input.value); }));
  const kidsNotNeeded = form.elements.smpKidsNotNeeded;
  const kidsList = kidsNotNeeded?.closest('.choice-block')?.querySelector('.kids-list');
  kidsNotNeeded?.addEventListener('change', () => { if (kidsList) kidsList.hidden = kidsNotNeeded.checked; });
  const ageLimit = Number(context.retiro.idadeMaximaEspacoKids) || 0;
  const start = context.retiro.dataInicio ? new Date(`${context.retiro.dataInicio}T12:00:00`) : null;
  form.querySelectorAll('[name^="smpKidNascimento"]').forEach((input) => input.addEventListener('change', () => {
    if (!ageLimit || !start || !input.value) return;
    const birth = new Date(`${input.value}T12:00:00`);
    if (Number.isNaN(birth.getTime())) return;
    let age = start.getFullYear() - birth.getFullYear();
    if (start.getMonth() < birth.getMonth() || (start.getMonth() === birth.getMonth() && start.getDate() < birth.getDate())) age -= 1;
    if (age > ageLimit) alert('Criança acima da idade permitida pra esse retiro');
  }));
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    message.textContent = 'Salvando cadastro...';
    try {
      const response = await fetch(`/api/cadastro-cursista/${encodeURIComponent(token)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payloadFromForm(form)),
      });
      if (!response.ok) throw new Error(await errorMessage(response));
      unavailable('Cadastro realizado', `A ficha ${context.numeroFicha} foi cadastrada com sucesso.`);
    } catch (error) {
      message.textContent = error.message || 'Não foi possível concluir o cadastro.';
      button.disabled = false;
    }
  });
}

async function launch() {
  if (!token) return unavailable('Link indisponível', 'Confira o endereço recebido da equipe do retiro.');
  try {
    const response = await fetch(`/api/cadastro-cursista/${encodeURIComponent(token)}`, { cache: 'no-store' });
    if (!response.ok) throw new Error(await errorMessage(response));
    const context = await response.json();
    if (context.cadastrado) return unavailable('Ficha já cadastrada', 'Este link já foi utilizado e não permite consultar ou editar os dados enviados.');
    if (!context.ativo) return unavailable('Cadastro indisponível', 'Este retiro não está recebendo cadastros por este link.');
    const typeLabel = context.tipoFichaCursista === 'cursista-individual' ? 'Cursista Individual' : context.tipoFichaCursista === 'cursista-epc' ? 'Cursista EPC' : 'Cursista SMP';
    app.innerHTML = `<main class="public-student-shell"><header class="hero"><div><p class="eyebrow">Cadastro público de cursista</p><h1>${escapeHtml(context.retiro.nome || 'Retiro')}</h1><p class="hero-copy">${typeLabel} · Ficha ${context.numeroFicha}</p></div></header><section class="panel public-student-file"><strong>Número da ficha</strong><span>${context.numeroFicha}</span></section><form id="public-student-form" class="panel student-form">${context.tipoFichaCursista === 'cursista-individual' ? individualForm(context) : coupleForm(context)}<p id="public-student-message" class="form-message"></p><div class="form-actions"><p><b>*</b> Campos obrigatórios</p><button type="submit">Salvar cadastro <span>→</span></button></div></form></main>`;
    wireForm(context);
  } catch (error) {
    unavailable('Link indisponível', error.message || 'Confira o endereço recebido da equipe do retiro.');
  }
}

launch();
