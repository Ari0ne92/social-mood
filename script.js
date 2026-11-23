/* ============================================================
   灵感配方 Social Mood — 交互脚本
   说明：优先请求本地 Python 后端 /api/generate；
        若后端未启动（例如直接双击打开 index.html），
        则使用下方内置的演示数据，保证页面依然可用。
   ============================================================ */

const API_URL = './api/generate';

/* ---------- 本地内置演示数据（后端未启动时的兜底） ---------- */
const FALLBACK_DATA = {
  copies: {
    朋友圈: [
      { text: '生活很吵，但今天的风刚刚好。', tags: '#日常 #随手记' },
      { text: '把普通的一天，过成值得纪念的一天。', tags: '#生活碎片' },
      { text: '没什么大事发生，这就很好。', tags: '#此刻' }
    ],
    小红书: [
      { text: '姐妹们！这家店我真的要吹爆，环境拍照一绝，出片率 100%✨', tags: '#探店 #周末去哪儿 #拍照打卡' },
      { text: '不化妆也能拍出氛围感的 3 个小技巧，最后一个我用了半年！', tags: '#氛围感 #拍照技巧 #新手友好' },
      { text: '花小钱办大事！今天这份快乐只花了 28 块', tags: '#性价比 #好物分享 #日常省钱' }
    ],
    抖音: [
      { text: '这一刻我突然不想发朋友圈了，只想发给你看。', tags: '#记录美好生活 #治愈系' },
      { text: '普通人的一天，也可以闪闪发光✨', tags: '#日常vlog #生活碎片' },
      { text: '别划走，这 3 秒真的很治愈。', tags: '#解压 #氛围感' }
    ]
  },
  bgm: [
    { title: '夏日漱石', artist: 'RADWIMPS', reason: '前奏一响就有电影感，适合城市街拍与傍晚光线。' },
    { title: '关于郑州的记忆', artist: '李志', reason: '叙事感强，适合配长句文案，情绪克制又耐听。' },
    { title: 'Sweet Night', artist: 'V', reason: '温柔的钢琴铺底，不抢画面，适合安静的生活片段。' },
    { title: '春を知らせるもの', artist: '羽毛田丈史', reason: '干净通透，适合浅色调照片，氛围轻盈。' },
    { title: 'Sunset Lover', artist: 'Petit Biscuit', reason: '节拍轻快，适合动态视频与快节奏剪辑。' },
    { title: '晚安', artist: '鹿先森乐队', reason: '尾音收得干净，适合作为图文结尾的情绪落点。' }
  ]
};

/* ---------- 页面状态 ---------- */
const state = {
  platform: '朋友圈',
  style: '高级感',
  hasPhoto: false,
  generating: false
};

/* ---------- DOM ---------- */
const el = {
  photoInput: document.getElementById('photoInput'),
  dropzone: document.getElementById('dropzone'),
  dropzoneInner: document.getElementById('dropzoneInner'),
  previewWrap: document.getElementById('previewWrap'),
  previewImg: document.getElementById('previewImg'),
  removePhoto: document.getElementById('removePhoto'),
  platformGroup: document.getElementById('platformGroup'),
  styleGroup: document.getElementById('styleGroup'),
  generateBtn: document.getElementById('generateBtn'),
  regenerateBtn: document.getElementById('regenerateBtn'),
  statusText: document.getElementById('statusText'),
  emptyState: document.getElementById('emptyState'),
  loadingState: document.getElementById('loadingState'),
  resultsBody: document.getElementById('resultsBody'),
  copyList: document.getElementById('copyList'),
  bgmList: document.getElementById('bgmList'),
  copyMeta: document.getElementById('copyMeta'),
  demoTag: document.getElementById('demoTag'),
  toast: document.getElementById('toast')
};

/* ============================================================
   1. 图片上传与预览
   ============================================================ */
el.photoInput.addEventListener('change', (e) => {
  const file = e.target.files && e.target.files[0];
  if (file) showPreview(file);
});

// 已选好照片后，点击预览图不再弹出文件选择框
el.dropzone.addEventListener('click', (e) => {
  if (state.hasPhoto && !e.target.closest('.preview-remove')) {
    e.preventDefault();
  }
});

// 支持点击「重新选择」时不再触发外层 label 的二次弹窗
el.removePhoto.addEventListener('click', (e) => {
  e.preventDefault();
  e.stopPropagation();
  resetPhoto();
  el.photoInput.click();
});

// 拖拽上传
['dragenter', 'dragover'].forEach((type) => {
  el.dropzone.addEventListener(type, (e) => {
    e.preventDefault();
    el.dropzone.classList.add('is-drag');
  });
});

['dragleave', 'drop'].forEach((type) => {
  el.dropzone.addEventListener(type, (e) => {
    e.preventDefault();
    el.dropzone.classList.remove('is-drag');
  });
});

el.dropzone.addEventListener('drop', (e) => {
  const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
  if (!file) return;
  if (!file.type.startsWith('image/')) {
    showToast('请上传图片文件');
    return;
  }
  showPreview(file);
});

function showPreview(file) {
  if (!file.type.startsWith('image/')) {
    showToast('请上传图片文件');
    return;
  }
  const reader = new FileReader();
  reader.onload = (ev) => {
    el.previewImg.src = ev.target.result;
    el.dropzoneInner.hidden = true;
    el.previewWrap.hidden = false;
    state.hasPhoto = true;
    el.statusText.textContent = '照片已就绪，可以生成灵感了。';
  };
  reader.readAsDataURL(file);
}

function resetPhoto() {
  el.previewImg.removeAttribute('src');
  el.previewWrap.hidden = true;
  el.dropzoneInner.hidden = false;
  el.photoInput.value = '';
  state.hasPhoto = false;
  el.statusText.textContent = '提示：上传照片、选好平台与风格，点击生成即可。';
}

/* ============================================================
   2. 平台 / 风格的按钮选择
   ============================================================ */
function bindGroup(group, key) {
  group.addEventListener('click', (e) => {
    const btn = e.target.closest('.chip');
    if (!btn) return;
    group.querySelectorAll('.chip').forEach((c) => {
      c.classList.remove('is-active');
      c.setAttribute('aria-checked', 'false');
    });
    btn.classList.add('is-active');
    btn.setAttribute('aria-checked', 'true');
    state[key] = btn.dataset.value;
  });
}

bindGroup(el.platformGroup, 'platform');
bindGroup(el.styleGroup, 'style');

/* ============================================================
   3. 生成灵感
   ============================================================ */
el.generateBtn.addEventListener('click', () => generate());
el.regenerateBtn.addEventListener('click', () => generate(true));

async function generate(isRegenerate = false) {
  if (state.generating) return;

  if (!state.hasPhoto) {
    showToast('请先上传一张照片');
    return;
  }

  state.generating = true;
  el.generateBtn.disabled = true;
  el.generateBtn.textContent = '生成中…';

  // 切换为加载状态
  el.emptyState.hidden = true;
  el.resultsBody.hidden = true;
  el.loadingState.hidden = false;

  let data = null;

  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        platform: state.platform,
        style: state.style,
        hasPhoto: state.hasPhoto
      })
    });
    if (res.ok) {
      data = await res.json();
    }
  } catch (err) {
    // 后端未启动，使用内置演示数据
    data = null;
  }

  if (!data) data = buildLocalDemo();

  // 模拟一点点“调配中”的等待，让过程更自然
  setTimeout(() => {
    renderResults(data);
    el.loadingState.hidden = true;
    el.resultsBody.hidden = false;
    el.resultsBody.classList.remove('fade-in');
    void el.resultsBody.offsetWidth;
    el.resultsBody.classList.add('fade-in');

    state.generating = false;
    el.generateBtn.disabled = false;
    el.generateBtn.textContent = '生成灵感';

    if (data.mock) {
      el.statusText.textContent = data.notice || '当前为演示数据（未接入真实模型）。';
    } else {
      el.statusText.textContent = '已由 ' + (data.source || 'AI 模型') + ' 生成。';
    }

    showToast(isRegenerate ? '已重新生成' : '灵感已就绪');
  }, 700);
}

/* 本地兜底数据：按风格做简单改写 */
function buildLocalDemo() {
  const copies = FALLBACK_DATA.copies[state.platform] || FALLBACK_DATA.copies['朋友圈'];
  const decorated = copies.map((c) => ({
    text: decorate(c.text, state.style),
    tags: c.tags
  }));
  const bgm = shuffle(FALLBACK_DATA.bgm.slice()).slice(0, 3);
  return {
    mock: true,
    platform: state.platform,
    style: state.style,
    copies: decorated,
    bgm
  };
}

function decorate(text, style) {
  const map = {
    高级感: (t) => t,
    松弛感: (t) => `${t}（不着急，慢慢来就好）`,
    幽默: (t) => `${t} 反正没人看，我说了算。`,
    简约: (t) => t.replace(/[。！～]$/, ''),
    朋友圈日常: (t) => `今天也是普通又认真的一天。${t}`
  };
  return (map[style] || ((t) => t))(text);
}

/* ============================================================
   4. 渲染结果
   ============================================================ */
function renderResults(data) {
  // 文案
  el.copyList.innerHTML = '';
  el.copyMeta.textContent = `${data.platform} · ${data.style}`;

  data.copies.forEach((item, i) => {
    const li = document.createElement('li');
    li.className = 'copy-item';

    const idx = document.createElement('span');
    idx.className = 'copy-index';
    idx.textContent = String(i + 1);

    const body = document.createElement('div');
    body.className = 'copy-body';

    const p = document.createElement('p');
    p.className = 'copy-text';
    p.textContent = item.text;
    body.appendChild(p);

    if (item.tags) {
      const tags = document.createElement('p');
      tags.className = 'copy-tags';
      tags.textContent = item.tags;
      body.appendChild(tags);
    }

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn-copy';
    btn.textContent = '复制';
    btn.addEventListener('click', () => copyText(item, btn));

    li.append(idx, body, btn);
    el.copyList.appendChild(li);
  });

  // BGM
  el.bgmList.innerHTML = '';
  data.bgm.forEach((item, i) => {
    const li = document.createElement('li');
    li.className = 'bgm-item';

    const idx = document.createElement('span');
    idx.className = 'bgm-index';
    idx.textContent = String(i + 1);

    const body = document.createElement('div');
    body.className = 'bgm-body';

    const title = document.createElement('p');
    title.className = 'bgm-title';
    title.textContent = item.title;

    const artist = document.createElement('p');
    artist.className = 'bgm-artist';
    artist.textContent = item.artist;

    const reason = document.createElement('p');
    reason.className = 'bgm-reason';
    reason.textContent = item.reason;

    // 试听入口：搜索关键词由当前歌曲的「歌曲名 + 歌手名」动态生成并编码
    const keyword = encodeURIComponent(`${item.title} ${item.artist}`.trim());

    const listenStyle =
      'display:inline-block;font-size:12px;line-height:1;padding:6px 12px;'
      + 'border-radius:999px;text-decoration:none;color:#6F8570;'
      + 'background:#E4EBE1;border:1px solid #8CA08A;';

    const links = document.createElement('div');
    links.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;margin-top:10px;';

    const netease = document.createElement('a');
    netease.href = `https://music.163.com/#/search/m/?s=${keyword}&type=1`;
    netease.target = '_blank';
    netease.rel = 'noopener noreferrer';
    netease.textContent = '网易云音乐试听';
    netease.style.cssText = listenStyle;

    const qq = document.createElement('a');
    qq.href = `https://y.qq.com/n/ryqq/search?w=${keyword}`;
    qq.target = '_blank';
    qq.rel = 'noopener noreferrer';
    qq.textContent = 'QQ音乐试听';
    qq.style.cssText = listenStyle;

    links.append(netease, qq);

    body.append(title, artist, reason, links);
    li.append(idx, body);
    el.bgmList.appendChild(li);
  });

  el.demoTag.textContent = data.mock
    ? '演示数据 DEMO DATA'
    : 'AI 生成 · ' + (data.source || 'AI');
}

/* ============================================================
   5. 复制功能
   ============================================================ */
async function copyText(item, btn) {
  const content = item.tags ? `${item.text}\n${item.tags}` : item.text;
  const ok = await writeClipboard(content);

  if (ok) {
    btn.textContent = '已复制';
    btn.classList.add('is-done');
    showToast('文案已复制到剪贴板');
    setTimeout(() => {
      btn.textContent = '复制';
      btn.classList.remove('is-done');
    }, 1600);
  } else {
    showToast('复制失败，请手动选中复制');
  }
}

async function writeClipboard(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch (err) {
    /* 继续走降级方案 */
  }

  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.top = '-1000px';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch (err) {
    return false;
  }
}

/* ============================================================
   6. 小工具
   ============================================================ */
let toastTimer = null;

function showToast(msg) {
  el.toast.textContent = msg;
  el.toast.hidden = false;
  requestAnimationFrame(() => el.toast.classList.add('is-show'));

  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.toast.classList.remove('is-show');
    setTimeout(() => {
      el.toast.hidden = true;
    }, 260);
  }, 2000);
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
