// background.js - RevoSub Service Worker

// Listen for tab updates to catch the OAuth callback
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
    // Check if this is our callback URL
    if (changeInfo.status === 'complete' && 
        tab.url && 
        tab.url.includes('auth.kennyy.com.br/auth/discord/callback')) {
        
        console.log('Detected OAuth callback page:', tab.url);
        
        // Wait a bit for the page to fully load and set window.REVOSUB_AUTH
        await new Promise(r => setTimeout(r, 500));
        
        // Inject script to extract auth data
        try {
            const results = await chrome.scripting.executeScript({
                target: { tabId: tabId },
                func: () => {
                    // Try to get from window.REVOSUB_AUTH
                    if (window.REVOSUB_AUTH) {
                        return window.REVOSUB_AUTH;
                    }
                    
                    // Try to get from localStorage
                    const stored = localStorage.getItem('revosub_auth');
                    if (stored) {
                        return JSON.parse(stored);
                    }
                    
                    return null;
                },
                world: 'MAIN' // Execute in the page's context to access window.REVOSUB_AUTH
            });
            
            console.log('Script execution results:', results);
            
            if (results && results[0] && results[0].result) {
                const authData = results[0].result;
                console.log('Extracted auth data:', authData);
                
                // Save to storage
                await chrome.storage.local.set({
                    authToken: authData.token,
                    user: authData.user
                });
                
                console.log('Auth saved to chrome.storage.local');
                
                // Close the tab after a short delay
                setTimeout(() => {
                    chrome.tabs.remove(tabId);
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
