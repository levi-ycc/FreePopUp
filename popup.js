/**
 * FreePopUp — Popup Script
 * 擴充功能彈出介面邏輯
 * 
 * 流程：
 * 1. 偵測影片列表顯示在 popup 中
 * 2. 使用者點擊「彈出」→ 在頁面上顯示覆蓋按鈕 → 關閉 popup
 * 3. 使用者在頁面上點擊覆蓋按鈕（user gesture）→ 觸發 Document PiP
 */

document.addEventListener('DOMContentLoaded', () => {
  const videoList = document.getElementById('video-list');
  const emptyState = document.getElementById('empty-state');
  const errorState = document.getElementById('error-state');
  const statusText = document.getElementById('status-text');
  const statusDot = document.querySelector('.status-dot');
  const pipModeRadios = document.querySelectorAll('input[name="pipMode"]');

  // 讀取設定
  chrome.storage.local.get(['pipMode'], (result) => {
    if (result.pipMode) {
      const radio = document.querySelector(`input[name="pipMode"][value="${result.pipMode}"]`);
      if (radio) radio.checked = true;
    }
  });

  // 監聽設定改變
  pipModeRadios.forEach(radio => {
    radio.addEventListener('change', (e) => {
      chrome.storage.local.set({ pipMode: e.target.value });
    });
  });

  loadVideos();

  /**
   * 載入影片列表
   */
  async function loadVideos() {
    try {
      statusText.textContent = '掃描中...';
      statusDot.className = 'status-dot';

      const response = await sendMessage({ target: 'background', action: 'getVideos' });

      if (response.error) {
        showError(response.error);
        return;
      }

      const videos = response.videos || [];

      if (videos.length === 0) {
        showEmpty();
        return;
      }

      showVideoList(videos);
    } catch (err) {
      showError(err.message || '無法與頁面通訊，請重新整理頁面後再試');
    }
  }

  /**
   * 顯示影片列表
   */
  function showVideoList(videos) {
    statusText.textContent = `找到 ${videos.length} 個影片`;
    statusDot.className = 'status-dot found';

    videoList.innerHTML = '';
    emptyState.classList.add('hidden');
    errorState.classList.add('hidden');

    videos.forEach((video, i) => {
      const card = createVideoCard(video, i);
      videoList.appendChild(card);

      // 淡入動畫
      card.style.opacity = '0';
      card.style.transform = 'translateY(8px)';
      setTimeout(() => {
        card.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
        card.style.opacity = '1';
        card.style.transform = 'translateY(0)';
      }, i * 60);
    });
  }

  /**
   * 建立影片卡片
   */
  function createVideoCard(video, displayIndex) {
    const card = document.createElement('div');
    card.className = 'video-card';

    // 編號
    const indexEl = document.createElement('div');
    indexEl.className = 'video-card-index';
    indexEl.textContent = displayIndex + 1;

    // 資訊
    const info = document.createElement('div');
    info.className = 'video-card-info';

    const title = document.createElement('div');
    title.className = 'video-card-title';
    title.textContent = video.title || '影片 ' + (displayIndex + 1);
    title.title = video.title;

    const meta = document.createElement('div');
    meta.className = 'video-card-meta';

    if (video.width && video.height) {
      const sizeBadge = document.createElement('span');
      sizeBadge.className = 'badge';
      sizeBadge.textContent = `${video.width}×${video.height}`;
      meta.appendChild(sizeBadge);
    }

    if (video.duration && isFinite(video.duration)) {
      const durBadge = document.createElement('span');
      durBadge.className = 'badge';
      durBadge.textContent = formatTime(video.duration);
      meta.appendChild(durBadge);
    }

    const statusBadge = document.createElement('span');
    statusBadge.className = `badge ${video.paused ? 'paused' : 'playing'}`;
    statusBadge.textContent = video.paused ? '⏸ 暫停' : '▶ 播放中';
    meta.appendChild(statusBadge);

    info.appendChild(title);
    info.appendChild(meta);

    // 彈出按鈕
    const btn = document.createElement('button');
    btn.className = 'pop-out-btn';
    btn.textContent = '🚀 彈出';
    btn.addEventListener('click', () => triggerOverlays(btn));

    card.appendChild(indexEl);
    card.appendChild(info);
    card.appendChild(btn);

    return card;
  }

  /**
   * 觸發頁面覆蓋按鈕，然後關閉 popup
   * 使用者將在頁面上直接點擊覆蓋按鈕（提供 user gesture）
   */
  async function triggerOverlays(btn) {
    btn.classList.add('loading');
    btn.textContent = '⏳ 準備中...';

    try {
      const response = await sendMessage({
        target: 'background',
        action: 'showOverlays'
      });

      if (response.success) {
        btn.classList.remove('loading');
        btn.classList.add('success');
        btn.textContent = '✓ 請在頁面上點擊';

        // 關閉 popup，讓使用者看到頁面上的覆蓋按鈕
        setTimeout(() => {
          window.close();
        }, 600);
      } else {
        btn.classList.remove('loading');
        btn.textContent = '❌ 失敗';
        setTimeout(() => { btn.textContent = '🚀 彈出'; }, 2000);
      }
    } catch (err) {
      btn.classList.remove('loading');
      btn.textContent = '❌ 錯誤';
      console.error('觸發覆蓋層失敗:', err);
      setTimeout(() => { btn.textContent = '🚀 彈出'; }, 2000);
    }
  }

  function showEmpty() {
    statusText.textContent = '未找到影片';
    statusDot.className = 'status-dot error';
    videoList.innerHTML = '';
    emptyState.classList.remove('hidden');
    errorState.classList.add('hidden');
  }

  function showError(message) {
    statusText.textContent = '連線錯誤';
    statusDot.className = 'status-dot error';
    videoList.innerHTML = '';
    emptyState.classList.add('hidden');
    errorState.classList.remove('hidden');
    document.getElementById('error-desc').textContent = message;
  }

  function sendMessage(message) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(message, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve(response || {});
        }
      });
    });
  }

  function formatTime(seconds) {
    if (!seconds || !isFinite(seconds)) return '--:--';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    if (h > 0) {
      return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    }
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }
});
