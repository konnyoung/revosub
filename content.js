// YTT Injector - Content Script

(function() {
    'use strict';
    
    // Evitar múltiplas injeções
    if (window._yttInjectorLoaded) return;
    window._yttInjectorLoaded = true;
    
    const API_URL = 'https://auth.kennyy.com.br';
    
    let subtitleData = null;
    let syncInterval = null;
    let overlayContainer = null;
    let currentFileName = null;
    let subtitlesVisible = true;
    let toggleButton = null;
    let currentVideoId = null;
    let currentLang = null;
    let availableLanguages = [];
    
    // Escutar mensagens do popup - SÍNCRONO
    chrome.runtime.onMessage.addListener(function(message, sender, sendResponse) {
        const action = message.action;
        
        if (action === 'ping') {
            sendResponse({ pong: true });
        }
        else if (action === 'injectSubtitle') {
            currentFileName = message.fileName || 'legenda';
            try {
                injectSubtitle(message.content, message.format);
                sendResponse({ success: true });
            } catch (e) {
                sendResponse({ success: false, error: e.message });
            }
        }
        else if (action === 'removeSubtitle') {
            removeSubtitle();
            removeToggleButton();
            sendResponse({ success: true });
        }
        else if (action === 'toggleSubtitle') {
            toggleSubtitleVisibility();
            sendResponse({ success: true, visible: subtitlesVisible });
        }
        else if (action === 'getStatus') {
            sendResponse({ 
                hasSubtitle: subtitleData !== null,
                subtitleName: currentFileName,
                videoId: getVideoId()
            });
        }
        else if (action === 'uploadSubtitle') {
            uploadCurrentSubtitle(message.content, message.lang)
                .then(result => sendResponse(result))
                .catch(err => sendResponse({ success: false, error: err.message }));
            return true; // Resposta assíncrona
        }
        else {
            sendResponse({ success: false, error: 'Unknown action' });
        }
        
        // IMPORTANTE: retornar false para resposta síncrona
        return false;
    });
    
    function injectSubtitle(content, format) {
        removeSubtitle();
        
        console.log('YTT Injector: Iniciando injeção, formato:', format);
        
        if (format === 'ytt') {
            subtitleData = parseYTT(content);
        } else {
            subtitleData = parseVTT(content);
        }
        
        if (!subtitleData || subtitleData.cues.length === 0) {
            console.error('YTT Injector: Nenhuma legenda encontrada');
            return;
        }
        
        console.log('YTT Injector: Carregadas', subtitleData.cues.length, 'legendas');
        console.log('YTT Injector: Primeira cue:', subtitleData.cues[0]);
        
        createOverlay();
        
        if (overlayContainer) {
            console.log('YTT Injector: Overlay criado com sucesso!');
            console.log('YTT Injector: Overlay parent:', overlayContainer.parentElement);
            createToggleButton();
        } else {
            console.error('YTT Injector: FALHA ao criar overlay!');
        }
        
        startSync();
    }
    
    function parseYTT(content) {
        const parser = new DOMParser();
        const doc = parser.parseFromString(content, 'text/xml');
        
        // Parsear Window Positions (wp)
        const windowPositions = {};
        doc.querySelectorAll('wp').forEach(wp => {
            // Use nullish coalescing to handle av=0 correctly (0 is a valid value for top position)
            const avAttr = wp.getAttribute('av');
            const ahAttr = wp.getAttribute('ah');
            const apAttr = wp.getAttribute('ap');
            const wpData = {
                ap: apAttr !== null ? parseInt(apAttr) : 7,
                ah: ahAttr !== null ? parseFloat(ahAttr) : 50,
                av: avAttr !== null ? parseFloat(avAttr) : 90
            };
            windowPositions[wp.getAttribute('id')] = wpData;
            
            // Debug para posições top (av baixo ou ap 0,1,2)
            if (wpData.av < 10 || wpData.ap <= 2) {
                console.log('YTT Parse WP Debug: id=' + wp.getAttribute('id'), 
                    'ap=' + wpData.ap, 'ah=' + wpData.ah, 'av=' + wpData.av);
            }
        });
        
        // Parsear Window Styles (ws)
        const windowStyles = {};
        doc.querySelectorAll('ws').forEach(ws => {
            windowStyles[ws.getAttribute('id')] = {
                ju: parseInt(ws.getAttribute('ju')) || 2
            };
        });
        
        // Parsear Pen Styles
        const penStyles = {};
        doc.querySelectorAll('pen').forEach(pen => {
            const id = pen.getAttribute('id');
            penStyles[id] = {
                sz: parseInt(pen.getAttribute('sz')) || 100,
                fc: pen.getAttribute('fc') || '#FFFFFF',
                fo: pen.hasAttribute('fo') ? parseInt(pen.getAttribute('fo')) : 254,
                bc: pen.getAttribute('bc') || '#000000',
                bo: pen.hasAttribute('bo') ? parseInt(pen.getAttribute('bo')) : 0,
                fs: parseInt(pen.getAttribute('fs')) || 0,
                b: pen.getAttribute('b') === '1',
                i: pen.getAttribute('i') === '1',
                u: pen.getAttribute('u') === '1',
                et: parseInt(pen.getAttribute('et')) || 0,
                ec: pen.getAttribute('ec') || '#000000'
            };
        });
        
        // Parsear Paragraphs
        const cues = [];
        doc.querySelectorAll('body > p').forEach(p => {
            const startMs = parseInt(p.getAttribute('t')) || 0;
            const durationMs = parseInt(p.getAttribute('d')) || 0;
            const wpId = p.getAttribute('wp') || '0';
            const wsId = p.getAttribute('ws') || '0';
            
            const wp = windowPositions[wpId] || { ap: 7, ah: 50, av: 90 };
            const ws = windowStyles[wsId] || { ju: 2 };
            
            const spans = [];
            p.querySelectorAll('s').forEach(s => {
                const penId = s.getAttribute('p') || '0';
                const pen = penStyles[penId] || { sz: 100, fc: '#FFFFFF', fo: 254, bo: 0 };
                
                // Capturar time offset para efeito karaokê
                const timeOffset = s.hasAttribute('t') ? parseInt(s.getAttribute('t')) : 0;
                
                let text = s.textContent || '';
                
                // Debug: ver o texto original antes de limpar
                const originalText = text;
                const hasNewline = text.includes('\n');
                
                text = text.replace(/[\u200B\u200C\u200D\uFEFF\u200E\u200F]/g, '');
                
                // Debug para ver quebras de linha
                if (hasNewline) {
                    console.log('YTT LineBreak Debug: original chars:', JSON.stringify(originalText), 'cleaned:', JSON.stringify(text));
                }
                
                // Manter spans com texto, espaços ou quebras de linha
                if (text.trim() || text.includes(' ') || text.includes('\n')) {
                    spans.push({ text, pen, timeOffset });
                }
            });
            
            if (spans.length === 0 || spans.every(s => !s.text.trim())) {
                return;
            }
            
            cues.push({
                start: startMs / 1000,
                end: (startMs + durationMs) / 1000,
                wp, ws, spans
            });
        });
        
        return { cues };
    }
    
    function parseVTT(content) {
        const cues = [];
        const lines = content.split('\n');
        let i = 0;
        
        while (i < lines.length) {
            const line = lines[i].trim();
            const match = line.match(/(\d{2}:\d{2}:\d{2}[.,]\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2}[.,]\d{3})/);
            
            if (match) {
                const start = parseTimestamp(match[1]);
                const end = parseTimestamp(match[2]);
                
                i++;
                let text = '';
                while (i < lines.length && lines[i].trim() !== '') {
                    text += (text ? '\n' : '') + lines[i];
                    i++;
                }
                
                if (text.trim()) {
                    cues.push({
                        start, end,
                        wp: { ap: 7, ah: 50, av: 90 },
                        ws: { ju: 2 },
                        spans: [{ text, pen: { sz: 100, fc: '#FFFFFF', fo: 254, bo: 0, et: 3, ec: '#000000' } }]
                    });
                }
            }
            i++;
        }
        
        return { cues };
    }
    
    function parseTimestamp(ts) {
        ts = ts.replace(',', '.');
        const parts = ts.split(':');
        return parseInt(parts[0]) * 3600 + parseInt(parts[1]) * 60 + parseFloat(parts[2]);
    }
    
    function createOverlay() {
        const video = document.querySelector('video');
        if (!video) {
            console.error('YTT Injector: Video element não encontrado!');
            return;
        }
        
        console.log('YTT Injector: Video encontrado:', video);
        
        // Usar #movie_player que está acima de tudo
        let playerContainer = document.querySelector('#movie_player');
        
        if (!playerContainer) {
            playerContainer = document.querySelector('.html5-video-player');
        }
        
        if (!playerContainer) {
            playerContainer = document.querySelector('.html5-video-container');
        }
        
        if (!playerContainer) {
            playerContainer = video.parentElement;
        }
        
        if (!playerContainer) {
            console.error('YTT Injector: Player container não encontrado!');
            return;
        }
        
        console.log('YTT Injector: Container encontrado:', playerContainer.className || playerContainer.id);
        
        // Remover overlay existente se houver
        const existingOverlay = document.getElementById('ytt-subtitle-overlay');
        if (existingOverlay) existingOverlay.remove();
        
        overlayContainer = document.createElement('div');
        overlayContainer.id = 'ytt-subtitle-overlay';
        overlayContainer.style.cssText = `
            position: absolute !important;
            top: 0 !important; 
            left: 0 !important;
            width: 100% !important; 
            height: 100% !important;
            pointer-events: none !important;
            z-index: 2147483647 !important;
            overflow: hidden !important;
        `;
        
        playerContainer.style.position = 'relative';
        playerContainer.appendChild(overlayContainer);
        
        console.log('YTT Injector: Overlay anexado ao DOM');
        
        injectStyles();
    }
    
    function injectStyles() {
        if (document.getElementById('ytt-injector-styles')) return;
        
        const style = document.createElement('style');
        style.id = 'ytt-injector-styles';
        style.textContent = `
            #ytt-subtitle-overlay { 
                font-family: 'YouTube Noto', Roboto, Arial, sans-serif !important;
                z-index: 2147483647 !important;
            }
            .ytt-cue { 
                position: absolute !important; 
                pointer-events: none !important;
                z-index: 2147483647 !important;
                max-width: none !important;
            }
            .ytt-line {
                display: block !important;
                white-space: nowrap !important;
            }
            .ytt-span { 
                display: inline !important;
                white-space: nowrap !important;
            }
            .ytt-span-hidden {
                visibility: hidden !important;
                opacity: 0 !important;
            }
            .ytt-fs-0 { font-family: 'YouTube Noto', Roboto-Medium, Roboto, Arial, Helvetica, sans-serif !important; }
            .ytt-fs-1 { font-family: 'Courier New', Courier, 'Lucida Console', monospace !important; }
            .ytt-fs-2 { font-family: 'Times New Roman', Times, Georgia, serif !important; }
            .ytt-fs-3 { font-family: 'Deja Vu Sans Mono', 'Lucida Console', Monaco, monospace !important; }
            .ytt-fs-4 { font-family: 'Comic Sans MS', 'Comic Sans', 'Chalkboard SE', 'Comic Neue', cursive !important; }
            .ytt-fs-5 { font-family: 'Monotype Corsiva', 'URW Chancery L', 'Apple Chancery', 'Brush Script MT', cursive !important; }
            .ytt-fs-6 { font-family: 'Carrois Gothic SC', 'Small Caps', 'Alegreya Sans SC', sans-serif !important; font-variant: small-caps !important; }
            .ytt-fs-7 { font-family: Papyrus, 'Herculanum', fantasy !important; }
        `;
        document.head.appendChild(style);
    }
    
    function startSync() {
        if (syncInterval) clearInterval(syncInterval);
        
        syncInterval = setInterval(() => {
            const video = document.querySelector('video');
            if (!video || !subtitleData) return;
            renderCues(video.currentTime);
        }, 25);
    }
    
    function renderCues(currentTime) {
        if (!overlayContainer) {
            console.warn('YTT Injector: overlayContainer não existe!');
            return;
        }
        overlayContainer.innerHTML = '';
        
        const video = document.querySelector('video');
        if (!video) return;
        
        // YouTube usa aproximadamente 1% da altura do vídeo como base para sz=100
        const videoHeight = video.offsetHeight;
        const baseFontSize = videoHeight * 0.01;
        
        // Detectar tela cheia e adicionar +10px
        const isFullscreen = document.fullscreenElement || 
                            document.webkitFullscreenElement || 
                            document.querySelector('.ytp-fullscreen');
        const fullscreenBonus = isFullscreen ? 10 : 0;
        
        const activeCues = subtitleData.cues.filter(cue => 
            currentTime >= cue.start && currentTime < cue.end
        );
        
        if (activeCues.length > 0) {
            console.log('YTT Injector: Renderizando', activeCues.length, 'cues no tempo', currentTime.toFixed(2));
        }
        
        activeCues.forEach(cue => {
            const container = document.createElement('div');
            container.className = 'ytt-cue';
            
            const pos = calculatePosition(cue.wp);
            
            // Debug para verificar posição top-center
            if (cue.wp.ap === 1 || cue.wp.av < 10) {
                console.log('YTT Position Debug (TOP):', 
                    'ap=' + cue.wp.ap, 
                    'ah=' + cue.wp.ah, 
                    'av=' + cue.wp.av,
                    '=> left=' + pos.left, 
                    'top=' + pos.top, 
                    'transform=' + pos.transform,
                    'text=' + cue.spans.map(s => s.text).join('').substring(0, 20));
            }
            
            container.style.left = pos.left;
            container.style.top = pos.top;
            container.style.transform = pos.transform;
            container.style.textAlign = cue.ws.ju === 0 ? 'left' : cue.ws.ju === 1 ? 'right' : 'center';
            
            // Calcular tempo relativo ao início da cue para karaokê
            const relativeTimeMs = (currentTime - cue.start) * 1000;
            
            // Debug karaokê
            const hasKaraoke = cue.spans.some(s => s.timeOffset > 0);
            if (hasKaraoke) {
                console.log('YTT Karaoke: cue start=' + cue.start.toFixed(2) + ', relativeMs=' + relativeTimeMs.toFixed(0) + ', spans:', 
                    cue.spans.map(s => ({text: s.text.substring(0,10), offset: s.timeOffset})));
            }
            
            cue.spans.forEach(spanData => {
                // Se o span é SOMENTE uma quebra de linha, inserir <br> diretamente
                if (spanData.text === '\n' || spanData.text.trim() === '' && spanData.text.includes('\n')) {
                    container.appendChild(document.createElement('br'));
                } else if (spanData.text.includes('\n')) {
                    // Texto com quebras de linha embutidas
                    const parts = spanData.text.split('\n');
                    parts.forEach((part, idx) => {
                        if (part) {
                            const span = document.createElement('span');
                            span.className = 'ytt-span';
                            
                            if (spanData.timeOffset > 0 && relativeTimeMs < spanData.timeOffset) {
                                span.classList.add('ytt-span-hidden');
                            }
                            
                            applyPenStyles(span, spanData.pen, baseFontSize, fullscreenBonus);
                            span.textContent = part;
                            container.appendChild(span);
                        }
                        // Adicionar quebra de linha após cada parte, exceto a última
                        if (idx < parts.length - 1) {
                            container.appendChild(document.createElement('br'));
                        }
                    });
                } else {
                    const span = document.createElement('span');
                    span.className = 'ytt-span';
                    
                    // Efeito Karaokê: esconder spans cujo timeOffset ainda não foi atingido
                    if (spanData.timeOffset > 0 && relativeTimeMs < spanData.timeOffset) {
                        span.classList.add('ytt-span-hidden');
                    }
                    
                    applyPenStyles(span, spanData.pen, baseFontSize, fullscreenBonus);
                    span.textContent = spanData.text;
                    container.appendChild(span);
                }
            });
            
            overlayContainer.appendChild(container);
        });
    }
    
    // Padding das bordas em porcentagem (mantém proporção em tela cheia)
    const EDGE_PADDING = 2; // 2% de padding nas bordas
    
    function calculatePosition(wp) {
        // ap (anchor point) no YTT:
        // 0=top-left    1=top-center    2=top-right
        // 3=mid-left    4=mid-center    5=mid-right
        // 6=bot-left    7=bot-center    8=bot-right
        //
        // Transform [X, Y] para posicionar o ponto âncora corretamente:
        // - X: 0% = âncora na esquerda, -50% = âncora no centro, -100% = âncora na direita
        // - Y: 0% = âncora no topo, -50% = âncora no meio, -100% = âncora embaixo
        const transforms = [
            ['0%', '0%'],      // ap=0: top-left
            ['-50%', '0%'],    // ap=1: top-center (\an8)
            ['-100%', '0%'],   // ap=2: top-right
            ['0%', '-50%'],    // ap=3: mid-left
            ['-50%', '-50%'],  // ap=4: mid-center (\an5)
            ['-100%', '-50%'], // ap=5: mid-right
            ['0%', '-100%'],   // ap=6: bot-left
            ['-50%', '-100%'], // ap=7: bot-center (\an2) - padrão
            ['-100%', '-100%'] // ap=8: bot-right
        ];
        const t = transforms[wp.ap] || ['-50%', '-100%'];
        
        // Aplicar padding nas bordas (mapeia 0-100% para PADDING-(100-PADDING)%)
        // Isso garante que legendas não fiquem coladas nas bordas
        const paddedAh = EDGE_PADDING + (wp.ah * (100 - 2 * EDGE_PADDING) / 100);
        const paddedAv = EDGE_PADDING + (wp.av * (100 - 2 * EDGE_PADDING) / 100);
        
        return {
            left: `${paddedAh}%`,
            top: `${paddedAv}%`,
            transform: `translate(${t[0]}, ${t[1]})`
        };
    }
    
    function applyPenStyles(el, pen, baseFontSize, fullscreenBonus = 0) {
        // sz é uma porcentagem onde 100 = tamanho normal
        // fullscreenBonus adiciona +10px em tela cheia
        const fontSize = Math.max(12, (baseFontSize * (pen.sz / 100)) + 23 + fullscreenBonus);
        el.style.fontSize = `${fontSize}px`;
        el.style.lineHeight = '1.2';
        el.style.color = hexToRGBA(pen.fc, pen.fo / 254);
        
        if (pen.bo > 0) {
            el.style.backgroundColor = hexToRGBA(pen.bc, pen.bo / 254);
            el.style.padding = '2px 4px';
        }
        
        // Aplicar fonte diretamente no style para garantir
        // Usando nomes exatos que o YouTube usa
        const fontFamilies = {
            0: 'Roboto, Arial, sans-serif',
            1: 'Courier New, monospace',
            2: 'Times New Roman, serif',
            3: 'Lucida Console, monospace',
            4: 'Comic Sans MS, Arial, sans-serif',
            5: 'Comic Sans MS, Arial, sans-serif',
            6: 'Carrois Gothic SC, Arial, sans-serif',
            7: 'Papyrus, Arial, sans-serif'
        };
        
        // Debug: ver qual fs está sendo usado
        if (pen.fs !== undefined && pen.fs !== 0) {
            console.log('YTT Font Debug: fs=' + pen.fs + ', font=' + fontFamilies[pen.fs]);
        }
        
        if (pen.fs !== undefined && fontFamilies[pen.fs]) {
            el.style.setProperty('font-family', fontFamilies[pen.fs], 'important');
            if (pen.fs === 6) el.style.fontVariant = 'small-caps';
        }
        
        if (pen.b) el.style.fontWeight = 'bold';
        if (pen.i) el.style.fontStyle = 'italic';
        if (pen.u) el.style.textDecoration = 'underline';
        
        if (pen.et && pen.et > 0) {
            el.style.textShadow = getEdgeEffect(pen.et, pen.ec, fontSize);
        }
    }
    
    function getEdgeEffect(et, color, fontSize) {
        const s = Math.max(1, Math.round(fontSize / 20));
        const b = s * 2;
        
        switch (et) {
            case 1: return `${s}px ${s}px 0 ${color}`;
            case 2: return `${s}px ${s}px 0 ${color}, ${-s}px ${-s}px 0 ${color}`;
            case 3: return `0 0 ${b}px ${color}, ${s}px 0 0 ${color}, ${-s}px 0 0 ${color}, 0 ${s}px 0 ${color}, 0 ${-s}px 0 ${color}, ${s}px ${s}px 0 ${color}, ${-s}px ${-s}px 0 ${color}, ${s}px ${-s}px 0 ${color}, ${-s}px ${s}px 0 ${color}`;
            case 4: return `${s}px ${s}px ${b}px ${color}`;
            default: return 'none';
        }
    }
    
    function hexToRGBA(hex, alpha) {
        if (!hex) return `rgba(255,255,255,${alpha})`;
        hex = hex.replace('#', '');
        if (hex.length === 3) hex = hex[0]+hex[0]+hex[1]+hex[1]+hex[2]+hex[2];
        const r = parseInt(hex.substring(0,2), 16);
        const g = parseInt(hex.substring(2,4), 16);
        const b = parseInt(hex.substring(4,6), 16);
        return `rgba(${r},${g},${b},${alpha})`;
    }
    
    function createToggleButton() {
        // Remover botão existente se houver
        removeToggleButton();
        
        // Encontrar a barra de controles do YouTube
        const rightControls = document.querySelector('.ytp-right-controls');
        if (!rightControls) {
            console.warn('YTT Injector: Controles do player não encontrados');
            return;
        }
        
        // Criar botão no estilo do YouTube
        toggleButton = document.createElement('button');
        toggleButton.className = 'ytp-button ytt-toggle-btn';
        toggleButton.title = 'Legendas YTT (ativadas)';
        toggleButton.setAttribute('aria-label', 'Alternar legendas YTT');
        toggleButton.innerHTML = `
            <svg height="100%" viewBox="0 0 36 36" width="100%">
                <path class="ytt-cc-icon" fill="#fff" d="M11,11 C9.89,11 9,11.9 9,13 L9,23 C9,24.1 9.89,25 11,25 L25,25 C26.1,25 27,24.1 27,23 L27,13 C27,11.9 26.1,11 25,11 L11,11 Z M17,17 L15.5,17 L15.5,16.5 L14,16.5 L14,19.5 L15.5,19.5 L15.5,19 L17,19 L17,20 C17,20.55 16.55,21 16,21 L13.5,21 C12.95,21 12.5,20.55 12.5,20 L12.5,16 C12.5,15.45 12.95,15 13.5,15 L16,15 C16.55,15 17,15.45 17,16 L17,17 Z M23.5,17 L22,17 L22,16.5 L20.5,16.5 L20.5,19.5 L22,19.5 L22,19 L23.5,19 L23.5,20 C23.5,20.55 23.05,21 22.5,21 L20,21 C19.45,21 19,20.55 19,20 L19,16 C19,15.45 19.45,15 20,15 L22.5,15 C23.05,15 23.5,15.45 23.5,16 L23.5,17 Z"></path>
            </svg>
        `;
        
        toggleButton.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            toggleSubtitleVisibility();
        });
        
        // Clique direito para menu de idiomas
        toggleButton.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            e.stopPropagation();
            showLanguageMenu(e);
        });
        
        // Inserir no início dos controles da direita
        if (rightControls.firstChild) {
            rightControls.insertBefore(toggleButton, rightControls.firstChild);
        } else {
            rightControls.appendChild(toggleButton);
        }
        
        // Adicionar estilos do botão
        injectButtonStyles();
        updateToggleButtonState();
        
        console.log('YTT Injector: Botão de toggle criado');
    }
    
    function removeToggleButton() {
        if (toggleButton) {
            toggleButton.remove();
            toggleButton = null;
        }
        const existingBtn = document.querySelector('.ytt-toggle-btn');
        if (existingBtn) existingBtn.remove();
    }
    
    function toggleSubtitleVisibility() {
        subtitlesVisible = !subtitlesVisible;
        
        if (overlayContainer) {
            overlayContainer.style.display = subtitlesVisible ? 'block' : 'none';
        }
        
        updateToggleButtonState();
        console.log('YTT Injector: Legendas', subtitlesVisible ? 'ativadas' : 'desativadas');
    }
    
    function updateToggleButtonState() {
        if (!toggleButton) return;
        
        const icon = toggleButton.querySelector('.ytt-cc-icon');
        if (icon) {
            icon.style.fill = subtitlesVisible ? '#fff' : '#666';
        }
        
        toggleButton.title = subtitlesVisible ? 'Legendas YTT (ativadas)' : 'Legendas YTT (desativadas)';
        toggleButton.classList.toggle('ytt-btn-inactive', !subtitlesVisible);
    }
    
    function injectButtonStyles() {
        if (document.getElementById('ytt-button-styles')) return;
        
        const style = document.createElement('style');
        style.id = 'ytt-button-styles';
        style.textContent = `
            .ytt-toggle-btn {
                position: relative !important;
                width: 48px !important;
                height: 100% !important;
                opacity: 0.9 !important;
                cursor: pointer !important;
                transition: opacity 0.1s ease !important;
            }
            .ytt-toggle-btn:hover {
                opacity: 1 !important;
            }
            .ytt-toggle-btn.ytt-btn-inactive {
                opacity: 0.5 !important;
            }
            .ytt-toggle-btn.ytt-btn-inactive:hover {
                opacity: 0.7 !important;
            }
            .ytt-toggle-btn svg {
                pointer-events: none !important;
            }
            .ytt-toggle-btn::after {
                content: 'YTT' !important;
                position: absolute !important;
                bottom: 2px !important;
                right: 2px !important;
                font-size: 7px !important;
                font-weight: bold !important;
                color: #ff0 !important;
                text-shadow: 1px 1px 1px #000 !important;
            }
            /* Menu de idiomas */
            .ytt-lang-menu {
                position: fixed;
                background: rgba(28, 28, 28, 0.98);
                border-radius: 8px;
                padding: 8px 0;
                min-width: 180px;
                max-height: 300px;
                overflow-y: auto;
                box-shadow: 0 4px 20px rgba(0,0,0,0.7);
                z-index: 2147483647;
                font-family: 'YouTube Sans', Roboto, sans-serif;
                border: 1px solid rgba(255,255,255,0.1);
            }
            .ytt-lang-menu-title {
                padding: 4px 12px 8px;
                font-size: 11px;
                color: #888;
                border-bottom: 1px solid rgba(255,255,255,0.1);
                margin-bottom: 4px;
            }
            .ytt-lang-item {
                display: flex;
                align-items: center;
                padding: 8px 12px;
                cursor: pointer;
                font-size: 13px;
                color: #fff;
                transition: background 0.15s;
            }
            .ytt-lang-item:hover {
                background: rgba(255,255,255,0.1);
            }
            .ytt-lang-item.active {
                background: rgba(255, 0, 0, 0.2);
            }
            .ytt-lang-item .check {
                width: 16px;
                margin-right: 8px;
                color: #0f0;
            }
        `;
        document.head.appendChild(style);
    }
    
    function showLanguageMenu(event) {
        // Fechar menu existente
        closeLanguageMenu();
        
        if (availableLanguages.length === 0) {
            console.log('YTT Injector: Nenhum idioma disponível');
            return;
        }
        
        const menu = document.createElement('div');
        menu.className = 'ytt-lang-menu';
        menu.id = 'ytt-lang-menu';
        
        const title = document.createElement('div');
        title.className = 'ytt-lang-menu-title';
        title.textContent = '🌍 Idiomas disponíveis';
        menu.appendChild(title);
        
        availableLanguages.forEach(lang => {
            const item = document.createElement('div');
            item.className = 'ytt-lang-item' + (lang.code === currentLang ? ' active' : '');
            item.innerHTML = `
                <span class="check">${lang.code === currentLang ? '✓' : ''}</span>
                <span>${lang.name}</span>
            `;
            item.addEventListener('click', (e) => {
                e.stopPropagation();
                switchLanguage(lang.code);
                closeLanguageMenu();
            });
            menu.appendChild(item);
        });
        
        // Adicionar ao body e posicionar
        document.body.appendChild(menu);
        
        // Calcular posição baseada no botão
        const btnRect = toggleButton.getBoundingClientRect();
        const menuRect = menu.getBoundingClientRect();
        
        // Posicionar acima do botão, centralizado
        let left = btnRect.left + (btnRect.width / 2) - (menuRect.width / 2);
        let top = btnRect.top - menuRect.height - 10;
        
        // Garantir que não saia da tela
        if (left < 10) left = 10;
        if (left + menuRect.width > window.innerWidth - 10) left = window.innerWidth - menuRect.width - 10;
        if (top < 10) top = btnRect.bottom + 10; // Se não couber acima, mostrar abaixo
        
        menu.style.left = left + 'px';
        menu.style.top = top + 'px';
        
        // Fechar ao clicar fora
        setTimeout(() => {
            document.addEventListener('click', closeLanguageMenuOnClick);
        }, 100);
    }
    
    function closeLanguageMenu() {
        const menu = document.getElementById('ytt-lang-menu');
        if (menu) menu.remove();
        document.removeEventListener('click', closeLanguageMenuOnClick);
    }
    
    function closeLanguageMenuOnClick(e) {
        if (!e.target.closest('.ytt-lang-menu')) {
            closeLanguageMenu();
        }
    }
    
    function removeSubtitle() {
        if (syncInterval) { clearInterval(syncInterval); syncInterval = null; }
        if (overlayContainer) { overlayContainer.remove(); overlayContainer = null; }
        subtitleData = null;
        currentFileName = null;
        subtitlesVisible = true;
        currentLang = null;
    }
    
    // ============ FUNÇÕES DE API ============
    
    function getVideoId() {
        const urlParams = new URLSearchParams(window.location.search);
        return urlParams.get('v');
    }
    
    function getBrowserLanguage() {
        // Tentar obter idioma do navegador no formato xx-XX
        const lang = navigator.language || navigator.userLanguage || 'en-US';
        return lang;
    }
    
    function normalizeLanguage(lang) {
        // Mapear idiomas curtos para códigos completos
        const langMap = {
            'pt': 'pt-BR', 'en': 'en-US', 'es': 'es-ES', 'fr': 'fr-FR',
            'de': 'de-DE', 'it': 'it-IT', 'ja': 'ja-JP', 'ko': 'ko-KR',
            'zh': 'zh-CN', 'ru': 'ru-RU', 'ar': 'ar-SA'
        };
        
        // Se já está no formato completo, retornar
        if (lang.includes('-')) return lang;
        
        // Senão, mapear
        return langMap[lang.toLowerCase()] || 'en-US';
    }
    
    // Mapa de nomes de idiomas
    const languageNames = {
        'pt-BR': 'Português (Brasil)',
        'pt-PT': 'Português (Portugal)',
        'en-US': 'English (US)',
        'en-GB': 'English (UK)',
        'es-ES': 'Español (España)',
        'es-MX': 'Español (México)',
        'fr-FR': 'Français',
        'de-DE': 'Deutsch',
        'it-IT': 'Italiano',
        'ja-JP': '日本語',
        'ko-KR': '한국어',
        'zh-CN': '中文 (简体)',
        'zh-TW': '中文 (繁體)',
        'ru-RU': 'Русский',
        'ar-SA': 'العربية'
    };
    
    function getLanguageName(code) {
        return languageNames[code] || code;
    }
    
    async function fetchAvailableLanguages(videoId) {
        try {
            const response = await fetch(`${API_URL}/api/subtitles/video/${videoId}`);
            if (response.ok) {
                const data = await response.json();
                // Mapear para o formato esperado com nome do idioma
                availableLanguages = (data.subtitles || []).map(s => ({
                    code: s.language,
                    id: s.id,
                    name: getLanguageName(s.language)
                }));
                console.log('YTT Injector: Idiomas disponíveis:', availableLanguages.map(l => `${l.code} (${l.name})`));
                return availableLanguages;
            }
            return [];
        } catch (err) {
            console.log('YTT Injector: Erro ao buscar idiomas disponíveis');
            return [];
        }
    }
    
    async function fetchSubtitleFromServer(videoId, lang) {
        try {
            // Buscar a legenda pelo ID (primeiro com o idioma correspondente)
            const langInfo = availableLanguages.find(l => l.code === lang);
            if (!langInfo) return null;
            
            const response = await fetch(`${API_URL}/api/subtitles/${langInfo.id}/download`);
            if (response.ok) {
                const data = await response.json();
                console.log(`YTT Injector: Legenda encontrada (${lang}) para`, videoId);
                currentLang = lang;
                return data.content;
            }
            return null;
        } catch (err) {
            console.log('YTT Injector: Servidor não disponível ou sem legenda');
            return null;
        }
    }
    
    async function uploadCurrentSubtitle(content, lang) {
        const videoId = getVideoId();
        if (!videoId) {
            return { success: false, error: 'Nenhum vídeo detectado' };
        }
        
        // Se não especificou idioma, usar idioma do navegador
        if (!lang) {
            lang = normalizeLanguage(getBrowserLanguage());
        }
        
        try {
            // Obter token do storage
            const result = await chrome.storage.local.get(['authToken']);
            if (!result.authToken) {
                return { success: false, error: 'Faça login para enviar legendas' };
            }
            
            const response = await fetch(`${API_URL}/api/subtitles`, {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${result.authToken}`
                },
                body: JSON.stringify({
                    youtubeVideoId: videoId,
                    title: `Legenda ${videoId}`,
                    language: lang,
                    content: content,
                    isPublic: true
                })
            });
            
            const data = await response.json();
            if (response.ok) {
                console.log(`YTT Injector: Legenda enviada para o servidor (${lang}/${videoId})`);
                return { success: true, videoId, lang };
            } else {
                return { success: false, error: data.error };
            }
        } catch (err) {
            return { success: false, error: 'Servidor não disponível' };
        }
    }
    
    async function checkAndLoadSubtitle() {
        const videoId = getVideoId();
        if (!videoId || videoId === currentVideoId) return;
        
        currentVideoId = videoId;
        
        // Se já tem legenda carregada, não buscar
        if (subtitleData) return;
        
        // Buscar idiomas disponíveis
        const available = await fetchAvailableLanguages(videoId);
        if (available.length === 0) {
            console.log('YTT Injector: Nenhuma legenda disponível no servidor');
            return;
        }
        
        // Tentar idioma do navegador primeiro
        const browserLang = normalizeLanguage(getBrowserLanguage());
        let content = null;
        let usedLang = null;
        
        // Verificar se idioma do navegador está disponível
        const browserLangAvailable = available.find(l => l.code === browserLang);
        if (browserLangAvailable) {
            content = await fetchSubtitleFromServer(videoId, browserLang);
            usedLang = browserLang;
        }
        
        // Se não encontrou, tentar variante do mesmo idioma (pt-PT se pt-BR não existe)
        if (!content) {
            const baseLang = browserLang.split('-')[0];
            const variantLang = available.find(l => l.code.startsWith(baseLang + '-'));
            if (variantLang) {
                content = await fetchSubtitleFromServer(videoId, variantLang.code);
                usedLang = variantLang.code;
            }
        }
        
        // Se ainda não encontrou, usar o primeiro disponível
        if (!content && available.length > 0) {
            content = await fetchSubtitleFromServer(videoId, available[0].code);
            usedLang = available[0].code;
        }
        
        if (content) {
            currentFileName = `${videoId}.ytt [${usedLang}]`;
            injectSubtitle(content, 'ytt');
            updateToggleButtonLanguage();
        }
    }
    
    function updateToggleButtonLanguage() {
        if (toggleButton && currentLang) {
            toggleButton.title = `Legenda: ${currentLang}${availableLanguages.length > 1 ? ' (clique direito para trocar)' : ''}`;
        }
    }
    
    async function switchLanguage(lang) {
        const videoId = getVideoId();
        if (!videoId) return;
        
        const content = await fetchSubtitleFromServer(videoId, lang);
        if (content) {
            removeSubtitle();
            currentFileName = `${videoId}.ytt [${lang}]`;
            injectSubtitle(content, 'ytt');
            updateToggleButtonLanguage();
        }
    }
    
    // Auto-detectar mudança de vídeo e buscar legenda
    function initAutoFetch() {
        // Checar ao carregar
        setTimeout(checkAndLoadSubtitle, 1000);
        
        // Observar mudanças na URL (navegação SPA do YouTube)
        let lastUrl = location.href;
        const observer = new MutationObserver(() => {
            if (location.href !== lastUrl) {
                lastUrl = location.href;
                currentVideoId = null;
                removeSubtitle();
                removeToggleButton();
                setTimeout(checkAndLoadSubtitle, 500);
            }
        });
        
        observer.observe(document.body, { childList: true, subtree: true });
    }
    
    // Iniciar auto-fetch
    initAutoFetch();
    
    console.log('YTT Injector: Content script carregado!');
})();
