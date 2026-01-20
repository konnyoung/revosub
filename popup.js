// popup.js - RevoSub Extension with Discord Auth

const API_URL = 'https://auth.kennyy.com.br';

document.addEventListener('DOMContentLoaded', init);

let selectedFile = null;
let fileContent = null;
let currentUser = null;
let authToken = null;
let currentVideoId = null;

async function init() {
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
            const result = await chrome.storage.local.get(['authToken', 'user']);
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
                            avatar: userData.discordId && currentUser?.avatar ? currentUser.avatar : null
                        };
                        await chrome.storage.local.set({ user: currentUser });
                        // Don't call updateUIForAuth again - it's already showing correctly
                        console.log('Token valid, user data refreshed');
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
        setStatus('info', '⏳ Abrindo login...');
        
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
        
        setStatus('info', '⏳ Aguardando login no Discord...');
        
        // Listen for storage changes (background script will save auth data)
        const storageListener = async (changes, areaName) => {
            if (areaName === 'local' && changes.authToken && changes.user) {
                console.log('Auth data received from background script');
                
                authToken = changes.authToken.newValue;
                currentUser = changes.user.newValue;
                
                chrome.storage.onChanged.removeListener(storageListener);
                clearInterval(checkClosed);
                
                updateUIForAuth(true);
                setStatus('success', '✅ Login realizado!');
                loadMySubtitles();
            }
        };
        
        chrome.storage.onChanged.addListener(storageListener);
        
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
                const result = await chrome.storage.local.get(['authToken', 'user']);
                if (result.authToken && result.user) {
                    authToken = result.authToken;
                    currentUser = result.user;
                    chrome.storage.onChanged.removeListener(storageListener);
                    updateUIForAuth(true);
                    setStatus('success', '✅ Login realizado!');
                    loadMySubtitles();
                } else {
                    chrome.storage.onChanged.removeListener(storageListener);
                    setStatus('info', 'ℹ️ Faça login para acessar a nuvem');
                }
                return;
            }
            
            // Timeout
            if (attempts >= maxAttempts) {
                clearInterval(checkClosed);
                chrome.storage.onChanged.removeListener(storageListener);
                if (authWindow && !authWindow.closed) {
                    authWindow.close();
                }
                setStatus('error', '❌ Timeout no login');
            }
        }, 1000);
    }
    
    async function logout() {
        authToken = null;
        currentUser = null;
        await chrome.storage.local.remove(['authToken', 'user']);
        updateUIForAuth(false);
        setStatus('info', 'ℹ️ Desconectado');
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
        
        const response = await fetch(`${API_URL}${endpoint}`, {
            ...options,
            headers
        });
        
        if (!response.ok) {
            const error = await response.json().catch(() => ({ error: 'Request failed' }));
            throw new Error(error.error || 'API Error');
        }
        
        return response.json();
    }
    
    async function uploadSubtitleToCloud() {
        if (!fileContent || !currentVideoId) {
            setStatus('error', '❌ Selecione um arquivo e abra um vídeo');
            return;
        }
        
        if (!authToken) {
            setStatus('error', '❌ Faça login para salvar na nuvem');
            return;
        }
        
        // Verificar se o idioma já existe
        const selectedOption = langSelect.selectedOptions[0];
        if (selectedOption && selectedOption.disabled) {
            setStatus('error', '❌ Já existe legenda neste idioma para este vídeo');
            return;
        }
        
        setStatus('info', '⏳ Enviando para a nuvem...');
        
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
                    isPublic: isPublicCheckbox.checked
                })
            });
            
            setStatus('success', '✅ Legenda salva na nuvem!');
            
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
                    <p>Faça login para ver suas legendas</p>
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
                        <p>Você ainda não tem legendas salvas</p>
                    </div>
                `;
                return;
            }
            
            container.innerHTML = data.subtitles.map(sub => `
                <div class="subtitle-item" data-id="${sub.id}" data-content="${encodeURIComponent(sub.content || '')}">
                    <div class="icon">📄</div>
                    <div class="info">
                        <div class="name">${sub.title || sub.youtubeVideoId}</div>
                        <div class="meta">${sub.language} • ${sub.isPublic ? '🌐 Pública' : '🔒 Privada'} • ${sub.youtubeVideoId}</div>
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
                    await injectSubtitle(content, 'cloud-subtitle');
                });
            });
            
            container.querySelectorAll('.delete-btn').forEach(btn => {
                btn.addEventListener('click', async (e) => {
                    e.stopPropagation();
                    const id = btn.dataset.id;
                    if (confirm('Excluir esta legenda?')) {
                        await deleteSubtitle(id);
                    }
                });
            });
            
        } catch (e) {
            container.innerHTML = `
                <div class="empty-state">
                    <div class="icon">❌</div>
                    <p>Erro ao carregar legendas</p>
                </div>
            `;
        }
    }
    
    async function loadPublicSubtitles() {
        const container = document.getElementById('publicSubtitlesList');
        
        if (!currentVideoId) {
            container.innerHTML = `
                <div class="empty-state">
                    <div class="icon">🎥</div>
                    <p>Abra um vídeo do YouTube para buscar legendas</p>
                </div>
            `;
            return;
        }
        
        try {
            const data = await apiRequest(`/api/subtitles/video/${currentVideoId}`);
            
            if (!data.subtitles || data.subtitles.length === 0) {
                container.innerHTML = `
                    <div class="empty-state">
                        <div class="icon">🔍</div>
                        <p>Nenhuma legenda encontrada para este vídeo</p>
                    </div>
                `;
                return;
            }
            
            container.innerHTML = data.subtitles.map(sub => `
                <div class="subtitle-item" data-id="${sub.id}">
                    <div class="icon">📄</div>
                    <div class="info">
                        <div class="name">${sub.language}</div>
                        <div class="meta">Por ${sub.User?.username || 'Anônimo'} • ${sub.downloads || 0} downloads</div>
                    </div>
                    <div class="actions">
                        <button class="action-btn use-btn" data-id="${sub.id}">▶️ Usar</button>
                    </div>
                </div>
            `).join('');
            
            container.querySelectorAll('.use-btn').forEach(btn => {
                btn.addEventListener('click', async (e) => {
                    e.stopPropagation();
                    const id = btn.dataset.id;
                    await downloadAndInject(id);
                });
            });
            
        } catch (e) {
            container.innerHTML = `
                <div class="empty-state">
                    <div class="icon">❌</div>
                    <p>Erro ao buscar legendas</p>
                </div>
            `;
        }
    }
    
    async function downloadAndInject(id) {
        try {
            setStatus('info', '⏳ Baixando legenda...');
            const data = await apiRequest(`/api/subtitles/${id}/download`);
            await injectSubtitle(data.content, `cloud-${data.language}`);
            setStatus('success', '✅ Legenda injetada!');
        } catch (e) {
            setStatus('error', '❌ ' + e.message);
        }
    }
    
    async function deleteSubtitle(id) {
        try {
            await apiRequest(`/api/subtitles/${id}`, { method: 'DELETE' });
            setStatus('success', '✅ Legenda excluída');
            loadMySubtitles();
        } catch (e) {
            setStatus('error', '❌ ' + e.message);
        }
    }
    
    // ========== Subtitle Functions ==========
    
    async function checkYouTubePage() {
        try {
            const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
            const tab = tabs[0];
            
            if (!tab || !tab.url || !tab.url.includes('youtube.com/watch')) {
                setStatus('warning', '⚠️ Abra um vídeo do YouTube primeiro');
                injectBtn.disabled = true;
                return false;
            }
            
            chrome.tabs.sendMessage(tab.id, { action: 'getStatus' }, function(response) {
                if (chrome.runtime.lastError) return;
                
                if (response && response.videoId) {
                    currentVideoId = response.videoId;
                    videoIdSpan.textContent = response.videoId;
                    videoInfo.classList.remove('hidden');
                    
                    // Load public subtitles for this video
                    loadPublicSubtitles();
                    
                    // Update language selector to show existing languages
                    updateLanguageSelector(response.videoId);
                }
                
                if (response && response.hasSubtitle) {
                    showCurrentSubtitle(response.subtitleName || 'Legenda ativa');
                }
            });
            
            setStatus('success', '✅ Pronto para injetar legenda');
            injectBtn.disabled = false;
            return true;
        } catch (e) {
            setStatus('info', 'ℹ️ Selecione um arquivo de legenda');
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
    
    async function injectSubtitle(content, name) {
        try {
            const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
            const tab = tabs[0];
            
            const format = content.includes('<?xml') || content.includes('<timedtext') ? 'ytt' : 'vtt';
            
            return new Promise((resolve, reject) => {
                chrome.tabs.sendMessage(tab.id, {
                    action: 'injectSubtitle',
                    content: content,
                    fileName: name,
                    format: format
                }, function(response) {
                    if (chrome.runtime.lastError) {
                        setStatus('error', '❌ Recarregue a página do YouTube');
                        reject(chrome.runtime.lastError);
                        return;
                    }
                    if (response && response.success) {
                        showCurrentSubtitle(name);
                        resolve(response);
                    } else {
                        setStatus('error', '❌ ' + (response?.error || 'Erro'));
                        reject(new Error(response?.error));
                    }
                });
            });
        } catch (e) {
            setStatus('error', '❌ Erro ao injetar');
            throw e;
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
            } else if (tab.dataset.tab === 'browse') {
                loadPublicSubtitles();
            }
        });
    });
    
    // File selection
    fileInput.addEventListener('change', async function(e) {
        const file = e.target.files[0];
        if (!file) return;
        
        selectedFile = file;
        fileLabel.classList.add('has-file');
        fileName.textContent = file.name;
        fileName.classList.remove('hidden');
        fileLabel.querySelector('.text').textContent = 'Arquivo selecionado:';
        
        try {
            fileContent = await readFile(file);
            const ext = file.name.split('.').pop().toLowerCase();
            
            if (ext === 'srt') {
                fileContent = convertSRTtoVTT(fileContent);
                setStatus('info', '📄 SRT convertido para VTT');
            } else if (ext === 'ass' || ext === 'ssa') {
                fileContent = convertASStoVTT(fileContent);
                setStatus('info', '📄 ASS convertido para VTT');
            } else if (ext === 'ytt') {
                setStatus('success', '✅ Arquivo YTT pronto');
            } else {
                setStatus('success', '✅ Arquivo VTT pronto');
            }
            
            // Show upload section if logged in
            if (authToken) {
                uploadSection.classList.remove('hidden');
            }
            
            await checkYouTubePage();
        } catch (err) {
            setStatus('error', '❌ Erro ao ler arquivo');
        }
    });
    
    // Inject button
    injectBtn.addEventListener('click', async function() {
        if (!fileContent || !selectedFile) return;
        
        setStatus('info', '⏳ Injetando legenda...');
        
        try {
            await injectSubtitle(fileContent, selectedFile.name);
            setStatus('success', '✅ Legenda injetada!');
        } catch (e) {
            // Error already handled
        }
    });
    
    // Remove button
    removeBtn.addEventListener('click', async function() {
        try {
            const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
            chrome.tabs.sendMessage(tabs[0].id, { action: 'removeSubtitle' }, function() {
                if (!chrome.runtime.lastError) {
                    setStatus('info', 'ℹ️ Legenda removida');
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
