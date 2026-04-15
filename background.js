/**
 * FreePopUp — Background Service Worker
 * 負責 popup ↔ content script 之間的訊息路由
 */

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.target === 'background') {
    switch (message.action) {
      case 'getVideos':
        forwardToActiveTab({ action: 'detectVideos' }, sendResponse);
        return true;

      case 'showOverlays':
        forwardToActiveTab({ action: 'showOverlays' }, sendResponse);
        return true;

      case 'popOutVideo':
        forwardToActiveTab({
          action: 'popOutVideo',
          videoIndex: message.videoIndex
        }, sendResponse);
        return true;

      default:
        break;
    }
  }
});

/**
 * 將訊息轉發到當前活動分頁的 content script
 */
function forwardToActiveTab(message, sendResponse) {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (!tabs[0]) {
      sendResponse({ success: false, videos: [], error: '找不到活動分頁' });
      return;
    }
    chrome.tabs.sendMessage(tabs[0].id, message, (response) => {
      if (chrome.runtime.lastError) {
        sendResponse({
          success: false,
          videos: [],
          error: chrome.runtime.lastError.message
        });
      } else {
        sendResponse(response);
      }
    });
  });
}

// 擴充功能安裝時的初始化
chrome.runtime.onInstalled.addListener(() => {
  console.log('FreePopUp 已安裝！');
});
