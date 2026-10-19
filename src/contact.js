const endpoint = '/api/contact';

async function requestContact(suffix = '', options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(endpoint + suffix, {
      credentials: 'same-origin', cache: 'no-store', ...options, signal: controller.signal,
      headers: { Accept: 'application/json', ...options.headers },
    });
    if (!response.ok) throw new Error('Contact request failed');
    return await response.json();
  } finally { clearTimeout(timeout); }
}

export function createContactForms() {
  document.querySelectorAll('[data-contact-form]').forEach(form => {
    const button = form.querySelector('button[type="submit"]');
    const status = form.querySelector('.contact-form-status');
    const callback = form.dataset.contactMode === 'callback';
    const requiredFields = callback ? ['email'] : ['name', 'email', 'message'];
    const submitLabel = button.textContent.trim();
    let submission = null, busy = false;
    form.querySelectorAll('[required]').forEach(input => input.addEventListener('input', () => {
      input.setCustomValidity(''); status.hidden = true;
    }));
    form.addEventListener('submit', async event => {
      event.preventDefault();
      if (busy || !form.reportValidity()) return;
      const data = new FormData(form);
      const fields = Object.fromEntries([...requiredFields, 'website'].map(key => [key, String(data.get(key) || '').trim()]));
      if (callback) fields.kind = 'callback';
      for (const key of requiredFields) {
        if (!fields[key]) {
          form.elements.namedItem(key).setCustomValidity('Please fill out this field.');
          form.reportValidity(); return;
        }
      }
      const fingerprint = JSON.stringify(fields);
      if (submission?.fingerprint !== fingerprint) submission = { fingerprint, id: crypto.randomUUID() };
      busy = true;
      status.hidden = true;
      button.textContent = 'Sending…';
      form.setAttribute('aria-busy', 'true');
      const inputs = [...form.querySelectorAll('input,textarea,button[type="submit"]')];
      inputs.forEach(input => input.disabled = true);
      try {
        const result = await requestContact('', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: submission.id, ...fields }),
        });
        if (result.receipt !== submission.id) throw new Error('Unconfirmed message');
        form.reset();
        submission = null;
        status.textContent = callback ? 'Email received.' : 'Message sent.';
      } catch {
        status.textContent = 'Couldn’t send. Try again.';
      } finally {
        status.hidden = false;
        inputs.forEach(input => input.disabled = false);
        button.textContent = submitLabel;
        form.removeAttribute('aria-busy');
        busy = false;
      }
    });
  });

  const inbox = document.querySelector('#contact-inbox');
  const messages = inbox.querySelector('[data-inbox-messages]');
  const status = inbox.querySelector('[data-inbox-status]');
  const more = inbox.querySelector('[data-inbox-more]');
  const openers = [...document.querySelectorAll('[data-inbox-open]')];
  let cursor = null, loading = false;
  function renderMessage(message) {
    const article = document.createElement('article'); article.className = 'contact-inbox-message';
    const name = document.createElement('h3'); name.textContent = message.kind === 'callback' ? 'Email enquiry' : message.name;
    const meta = document.createElement('div'); meta.className = 'contact-inbox-meta';
    const email = document.createElement('a'); email.textContent = message.email;
    email.href = `mailto:${encodeURIComponent(message.email)}`;
    const time = document.createElement('time'); time.dateTime = message.createdAt;
    const date = new Date(message.createdAt);
    time.textContent = Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat('en', { dateStyle: 'medium' }).format(date) : '';
    meta.append(email, time);
    article.append(name, meta);
    if (message.kind !== 'callback') {
      const body = document.createElement('p'); body.className = 'contact-inbox-body'; body.textContent = message.message;
      article.append(body);
    }
    return article;
  }
  async function loadMessages(reset = false) {
    if (loading) return;
    loading = true; more.disabled = true; status.hidden = false; status.textContent = 'Loading…';
    if (reset) { cursor = null; messages.replaceChildren(); more.hidden = true; }
    try {
      const suffix = '?inbox=1' + (cursor ? `&cursor=${encodeURIComponent(cursor)}` : '');
      const result = await requestContact(suffix);
      if (!Array.isArray(result.messages)) throw new Error('Invalid inbox');
      messages.append(...result.messages.map(renderMessage));
      cursor = typeof result.cursor === 'string' && result.cursor ? result.cursor : null;
      more.hidden = !cursor;
      status.textContent = messages.childElementCount ? '' : 'No messages yet.';
      status.hidden = Boolean(messages.childElementCount);
    } catch {
      status.hidden = false; status.textContent = 'Couldn’t load messages.';
    } finally { loading = false; more.disabled = false; }
  }
  openers.forEach(button => button.addEventListener('click', () => { inbox.showModal(); loadMessages(true); }));
  more.addEventListener('click', () => loadMessages());
  inbox.querySelector('[data-inbox-close]').addEventListener('click', () => inbox.close());
  inbox.addEventListener('click', event => {
    if (event.target !== inbox) return;
    const bounds = inbox.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) inbox.close();
  });
  requestContact().then(result => { openers.forEach(button => button.hidden = result.canRead !== true); }).catch(() => {});
}
