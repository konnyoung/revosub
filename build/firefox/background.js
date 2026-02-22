// RevoSub Extension - Build: FIREFOX
// Generated: 2026-02-03T15:42:38.847Z

// background.js - RevoSub Service Worker

// Polyfill para compatibilidade Chrome/Firefox
const browserAPI = typeof browser !== 'undefined' ? browser : chrome;

// Configuração da janela popup
const POPUP_WIDTH = 375;
const POPUP_HEIGHT = 600;

// Variável para rastrear a janela aberta
let popupWindowId = null;

/**
 * Abre o popup como uma janela independente
 */
async function openPopupWindow() {
    // Se já existe uma janela aberta, focar nela
    if (popupWindowId !== null) {
        try {
            const existingWindow = await browserAPI.windows.get(popupWindowId);
            if (existingWindow) {
                await browserAPI.windows.update(popupWindowId, { focused: true });
                return;
            }
        } catch (e) {
            // Janela não existe mais
            popupWindowId = null;
        }
    }
    
    // Criar nova janela
    const popupURL = browserAPI.runtime.getURL('popup.html');
    
    const window = await browserAPI.windows.create({
        url: popupURL,
        type: 'popup',
        width: POPUP_WIDTH,
        height: POPUP_HEIGHT,
        focused: true
    });
    
    popupWindowId = window.id;
}

// Listener para clique no ícone da extensão
// Chrome usa chrome.action, Firefox usa browser.browserAction
if (browserAPI.action) {
    // Chrome Manifest V3
    browserAPI.action.onClicked.addListener(openPopupWindow);
} else if (browserAPI.browserAction) {
    // Firefox Manifest V2
    browserAPI.browserAction.onClicked.addListener(openPopupWindow);
}

// Limpar referência quando a janela for fechada
browserAPI.windows.onRemoved.addListener((windowId) => {
    if (windowId === popupWindowId) {
        popupWindowId = null;
    }
});

// Listen for tab updates to catch the OAuth callback
browserAPI.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
    // Check if this is our callback URL
    if (changeInfo.status === 'complete' && 
        tab.url && 
        tab.url.includes('auth.kennyy.com.br/auth/discord/callback')) {
        
        console.log('Detected OAuth callback page:', tab.url);
        
        // Wait a bit for the page to fully load and set window.REVOSUB_AUTH
        await new Promise(r => setTimeout(r, 500));
        
        // Inject script to extract auth data
        try {
            let authData = null;
            
            // Chrome usa scripting API, Firefox usa tabs.executeScript
            if (browserAPI.scripting) {
                // Chrome Manifest V3
                const results = await browserAPI.scripting.executeScript({
                    target: { tabId: tabId },
                    func: () => {
                        if (window.REVOSUB_AUTH) {
                            return window.REVOSUB_AUTH;
                        }
                        const stored = localStorage.getItem('revosub_auth');
                        if (stored) {
                            return JSON.parse(stored);
                        }
                        return null;
                    },
                    world: 'MAIN'
                });
                
                if (results && results[0] && results[0].result) {
                    authData = results[0].result;
                }
            } else {
                // Firefox Manifest V2
                const results = await browserAPI.tabs.executeScript(tabId, {
                    code: `
                        (function() {
                            if (window.REVOSUB_AUTH) {
                                return window.REVOSUB_AUTH;
                            }
                            var stored = localStorage.getItem('revosub_auth');
                            if (stored) {
                                return JSON.parse(stored);
                            }
                            return null;
                        })();
                    `
                });
                
                if (results && results[0]) {
                    authData = results[0];
                }
            }
            
            console.log('Extracted auth data:', authData);
            
            if (authData) {
                // Save to storage
                await browserAPI.storage.local.set({
                    authToken: authData.token,
                    user: authData.user
                });
                
                console.log('Auth saved to storage');
                
                // Close the tab after a short delay
                setTimeout(() => {
                    browserAPI.tabs.remove(tabId);
                }, 1000);
            } else {
                console.error('No auth data found in callback page');
            }
        } catch (error) {
            console.error('Error extracting auth data:', error);
        }
    }
});

console.log('RevoSub background script loaded');
