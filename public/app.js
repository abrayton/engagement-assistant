// ===== tab switching =====
document.querySelectorAll('.tab').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((b) => b.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach((p) => p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
    if (btn.dataset.tab === 'queue') loadQueue();
    if (btn.dataset.tab === 'history') loadHistory();
    if (btn.dataset.tab === 'status') loadStatus();
  });
});

// ===== queue =====
async function loadQueue() {
  const list = document.getElementById('queue-list');
  const empty = document.getElementById('queue-empty');
  const count = document.getElementById('queue-count');
  list.innerHTML = '';
  let rows;
  try {
    const res = await fetch('/api/queue');
    rows = await res.json();
  } catch (err) {
    list.innerHTML = `<p class="empty">Error loading queue: ${escapeHtml(err.message)}</p>`;
    return;
  }
  count.textContent = rows.length === 0 ? '' : `${rows.length} draft${rows.length === 1 ? '' : 's'} ready`;
  if (rows.length === 0) {
    empty.classList.remove('hidden');
    return;
  }
  empty.classList.add('hidden');
  rows.forEach((row) => list.appendChild(renderCard(row)));
}

function renderCard(row) {
  const card = document.createElement('div');
  card.className = 'card';
  card.dataset.threadId = row.id;

  const scoreClass = row.relevance_score >= 9 ? 'score-green'
    : row.relevance_score >= 7 ? 'score-yellow'
    : 'score-gray';
  const highTrafficBadge = row.high_traffic_flag
    ? `<span class="badge warning">HIGH TRAFFIC — post only if exceptional</span>`
    : '';

  const ageStr = formatAge(row.age_hours);
  const bodyPreview = (row.body || '').slice(0, 200) + ((row.body || '').length > 200 ? '…' : '');

  card.innerHTML = `
    <div class="card-header">
      <span class="badge subreddit">r/${escapeHtml(row.subreddit)}</span>
      <span class="badge ${scoreClass}">score ${row.relevance_score}</span>
      ${highTrafficBadge}
      <span class="meta">${ageStr} • ${row.comment_count} comment${row.comment_count === 1 ? '' : 's'}</span>
    </div>
    <div class="title">${escapeHtml(row.title)}</div>
    <div class="body-preview">${escapeHtml(bodyPreview)}</div>
    <a class="thread-link" href="${escapeHtml(row.url)}" target="_blank" rel="noopener">Open Thread →</a>

    <div class="scoring-context">
      <label>Why it's relevant</label>
      <div>${escapeHtml(row.relevance_reason || '')}</div>
      <label style="margin-top:6px">Suggested angle</label>
      <div>${escapeHtml(row.suggested_angle || '—')}</div>
    </div>

    <textarea class="draft-textarea">${escapeHtml(row.draft_text || '')}</textarea>
    <div class="char-count">0 chars</div>

    <div class="actions">
      <button class="primary copy-open">Copy & Open Thread</button>
      <button class="regenerate">Regenerate</button>
      <button class="skip">Skip</button>
    </div>
  `;

  const textarea = card.querySelector('.draft-textarea');
  const charCount = card.querySelector('.char-count');
  function updateCount() { charCount.textContent = `${textarea.value.length} chars`; }
  textarea.addEventListener('input', updateCount);
  updateCount();

  // wiring for the buttons happens in Task 22
  attachCardActions(card, row);

  return card;
}

function formatAge(hours) {
  if (hours < 1) return `${Math.round(hours * 60)}m old`;
  if (hours < 24) return `${hours.toFixed(1)}h old`;
  return `${(hours / 24).toFixed(1)}d old`;
}

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Stub — implemented in Task 22
function attachCardActions(card, row) { /* filled in next task */ }

// Refresh button
document.getElementById('refresh-queue').addEventListener('click', loadQueue);

// Initial load
loadQueue();

// Stubs — implemented in Task 23
function loadHistory() {}
function loadStatus() {}
