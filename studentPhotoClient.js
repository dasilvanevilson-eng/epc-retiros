const SOURCE_MAX_BYTES = 15 * 1024 * 1024;
const FINAL_MAX_BYTES = 2 * 1024 * 1024;
let heicLoader;

const escapeHtml = (value = '') => String(value).replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[character]));

function loadHeicDecoder() {
  if (globalThis.heic2any) return Promise.resolve(globalThis.heic2any);
  if (!heicLoader) heicLoader = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = '/assets/vendor/heic2any.min.js';
    script.onload = () => globalThis.heic2any ? resolve(globalThis.heic2any) : reject(new Error('Conversor HEIC indisponivel.'));
    script.onerror = () => reject(new Error('Nao foi possivel carregar o conversor HEIC.'));
    document.head.append(script);
  });
  return heicLoader;
}

async function fileKind(file) {
  const bytes = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  const ascii = String.fromCharCode(...bytes);
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return 'jpeg';
  if (bytes.slice(0, 8).every((value, index) => value === [137, 80, 78, 71, 13, 10, 26, 10][index])) return 'png';
  if (ascii.slice(0, 4) === 'RIFF' && ascii.slice(8, 12) === 'WEBP') return 'webp';
  const brand = ascii.slice(8, 12).toLowerCase();
  if (ascii.slice(4, 8) === 'ftyp' && ['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'mif1', 'msf1'].includes(brand)) return 'heic';
  return '';
}

async function decodableBlob(file, onStatus) {
  if (!file || file.size <= 0) throw new Error('Selecione uma imagem valida.');
  if (file.size > SOURCE_MAX_BYTES) throw new Error('A imagem original deve ter no maximo 15 MB.');
  const kind = await fileKind(file);
  if (!kind) throw new Error('Formato nao reconhecido. Use JPEG, PNG, WebP, HEIC ou HEIF.');
  if (kind !== 'heic') return file;
  onStatus('Convertendo imagem HEIC/HEIF...');
  const heic2any = await loadHeicDecoder();
  const converted = await heic2any({ blob: file, toType: 'image/jpeg', quality: 0.95, multiple: false });
  return Array.isArray(converted) ? converted[0] : converted;
}

function loadImage(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const image = new Image();
    image.onload = () => resolve({ image, url });
    image.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Nao foi possivel abrir esta imagem.')); };
    image.src = url;
  });
}

function cropDialog(blob, { type }) {
  const individual = type === 'individual';
  const output = individual ? { width: 900, height: 1200 } : { width: 1200, height: 900 };
  return new Promise(async (resolve, reject) => {
    let loaded;
    try { loaded = await loadImage(blob); } catch (error) { reject(error); return; }
    const { image, url } = loaded;
    const overlay = document.createElement('div');
    overlay.className = 'student-photo-editor-overlay';
    overlay.innerHTML = `<section class="student-photo-editor" role="dialog" aria-modal="true" aria-labelledby="student-photo-editor-title"><div class="panel-heading"><div><p class="eyebrow">Foto opcional</p><h2 id="student-photo-editor-title">Ajustar enquadramento</h2><p>Arraste a imagem e use o zoom para enquadrar ${individual ? 'o cursista' : 'o casal'}.</p></div></div><canvas width="${output.width}" height="${output.height}" tabindex="0" aria-label="Pre-visualizacao do recorte. Use as setas para mover a imagem."></canvas><label class="student-photo-zoom"><span>Zoom</span><input type="range" min="1" max="3" value="1" step="0.01"></label><div class="student-photo-editor-actions"><button type="button" data-photo-rotate>Girar 90°</button><button type="button" data-photo-cancel>Cancelar</button><button type="button" class="primary-button" data-photo-confirm>Usar esta foto</button></div><p class="form-message" data-photo-editor-message></p></section>`;
    document.body.append(overlay);
    const canvas = overlay.querySelector('canvas');
    const context = canvas.getContext('2d', { alpha: false });
    const zoom = overlay.querySelector('input[type="range"]');
    const message = overlay.querySelector('[data-photo-editor-message]');
    let rotation = 0; let offsetX = 0; let offsetY = 0; let dragging = false; let previous = null;
    const rotatedSize = () => rotation % 180 === 0 ? { width: image.naturalWidth, height: image.naturalHeight } : { width: image.naturalHeight, height: image.naturalWidth };
    const draw = () => {
      const rotated = rotatedSize();
      const base = Math.max(output.width / rotated.width, output.height / rotated.height);
      const scale = base * Number(zoom.value);
      const maxX = Math.max(0, (rotated.width * scale - output.width) / 2);
      const maxY = Math.max(0, (rotated.height * scale - output.height) / 2);
      offsetX = Math.max(-maxX, Math.min(maxX, offsetX));
      offsetY = Math.max(-maxY, Math.min(maxY, offsetY));
      context.save();
      context.fillStyle = '#fff'; context.fillRect(0, 0, output.width, output.height);
      context.translate(output.width / 2 + offsetX, output.height / 2 + offsetY);
      context.rotate(rotation * Math.PI / 180);
      context.scale(scale, scale);
      context.drawImage(image, -image.naturalWidth / 2, -image.naturalHeight / 2);
      context.restore();
    };
    const onEscape = (event) => { if (event.key === 'Escape') { close(); resolve(null); } };
    const close = () => { document.removeEventListener('keydown', onEscape); URL.revokeObjectURL(url); overlay.remove(); };
    document.addEventListener('keydown', onEscape);
    zoom.addEventListener('input', draw);
    overlay.querySelector('[data-photo-rotate]').addEventListener('click', () => { rotation = (rotation + 90) % 360; offsetX = 0; offsetY = 0; draw(); });
    canvas.addEventListener('pointerdown', (event) => { dragging = true; previous = event; canvas.setPointerCapture(event.pointerId); });
    canvas.addEventListener('pointermove', (event) => {
      if (!dragging || !previous) return;
      const rect = canvas.getBoundingClientRect();
      offsetX += (event.clientX - previous.clientX) * output.width / rect.width;
      offsetY += (event.clientY - previous.clientY) * output.height / rect.height;
      previous = event; draw();
    });
    canvas.addEventListener('pointerup', () => { dragging = false; previous = null; });
    canvas.addEventListener('pointercancel', () => { dragging = false; previous = null; });
    canvas.addEventListener('keydown', (event) => {
      const movement = event.shiftKey ? 40 : 12;
      if (event.key === 'ArrowLeft') offsetX -= movement;
      else if (event.key === 'ArrowRight') offsetX += movement;
      else if (event.key === 'ArrowUp') offsetY -= movement;
      else if (event.key === 'ArrowDown') offsetY += movement;
      else return;
      event.preventDefault(); draw();
    });
    overlay.querySelector('[data-photo-cancel]').addEventListener('click', () => { close(); resolve(null); });
    overlay.querySelector('[data-photo-confirm]').addEventListener('click', async () => {
      const button = overlay.querySelector('[data-photo-confirm]');
      button.disabled = true; message.textContent = 'Otimizando imagem...';
      try {
        let result = null;
        for (const quality of [0.92, 0.89, 0.86, 0.85]) {
          result = await new Promise((done) => canvas.toBlob(done, 'image/jpeg', quality));
          if (result && result.size <= FINAL_MAX_BYTES) break;
        }
        if (!result || result.size > FINAL_MAX_BYTES) throw new Error('Nao foi possivel reduzir a foto para 2 MB sem comprometer a qualidade.');
        close(); resolve(result);
      } catch (error) { message.textContent = error.message; button.disabled = false; }
    });
    draw();
  });
}

const photoUrl = (type, retreatId, recordId) => `/api/cursista-foto/${encodeURIComponent(type)}/${encodeURIComponent(retreatId)}/${encodeURIComponent(recordId)}`;

export function attachStudentPhotoField(form, { type, publicMode = false, mountTarget = null } = {}) {
  if (!form || form.querySelector('[data-student-photo-field]')) return form?._studentPhotoController || null;
  const individual = type === 'individual';
  const section = document.createElement('section');
  section.className = 'student-photo-field is-file-number-photo';
  section.dataset.studentPhotoField = type;
  section.innerHTML = `<div class="section-heading"><span aria-hidden="true">📷</span><div><h2>${individual ? 'Foto do cursista' : 'Foto do casal'}</h2><p>Opcional · enquadramento ${individual ? 'vertical' : 'horizontal'}</p></div></div><div class="student-photo-layout"><div class="student-photo-preview ${individual ? 'is-portrait' : 'is-landscape'}"><span>Nenhuma foto selecionada</span><img alt="${escapeHtml(individual ? 'Foto do cursista' : 'Foto do casal')}" hidden></div><div class="student-photo-controls"><input type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif" data-photo-file hidden><input type="file" accept="image/*" capture="environment" data-photo-camera hidden><button type="button" data-photo-choose>Escolher no dispositivo</button><button type="button" data-photo-capture>Usar câmera</button><button type="button" class="delete-student-photo" data-photo-delete hidden>Excluir foto</button><p class="hint">JPEG, PNG, WebP, HEIC ou HEIF, até 15 MB.</p><p class="form-message" data-photo-message aria-live="polite"></p></div></div>`;
  const target = mountTarget || form;
  if (mountTarget) target.append(section);
  else {
    const anchor = form.querySelector('.form-section, .cursista-smp-section');
    if (anchor) form.insertBefore(section, anchor); else form.prepend(section);
  }
  const preview = section.querySelector('.student-photo-preview');
  const image = preview.querySelector('img');
  const placeholder = preview.querySelector('span');
  const message = section.querySelector('[data-photo-message]');
  const fileInput = section.querySelector('[data-photo-file]');
  const cameraInput = section.querySelector('[data-photo-camera]');
  const deleteButton = section.querySelector('[data-photo-delete]');
  if (publicMode) deleteButton.remove();
  let pendingBlob = null; let previewUrl = ''; let currentRecord = null;
  const setMessage = (text) => { message.textContent = text || ''; };
  const showBlob = (blob) => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = URL.createObjectURL(blob); image.src = previewUrl; image.hidden = false; placeholder.hidden = true;
  };
  const choose = async (file) => {
    if (!file) return;
    try {
      setMessage('Preparando imagem...');
      const source = await decodableBlob(file, setMessage);
      const cropped = await cropDialog(source, { type });
      if (!cropped) { setMessage('Ajuste cancelado.'); return; }
      pendingBlob = cropped; showBlob(cropped); setMessage('Foto pronta. Ela será enviada ao salvar a ficha.');
    } catch (error) { setMessage(error.message || 'Nao foi possivel preparar a imagem.'); }
    finally { fileInput.value = ''; cameraInput.value = ''; }
  };
  section.querySelector('[data-photo-choose]').addEventListener('click', () => fileInput.click());
  section.querySelector('[data-photo-capture]').addEventListener('click', () => cameraInput.click());
  fileInput.addEventListener('change', () => choose(fileInput.files?.[0]));
  cameraInput.addEventListener('change', () => choose(cameraInput.files?.[0]));
  const controller = {
    hasPending: () => Boolean(pendingBlob),
    async uploadLogged(record) {
      if (!pendingBlob) return false;
      const retreatId = record?.retiroId; const recordId = record?.id || record?.numeroFichaSmp;
      if (!retreatId || !recordId) throw new Error('Salve a ficha antes de enviar a foto.');
      setMessage('Enviando foto...');
      const response = await fetch(photoUrl(type, retreatId, recordId), { method: 'PUT', credentials: 'same-origin', headers: { 'Content-Type': 'image/jpeg' }, body: pendingBlob });
      const details = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(details.error || 'Nao foi possivel enviar a foto.');
      pendingBlob = null; currentRecord = record; if (deleteButton) deleteButton.hidden = false; setMessage('Foto salva com segurança.'); return true;
    },
    async uploadPublic(photoUploadToken, apiUrl) {
      if (!pendingBlob) return false;
      if (!photoUploadToken) throw new Error('O cadastro foi salvo, mas a autorizacao da foto nao foi recebida.');
      setMessage('Cadastro salvo. Enviando foto...');
      const target = new URL(apiUrl, location.origin);
      target.pathname = `${target.pathname.replace(/\/$/, '')}/foto`;
      const response = await fetch(target, { method: 'POST', headers: { 'Content-Type': 'image/jpeg', 'X-Photo-Upload-Token': photoUploadToken }, body: pendingBlob });
      const details = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(details.error || 'Cadastro salvo, mas nao foi possivel enviar a foto.');
      pendingBlob = null; setMessage('Cadastro e foto salvos com sucesso.'); return true;
    },
    async load(record) {
      pendingBlob = null;
      currentRecord = record || null;
      if (deleteButton) deleteButton.hidden = true;
      if (previewUrl) { URL.revokeObjectURL(previewUrl); previewUrl = ''; }
      image.hidden = true; image.removeAttribute('src'); placeholder.hidden = false; placeholder.textContent = 'Nenhuma foto cadastrada'; setMessage('');
      if (publicMode || !record?.retiroId || !(record.id || record.numeroFichaSmp)) return;
      try {
        const response = await fetch(photoUrl(type, record.retiroId, record.id || record.numeroFichaSmp), { credentials: 'same-origin', cache: 'no-store' });
        if (response.status === 404) return;
        if (!response.ok) return;
        showBlob(await response.blob()); placeholder.textContent = ''; if (deleteButton) deleteButton.hidden = false;
      } catch { /* A ficha permanece utilizavel mesmo se a foto estiver indisponivel. */ }
    },
    reset() { pendingBlob = null; currentRecord = null; if (previewUrl) URL.revokeObjectURL(previewUrl); previewUrl = ''; image.hidden = true; image.removeAttribute('src'); placeholder.hidden = false; placeholder.textContent = 'Nenhuma foto selecionada'; if (deleteButton) deleteButton.hidden = true; setMessage(''); },
  };
  deleteButton?.addEventListener('click', async () => {
    const retreatId = currentRecord?.retiroId; const recordId = currentRecord?.id || currentRecord?.numeroFichaSmp;
    if (!retreatId || !recordId) return;
    if (!confirm('Excluir definitivamente a foto e todas as versões anteriores desta ficha? Esta ação não poderá ser desfeita.')) return;
    deleteButton.disabled = true; setMessage('Excluindo foto definitivamente...');
    try {
      const response = await fetch(photoUrl(type, retreatId, recordId), { method: 'DELETE', credentials: 'same-origin', headers: { 'X-Confirm-Photo-Deletion': 'definitive' } });
      const details = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(details.error || 'Nao foi possivel excluir a foto.');
      pendingBlob = null; if (previewUrl) URL.revokeObjectURL(previewUrl); previewUrl = ''; image.hidden = true; image.removeAttribute('src'); placeholder.hidden = false; placeholder.textContent = 'Nenhuma foto cadastrada'; deleteButton.hidden = true; setMessage('Foto excluída definitivamente.');
    } catch (error) { setMessage(error.message || 'Nao foi possivel excluir a foto.'); }
    finally { deleteButton.disabled = false; }
  });
  form._studentPhotoController = controller;
  return controller;
}

export { photoUrl };
