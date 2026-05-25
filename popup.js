// ── 要素取得 ──
const btn          = document.getElementById('copy-btn');
const status       = document.getElementById('status');
const pathBox      = document.getElementById('path-box');
const settingsBtn  = document.getElementById('settings-btn');
const backBtn      = document.getElementById('back-btn');
const mainView     = document.getElementById('main-view');
const settingsView = document.getElementById('settings-view');
const mappingList  = document.getElementById('mapping-list');
const addEmail     = document.getElementById('add-email');
const addLetter    = document.getElementById('add-letter');
const addBtn       = document.getElementById('add-mapping-btn');

function setStatus(msg, type = '') {
  status.textContent = msg;
  status.className = type;
}

// ── 設定（ドライブ文字マッピング）────────────────────────

async function loadMappings() {
  const { mappings = {} } = await chrome.storage.sync.get('mappings');
  return mappings;
}

async function saveMappings(mappings) {
  await chrome.storage.sync.set({ mappings });
}

async function renderMappings() {
  const mappings = await loadMappings();
  const entries = Object.entries(mappings);
  mappingList.innerHTML = '';

  if (entries.length === 0) {
    mappingList.innerHTML = '<div class="no-mapping">設定がありません</div>';
    return;
  }

  entries.forEach(([email, letter]) => {
    const row = document.createElement('div');
    row.className = 'mapping-row';
    row.innerHTML = `
      <span class="mapping-email" title="${email}">${email}</span>
      <span class="mapping-letter">${letter}:</span>
      <button class="delete-btn" data-email="${email}">✕</button>
    `;
    row.querySelector('.delete-btn').addEventListener('click', async () => {
      const m = await loadMappings();
      delete m[email];
      await saveMappings(m);
      renderMappings();
    });
    mappingList.appendChild(row);
  });
}

settingsBtn.addEventListener('click', () => {
  mainView.style.display = 'none';
  settingsView.style.display = 'block';
  renderMappings();
});

backBtn.addEventListener('click', () => {
  settingsView.style.display = 'none';
  mainView.style.display = 'block';
});

addBtn.addEventListener('click', async () => {
  const email  = addEmail.value.trim().toLowerCase();
  const letter = addLetter.value.trim().toUpperCase();
  if (!email || !/^[A-Z]$/.test(letter)) {
    alert('メールアドレスと1文字のドライブ文字を入力してください（例：G）');
    return;
  }
  const m = await loadMappings();
  m[email] = letter;
  await saveMappings(m);
  addEmail.value = '';
  addLetter.value = '';
  renderMappings();
});

// ── メイン処理 ────────────────────────────────────────────

btn.addEventListener('click', async () => {
  btn.disabled = true;
  pathBox.style.display = 'none';
  setStatus('処理中...');

  try {
    // 1. アクティブタブの URL からフォルダID を取得
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.url) throw new Error('タブのURLを取得できませんでした');

    const match = tab.url.match(/\/folders\/([\w-]+)/);
    if (!match) {
      setStatus('Google Drive のフォルダページを開いた状態で押してください', 'error');
      btn.disabled = false;
      return;
    }
    const startId = match[1];

    // 2. OAuth トークンを取得
    const token = await new Promise((resolve, reject) => {
      chrome.identity.getAuthToken({ interactive: true }, (t) => {
        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
        else resolve(t);
      });
    });

    const headers = { Authorization: 'Bearer ' + token };

    // 3. メールアドレスを取得 → ドライブ文字を決定
    const userRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', { headers });
    const { email } = await userRes.json();
    const mappings = await loadMappings();
    const driveLetter = (email && mappings[email.toLowerCase()]) || 'G';

    // 4. ファイル情報取得ヘルパー
    const getFile = async (id) => {
      const r = await fetch(
        `https://www.googleapis.com/drive/v3/files/${id}` +
        `?fields=name,parents,driveId&supportsAllDrives=true`,
        { headers }
      );
      if (r.status === 401) {
        await new Promise(res => chrome.identity.removeCachedAuthToken({ token }, res));
        throw new Error('認証トークンが失効しました。もう一度押してください。');
      }
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error(err?.error?.message || `HTTP ${r.status}`);
      }
      return r.json();
    };

    // 5. 親フォルダを遡ってパスを組み立て
    setStatus('パスを取得中...');
    const parts = [];
    let cur = startId;
    let driveId = null;

    for (let i = 0; i < 30; i++) {
      const f = await getFile(cur);
      if (!driveId && f.driveId) driveId = f.driveId;

      // parentsがない = ルートフォルダ → 名前を追加せず終了
      if (!f.parents || f.parents.length === 0) break;

      const pid = f.parents[0];
      parts.unshift(f.name);
      if (pid === driveId) break;
      cur = pid;
    }

    // 6. プレフィックスを組み立て
    let prefix = `${driveLetter}:\\マイドライブ`;
    if (driveId) {
      const r = await fetch(
        `https://www.googleapis.com/drive/v3/drives/${driveId}?fields=name`,
        { headers }
      );
      const d = await r.json();
      prefix = `${driveLetter}:\\共有ドライブ\\${d.name || driveId}`;
    }

    // 7. Windowsパス形式に組み立て・コピー
    const winPath = prefix + '\\' + parts.join('\\');
    await navigator.clipboard.writeText(winPath);

    setStatus('✅ コピーしました！', 'success');
    pathBox.style.display = 'block';
    pathBox.textContent = winPath;

  } catch (e) {
    setStatus('エラー: ' + e.message, 'error');
  }

  btn.disabled = false;
});
