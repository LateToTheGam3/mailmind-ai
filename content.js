console.log('MailMind content script loaded!');

const MODELS = ['stepfun/step-3.5-flash:free', 'google/gemma-3-27b-it:free'];

const TONES = [
  { id: 'professional', label: '💼 Professional' },
  { id: 'friendly', label: '😊 Friendly' },
  { id: 'persuasive', label: '🎯 Persuasive' },
  { id: 'concise', label: '⚡ Concise' },
  { id: 'empathetic', label: '🤝 Empathetic' },
  { id: 'urgent', label: '🔥 Urgent' },
  { id: 'value', label: '💎 Whats In It For Them' },
];

const TONE_PROMPTS = {
  professional: 'Write in a professional tone — clear, confident, and respectful.',
  friendly: 'Write in a friendly tone — warm, approachable, and personable.',
  persuasive: 'Write in a persuasive tone — compelling and action-driving.',
  concise: 'Write in a concise tone — short, direct, absolutely no fluff.',
  empathetic: 'Write in an empathetic tone — understanding, human, and caring.',
  urgent: 'Write in an urgent tone — time-sensitive and motivating.',
  value: `Write this email using the "What's In It For Them" principle. The recipient is busy and has no obligation to respond. The email must: 1. Open by immediately signalling value TO THEM — not what you want, but what they gain. 2. Be specific about what you can offer that makes THEIR life easier or more successful. 3. Position the sender as someone who adds value, not takes up time. 4. Make them think "I can get something from this person". 5. End with a low-friction ask that feels worth their time. Be smart, confident, never beg. Feel like a peer offering value, not someone asking for a favour.`,
};

const injectedToolbars = new WeakSet();
let isGenerating = false;

function getSelectedText() {
  return window.getSelection()?.toString().trim() || '';
}

function getLastEmailInThread() {
  const emailBodies = document.querySelectorAll('.a3s.aiL, .a3s, .ii.gt');
  if (!emailBodies.length) return '';
  return emailBodies[emailBodies.length - 1]?.innerText?.trim() || '';
}

function findComposeWindow(toolbar) {
  return toolbar.closest('.M9') || toolbar.closest('[jscontroller]');
}

function findBodyEl(toolbar) {
  const win = findComposeWindow(toolbar);
  const selectors = [
    '[contenteditable="true"][aria-label*="Message Body"]',
    '[contenteditable="true"][aria-label*="message"]',
    '[contenteditable="true"][g_editable="true"]',
    '.Am.Al.editable',
    '[contenteditable="true"]'
  ];
  if (win) {
    for (const sel of selectors) {
      const el = win.querySelector(sel);
      if (el) return el;
    }
  }
  for (const sel of selectors) {
    for (const el of document.querySelectorAll(sel)) {
      if (el.offsetHeight > 50) return el;
    }
  }
  return null;
}

function getSubject(toolbar) {
  const win = findComposeWindow(toolbar);
  const subjectInWindow = win?.querySelector('input[name="subjectbox"]');
  if (subjectInWindow?.value?.trim()) return subjectInWindow.value.trim();

  const allSubjectBoxes = Array.from(document.querySelectorAll('input[name="subjectbox"]'));
  if (allSubjectBoxes.length === 1) return allSubjectBoxes[0].value.trim();

  if (allSubjectBoxes.length > 1) {
    const toolbarRect = toolbar.getBoundingClientRect();
    let closest = null;
    let minDistance = Infinity;
    for (const box of allSubjectBoxes) {
      const rect = box.getBoundingClientRect();
      const distance = Math.abs(rect.top - toolbarRect.top) + Math.abs(rect.left - toolbarRect.left);
      if (distance < minDistance) { minDistance = distance; closest = box; }
    }
    if (closest?.value?.trim()) return closest.value.trim();
  }
  return document.querySelector('h2.hP')?.innerText?.trim() || '';
}

function insertIntoBody(bodyEl, text) {
  bodyEl.focus();
  bodyEl.style.direction = 'ltr';
  bodyEl.style.textAlign = 'left';
  bodyEl.innerHTML = '';
  text.split('\n').forEach((line, i) => {
    if (i > 0) bodyEl.appendChild(document.createElement('br'));
    bodyEl.appendChild(document.createTextNode(line));
  });
  bodyEl.dispatchEvent(new Event('input', { bubbles: true }));
}

function injectUI(toolbar) {
  if (injectedToolbars.has(toolbar)) return;
  injectedToolbars.add(toolbar);

  let selectedTone = 'professional';
  let selectedMode = 'compose';

  const wrapper = document.createElement('div');
  wrapper.style.cssText = 'display:flex;align-items:center;gap:4px;margin-left:6px;';

  const modeSelect = document.createElement('select');
  modeSelect.style.cssText = `
    background:#1a1a1a;color:#aaa;border:1px solid #333;
    border-radius:3px;padding:4px 6px;font-size:11px;
    font-weight:600;cursor:pointer;outline:none;
  `;
  [{ id: 'compose', label: '✦ Compose' }, { id: 'reply', label: '↩ Reply' }].forEach(m => {
    const opt = document.createElement('option');
    opt.value = m.id;
    opt.textContent = m.label;
    modeSelect.appendChild(opt);
  });
  modeSelect.addEventListener('change', (e) => { selectedMode = e.target.value; });

  const toneSelect = document.createElement('select');
  toneSelect.style.cssText = `
    background:#1a1a1a;color:#c8f542;border:1px solid #c8f542;
    border-radius:3px;padding:4px 6px;font-size:11px;
    font-weight:600;cursor:pointer;outline:none;max-width:175px;
  `;
  TONES.forEach(tone => {
    const opt = document.createElement('option');
    opt.value = tone.id;
    opt.textContent = tone.label;
    if (tone.id === selectedTone) opt.selected = true;
    toneSelect.appendChild(opt);
  });
  toneSelect.addEventListener('change', (e) => { selectedTone = e.target.value; });

  const btn = document.createElement('button');
  btn.className = 'mailmind-btn';
  btn.innerHTML = '⚡ Go';

  btn.addEventListener('click', async (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (isGenerating) return;
    isGenerating = true;

    // Get API key securely from chrome.storage
    const storage = await chrome.storage.sync.get('apiKey');
    const apiKey = storage.apiKey;
    if (!apiKey) {
      alert('Please add your OpenRouter API key by clicking the MailMind icon in the Chrome toolbar.');
      isGenerating = false;
      return;
    }

    const bodyEl = findBodyEl(toolbar);
    const subject = getSubject(toolbar);
    const toneInstruction = TONE_PROMPTS[selectedTone];
    const selectedText = getSelectedText();
    const currentDraft = bodyEl?.innerText?.trim() || '';

    let prompt = '';
    if (selectedMode === 'reply') {
      const emailToReplyTo = selectedText || getLastEmailInThread();
      if (!emailToReplyTo) {
        alert('No email found to reply to. Select the email text you want to reply to, or open a thread.');
        isGenerating = false;
        return;
      }
      prompt = `You are an expert email writer. ${toneInstruction}\n\nWrite a reply to this email:\n---\n${emailToReplyTo.slice(0, 2000)}\n---\n${currentDraft ? `\nGuidance: ${currentDraft}` : ''}\n\nReturn ONLY the reply body. No subject line. No explanation.`;
    } else {
      prompt = currentDraft
        ? `You are an expert email writer. ${toneInstruction}\n\nRewrite this email about "${subject}" and return ONLY the improved body:\n\n${currentDraft}`
        : `You are an expert email writer. ${toneInstruction}\n\nWrite an email with this subject: "${subject}". Return ONLY the email body. No subject line. No explanation.`;
    }

    btn.disabled = true;
    btn.innerHTML = '⏳...';

    try {
      let result = null;
      for (let m = 0; m < MODELS.length; m++) {
        try {
          if (m > 0) { btn.innerHTML = '⏳ Backup...'; await new Promise(r => setTimeout(r, 2000)); }
          const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey },
            body: JSON.stringify({ model: MODELS[m], messages: [{ role: 'user', content: prompt }] })
          });
          const data = await response.json();
          if (data.error) throw new Error(data.error.message);
          result = data.choices[0].message.content;
          break;
        } catch (err) {
          console.log('Model failed:', err.message);
          if (m === MODELS.length - 1) throw err;
        }
      }
      if (result && bodyEl) {
        insertIntoBody(bodyEl, result);
      } else {
        alert('Could not find email body. Click inside the compose window first.');
      }
    } catch (err) {
      alert('MailMind error: ' + err.message);
    } finally {
      btn.innerHTML = '⚡ Go';
      btn.disabled = false;
      isGenerating = false;
    }
  });

  wrapper.appendChild(modeSelect);
  wrapper.appendChild(toneSelect);
  wrapper.appendChild(btn);
  toolbar.appendChild(wrapper);
}

const observer = new MutationObserver(() => {
  document.querySelectorAll('.aDh').forEach(toolbar => injectUI(toolbar));
});

observer.observe(document.body, { childList: true, subtree: true });
