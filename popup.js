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
const nameMy       = document.getElementById('name-my');
const nameShared   = document.getElementById('name-shared');
const saveNamesBtn = document.getElementById('save-names-btn');
const namesStatus  = document.getElementById('names-status');

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
    // 入力値を HTML として解釈させないよう、innerHTML は使わず textContent で組み立てる
    const row = document.createElement('div');
    row.className = 'mapping-row';

    const emailSpan = document.createElement('span');
    emailSpan.className = 'mapping-email';
    emailSpan.title = email;
    emailSpan.textContent = email;

    const letterSpan = document.createElement('span');
    letterSpan.className = 'mapping-letter';
    letterSpan.textContent = `${letter}:`;

    const delBtn = document.createElement('button');
    delBtn.className = 'delete-btn';
    delBtn.textContent = '✕';

    row.append(emailSpan, letterSpan, delBtn);
    delBtn.addEventListener('click', async () => {
      const m = await loadMappings();
      delete m[email];
      await saveMappings(m);
      renderMappings();
    });
    mappingList.appendChild(row);
  });
}

// ── 設定（フォルダ名）────────────────────────────────────
// パソコン版ドライブは Windows の表示言語でフォルダ名が変わる（英語版は My Drive / Shared drives）。
// 既定値はブラウザの表示言語から推定し、合わない環境では設定画面で書き換えてもらう。
const DEFAULT_NAMES = (chrome.i18n.getUILanguage() || '').toLowerCase().startsWith('ja')
  ? { myDrive: 'マイドライブ', sharedDrives: '共有ドライブ' }
  : { myDrive: 'My Drive', sharedDrives: 'Shared drives' };

// Windows のフォルダ名に使えない文字と制御文字
const INVALID_FOLDER_CHARS = /[\\/:*?"<>|\u0000-\u001F\u007F-\u009F]/;

async function loadFolderNames() {
  const { folderNames = {} } = await chrome.storage.sync.get('folderNames');
  return {
    myDrive:      folderNames.myDrive      || DEFAULT_NAMES.myDrive,
    sharedDrives: folderNames.sharedDrives || DEFAULT_NAMES.sharedDrives,
  };
}

async function renderFolderNames() {
  const names = await loadFolderNames();
  nameMy.value = names.myDrive;
  nameShared.value = names.sharedDrives;
  nameMy.placeholder = DEFAULT_NAMES.myDrive;
  nameShared.placeholder = DEFAULT_NAMES.sharedDrives;
  namesStatus.textContent = '';
}

saveNamesBtn.addEventListener('click', async () => {
  const myDrive = nameMy.value.trim();
  const sharedDrives = nameShared.value.trim();
  if (INVALID_FOLDER_CHARS.test(myDrive + sharedDrives)) {
    namesStatus.className = 'error';
    namesStatus.textContent = '\\ / : * ? " < > | は使えません';
    return;
  }
  // 空欄は保存しない（= 既定値を使う）
  const folderNames = {};
  if (myDrive) folderNames.myDrive = myDrive;
  if (sharedDrives) folderNames.sharedDrives = sharedDrives;
  await chrome.storage.sync.set({ folderNames });
  await renderFolderNames();
  namesStatus.className = '';
  namesStatus.textContent = '保存しました';
});

settingsBtn.addEventListener('click', () => {
  mainView.style.display = 'none';
  settingsView.style.display = 'block';
  renderMappings();
  renderFolderNames();
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

// ── フォルダ名の無害化 ──────────────────────────────────────
// フォルダ名は共有元の他人が自由に付けられる。改行などの制御文字が入っていると、
// コピーしたパスをターミナルに貼り付けた時点でコマンドが実行されうる（ペーストジャッキング）。
// 表示方向の制御文字・ゼロ幅文字は、表示とコピー内容を食い違わせる偽装に使えるため併せて除去する。
const UNSAFE_CHARS = /[\u0000-\u001F\u007F-\u009F​-‏‪-‮⁦-⁩﻿]/g;
const sanitizeName = (name) => String(name ?? '').replace(UNSAFE_CHARS, '');

// ── クリップボード ────────────────────────────────────────
// 初回の OAuth 同意画面（別ウィンドウ）を閉じた直後はポップアップにフォーカスがなく、
// navigator.clipboard.writeText が "Document is not focused" で失敗する。
// その場合は execCommand('copy') にフォールバックする（clipboardWrite 権限があれば
// フォーカスやユーザー操作がなくても書き込める）。
async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (_) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  }
}

// ── メイン処理 ────────────────────────────────────────────

btn.addEventListener('click', async () => {
  btn.disabled = true;
  pathBox.style.display = 'none';
  setStatus('処理中...');

  try {
    // 1. アクティブタブの URL からフォルダID を取得
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.url) throw new Error('タブのURLを取得できませんでした');

    const url = new URL(tab.url);
    const match = url.hostname === 'drive.google.com' && url.pathname.match(/\/folders\/([\w-]+)/);
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
      parts.unshift(sanitizeName(f.name));
      if (pid === driveId) break;
      cur = pid;
    }

    // 6. プレフィックスを組み立て
    const names = await loadFolderNames();
    let prefix = `${driveLetter}:\\${names.myDrive}`;
    if (driveId) {
      const r = await fetch(
        `https://www.googleapis.com/drive/v3/drives/${driveId}?fields=name`,
        { headers }
      );
      const d = await r.json();
      prefix = `${driveLetter}:\\${names.sharedDrives}\\${sanitizeName(d.name) || driveId}`;
    }

    // 7. Windowsパス形式に組み立て・コピー
    const winPath = prefix + '\\' + parts.join('\\');
    pathBox.style.display = 'block';
    pathBox.textContent = winPath;

    if (await copyText(winPath)) {
      setStatus('✅ コピーしました！', 'success');
    } else {
      // 最終手段: フォーカスとユーザー操作がある次のクリックでコピーする
      setStatus('パスを取得しました。ポップアップ内をクリックするとコピーします');
      document.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(winPath);
          setStatus('✅ コピーしました！', 'success');
        } catch (e) {
          setStatus('エラー: ' + e.message, 'error');
        }
      }, { once: true });
    }

  } catch (e) {
    setStatus('エラー: ' + e.message, 'error');
  }

  btn.disabled = false;
});
