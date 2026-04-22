/**
 * FreePopUp — Content Script
 * 偵測頁面影片、使用 Document PiP API 彈出浮動視窗
 * 
 * 重要：Document PiP API 需要 user gesture 觸發，
 * 因此我們在頁面上注入浮動覆蓋按鈕，讓使用者直接點擊。
 */

(() => {
  // 防止重複注入
  if (window.__freePopUpInjected) return;
  window.__freePopUpInjected = true;

  // 儲存目前的 PiP 狀態
  let currentPipWindow = null;
  let originalVideoParent = null;
  let originalVideoNextSibling = null;
  let pippedVideo = null;

  // 隱藏/顯示 PiP 視窗相關
  let pipWindowHidden = false;
  let hiddenPipMode = null; // 'document' 或 'traditional'

  // 覆蓋層和按鈕相關
  let overlaysVisible = false;
  let overlayElements = [];

  // ============================================================
  // 影片偵測
  // ============================================================

  /**
   * 偵測頁面上所有 <video> 元素
   */
  function detectVideos() {
    const videos = document.querySelectorAll('video');
    const videoList = [];

    videos.forEach((video, index) => {
      const rect = video.getBoundingClientRect();
      if (rect.width < 20 && rect.height < 20) return;

      let title = '';
      title = video.getAttribute('aria-label') ||
              video.getAttribute('title') ||
              video.closest('[aria-label]')?.getAttribute('aria-label') || '';

      if (!title) {
        title = document.title || '未命名影片';
      }

      let src = video.currentSrc || video.src || '';
      if (!src) {
        const source = video.querySelector('source');
        if (source) src = source.src || '';
      }

      videoList.push({
        index: index,
        title: title.substring(0, 60),
        src: src,
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        duration: video.duration || 0,
        currentTime: video.currentTime || 0,
        paused: video.paused,
        muted: video.muted,
        hasAudio: !video.muted && video.volume > 0
      });
    });

    return videoList;
  }

  /**
   * 格式化時間（秒 → mm:ss）
   */
  function formatTime(seconds) {
    if (!seconds || !isFinite(seconds)) return '--:--';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }

  // ============================================================
  // 頁面覆蓋按鈕（解決 user gesture 問題）
  // ============================================================

  /**
   * 注入覆蓋層樣式到頁面
   */
  function injectOverlayStyles() {
    if (document.getElementById('freepopup-overlay-styles')) return;

    const style = document.createElement('style');
    style.id = 'freepopup-overlay-styles';
    style.textContent = `
      .freepopup-overlay {
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        pointer-events: none;
        z-index: 2147483646;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: opacity 0.3s ease;
      }

      .freepopup-overlay.active {
        pointer-events: auto;
        background: rgba(0, 0, 0, 0.35);
        backdrop-filter: blur(2px);
      }

      .freepopup-btn {
        pointer-events: auto;
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 10px 20px;
        background: linear-gradient(135deg, #7C3AED, #06B6D4);
        color: #fff;
        border: none;
        border-radius: 12px;
        font-size: 14px;
        font-weight: 600;
        cursor: pointer;
        box-shadow: 0 4px 20px rgba(124, 58, 237, 0.5),
                    0 0 0 1px rgba(255, 255, 255, 0.1);
        transition: all 0.3s ease;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        letter-spacing: 0.3px;
        opacity: 0;
        transform: scale(0.8);
        animation: freepopup-appear 0.4s ease forwards;
      }

      @keyframes freepopup-appear {
        to {
          opacity: 1;
          transform: scale(1);
        }
      }

      .freepopup-btn:hover {
        transform: scale(1.08) !important;
        box-shadow: 0 6px 30px rgba(124, 58, 237, 0.7),
                    0 0 0 2px rgba(124, 58, 237, 0.4);
      }

      .freepopup-btn:active {
        transform: scale(0.95) !important;
      }

      .freepopup-btn .icon {
        font-size: 18px;
      }

      .freepopup-badge {
        position: absolute;
        top: 8px;
        left: 8px;
        display: flex;
        align-items: center;
        gap: 4px;
        padding: 4px 10px;
        background: rgba(124, 58, 237, 0.85);
        color: #fff;
        border-radius: 8px;
        font-size: 11px;
        font-weight: 600;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        pointer-events: auto;
        backdrop-filter: blur(8px);
        box-shadow: 0 2px 8px rgba(0,0,0,0.3);
        opacity: 0;
        animation: freepopup-appear 0.3s ease 0.1s forwards;
      }

      .freepopup-cancel-btn {
        position: absolute;
        top: 8px;
        right: 8px;
        pointer-events: auto;
        width: 28px;
        height: 28px;
        display: flex;
        align-items: center;
        justify-content: center;
        background: rgba(239, 68, 68, 0.7);
        color: #fff;
        border: none;
        border-radius: 8px;
        font-size: 14px;
        cursor: pointer;
        backdrop-filter: blur(8px);
        transition: all 0.2s ease;
        opacity: 0;
        animation: freepopup-appear 0.3s ease 0.2s forwards;
      }

      .freepopup-cancel-btn:hover {
        background: rgba(239, 68, 68, 0.9);
        transform: scale(1.1);
      }
    `;
    document.head.appendChild(style);
  }

  /**
   * 在所有偵測到的影片上顯示「彈出」按鈕覆蓋層
   */
  function showVideoOverlays() {
    removeOverlays();
    injectOverlayStyles();

    const videos = document.querySelectorAll('video');
    if (videos.length === 0) return;

    videos.forEach((video, index) => {
      const rect = video.getBoundingClientRect();
      if (rect.width < 40 && rect.height < 40) return;

      // 找到影片的定位容器
      let container = video.parentElement;
      // 確保容器有 position 屬性
      const containerStyle = window.getComputedStyle(container);
      if (containerStyle.position === 'static') {
        container.style.position = 'relative';
      }

      // 建立覆蓋層
      const overlay = document.createElement('div');
      overlay.className = 'freepopup-overlay active';
      overlay.dataset.freepopupOverlay = 'true';

      // 影片編號標記
      const badge = document.createElement('div');
      badge.className = 'freepopup-badge';
      badge.innerHTML = `<span>🎬</span> 影片 ${index + 1}`;
      overlay.appendChild(badge);

      // 彈出按鈕（使用者直接點擊 → 有 user gesture）
      const btn = document.createElement('button');
      btn.className = 'freepopup-btn';
      btn.innerHTML = '<span class="icon">🚀</span> 彈出浮動視窗';
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        e.preventDefault();
        btn.textContent = '⏳ 處理中...';
        btn.style.pointerEvents = 'none';

        const result = await popOutVideo(index);

        if (result.success) {
          removeOverlays();
        } else {
          btn.innerHTML = '<span class="icon">❌</span> ' + (result.error || '失敗');
          setTimeout(() => {
            btn.innerHTML = '<span class="icon">🚀</span> 重試';
            btn.style.pointerEvents = 'auto';
          }, 2000);
        }
      });
      overlay.appendChild(btn);

      // 取消按鈕
      const cancelBtn = document.createElement('button');
      cancelBtn.className = 'freepopup-cancel-btn';
      cancelBtn.innerHTML = '✕';
      cancelBtn.title = '取消';
      cancelBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        removeOverlays();
      });
      overlay.appendChild(cancelBtn);

      container.appendChild(overlay);
      overlayElements.push(overlay);
    });

    overlaysVisible = true;
  }

  /**
   * 移除所有覆蓋層
   */
  function removeOverlays() {
    document.querySelectorAll('[data-freepopup-overlay]').forEach(el => el.remove());
    overlayElements = [];
    overlaysVisible = false;
  }

  // ============================================================
  // PiP 核心功能
  // ============================================================

  /**
   * 彈出影片為浮動視窗
   */
  async function popOutVideo(videoIndex) {
    const allVideos = document.querySelectorAll('video');
    const video = allVideos[videoIndex];

    if (!video) {
      return { success: false, error: '找不到指定的影片元素' };
    }

    // 先關閉已有的 PiP 視窗
    if (currentPipWindow && !currentPipWindow.closed) {
      currentPipWindow.close();
    }

    // 取得使用者設定的模式
    const storage = await new Promise(resolve => chrome.storage.local.get(['pipMode'], resolve));
    const mode = storage.pipMode || 'traditional'; // 預設使用傳統模式

    if (mode === 'document' && 'documentPictureInPicture' in window) {
      return await openDocumentPiP(video);
    } else if (mode === 'document' && video.requestPictureInPicture) {
      // 備援：不支援 Document PiP 時降級
      return await openTraditionalPiP(video);
    } else if (mode === 'traditional' && video.requestPictureInPicture) {
      return await openTraditionalPiP(video);
    } else if ('documentPictureInPicture' in window) {
      // 備援
      return await openDocumentPiP(video);
    } else {
      return { success: false, error: '此瀏覽器不支援 Picture-in-Picture' };
    }
  }

  /**
   * Document PiP（進階版，自訂 UI）
   */
  async function openDocumentPiP(video) {
    try {
      const aspectRatio = video.videoWidth / video.videoHeight || 16 / 9;
      let pipWidth = Math.min(480, window.screen.width * 0.35);
      let pipHeight = Math.round(pipWidth / aspectRatio) + 50;

      const pipWindow = await window.documentPictureInPicture.requestWindow({
        width: Math.round(pipWidth),
        height: Math.round(pipHeight),
      });

      currentPipWindow = pipWindow;

      // 注入樣式
      injectPipStyles(pipWindow);

      // 記錄影片原始位置
      originalVideoParent = video.parentNode;
      originalVideoNextSibling = video.nextSibling;
      pippedVideo = video;

      // 建立容器
      const container = pipWindow.document.createElement('div');
      container.id = 'pip-container';

      const videoWrapper = pipWindow.document.createElement('div');
      videoWrapper.id = 'pip-video-wrapper';

      // 移動影片
      videoWrapper.appendChild(video);
      container.appendChild(videoWrapper);

      // 建立控制列
      const controls = createControls(pipWindow, video);
      container.appendChild(controls);

      pipWindow.document.body.appendChild(container);

      // 確保繼續播放
      if (video.paused) {
        video.play().catch(() => {});
      }

      // 監聽關閉
      pipWindow.addEventListener('pagehide', () => {
        if (pipWindowHidden) {
          // 主動隱藏：將影片放回頁面，但保留 pippedVideo 引用以便恢復
          if (pippedVideo && originalVideoParent) {
            try {
              if (originalVideoNextSibling && originalVideoNextSibling.parentNode === originalVideoParent) {
                originalVideoParent.insertBefore(pippedVideo, originalVideoNextSibling);
              } else {
                originalVideoParent.appendChild(pippedVideo);
              }
            } catch (e) {}
          }
          currentPipWindow = null;
        } else {
          // 真正關閉：完全清除狀態
          restoreVideo();
        }
      });

      return { success: true, method: 'documentPiP' };
    } catch (err) {
      console.error('Document PiP 失敗:', err);
      // 備援
      if (video.requestPictureInPicture) {
        return await openTraditionalPiP(video);
      }
      return { success: false, error: err.message };
    }
  }

  /**
   * 傳統 PiP（備援）
   */
  async function openTraditionalPiP(video) {
    try {
      await video.requestPictureInPicture();
      pippedVideo = video;
      return { success: true, method: 'traditionalPiP' };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  // ============================================================
  // PiP 視窗樣式與控制列
  // ============================================================

  function injectPipStyles(pipWindow) {
    const style = pipWindow.document.createElement('style');
    style.textContent = `
      * {
        margin: 0;
        padding: 0;
        box-sizing: border-box;
      }

      body {
        background: #0a0a0f;
        overflow: hidden;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        display: flex;
        flex-direction: column;
        height: 100vh;
        width: 100vw;
      }

      #pip-container {
        display: flex;
        flex-direction: column;
        height: 100%;
        width: 100%;
        position: relative;
      }

      #pip-video-wrapper {
        flex: 1;
        display: flex;
        align-items: center;
        justify-content: center;
        background: #000;
        overflow: hidden;
        min-height: 0;
      }

      #pip-video-wrapper video {
        width: 100%;
        height: 100%;
        object-fit: contain;
      }

      #pip-controls {
        position: absolute;
        bottom: 0;
        left: 0;
        right: 0;
        background: linear-gradient(transparent, rgba(0,0,0,0.85));
        padding: 20px 12px 10px;
        display: flex;
        align-items: center;
        gap: 8px;
        opacity: 0;
        transition: opacity 0.3s ease;
        z-index: 10;
      }

      #pip-container:hover #pip-controls {
        opacity: 1;
      }

      .pip-btn {
        background: rgba(255,255,255,0.15);
        border: none;
        color: #fff;
        width: 32px;
        height: 32px;
        border-radius: 8px;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 16px;
        transition: all 0.2s ease;
        flex-shrink: 0;
        backdrop-filter: blur(8px);
      }

      .pip-btn:hover {
        background: rgba(255,255,255,0.3);
        transform: scale(1.1);
      }

      .pip-btn:active {
        transform: scale(0.95);
      }

      #pip-progress-container {
        flex: 1;
        height: 4px;
        background: rgba(255,255,255,0.2);
        border-radius: 4px;
        cursor: pointer;
        position: relative;
        transition: height 0.15s ease;
      }

      #pip-progress-container:hover {
        height: 8px;
      }

      #pip-progress-bar {
        height: 100%;
        background: linear-gradient(90deg, #7C3AED, #06B6D4);
        border-radius: 4px;
        width: 0%;
        transition: width 0.1s linear;
        position: relative;
      }

      #pip-progress-bar::after {
        content: '';
        position: absolute;
        right: -5px;
        top: 50%;
        transform: translateY(-50%);
        width: 12px;
        height: 12px;
        background: #fff;
        border-radius: 50%;
        opacity: 0;
        transition: opacity 0.15s ease;
        box-shadow: 0 0 6px rgba(124,58,237,0.6);
      }

      #pip-progress-container:hover #pip-progress-bar::after {
        opacity: 1;
      }

      #pip-time {
        color: rgba(255,255,255,0.7);
        font-size: 11px;
        white-space: nowrap;
        min-width: 65px;
        text-align: center;
        flex-shrink: 0;
      }

      #pip-volume-slider {
        width: 60px;
        height: 4px;
        -webkit-appearance: none;
        appearance: none;
        background: rgba(255,255,255,0.2);
        border-radius: 4px;
        outline: none;
        cursor: pointer;
        flex-shrink: 0;
      }

      #pip-volume-slider::-webkit-slider-thumb {
        -webkit-appearance: none;
        width: 12px;
        height: 12px;
        background: #fff;
        border-radius: 50%;
        cursor: pointer;
        box-shadow: 0 0 4px rgba(0,0,0,0.3);
      }

      #pip-toast {
        position: absolute;
        top: 10px;
        left: 50%;
        transform: translateX(-50%) translateY(-40px);
        background: rgba(124, 58, 237, 0.9);
        color: #fff;
        padding: 6px 14px;
        border-radius: 20px;
        font-size: 12px;
        opacity: 0;
        transition: all 0.3s ease;
        z-index: 20;
        backdrop-filter: blur(8px);
        pointer-events: none;
      }

      #pip-toast.show {
        opacity: 1;
        transform: translateX(-50%) translateY(0);
      }
    `;
    pipWindow.document.head.appendChild(style);
  }

  function createControls(pipWindow, video) {
    const doc = pipWindow.document;
    const controls = doc.createElement('div');
    controls.id = 'pip-controls';

    // 播放/暫停
    const playBtn = doc.createElement('button');
    playBtn.className = 'pip-btn';
    playBtn.innerHTML = video.paused ? '▶' : '⏸';
    playBtn.title = '播放/暫停';
    playBtn.addEventListener('click', () => {
      video.paused ? video.play() : video.pause();
    });
    video.addEventListener('play', () => { playBtn.innerHTML = '⏸'; });
    video.addEventListener('pause', () => { playBtn.innerHTML = '▶'; });

    // 快退
    const rewindBtn = doc.createElement('button');
    rewindBtn.className = 'pip-btn';
    rewindBtn.innerHTML = '⏪';
    rewindBtn.title = '快退 10 秒';
    rewindBtn.addEventListener('click', () => {
      video.currentTime = Math.max(0, video.currentTime - 10);
      showToast(pipWindow, '⏪ -10s');
    });

    // 快進
    const forwardBtn = doc.createElement('button');
    forwardBtn.className = 'pip-btn';
    forwardBtn.innerHTML = '⏩';
    forwardBtn.title = '快進 10 秒';
    forwardBtn.addEventListener('click', () => {
      video.currentTime = Math.min(video.duration || Infinity, video.currentTime + 10);
      showToast(pipWindow, '⏩ +10s');
    });

    // 進度條
    const progressContainer = doc.createElement('div');
    progressContainer.id = 'pip-progress-container';
    const progressBar = doc.createElement('div');
    progressBar.id = 'pip-progress-bar';
    progressContainer.appendChild(progressBar);

    video.addEventListener('timeupdate', () => {
      if (video.duration) {
        progressBar.style.width = (video.currentTime / video.duration * 100) + '%';
      }
    });

    progressContainer.addEventListener('click', (e) => {
      const rect = progressContainer.getBoundingClientRect();
      const ratio = (e.clientX - rect.left) / rect.width;
      if (video.duration) video.currentTime = ratio * video.duration;
    });

    // 時間
    const timeLabel = doc.createElement('span');
    timeLabel.id = 'pip-time';
    timeLabel.textContent = `${formatTime(video.currentTime)} / ${formatTime(video.duration)}`;
    video.addEventListener('timeupdate', () => {
      timeLabel.textContent = `${formatTime(video.currentTime)} / ${formatTime(video.duration)}`;
    });

    // 音量
    const volumeBtn = doc.createElement('button');
    volumeBtn.className = 'pip-btn';
    volumeBtn.innerHTML = video.muted ? '🔇' : '🔊';
    volumeBtn.title = '靜音/取消靜音';
    volumeBtn.addEventListener('click', () => {
      video.muted = !video.muted;
      volumeBtn.innerHTML = video.muted ? '🔇' : '🔊';
    });

    const volumeSlider = doc.createElement('input');
    volumeSlider.type = 'range';
    volumeSlider.id = 'pip-volume-slider';
    volumeSlider.min = '0';
    volumeSlider.max = '1';
    volumeSlider.step = '0.05';
    volumeSlider.value = video.volume;
    volumeSlider.addEventListener('input', () => {
      video.volume = parseFloat(volumeSlider.value);
      video.muted = video.volume === 0;
      volumeBtn.innerHTML = video.muted ? '🔇' : '🔊';
    });

    // 關閉
    const closeBtn = doc.createElement('button');
    closeBtn.className = 'pip-btn';
    closeBtn.innerHTML = '✕';
    closeBtn.title = '關閉浮動視窗';
    closeBtn.style.background = 'rgba(239,68,68,0.3)';
    closeBtn.addEventListener('click', () => pipWindow.close());

    // 組裝
    controls.appendChild(playBtn);
    controls.appendChild(rewindBtn);
    controls.appendChild(forwardBtn);
    controls.appendChild(progressContainer);
    controls.appendChild(timeLabel);
    controls.appendChild(volumeBtn);
    controls.appendChild(volumeSlider);
    controls.appendChild(closeBtn);

    // Toast
    const toast = doc.createElement('div');
    toast.id = 'pip-toast';
    setTimeout(() => {
      const cont = doc.getElementById('pip-container');
      if (cont) cont.appendChild(toast);
    }, 100);

    // 鍵盤快捷鍵
    pipWindow.document.addEventListener('keydown', (e) => {
      switch (e.key) {
        case ' ':
        case 'k':
          e.preventDefault();
          video.paused ? video.play() : video.pause();
          break;
        case 'ArrowLeft':
          video.currentTime = Math.max(0, video.currentTime - 5);
          showToast(pipWindow, '⏪ -5s');
          break;
        case 'ArrowRight':
          video.currentTime = Math.min(video.duration || Infinity, video.currentTime + 5);
          showToast(pipWindow, '⏩ +5s');
          break;
        case 'ArrowUp':
          e.preventDefault();
          video.volume = Math.min(1, video.volume + 0.1);
          volumeSlider.value = video.volume;
          showToast(pipWindow, `🔊 ${Math.round(video.volume * 100)}%`);
          break;
        case 'ArrowDown':
          e.preventDefault();
          video.volume = Math.max(0, video.volume - 0.1);
          volumeSlider.value = video.volume;
          showToast(pipWindow, `🔊 ${Math.round(video.volume * 100)}%`);
          break;
        case 'm':
          video.muted = !video.muted;
          volumeBtn.innerHTML = video.muted ? '🔇' : '🔊';
          break;
        case 'Escape':
          pipWindow.close();
          break;
      }
    });

    return controls;
  }

  function showToast(pipWindow, message) {
    const toast = pipWindow.document.getElementById('pip-toast');
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add('show');
    clearTimeout(toast._timeout);
    toast._timeout = setTimeout(() => toast.classList.remove('show'), 1200);
  }

  /**
   * 將影片還原到原始位置
   */
  function restoreVideo() {
    if (pippedVideo && originalVideoParent) {
      try {
        if (originalVideoNextSibling && originalVideoNextSibling.parentNode === originalVideoParent) {
          originalVideoParent.insertBefore(pippedVideo, originalVideoNextSibling);
        } else {
          originalVideoParent.appendChild(pippedVideo);
        }
      } catch (e) {
        console.warn('FreePopUp: 無法還原影片到原始位置', e);
      }
    }
    pippedVideo = null;
    originalVideoParent = null;
    originalVideoNextSibling = null;
    currentPipWindow = null;
  }

  // ============================================================
  // TAB 鍵隱藏/顯示 PiP 視窗
  // ============================================================

  /**
   * 切換 PiP 視窗的顯示/隱藏
   */
  function togglePipVisibility() {
    // === 隱藏 === 
    // Document PiP 模式：關閉視窗
    if (currentPipWindow && !currentPipWindow.closed) {
      pipWindowHidden = true;
      hiddenPipMode = 'document';
      if (pippedVideo && !pippedVideo.paused) {
        pippedVideo.dataset.wasPlaying = 'true';
      }
      pippedVideo.pause();
      currentPipWindow.close();
      return true;
    }
    // 傳統 PiP 模式：退出 PiP
    if (pippedVideo && document.pictureInPictureElement) {
      pipWindowHidden = true;
      hiddenPipMode = 'traditional';
      pippedVideo.dataset.wasPlaying = pippedVideo.paused ? 'false' : 'true';
      pippedVideo.pause();
      document.exitPictureInPicture().catch(() => {});
      return true;
    }

    // === 恢復 ===
    if (pippedVideo && pipWindowHidden) {
      pipWindowHidden = false;
      const wasPlaying = pippedVideo.dataset.wasPlaying === 'true';
      delete pippedVideo.dataset.wasPlaying;

      if (hiddenPipMode === 'document') {
        // 重新開啟 Document PiP
        openDocumentPiP(pippedVideo).then((result) => {
          if (result.success && wasPlaying && pippedVideo) {
            pippedVideo.play().catch(() => {});
          }
        }).catch(() => { pipWindowHidden = false; });
      } else {
        // 重新進入傳統 PiP
        pippedVideo.requestPictureInPicture().then(() => {
          if (wasPlaying && pippedVideo) {
            pippedVideo.play().catch(() => {});
          }
        }).catch((err) => {
          console.warn('FreePopUp: 無法恢復 PiP', err);
          pipWindowHidden = false;
        });
      }
      hiddenPipMode = null;
      return true;
    }

    return false;
  }

  // ============================================================
  // 訊息監聯
  // ============================================================
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    switch (message.action) {
      case 'detectVideos':
        sendResponse({ videos: detectVideos() });
        break;

      case 'showOverlays':
        // 從 popup 觸發 → 在頁面上顯示覆蓋按鈕（按鈕點擊才有 user gesture）
        showVideoOverlays();
        sendResponse({ success: true });
        break;

      case 'popOutVideo':
        // 來自覆蓋按鈕的直接呼叫（有 user gesture），或備援
        popOutVideo(message.videoIndex).then((result) => {
          sendResponse(result);
        }).catch((err) => {
          sendResponse({ success: false, error: err.message });
        });
        return true;

      case 'togglePipVisibility':
        // 來自 Alt+H 快捷鍵（透過 background.js 轉發）
        togglePipVisibility();
        sendResponse({ success: true });
        break;

      default:
        break;
    }
  });
})();
