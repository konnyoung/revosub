// RevoSub Extension - Build: FIREFOX
// Generated: 2026-02-03T15:42:38.846Z

// popup.js - RevoSub Extension with Discord Auth

// Polyfill para compatibilidade Chrome/Firefox
const browserAPI = typeof browser !== 'undefined' ? browser : chrome;

/**
 * Helper para internacionalização (i18n)
 * Usa a API nativa de extensões para obter traduções
 */
function i18n(messageName, substitutions) {
    return browserAPI.i18n.getMessage(messageName, substitutions) || messageName;
}

/**
 * Aplica traduções em todos os elementos com data-i18n
 */
function applyTranslations() {
    // Traduzir elementos com data-i18n
    document.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.getAttribute('data-i18n');
        const translated = i18n(key);
        if (translated && translated !== key) {
            el.textContent = translated;
        }
    });

    // Traduzir placeholders
    document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
        const key = el.getAttribute('data-i18n-placeholder');
        const translated = i18n(key);
        if (translated && translated !== key) {
            el.placeholder = translated;
        }
    });

    // Traduzir titles (tooltips)
    document.querySelectorAll('[data-i18n-title]').forEach(el => {
        const key = el.getAttribute('data-i18n-title');
        const translated = i18n(key);
        if (translated && translated !== key) {
            el.title = translated;
        }
    });
}

const API_URL = 'https://auth.kennyy.com.br';

document.addEventListener('DOMContentLoaded', init);

let selectedFile = null;
let fileContent = null;
let fileFormat = null; // 'ytt', 'vtt', 'ass'
let currentUser = null;
let authToken = null;
let currentVideoId = null;

/**
 * Encontra a aba do YouTube ativa (em qualquer janela)
 * Necessário porque a extensão agora abre como janela independente
 */
async function findYouTubeTab() {
    // Buscar abas do YouTube em todas as janelas
    const youtubeTabs = await browserAPI.tabs.query({ 
        url: ['*://www.youtube.com/*', '*://youtube.com/*'] 
    });
    
    if (youtubeTabs.length === 0) {
        return null;
    }
    
    // Preferir aba ativa, senão pegar a primeira
    const activeTab = youtubeTabs.find(t => t.active) || youtubeTabs[0];
    return activeTab;
}

async function init() {
    // Aplicar traduções
    applyTranslations();
    
    // DOM Elements
    const loginSection = document.getElementById('loginSection');
    const userProfile = document.getElementById('userProfile');
    const tabsSection = document.getElementById('tabsSection');
    const discordLoginBtn = document.getElementById('discordLoginBtn');
    const logoutBtn = document.getElementById('logoutBtn');
    const userAvatar = document.getElementById('userAvatar');
    const userName = document.getElementById('userName');
    
    const fileInput = document.getElementById('fileInput');
    const fileLabel = document.getElementById('fileLabel');
    const fileName = document.getElementById('fileName');
    const injectBtn = document.getElementById('injectBtn');
    const uploadBtn = document.getElementById('uploadBtn');
    const uploadSection = document.getElementById('uploadSection');
    const langSelect = document.getElementById('langSelect');
    const isPublicCheckbox = document.getElementById('isPublic');
    const removeBtn = document.getElementById('removeBtn');
    const status = document.getElementById('status');
    const statusText = document.getElementById('statusText');
    const currentSubtitle = document.getElementById('currentSubtitle');
    const currentName = document.getElementById('currentName');
    const videoInfo = document.getElementById('videoInfo');
    const videoIdSpan = document.getElementById('videoId');
    
    const tabs = document.querySelectorAll('.tab');
    const tabContents = document.querySelectorAll('.tab-content');
    
    // ========== UI Functions ==========
    
    function setStatus(type, message) {
        status.className = 'status ' + type;
        statusText.textContent = message;
    }
    
    function showCurrentSubtitle(name) {
        currentSubtitle.classList.remove('hidden');
        currentName.textContent = name;
        removeBtn.classList.remove('hidden');
    }
    
    function hideCurrentSubtitle() {
        currentSubtitle.classList.add('hidden');
        removeBtn.classList.add('hidden');
    }
    
    function updateUIForAuth(isLoggedIn) {
        console.log('updateUIForAuth called with:', isLoggedIn, 'currentUser:', currentUser);
        console.trace('Call stack:');
        
        if (isLoggedIn && currentUser) {
            loginSection.classList.add('hidden');
            userProfile.classList.remove('hidden');
            tabsSection.classList.remove('hidden');
            
            userName.textContent = currentUser.username;
            
            if (currentUser.avatar && currentUser.discordId) {
                userAvatar.innerHTML = `<img src="https://cdn.discordapp.com/avatars/${currentUser.discordId}/${currentUser.avatar}.png" alt="Avatar">`;
            } else {
                userAvatar.textContent = currentUser.username.charAt(0).toUpperCase();
            }
            
            // Show admin tab if user is admin
            const adminTab = document.getElementById('adminTab');
            if (adminTab && currentUser.isAdmin) {
                adminTab.classList.remove('hidden');
            } else if (adminTab) {
                adminTab.classList.add('hidden');
            }
        } else {
            loginSection.classList.remove('hidden');
            userProfile.classList.add('hidden');
            tabsSection.classList.add('hidden');
            uploadSection.classList.add('hidden');
        }
    }
    
    // ========== Auth Functions ==========
    
    async function loadAuthState() {
        console.log('loadAuthState() called');
        try {
            const result = await browserAPI.storage.local.get(['authToken', 'user']);
            console.log('Loaded auth state:', result);
            console.log('authToken exists:', !!result.authToken);
            console.log('user exists:', !!result.user);
            
            if (result.authToken && result.user) {
                authToken = result.authToken;
                currentUser = result.user;
                
                console.log('Setting currentUser:', currentUser);
                console.log('Calling updateUIForAuth(true)');
                
                // Show UI immediately with cached data
                updateUIForAuth(true);
                
                console.log('UI updated, now verifying token...');
                
                // Then verify token in background
                try {
                    const response = await fetch(`${API_URL}/api/users/me`, {
                        headers: { 'Authorization': `Bearer ${authToken}` }
                    });
                    
                    console.log('Token verification response:', response.status);
                    
                    if (response.ok) {
                        const userData = await response.json();
                        // API returns user directly, not { user: ... }
                        currentUser = {
                            id: userData.id,
                            discordId: userData.discordId,
                            username: userData.username,
                            avatar: userData.discordId && currentUser?.avatar ? currentUser.avatar : null,
                            isAdmin: userData.isAdmin || false
                        };
                        await browserAPI.storage.local.set({ user: currentUser });
                        // Update UI again to show/hide admin tab
                        updateUIForAuth(true);
                        console.log('Token valid, user data refreshed, isAdmin:', currentUser.isAdmin);
                    } else if (response.status === 401) {
                        // Only logout on explicit 401
                        console.log('Token expired, logging out');
                        await logout();
                    } else {
                        console.log('Other response status, keeping cached login');
                    }
                    // For other errors, keep the cached login
                } catch (fetchError) {
                    console.error('API fetch error (keeping cached login):', fetchError);
                    // Keep logged in with cached data on network error
                }
                return true;
            } else {
                console.log('No auth data found in storage');
            }
        } catch (e) {
            console.error('Auth check error:', e);
        }
        console.log('Calling updateUIForAuth(false)');
        updateUIForAuth(false);
        return false;
    }
    
    async function login() {
        setStatus('info', i18n('statusOpeningLogin'));
        
        // Open Discord OAuth in a new window
        const width = 500;
        const height = 700;
        const left = (screen.width - width) / 2;
        const top = (screen.height - height) / 2;
        
        const authWindow = window.open(
            `${API_URL}/auth/discord`,
            'RevoSub Login',
            `width=${width},height=${height},left=${left},top=${top}`
        );
        
        setStatus('info', i18n('statusWaitingDiscord'));
        
        // Listen for storage changes (background script will save auth data)
        const storageListener = async (changes, areaName) => {
            if (areaName === 'local' && changes.authToken && changes.user) {
                console.log('Auth data received from background script');
                
                authToken = changes.authToken.newValue;
                currentUser = changes.user.newValue;
                
                browserAPI.storage.onChanged.removeListener(storageListener);
                clearInterval(checkClosed);
                
                updateUIForAuth(true);
                setStatus('success', i18n('statusLoginSuccess'));
                loadMySubtitles();
            }
        };
        
        browserAPI.storage.onChanged.addListener(storageListener);
        
        // Also poll for window close as backup
        let attempts = 0;
        const maxAttempts = 300; // 5 minutes max
        
        const checkClosed = setInterval(async () => {
            attempts++;
            
            // Check if window was closed
            if (authWindow && authWindow.closed) {
                clearInterval(checkClosed);
                
                // Give a small delay for storage operations
                await new Promise(r => setTimeout(r, 1000));
                
                // Check if we got auth
                const result = await browserAPI.storage.local.get(['authToken', 'user']);
                if (result.authToken && result.user) {
                    authToken = result.authToken;
                    currentUser = result.user;
                    browserAPI.storage.onChanged.removeListener(storageListener);
                    updateUIForAuth(true);
                    setStatus('success', i18n('statusLoginSuccess'));
                    loadMySubtitles();
                } else {
                    browserAPI.storage.onChanged.removeListener(storageListener);
                    setStatus('info', i18n('statusLoginForCloud'));
                }
                return;
            }
            
            // Timeout
            if (attempts >= maxAttempts) {
                clearInterval(checkClosed);
                browserAPI.storage.onChanged.removeListener(storageListener);
                if (authWindow && !authWindow.closed) {
                    authWindow.close();
                }
                setStatus('error', i18n('statusLoginTimeout'));
            }
        }, 1000);
    }
    
    async function logout() {
        authToken = null;
        currentUser = null;
        await browserAPI.storage.local.remove(['authToken', 'user']);
        updateUIForAuth(false);
        setStatus('info', i18n('statusDisconnected'));
    }
    
    // ========== API Functions ==========
    
    async function apiRequest(endpoint, options = {}) {
        const headers = {
            'Content-Type': 'application/json',
            ...options.headers
        };
        
        if (authToken) {
            headers['Authorization'] = `Bearer ${authToken}`;
        }
        
        let response;
        try {
            response = await fetch(`${API_URL}${endpoint}`, {
                ...options,
                headers
            });
        } catch (networkError) {
            console.error('Network error:', networkError);
            throw new Error('Erro de conexão. Verifique sua internet.');
        }
        
        if (!response.ok) {
            let errorMessage = 'Erro no servidor';
            try {
                const error = await response.json();
                errorMessage = error.error || error.message || `Erro ${response.status}`;
            } catch {
                errorMessage = `Erro ${response.status}: ${response.statusText}`;
            }
            console.error('API Error:', response.status, errorMessage);
            throw new Error(errorMessage);
        }
        
        return response.json();
    }
    
    async function uploadSubtitleToCloud() {
        if (!fileContent || !currentVideoId) {
            setStatus('error', i18n('statusSelectFileAndVideo'));
            return;
        }
        
        if (!authToken) {
            setStatus('error', i18n('statusLoginToSave'));
            return;
        }
        
        // Verificar se o idioma já existe
        const selectedOption = langSelect.selectedOptions[0];
        if (selectedOption && selectedOption.disabled) {
            setStatus('error', i18n('statusDuplicateLanguage'));
            return;
        }
        
        setStatus('info', i18n('statusUploading'));
        
        try {
            // Usar o nome do arquivo como título
            const title = selectedFile ? selectedFile.name.replace(/\.[^.]+$/, '') : `Legenda ${currentVideoId}`;
            
            const data = await apiRequest('/api/subtitles', {
                method: 'POST',
                body: JSON.stringify({
                    youtubeVideoId: currentVideoId,
                    title: title,
                    content: fileContent,
                    language: langSelect.value,
                    format: fileFormat || 'ytt', // Incluir formato detectado
                    isPublic: isPublicCheckbox.checked
                })
            });
            
            setStatus('success', i18n('statusUploadSuccess'));
            
            // Atualizar o seletor de idiomas
            updateLanguageSelector(currentVideoId);
            
            loadMySubtitles();
        } catch (e) {
            setStatus('error', '❌ ' + e.message);
        }
    }
    
    async function loadMySubtitles() {
        const container = document.getElementById('mySubtitlesList');
        
        if (!authToken) {
            container.innerHTML = `
                <div class="empty-state">
                    <div class="icon">🔒</div>
                    <p>${i18n('emptyLoginToSee')}</p>
                </div>
            `;
            return;
        }
        
        try {
            const data = await apiRequest('/api/subtitles/my');
            
            if (!data.subtitles || data.subtitles.length === 0) {
                container.innerHTML = `
                    <div class="empty-state">
                        <div class="icon">📭</div>
                        <p>${i18n('emptyNoSubtitles')}</p>
                    </div>
                `;
                return;
            }
            
            container.innerHTML = data.subtitles.map(sub => `
                <div class="subtitle-item" data-id="${sub.id}" data-content="${encodeURIComponent(sub.content || '')}">
                    <div class="icon">📄</div>
                    <div class="info">
                        <div class="name">${sub.title || sub.youtubeVideoId}</div>
                        <div class="meta">${sub.language} • ${sub.isPublic ? i18n('publicLabel') : i18n('privateLabel')} • ${sub.youtubeVideoId}</div>
                    </div>
                    <div class="actions">
                        <button class="action-btn inject-btn" data-id="${sub.id}">▶️</button>
                        <button class="action-btn delete delete-btn" data-id="${sub.id}">🗑️</button>
                    </div>
                </div>
            `).join('');
            
            // Add event listeners
            container.querySelectorAll('.inject-btn').forEach(btn => {
                btn.addEventListener('click', async (e) => {
                    e.stopPropagation();
                    const item = btn.closest('.subtitle-item');
                    const content = decodeURIComponent(item.dataset.content);
                    const subtitleId = item.dataset.id;
                    await injectSubtitle(content, 'cloud-subtitle', parseInt(subtitleId));
                });
            });
            
            container.querySelectorAll('.delete-btn').forEach(btn => {
                btn.addEventListener('click', async (e) => {
                    e.stopPropagation();
                    const id = btn.dataset.id;
                    if (confirm(i18n('confirmDeleteSubtitle'))) {
                        await deleteSubtitle(id);
                    }
                });
            });
            
        } catch (e) {
            container.innerHTML = `
                <div class="empty-state">
                    <div class="icon">❌</div>
                    <p>${i18n('emptyErrorLoading')}</p>
                </div>
            `;
        }
    }
    
    async function downloadAndInject(id) {
        try {
            setStatus('info', i18n('statusDownloading'));
            const data = await apiRequest(`/api/subtitles/${id}/download`);
            await injectSubtitle(data.content, `cloud-${data.language}`, parseInt(id));
            setStatus('success', i18n('statusInjected'));
        } catch (e) {
            setStatus('error', '❌ ' + e.message);
        }
    }
    
    async function deleteSubtitle(id) {
        try {
            await apiRequest(`/api/subtitles/${id}`, { method: 'DELETE' });
            setStatus('success', i18n('statusDeleted'));
            loadMySubtitles();
        } catch (e) {
            setStatus('error', '❌ ' + e.message);
        }
    }
    
    // ========== Subtitle Functions ==========
    
    async function checkYouTubePage() {
        try {
            const tab = await findYouTubeTab();
            
            if (!tab || !tab.url || !tab.url.includes('youtube.com/watch')) {
                setStatus('warning', i18n('statusOpenYouTube'));
                injectBtn.disabled = true;
                return false;
            }
            
            browserAPI.tabs.sendMessage(tab.id, { action: 'getStatus' }, function(response) {
                if (browserAPI.runtime.lastError) return;
                
                if (response && response.videoId) {
                    currentVideoId = response.videoId;
                    if (videoIdSpan) videoIdSpan.textContent = response.videoId;
                    if (videoInfo) videoInfo.classList.remove('hidden');
                    
                    // Update language selector to show existing languages
                    updateLanguageSelector(response.videoId);
                }
                
                if (response && response.hasSubtitle) {
                    showCurrentSubtitle(response.subtitleName || 'Legenda ativa');
                }
            });
            
            setStatus('success', i18n('statusReady'));
            injectBtn.disabled = false;
            return true;
        } catch (e) {
            setStatus('info', i18n('statusSelectFile'));
            return false;
        }
    }
    
    async function updateLanguageSelector(videoId) {
        try {
            // Buscar legendas existentes para este vídeo
            const response = await fetch(`${API_URL}/api/subtitles/video/${videoId}`);
            if (!response.ok) return;
            
            const data = await response.json();
            const existingLanguages = (data.subtitles || []).map(s => s.language);
            
            // Atualizar o seletor
            const options = langSelect.querySelectorAll('option');
            options.forEach(option => {
                if (existingLanguages.includes(option.value)) {
                    option.disabled = true;
                    option.textContent = option.textContent.replace(' ✓', '') + ' ✓';
                    option.style.color = '#888';
                } else {
                    option.disabled = false;
                    option.textContent = option.textContent.replace(' ✓', '');
                    option.style.color = '';
                }
            });
            
            // Se o idioma selecionado está desabilitado, selecionar o primeiro disponível
            if (langSelect.selectedOptions[0]?.disabled) {
                const firstEnabled = langSelect.querySelector('option:not([disabled])');
                if (firstEnabled) {
                    langSelect.value = firstEnabled.value;
                }
            }
        } catch (e) {
            console.error('Erro ao verificar idiomas existentes:', e);
        }
    }
    
    function readFile(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = e => resolve(e.target.result);
            reader.onerror = reject;
            reader.readAsText(file);
        });
    }
    
    function convertSRTtoVTT(srt) {
        return 'WEBVTT\n\n' + srt
            .replace(/(\d{2}):(\d{2}):(\d{2}),(\d{3})/g, '$1:$2:$3.$4')
            .replace(/\r\n/g, '\n').trim();
    }
    
    function convertASStoVTT(ass) {
        let vtt = 'WEBVTT\n\n';
        const lines = ass.split('\n');
        let inEvents = false;
        
        for (const line of lines) {
            if (line.startsWith('[Events]')) { inEvents = true; continue; }
            if (inEvents && line.startsWith('Dialogue:')) {
                const parts = line.substring(10).split(',');
                if (parts.length >= 10) {
                    const start = convertASSTime(parts[1].trim());
                    const end = convertASSTime(parts[2].trim());
                    let text = parts.slice(9).join(',').trim()
                        .replace(/\{[^}]+\}/g, '')
                        .replace(/\\N/g, '\n')
                        .replace(/\\n/g, '\n');
                    vtt += start + ' --> ' + end + '\n' + text + '\n\n';
                }
            }
        }
        return vtt;
    }
    
    function convertASSTime(time) {
        const m = time.match(/(\d+):(\d{2}):(\d{2})\.(\d{2})/);
        if (m) return m[1].padStart(2,'0') + ':' + m[2] + ':' + m[3] + '.' + m[4] + '0';
        return time;
    }
    
    async function injectSubtitle(content, name, subtitleId = null) {
        try {
            const tab = await findYouTubeTab();
            if (!tab) {
                setStatus('error', i18n('statusOpenYouTube'));
                throw new Error('No YouTube tab found');
            }
            
            // Detectar formato se não foi especificado
            let format = fileFormat;
            if (!format) {
                if (content.includes('<?xml') || content.includes('<timedtext')) {
                    format = 'ytt';
                } else if (content.includes('[Script Info]') || content.includes('[V4+ Styles]')) {
                    format = 'ass';
                } else {
                    format = 'vtt';
                }
            }
            
            return new Promise((resolve, reject) => {
                browserAPI.tabs.sendMessage(tab.id, {
                    action: 'injectSubtitle',
                    content: content,
                    fileName: name,
                    format: format,
                    subtitleId: subtitleId // ID da legenda da nuvem para denúncias
                }, function(response) {
                    if (browserAPI.runtime.lastError) {
                        setStatus('error', i18n('statusReloadYouTube'));
                        reject(browserAPI.runtime.lastError);
                        return;
                    }
                    if (response && response.success) {
                        showCurrentSubtitle(name);
                        resolve(response);
                    } else {
                        setStatus('error', '❌ ' + (response?.error || i18n('error')));
                        reject(new Error(response?.error));
                    }
                });
            });
        } catch (e) {
            setStatus('error', i18n('statusInjectError'));
            throw e;
        }
    }
    
    // ========== Admin Functions ==========
    
    async function loadAdminUsers() {
        const container = document.getElementById('adminUsersList');
        if (!container) return;
        
        try {
            const data = await apiRequest('/api/admin/users');
            
            if (!data.users || data.users.length === 0) {
                container.innerHTML = `
                    <div class="empty-state">
                        <p>${i18n('emptyNoUsers')}</p>
                    </div>
                `;
                return;
            }
            
            container.innerHTML = data.users.map(user => `
                <div class="admin-item ${user.isBanned ? 'banned' : ''}" data-id="${user.id}">
                    <div class="avatar">
                        ${user.avatar && user.discordId 
                            ? `<img src="https://cdn.discordapp.com/avatars/${user.discordId}/${user.avatar}.png" alt="Avatar">`
                            : user.username.charAt(0).toUpperCase()
                        }
                    </div>
                    <div class="info">
                        <div class="name">${user.username}${user.isAdmin ? ' [ADM]' : ''}${user.isBanned ? ' [BANNED]' : ''}</div>
                        <div class="meta">ID: ${user.id} | Discord: ${user.discordId || 'N/A'}</div>
                    </div>
                    <div class="actions">
                        ${user.isBanned 
                            ? `<button class="btn-ban btn-unban" data-id="${user.id}" data-action="unban">${i18n('unban')}</button>`
                            : `<button class="btn-ban" data-id="${user.id}" data-action="ban">${i18n('ban')}</button>`
                        }
                    </div>
                </div>
            `).join('');
            
            // Add ban/unban event listeners
            container.querySelectorAll('.btn-ban').forEach(btn => {
                btn.addEventListener('click', async (e) => {
                    e.stopPropagation();
                    const userId = btn.dataset.id;
                    const action = btn.dataset.action;
                    
                    if (action === 'ban') {
                        if (confirm(i18n('confirmBanUser'))) {
                            await banUser(userId, true);
                        }
                    } else {
                        if (confirm(i18n('confirmUnbanUser'))) {
                            await banUser(userId, false);
                        }
                    }
                });
            });
            
        } catch (e) {
            container.innerHTML = `
                <div class="empty-state">
                    <p>${i18n('emptyErrorUsers')}</p>
                </div>
            `;
        }
    }
    
    async function loadAdminSubtitles() {
        const container = document.getElementById('adminSubtitlesList');
        if (!container) return;
        
        try {
            const data = await apiRequest('/api/admin/subtitles');
            
            if (!data.subtitles || data.subtitles.length === 0) {
                container.innerHTML = `
                    <div class="empty-state">
                        <p>${i18n('emptyNoSubtitlesAdmin')}</p>
                    </div>
                `;
                return;
            }
            
            container.innerHTML = data.subtitles.map(sub => `
                <div class="admin-item" data-id="${sub.id}">
                    <div class="info">
                        <div class="name">${sub.title || sub.youtubeVideoId}</div>
                        <div class="meta">${sub.language} | ${sub.format || 'vtt'} | User: ${sub.username || sub.userId} | ${sub.isPublic ? i18n('publicLabel') : i18n('privateLabel')}</div>
                    </div>
                    <div class="actions">
                        <button class="btn-delete-admin" data-id="${sub.id}">${i18n('delete')}</button>
                    </div>
                </div>
            `).join('');
            
            // Add delete event listeners
            container.querySelectorAll('.btn-delete-admin').forEach(btn => {
                btn.addEventListener('click', async (e) => {
                    e.stopPropagation();
                    const subId = btn.dataset.id;
                    if (confirm(i18n('confirmDeleteSubtitle'))) {
                        await deleteSubtitleAdmin(subId);
                    }
                });
            });
            
        } catch (e) {
            container.innerHTML = `
                <div class="empty-state">
                    <p>${i18n('emptyErrorSubtitles')}</p>
                </div>
            `;
        }
    }
    
    async function banUser(userId, ban) {
        try {
            await apiRequest(`/api/admin/users/${userId}/ban`, {
                method: 'POST',
                body: JSON.stringify({ ban: ban })
            });
            setStatus('success', ban ? i18n('statusUserBanned') : i18n('statusUserUnbanned'));
            loadAdminUsers();
        } catch (e) {
            setStatus('error', i18n('errorPrefix') + ' ' + e.message);
        }
    }
    
    async function deleteSubtitleAdmin(id) {
        try {
            await apiRequest(`/api/admin/subtitles/${id}`, { method: 'DELETE' });
            setStatus('success', i18n('statusSubtitleDeleted'));
            loadAdminSubtitles();
        } catch (e) {
            setStatus('error', i18n('errorPrefix') + ' ' + e.message);
        }
    }
    
    function filterAdminUsers(searchTerm) {
        const items = document.querySelectorAll('#adminUsersList .admin-item');
        const term = searchTerm.toLowerCase();
        
        items.forEach(item => {
            const name = item.querySelector('.name')?.textContent.toLowerCase() || '';
            const meta = item.querySelector('.meta')?.textContent.toLowerCase() || '';
            
            if (name.includes(term) || meta.includes(term)) {
                item.style.display = '';
            } else {
                item.style.display = 'none';
            }
        });
    }
    
    function filterAdminSubtitles(searchTerm) {
        const items = document.querySelectorAll('#adminSubtitlesList .admin-item');
        const term = searchTerm.toLowerCase();
        
        items.forEach(item => {
            const name = item.querySelector('.name')?.textContent.toLowerCase() || '';
            const meta = item.querySelector('.meta')?.textContent.toLowerCase() || '';
            
            if (name.includes(term) || meta.includes(term)) {
                item.style.display = '';
            } else {
                item.style.display = 'none';
            }
        });
    }
    
    async function loadAdminReports(status = 'pending') {
        const container = document.getElementById('adminReportsList');
        if (!container) return;
        
        try {
            const endpoint = status === 'all' ? '/api/admin/reports' : `/api/admin/reports?status=${status}`;
            const data = await apiRequest(endpoint);
            
            // Atualizar badge
            const badge = document.getElementById('reportsBadge');
            if (badge) {
                const pendingCount = data.reports.filter(r => r.status === 'pending').length;
                if (pendingCount > 0) {
                    badge.textContent = pendingCount;
                    badge.classList.remove('hidden');
                } else {
                    badge.classList.add('hidden');
                }
            }
            
            if (!data.reports || data.reports.length === 0) {
                container.innerHTML = `
                    <div class="empty-state">
                        <p>${status === 'pending' ? i18n('emptyNoReportsPending') : i18n('emptyNoReports')}</p>
                    </div>
                `;
                return;
            }
            
            const reasonLabels = {
                'spam': i18n('reasonSpam'),
                'offensive': i18n('reasonOffensive'),
                'wrong_sync': i18n('reasonWrongSync'),
                'wrong_language': i18n('reasonWrongLanguage'),
                'copyright': i18n('reasonCopyright'),
                'other': i18n('reasonOther')
            };
            
            container.innerHTML = data.reports.map(report => `
                <div class="report-item ${report.status}" data-id="${report.id}">
                    <div class="report-header">
                        <span class="report-reason">${reasonLabels[report.reason] || report.reason}</span>
                        <span class="report-date">${new Date(report.createdAt).toLocaleDateString()}</span>
                    </div>
                    <div class="report-info">
                        <strong>${i18n('reportVideoLabel')}</strong> ${report.youtubeVideoId} | 
                        <strong>${i18n('reportLanguageLabel')}</strong> ${report.language}<br>
                        <strong>${i18n('reportSubtitleLabel')}</strong> ${report.subtitle?.title || 'N/A'} | 
                        <strong>${i18n('reportAuthorLabel')}</strong> ${report.subtitle?.author?.username || 'N/A'}<br>
                        <strong>${i18n('reportedByLabel')}</strong> ${report.reporter?.username || 'N/A'}
                    </div>
                    ${report.description ? `<div class="report-description">"${report.description}"</div>` : ''}
                    ${report.status === 'pending' ? `
                        <div class="report-actions">
                            <button class="btn-report-action btn-video" data-video="${report.youtubeVideoId}">${i18n('viewVideo')}</button>
                            <button class="btn-report-action btn-dismiss" data-id="${report.id}" data-action="dismiss">${i18n('dismiss')}</button>
                            <button class="btn-report-action btn-remove" data-id="${report.id}" data-action="remove">${i18n('remove')}</button>
                            <button class="btn-report-action btn-remove-ban" data-id="${report.id}" data-action="remove_ban">${i18n('removeAndBan')}</button>
                        </div>
                    ` : `<div style="font-size: 11px; color: #666;">${i18n('reportStatusLabel')} ${report.status}</div>`}
                </div>
            `).join('');
            
            // Event listeners
            container.querySelectorAll('.btn-video').forEach(btn => {
                btn.addEventListener('click', () => {
                    const videoId = btn.dataset.video;
                    window.open(`https://www.youtube.com/watch?v=${videoId}`, '_blank');
                });
            });
            
            container.querySelectorAll('.btn-dismiss, .btn-remove, .btn-remove-ban').forEach(btn => {
                btn.addEventListener('click', async (e) => {
                    e.stopPropagation();
                    const reportId = btn.dataset.id;
                    const action = btn.dataset.action;
                    
                    let confirmMsg = i18n('confirmDismissReport');
                    if (action === 'remove') confirmMsg = i18n('confirmRemoveSubtitle');
                    if (action === 'remove_ban') confirmMsg = i18n('confirmRemoveAndBan');
                    
                    if (confirm(confirmMsg)) {
                        await resolveReport(reportId, action);
                    }
                });
            });
            
        } catch (e) {
            container.innerHTML = `
                <div class="empty-state">
                    <p>${i18n('emptyErrorReports')}</p>
                </div>
            `;
        }
    }
    
    async function resolveReport(reportId, action) {
        try {
            await apiRequest(`/api/admin/reports/${reportId}/resolve`, {
                method: 'POST',
                body: JSON.stringify({ action: action })
            });
            
            const messages = {
                'dismiss': i18n('statusReportDismissed'),
                'remove': i18n('statusSubtitleRemoved'),
                'remove_ban': i18n('statusRemovedAndBanned')
            };
            
            setStatus('success', messages[action] || i18n('statusActionDone'));
            
            // Recarregar lista
            const filter = document.getElementById('adminReportFilter');
            loadAdminReports(filter ? filter.value : 'pending');
        } catch (e) {
            setStatus('error', i18n('errorPrefix') + ' ' + e.message);
        }
    }
    
    // ========== Event Listeners ==========
    
    // Discord Login
    discordLoginBtn.addEventListener('click', login);
    
    // Logout
    logoutBtn.addEventListener('click', logout);
    
    // Tabs
    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            tabs.forEach(t => t.classList.remove('active'));
            tabContents.forEach(c => c.classList.remove('active'));
            
            tab.classList.add('active');
            const tabId = 'tab' + tab.dataset.tab.charAt(0).toUpperCase() + tab.dataset.tab.slice(1);
            document.getElementById(tabId).classList.add('active');
            
            // Load data when switching tabs
            if (tab.dataset.tab === 'cloud') {
                loadMySubtitles();
            } else if (tab.dataset.tab === 'admin') {
                loadAdminUsers();
                loadAdminSubtitles();
                loadAdminReports('pending');
            }
        });
    });
    
    // Admin sub-tabs
    const adminSubtabs = document.querySelectorAll('.admin-subtab');
    const adminTabContents = document.querySelectorAll('.admin-tab-content');
    
    adminSubtabs.forEach(subtab => {
        subtab.addEventListener('click', () => {
            adminSubtabs.forEach(t => t.classList.remove('active'));
            adminTabContents.forEach(c => c.classList.remove('active'));
            
            subtab.classList.add('active');
            const tabId = 'admin' + subtab.dataset.adminTab.charAt(0).toUpperCase() + subtab.dataset.adminTab.slice(1);
            document.getElementById(tabId).classList.add('active');
            
            // Carregar dados ao trocar sub-aba
            if (subtab.dataset.adminTab === 'reports') {
                const filter = document.getElementById('adminReportFilter');
                loadAdminReports(filter ? filter.value : 'pending');
            }
        });
    });
    
    // Admin report filter
    const adminReportFilter = document.getElementById('adminReportFilter');
    if (adminReportFilter) {
        adminReportFilter.addEventListener('change', (e) => {
            loadAdminReports(e.target.value);
        });
    }
    
    // Admin search inputs
    const adminUserSearch = document.getElementById('adminUserSearch');
    const adminSubtitleSearch = document.getElementById('adminSubtitleSearch');
    
    if (adminUserSearch) {
        adminUserSearch.addEventListener('input', (e) => {
            filterAdminUsers(e.target.value);
        });
    }
    
    if (adminSubtitleSearch) {
        adminSubtitleSearch.addEventListener('input', (e) => {
            filterAdminSubtitles(e.target.value);
        });
    }
    
    // File selection
    fileInput.addEventListener('change', async function(e) {
        const file = e.target.files[0];
        if (!file) return;
        
        const ext = file.name.split('.').pop().toLowerCase();
        const supportedFormats = ['ytt', 'vtt', 'srt', 'ass', 'ssa', 'xml'];
        
        // Verificar se o formato é suportado
        if (!supportedFormats.includes(ext)) {
            setStatus('error', i18n('statusFormatNotSupported'));
            // Resetar input
            fileInput.value = '';
            selectedFile = null;
            fileContent = null;
            fileFormat = null;
            fileLabel.classList.remove('has-file');
            fileName.textContent = '';
            fileName.classList.add('hidden');
            fileLabel.querySelector('.text').textContent = i18n('selectFile');
            return;
        }
        
        selectedFile = file;
        fileLabel.classList.add('has-file');
        fileName.textContent = file.name;
        fileName.classList.remove('hidden');
        fileLabel.querySelector('.text').textContent = i18n('fileSelected');
        
        try {
            fileContent = await readFile(file);
            fileFormat = null; // Resetar formato
            
            if (ext === 'srt') {
                fileContent = convertSRTtoVTT(fileContent);
                fileFormat = 'vtt';
                setStatus('info', i18n('statusSrtConverted'));
            } else if (ext === 'ass' || ext === 'ssa') {
                // NÃO converter! Enviar ASS nativo com todos os estilos
                fileFormat = 'ass';
                setStatus('success', i18n('statusAssReady'));
            } else if (ext === 'ytt' || ext === 'xml') {
                fileFormat = 'ytt';
                setStatus('success', i18n('statusYttReady'));
            } else {
                fileFormat = 'vtt';
                setStatus('success', i18n('statusVttReady'));
            }
            
            // Show upload section if logged in
            if (authToken) {
                uploadSection.classList.remove('hidden');
            }
            
            await checkYouTubePage();
        } catch (err) {
            setStatus('error', i18n('statusFileError'));
        }
    });
    
    // Inject button
    injectBtn.addEventListener('click', async function() {
        if (!fileContent || !selectedFile) return;
        
        setStatus('info', i18n('statusInjecting'));
        
        try {
            await injectSubtitle(fileContent, selectedFile.name);
            setStatus('success', i18n('statusInjected'));
        } catch (e) {
            // Error already handled
        }
    });
    
    // Remove button
    removeBtn.addEventListener('click', async function() {
        try {
            const tab = await findYouTubeTab();
            if (!tab) return;
            browserAPI.tabs.sendMessage(tab.id, { action: 'removeSubtitle' }, function() {
                if (!browserAPI.runtime.lastError) {
                    setStatus('info', i18n('statusRemoved'));
                    hideCurrentSubtitle();
                }
            });
        } catch (e) {}
    });
    
    // Upload to cloud
    uploadBtn.addEventListener('click', uploadSubtitleToCloud);
    
    // Drag and drop
    fileLabel.addEventListener('dragover', function(e) {
        e.preventDefault();
        fileLabel.style.borderColor = '#e74c3c';
        fileLabel.style.background = 'rgba(231,76,60,0.1)';
    });
    
    fileLabel.addEventListener('dragleave', function(e) {
        e.preventDefault();
        if (!selectedFile) {
            fileLabel.style.borderColor = 'rgba(255,255,255,0.2)';
            fileLabel.style.background = 'transparent';
        }
    });
    
    fileLabel.addEventListener('drop', function(e) {
        e.preventDefault();
        if (e.dataTransfer.files.length > 0) {
            fileInput.files = e.dataTransfer.files;
            fileInput.dispatchEvent(new Event('change'));
        }
    });
    
    // ========== Initialize ==========
    
    await loadAuthState();
    await checkYouTubePage();
    
    if (authToken) {
        loadMySubtitles();
    }
}
