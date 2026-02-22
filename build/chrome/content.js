// RevoSub Extension - Build: CHROME
// Generated: 2026-02-03T15:42:38.828Z

// YTT Injector - Content Script

(function() {
    'use strict';
    
    // Polyfill para compatibilidade Chrome/Firefox
    const browserAPI = typeof browser !== 'undefined' ? browser : chrome;
    
    /**
     * Helper para internacionalização (i18n)
     * Usa a API nativa de extensões para obter traduções
     */
    function i18n(messageName, substitutions) {
        return browserAPI.i18n.getMessage(messageName, substitutions) || messageName;
    }
    
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
    let currentSubtitleId = null; // ID da legenda da nuvem (para denúncias)
    
    // Carregar preferência salva do usuário
    browserAPI.storage.local.get(['subtitlesVisible'], (result) => {
        if (result.subtitlesVisible !== undefined) {
            subtitlesVisible = result.subtitlesVisible;
            console.log('YTT Injector: Preferência carregada - legendas', subtitlesVisible ? 'ativadas' : 'desativadas');
        }
    });
    
    // Escutar mensagens do popup - SÍNCRONO
    browserAPI.runtime.onMessage.addListener(function(message, sender, sendResponse) {
        const action = message.action;
        
        if (action === 'ping') {
            sendResponse({ pong: true });
        }
        else if (action === 'injectSubtitle') {
            currentFileName = message.fileName || 'legenda';
            currentSubtitleId = message.subtitleId || null; // ID da nuvem para denúncias (null se local)
            // Se tem subtitleId, é legenda da nuvem - define idioma para denúncias
            if (message.subtitleId) {
                currentLang = currentLang || 'pt-BR'; // Mantém idioma atual ou usa padrão
            }
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
        // Preservar valores antes de remover (para re-injeção)
        const savedSubtitleId = currentSubtitleId;
        const savedLang = currentLang;
        
        removeSubtitle();
        
        // Restaurar valores preservados
        currentSubtitleId = savedSubtitleId;
        currentLang = savedLang;
        
        console.log('YTT Injector: Iniciando injeção, formato:', format);
        
        if (format === 'ytt') {
            subtitleData = parseYTT(content);
        } else if (format === 'ass') {
            subtitleData = parseASS(content);
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
    
    // ==================== ASS PARSER COMPLETO ====================
    
    function parseASS(content) {
        const lines = content.split(/\r?\n/);
        const styles = {};
        const cues = [];
        let playResX = 384; // Resolução padrão ASS
        let playResY = 288;
        
        let currentSection = '';
        let formatOrder = [];
        let styleFormatOrder = [];
        
        for (const line of lines) {
            const trimmed = line.trim();
            
            // Detectar seções
            if (trimmed.startsWith('[')) {
                currentSection = trimmed.toLowerCase();
                continue;
            }
            
            // Script Info
            if (currentSection === '[script info]') {
                if (trimmed.startsWith('PlayResX:')) {
                    playResX = parseInt(trimmed.split(':')[1]) || 384;
                } else if (trimmed.startsWith('PlayResY:')) {
                    playResY = parseInt(trimmed.split(':')[1]) || 288;
                }
            }
            
            // V4+ Styles
            if (currentSection === '[v4+ styles]' || currentSection === '[v4 styles]') {
                if (trimmed.startsWith('Format:')) {
                    styleFormatOrder = trimmed.substring(7).split(',').map(s => s.trim().toLowerCase());
                } else if (trimmed.startsWith('Style:')) {
                    const style = parseASSStyle(trimmed.substring(6), styleFormatOrder);
                    if (style) {
                        styles[style.name] = style;
                    }
                }
            }
            
            // Events
            if (currentSection === '[events]') {
                if (trimmed.startsWith('Format:')) {
                    formatOrder = trimmed.substring(7).split(',').map(s => s.trim().toLowerCase());
                } else if (trimmed.startsWith('Dialogue:')) {
                    const cue = parseASSDialogue(trimmed.substring(9), formatOrder, styles, playResX, playResY);
                    if (cue) {
                        cues.push(cue);
                    }
                }
            }
        }
        
        console.log('ASS Parser: Estilos encontrados:', Object.keys(styles));
        console.log('ASS Parser: PlayRes:', playResX, 'x', playResY);
        console.log('ASS Parser: Diálogos:', cues.length);
        
        return { cues, styles, playResX, playResY, isASS: true };
    }
    
    function parseASSStyle(styleData, formatOrder) {
        const parts = styleData.split(',').map(s => s.trim());
        const style = {};
        
        // Valores padrão
        const defaults = {
            name: 'Default',
            fontname: 'Arial',
            fontsize: 20,
            primarycolour: '&H00FFFFFF',
            secondarycolour: '&H000000FF',
            outlinecolour: '&H00000000',
            backcolour: '&H00000000',
            bold: 0,
            italic: 0,
            underline: 0,
            strikeout: 0,
            scalex: 100,
            scaley: 100,
            spacing: 0,
            angle: 0,
            borderstyle: 1,
            outline: 2,
            shadow: 2,
            alignment: 2,
            marginl: 10,
            marginr: 10,
            marginv: 10,
            encoding: 1
        };
        
        // Mapear campos pelo Format
        if (formatOrder.length > 0) {
            formatOrder.forEach((field, idx) => {
                if (idx < parts.length) {
                    style[field] = parts[idx];
                }
            });
        } else {
            // Ordem padrão V4+ Styles
            const defaultOrder = ['name', 'fontname', 'fontsize', 'primarycolour', 'secondarycolour', 
                'outlinecolour', 'backcolour', 'bold', 'italic', 'underline', 'strikeout',
                'scalex', 'scaley', 'spacing', 'angle', 'borderstyle', 'outline', 'shadow',
                'alignment', 'marginl', 'marginr', 'marginv', 'encoding'];
            defaultOrder.forEach((field, idx) => {
                if (idx < parts.length) {
                    style[field] = parts[idx];
                }
            });
        }
        
        // Converter valores numéricos
        // IMPORTANTE: usar !== para não converter 0 para valor default
        ['fontsize', 'bold', 'italic', 'underline', 'strikeout', 'scalex', 'scaley', 
         'spacing', 'angle', 'borderstyle', 'outline', 'shadow', 'alignment',
         'marginl', 'marginr', 'marginv', 'encoding'].forEach(field => {
            if (style[field] !== undefined) {
                const parsed = parseFloat(style[field]);
                style[field] = isNaN(parsed) ? defaults[field] : parsed;
            }
        });
        
        // Converter cores ASS para CSS
        style.primaryColor = assColorToCSS(style.primarycolour);
        style.secondaryColor = assColorToCSS(style.secondarycolour);
        style.outlineColor = assColorToCSS(style.outlinecolour);
        style.backColor = assColorToCSS(style.backcolour);
        
        return style;
    }
    
    function parseASSDialogue(dialogueData, formatOrder, styles, playResX, playResY) {
        const parts = dialogueData.split(',');
        const dialogue = {};
        
        // Mapear campos pelo Format (o Text é sempre o último e pode conter vírgulas)
        const textIndex = formatOrder.indexOf('text');
        formatOrder.forEach((field, idx) => {
            if (field === 'text') {
                dialogue.text = parts.slice(idx).join(',').trim();
            } else if (idx < parts.length) {
                dialogue[field] = parts[idx].trim();
            }
        });
        
        // Parsear timestamps
        const start = parseASSTimestamp(dialogue.start);
        const end = parseASSTimestamp(dialogue.end);
        
        if (isNaN(start) || isNaN(end)) return null;
        
        // Obter estilo base
        const styleName = dialogue.style || 'Default';
        const baseStyle = styles[styleName] || styles['Default'] || getDefaultASSStyle();
        
        // Extrair tags globais da linha (\pos, \move, \fad, \an) ANTES de processar texto
        const globalTags = extractGlobalTags(dialogue.text);
        
        // Mesclar estilo base com overrides globais
        const style = { ...baseStyle, ...globalTags };
        
        // Processar texto com override tags
        const processedText = processASSText(dialogue.text, style, styles);
        
        // Calcular posição baseada no alignment ASS
        const alignment = globalTags.alignment || style.alignment || 2;
        const { ap, ah, av } = assAlignmentToPosition(alignment, dialogue, style, playResX, playResY);
        
        return {
            start,
            end,
            duration: end - start,
            style,
            styleName,
            wp: { ap, ah, av },
            ws: { ju: getJustification(alignment) },
            spans: processedText.spans,
            isASS: true,
            layer: parseInt(dialogue.layer) || 0,
            marginL: parseInt(dialogue.marginl) || style.marginl || 0,
            marginR: parseInt(dialogue.marginr) || style.marginr || 0,
            marginV: parseInt(dialogue.marginv) || style.marginv || 0,
            effect: dialogue.effect || '',
            // Tags globais
            pos: globalTags.pos,
            move: globalTags.move,
            fadeIn: globalTags.fadeIn || 0,
            fadeOut: globalTags.fadeOut || 0,
            clip: globalTags.clip,
            playResX,
            playResY
        };
    }
    
    function extractGlobalTags(text) {
        const tags = {};
        
        // \pos(x,y)
        const posMatch = text.match(/\\pos\s*\(\s*([\d.-]+)\s*,\s*([\d.-]+)\s*\)/);
        if (posMatch) {
            tags.pos = { x: parseFloat(posMatch[1]), y: parseFloat(posMatch[2]) };
        }
        
        // \move(x1,y1,x2,y2[,t1,t2]) - também captura \\move (duas barras)
        const moveMatch = text.match(/\\+move\s*\(\s*([\d.-]+)\s*,\s*([\d.-]+)\s*,\s*([\d.-]+)\s*,\s*([\d.-]+)(?:\s*,\s*([\d.-]+)\s*,\s*([\d.-]+))?\s*\)/);
        if (moveMatch) {
            tags.move = {
                x1: parseFloat(moveMatch[1]),
                y1: parseFloat(moveMatch[2]),
                x2: parseFloat(moveMatch[3]),
                y2: parseFloat(moveMatch[4]),
                t1: moveMatch[5] ? parseFloat(moveMatch[5]) : 0,
                t2: moveMatch[6] ? parseFloat(moveMatch[6]) : null
            };
        }
        
        // \fad(fadeIn, fadeOut) em ms - também captura \\fad
        const fadMatch = text.match(/\\+fad\s*\(\s*([\d.-]+)\s*,\s*([\d.-]+)\s*\)/);
        if (fadMatch) {
            tags.fadeIn = parseFloat(fadMatch[1]);
            tags.fadeOut = parseFloat(fadMatch[2]);
        }
        
        // \an (alignment numpad)
        const anMatch = text.match(/\\an\s*(\d+)/);
        if (anMatch) {
            tags.alignment = parseInt(anMatch[1]);
        }
        
        // \a (legacy alignment)
        const aMatch = text.match(/\\a\s*(\d+)/);
        if (aMatch && !anMatch) {
            tags.alignment = convertLegacyAlignment(parseInt(aMatch[1]));
        }
        
        // \org(x,y)
        const orgMatch = text.match(/\\org\s*\(\s*([\d.-]+)\s*,\s*([\d.-]+)\s*\)/);
        if (orgMatch) {
            tags.org = { x: parseFloat(orgMatch[1]), y: parseFloat(orgMatch[2]) };
        }
        
        // \clip
        const clipMatch = text.match(/\\(i?clip)\s*\(([^)]+)\)/);
        if (clipMatch) {
            tags.clip = { invert: clipMatch[1] === 'iclip', value: clipMatch[2] };
        }
        
        return tags;
    }
    
    function parseASSTimestamp(ts) {
        if (!ts) return NaN;
        const match = ts.match(/(\d+):(\d{2}):(\d{2})\.(\d{2,3})/);
        if (!match) return NaN;
        const hours = parseInt(match[1]);
        const mins = parseInt(match[2]);
        const secs = parseInt(match[3]);
        const ms = match[4].length === 2 ? parseInt(match[4]) * 10 : parseInt(match[4]);
        return hours * 3600 + mins * 60 + secs + ms / 1000;
    }
    
    function assColorToCSS(assColor, alphaOverride) {
        if (!assColor) return 'rgba(255, 255, 255, 1)';
        
        // ASS Color format: &HAABBGGRR (alpha, blue, green, red)
        // Cores inline podem vir como &HBBGGRR& ou &HBBGGRR
        let color = assColor.toString().replace(/&H/gi, '').replace(/&/g, '').replace(/H/gi, '');
        
        // Se tiver 6 chars, é BBGGRR (sem alpha)
        // Se tiver 8 chars, é AABBGGRR
        let alpha = 0;
        let blue, green, red;
        
        if (color.length <= 6) {
            // Pad to 6 characters (BBGGRR)
            while (color.length < 6) {
                color = '0' + color;
            }
            blue = parseInt(color.substring(0, 2), 16);
            green = parseInt(color.substring(2, 4), 16);
            red = parseInt(color.substring(4, 6), 16);
        } else {
            // Pad to 8 characters (AABBGGRR)
            while (color.length < 8) {
                color = '0' + color;
            }
            alpha = parseInt(color.substring(0, 2), 16);
            blue = parseInt(color.substring(2, 4), 16);
            green = parseInt(color.substring(4, 6), 16);
            red = parseInt(color.substring(6, 8), 16);
        }
        
        // ASS alpha: 00 = opaque, FF = transparent
        let cssAlpha = (255 - alpha) / 255;
        if (alphaOverride !== undefined) {
            cssAlpha = alphaOverride;
        }
        
        return `rgba(${red}, ${green}, ${blue}, ${cssAlpha.toFixed(2)})`;
    }
    
    function assAlignmentToPosition(alignment, dialogue, style, playResX, playResY) {
        // ASS Numpad alignment:
        // 7 8 9  (top)
        // 4 5 6  (middle)
        // 1 2 3  (bottom)
        
        let ah = 50; // horizontal center
        let av = 90; // vertical bottom
        let ap = 7;  // anchor point
        
        // Horizontal
        switch (alignment % 3) {
            case 1: ah = 5; ap = (alignment <= 3) ? 1 : (alignment <= 6) ? 4 : 7; break;  // Left
            case 2: ah = 50; ap = (alignment <= 3) ? 2 : (alignment <= 6) ? 5 : 8; break; // Center
            case 0: ah = 95; ap = (alignment <= 3) ? 3 : (alignment <= 6) ? 6 : 9; break; // Right
        }
        
        // Vertical
        if (alignment >= 7) {
            av = 5;  // Top
        } else if (alignment >= 4) {
            av = 50; // Middle
        } else {
            av = 95; // Bottom
        }
        
        return { ap, ah, av };
    }
    
    function getJustification(alignment) {
        switch (alignment % 3) {
            case 1: return 0; // Left
            case 2: return 2; // Center
            case 0: return 1; // Right
        }
        return 2;
    }
    
    function getDefaultASSStyle() {
        return {
            name: 'Default',
            fontname: 'Arial',
            fontsize: 20,
            primaryColor: 'rgba(255, 255, 255, 1)',
            secondaryColor: 'rgba(255, 0, 0, 1)',
            outlineColor: 'rgba(0, 0, 0, 1)',
            backColor: 'rgba(0, 0, 0, 0.5)',
            bold: 0,
            italic: 0,
            underline: 0,
            outline: 2,
            shadow: 2,
            alignment: 2,
            marginl: 10,
            marginr: 10,
            marginv: 10,
            scalex: 100,
            scaley: 100
        };
    }
    
    function processASSText(text, baseStyle, allStyles) {
        // Processar override tags e karaokê
        const spans = [];
        let currentStyle = { ...baseStyle };
        let currentText = '';
        let i = 0;
        let karaokeTime = 0; // Acumulador de tempo de karaokê em ms
        
        // Substituir quebras de linha ANTES de processar
        // \N = quebra de linha hard, \n = quebra soft (depende de WrapStyle)
        text = text.replace(/\\N/g, '\n').replace(/\\n/g, '\n').replace(/\\h/g, '\u00A0'); // \h = non-breaking space
        
        while (i < text.length) {
            if (text[i] === '{') {
                // Encontrar fim da tag
                const endBrace = text.indexOf('}', i);
                if (endBrace === -1) {
                    currentText += text[i];
                    i++;
                    continue;
                }
                
                const tagContent = text.substring(i + 1, endBrace);
                
                // Verificar se é comentário {* ... } - ignorar
                if (tagContent.startsWith('*')) {
                    // É um comentário, extrair apenas as tags válidas depois do *
                    const validTags = tagContent.substring(1); // Remover o *
                    if (validTags.includes('\\')) {
                        // Tem tags válidas após o comentário
                        // Salvar texto anterior se houver
                        if (currentText) {
                            const span = createASSSpan(currentText, currentStyle, karaokeTime);
                            spans.push(span);
                            if (currentStyle.karaokeDuration) {
                                karaokeTime += currentStyle.karaokeDuration;
                            }
                            currentText = '';
                        }
                        currentStyle = processOverrideTags(validTags, currentStyle, allStyles);
                    }
                    // Se não tem tags válidas, só ignora o bloco
                    i = endBrace + 1;
                    continue;
                }
                
                // Salvar texto anterior se houver
                if (currentText) {
                    const span = createASSSpan(currentText, currentStyle, karaokeTime);
                    spans.push(span);
                    // Se tinha karaokê, incrementar o tempo
                    if (currentStyle.karaokeDuration) {
                        karaokeTime += currentStyle.karaokeDuration;
                    }
                    currentText = '';
                }
                
                // Processar override tags
                currentStyle = processOverrideTags(tagContent, currentStyle, allStyles);
                
                i = endBrace + 1;
            } else {
                currentText += text[i];
                i++;
            }
        }
        
        // Adicionar texto restante
        if (currentText) {
            const span = createASSSpan(currentText, currentStyle, karaokeTime);
            spans.push(span);
        }
        
        return { spans };
    }
    
    function createASSSpan(text, style, karaokeOffset) {
        return {
            text,
            karaokeOffset: karaokeOffset || 0, // Quando este span deve aparecer (ms desde início da cue)
            karaokeDuration: style.karaokeDuration || 0,
            karaokeType: style.karaokeType || null,
            pen: {
                sz: style.fontsize || 100,
                fc: style.primaryColor || 'rgba(255, 255, 255, 1)',
                fo: 254,
                bc: style.backColor || 'transparent',
                bo: style.backColor ? 192 : 0,
                et: style.outline > 0 ? 3 : (style.shadow > 0 ? 1 : 0),
                ec: style.outlineColor || 'rgba(0, 0, 0, 1)',
                fs: getFontStyleId(style.fontname),
                b: style.bold,
                i: style.italic,
                u: style.underline
            },
            style: { ...style },
            isASS: true
        };
    }
    
    function getFontStyleId(fontName) {
        if (!fontName) return 0;
        const fn = fontName.toLowerCase();
        
        if (fn.includes('courier')) return 1;
        if (fn.includes('times')) return 2;
        if (fn.includes('lucida') || fn.includes('consolas') || fn.includes('mono')) return 3;
        if (fn.includes('comic') || fn.includes('impact')) return 5;
        if (fn.includes('corsiva') || fn.includes('chancery') || fn.includes('dancing')) return 6;
        if (fn.includes('carrois') || fn.includes('small caps')) return 7;
        
        return 0; // Roboto/Arial
    }
    
    function processOverrideTags(tagString, currentStyle, allStyles) {
        const style = { ...currentStyle };
        
        // PRÉ-PROCESSAMENTO: Extrair \t(...) primeiro porque pode conter outras tags dentro
        // Aceita tanto ) quanto } como fechamento (tolerância a erros comuns em arquivos ASS)
        const tAnimations = [];
        let processedTagString = tagString.replace(/\\t\(([^)}]*(?:\([^)]*\)[^)}]*)*)[)}]?/gi, (match, content) => {
            if (content) {
                tAnimations.push(content);
            }
            return ''; // Remove da string para não processar novamente
        });
        
        // Armazenar animações
        if (tAnimations.length > 0) {
            if (!style.animations) style.animations = [];
            style.animations = style.animations.concat(tAnimations);
        }
        
        // Regex para encontrar tags ASS (inclui tags com números como \1c, \2c, \3c, \1a, etc)
        const tagRegex = /\\(\d?[a-zA-Z]+)([^\\]*)/g;
        let match;
        
        while ((match = tagRegex.exec(processedTagString)) !== null) {
            const tag = match[1].toLowerCase();
            const value = match[2].trim();
            
            switch (tag) {
                case 'b':
                    // \b pode ser 0, 1, ou peso (100-900)
                    if (value === '' || value === '1') {
                        style.bold = 1;
                    } else if (value === '0') {
                        style.bold = 0;
                    } else {
                        const weight = parseInt(value);
                        style.bold = weight >= 700 ? 1 : 0;
                    }
                    break;
                case 'i':
                    style.italic = value === '1' || value === '' ? 1 : parseInt(value) || 0;
                    break;
                case 'u':
                    style.underline = value === '1' || value === '' ? 1 : parseInt(value) || 0;
                    break;
                case 's':
                    style.strikeout = value === '1' || value === '' ? 1 : parseInt(value) || 0;
                    break;
                case 'fn':
                    style.fontname = value || currentStyle.fontname;
                    break;
                case 'fs':
                    style.fontsize = parseFloat(value) || currentStyle.fontsize;
                    break;
                case 'fscx':
                    style.scalex = parseFloat(value) || 100;
                    break;
                case 'fscy':
                    style.scaley = parseFloat(value) || 100;
                    break;
                case 'fsp':
                    style.spacing = parseFloat(value) || 0;
                    break;
                case 'c':
                case '1c':
                    style.primaryColor = assColorToCSS(value);
                    break;
                case '2c':
                    style.secondaryColor = assColorToCSS(value);
                    break;
                case '3c':
                    style.outlineColor = assColorToCSS(value);
                    break;
                case '4c':
                    style.backColor = assColorToCSS(value);
                    break;
                case 'alpha':
                    // Global alpha
                    const a = parseInt(value.replace('&H', '').replace('&', ''), 16) || 0;
                    style.alpha = (255 - a) / 255;
                    break;
                case '1a':
                    style.primaryAlpha = parseASSAlpha(value);
                    break;
                case '2a':
                    style.secondaryAlpha = parseASSAlpha(value);
                    break;
                case '3a':
                    style.outlineAlpha = parseASSAlpha(value);
                    break;
                case '4a':
                    style.backAlpha = parseASSAlpha(value);
                    break;
                case 'bord':
                    style.outline = parseFloat(value) || 0;
                    break;
                case 'shad':
                    style.shadow = parseFloat(value) || 0;
                    break;
                case 'be':
                    style.blur = parseFloat(value) || 0;
                    break;
                case 'blur':
                    style.blur = parseFloat(value) || 0;
                    break;
                case 'frx':
                    style.rotateX = parseFloat(value) || 0;
                    break;
                case 'fry':
                    style.rotateY = parseFloat(value) || 0;
                    break;
                case 'frz':
                case 'fr':
                    style.rotateZ = parseFloat(value) || 0;
                    break;
                case 'fax':
                    style.shearX = parseFloat(value) || 0;
                    break;
                case 'fay':
                    style.shearY = parseFloat(value) || 0;
                    break;
                case 'an':
                    style.alignment = parseInt(value) || 2;
                    break;
                case 'a':
                    // Legacy alignment (1-11)
                    style.alignment = convertLegacyAlignment(parseInt(value) || 2);
                    break;
                case 'pos':
                    // \pos(x,y)
                    const posMatch = value.match(/\(([^,]+),([^)]+)\)/);
                    if (posMatch) {
                        style.posX = parseFloat(posMatch[1]);
                        style.posY = parseFloat(posMatch[2]);
                    }
                    break;
                case 'move':
                    // \move(x1,y1,x2,y2[,t1,t2])
                    const moveMatch = value.match(/\(([^,]+),([^,]+),([^,]+),([^,)]+)(?:,([^,]+),([^)]+))?\)/);
                    if (moveMatch) {
                        style.move = {
                            x1: parseFloat(moveMatch[1]),
                            y1: parseFloat(moveMatch[2]),
                            x2: parseFloat(moveMatch[3]),
                            y2: parseFloat(moveMatch[4]),
                            t1: moveMatch[5] ? parseFloat(moveMatch[5]) : null,
                            t2: moveMatch[6] ? parseFloat(moveMatch[6]) : null
                        };
                    }
                    break;
                case 'org':
                    // \org(x,y) - origin for rotation
                    const orgMatch = value.match(/\(([^,]+),([^)]+)\)/);
                    if (orgMatch) {
                        style.orgX = parseFloat(orgMatch[1]);
                        style.orgY = parseFloat(orgMatch[2]);
                    }
                    break;
                case 'fad':
                case 'fade':
                    // \fad(in,out) or \fade(a1,a2,a3,t1,t2,t3,t4)
                    const fadMatch = value.match(/\(([^)]+)\)/);
                    if (fadMatch) {
                        const fadParts = fadMatch[1].split(',').map(p => parseFloat(p.trim()));
                        if (fadParts.length === 2) {
                            style.fadeIn = fadParts[0];
                            style.fadeOut = fadParts[1];
                        }
                    }
                    break;
                case 'clip':
                case 'iclip':
                    // Clipping - armazenar para uso no render
                    style.clip = value;
                    style.clipInvert = tag === 'iclip';
                    break;
                case 'r':
                    // Reset to style
                    if (value && allStyles[value]) {
                        Object.assign(style, allStyles[value]);
                    } else if (allStyles['Default']) {
                        Object.assign(style, allStyles['Default']);
                    }
                    break;
                case 'k':
                case 'kf':
                case 'ko':
                case 'K':
                    // Karaokê - duração em centésimos de segundo
                    // O valor é o tempo que o PRÓXIMO texto leva para ser "preenchido"
                    style.karaokeDuration = parseInt(value) * 10 || 0; // Converter para ms
                    style.karaokeType = tag.toLowerCase();
                    break;
                case 't':
                    // Ignorar - já processado no pré-processamento
                    break;
                case 'p':
                    // Drawing mode
                    style.drawing = parseInt(value) || 0;
                    break;
            }
        }
        
        return style;
    }
    
    function parseASSAlpha(value) {
        const a = parseInt(value.replace('&H', '').replace('&', ''), 16) || 0;
        return (255 - a) / 255;
    }
    
    // Parse e aplica animações \t
    function parseAndApplyAnimations(style, relativeTimeMs, cueDurationMs) {
        if (!style.animations || style.animations.length === 0) return style;
        
        const animatedStyle = { ...style };
        
        for (const animStr of style.animations) {
            // Parse animation parameters
            // Formats: style, accel\style, t1,t2\style, t1,t2,accel\style
            let t1 = 0;
            let t2 = cueDurationMs;
            let accel = 1;
            let styleStr = animStr;
            
            // Try to extract timing and accel
            // Pattern: numbers at start are timing, followed by style tags starting with \
            const timingMatch = animStr.match(/^([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?,?\s*\\(.+)/);
            const accelOnlyMatch = animStr.match(/^([\d.]+)\s*,\s*\\(.+)/);
            const styleOnlyMatch = animStr.match(/^\\(.+)/);
            
            if (timingMatch) {
                t1 = parseFloat(timingMatch[1]);
                t2 = parseFloat(timingMatch[2]);
                if (timingMatch[3]) accel = parseFloat(timingMatch[3]);
                styleStr = '\\' + timingMatch[4];
            } else if (accelOnlyMatch) {
                accel = parseFloat(accelOnlyMatch[1]);
                styleStr = '\\' + accelOnlyMatch[2];
            } else if (styleOnlyMatch) {
                styleStr = '\\' + styleOnlyMatch[1];
            }
            
            // Calculate progress (0 to 1)
            let progress = 0;
            if (relativeTimeMs <= t1) {
                progress = 0;
            } else if (relativeTimeMs >= t2) {
                progress = 1;
            } else if (t2 > t1) {
                progress = (relativeTimeMs - t1) / (t2 - t1);
            }
            
            // Apply acceleration
            if (accel !== 1) {
                progress = Math.pow(progress, accel);
            }
            
            // Parse target style values
            const tagRegex = /\\(\d?[a-zA-Z]+)([^\\]*)/g;
            let match;
            while ((match = tagRegex.exec(styleStr)) !== null) {
                const tag = match[1].toLowerCase();
                const value = match[2].trim();
                
                // Interpolate based on tag type
                switch (tag) {
                    case 'fs':
                        const targetFs = parseFloat(value);
                        const currentFs = animatedStyle.fontsize || 20;
                        animatedStyle.fontsize = currentFs + (targetFs - currentFs) * progress;
                        break;
                    case 'c':
                    case '1c':
                        if (progress > 0) {
                            animatedStyle.primaryColor = interpolateColor(
                                animatedStyle.primaryColor || 'rgba(255,255,255,1)',
                                assColorToCSS(value),
                                progress
                            );
                        }
                        break;
                    case '3c':
                        if (progress > 0) {
                            animatedStyle.outlineColor = interpolateColor(
                                animatedStyle.outlineColor || 'rgba(0,0,0,1)',
                                assColorToCSS(value),
                                progress
                            );
                        }
                        break;
                    case '4c':
                        if (progress > 0) {
                            animatedStyle.backColor = interpolateColor(
                                animatedStyle.backColor || 'rgba(0,0,0,0.5)',
                                assColorToCSS(value),
                                progress
                            );
                        }
                        break;
                    case 'fscx':
                        const targetScaleX = parseFloat(value) || 100;
                        const currentScaleX = animatedStyle.scalex || 100;
                        animatedStyle.scalex = currentScaleX + (targetScaleX - currentScaleX) * progress;
                        break;
                    case 'fscy':
                        const targetScaleY = parseFloat(value) || 100;
                        const currentScaleY = animatedStyle.scaley || 100;
                        animatedStyle.scaley = currentScaleY + (targetScaleY - currentScaleY) * progress;
                        break;
                    case 'frz':
                    case 'fr':
                        const targetRotZ = parseFloat(value) || 0;
                        const currentRotZ = animatedStyle.rotateZ || 0;
                        animatedStyle.rotateZ = currentRotZ + (targetRotZ - currentRotZ) * progress;
                        break;
                    case 'alpha':
                    case '1a':
                        const targetAlpha = parseASSAlpha(value);
                        const currentAlpha = animatedStyle.primaryAlpha !== undefined ? animatedStyle.primaryAlpha : 1;
                        animatedStyle.primaryAlpha = currentAlpha + (targetAlpha - currentAlpha) * progress;
                        break;
                }
            }
        }
        
        return animatedStyle;
    }
    
    // Interpola entre duas cores RGBA
    function interpolateColor(color1, color2, progress) {
        const parse = (c) => {
            const m = c.match(/rgba?\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+))?\s*\)/);
            if (m) return { r: parseInt(m[1]), g: parseInt(m[2]), b: parseInt(m[3]), a: parseFloat(m[4] || 1) };
            return { r: 255, g: 255, b: 255, a: 1 };
        };
        
        const c1 = parse(color1);
        const c2 = parse(color2);
        
        const r = Math.round(c1.r + (c2.r - c1.r) * progress);
        const g = Math.round(c1.g + (c2.g - c1.g) * progress);
        const b = Math.round(c1.b + (c2.b - c1.b) * progress);
        const a = c1.a + (c2.a - c1.a) * progress;
        
        return `rgba(${r}, ${g}, ${b}, ${a.toFixed(2)})`;
    }

    function convertLegacyAlignment(a) {
        // Legacy ASS alignment (1-11) to numpad (1-9)
        const map = { 1: 1, 2: 2, 3: 3, 5: 7, 6: 8, 7: 9, 9: 4, 10: 5, 11: 6 };
        return map[a] || 2;
    }
    
    // ==================== FIM ASS PARSER ====================
    
    function createOverlay() {
        const video = document.querySelector('video');
        if (!video) {
            console.error('YTT Injector: Video element não encontrado!');
            return;
        }
        
        console.log('YTT Injector: Video encontrado:', video);
        
        // Usar #movie_player que contém todo o player
        let playerContainer = document.querySelector('#movie_player');
        
        if (!playerContainer) {
            playerContainer = document.querySelector('.html5-video-player');
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
            pointer-events: none !important;
            z-index: 2147483647 !important;
            overflow: hidden !important;
        `;
        
        // Aplicar preferência salva do usuário
        overlayContainer.style.display = subtitlesVisible ? 'block' : 'none';
        
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
                white-space: nowrap !important;
                font-size: 0 !important; /* Remove espaços entre spans inline */
            }
            .ytt-line {
                display: block !important;
                white-space: nowrap !important;
            }
            .ytt-span { 
                display: inline !important;
                white-space: pre !important;
            }
            .ytt-span-hidden {
                visibility: hidden !important;
                opacity: 0 !important;
            }
            .ytt-fs-0 { font-family: 'YouTube Noto', Roboto, 'Arial Unicode Ms', Arial, Helvetica, Verdana, 'PT Sans Caption', sans-serif !important; }
            .ytt-fs-1 { font-family: 'Courier New', Courier, 'Nimbus Mono L', 'Cutive Mono', monospace !important; }
            .ytt-fs-2 { font-family: 'Times New Roman', Times, Georgia, Cambria, 'PT Serif Caption', serif !important; }
            .ytt-fs-3 { font-family: 'Lucida Console', 'DejaVu Sans Mono', Monaco, Consolas, 'PT Mono', monospace !important; }
            .ytt-fs-4 { font-family: 'YouTube Noto', Roboto, Arial, sans-serif !important; } /* ID 4 não usado, fallback para Roboto */
            .ytt-fs-5 { font-family: 'Comic Sans MS', Impact, Handlee, fantasy !important; }
            .ytt-fs-6 { font-family: 'Monotype Corsiva', 'URW Chancery L', 'Apple Chancery', 'Dancing Script', cursive !important; }
            .ytt-fs-7 { font-family: 'Carrois Gothic SC', sans-serif !important; font-variant: small-caps !important; }
            
            /* ASS-specific styles */
            .ytt-ass-span {
                display: inline !important;
                white-space: pre !important;
                margin: 0 !important;
                padding: 0 !important;
                word-spacing: normal !important;
            }
            .ytt-ass-karaoke {
                transition: color 0.05s linear !important;
            }
            .ytt-cue.ytt-ass-cue {
                transform-style: preserve-3d !important;
                perspective: 1000px !important;
                word-spacing: normal !important;
                letter-spacing: normal !important;
                font-size: 0 !important; /* Remove espaços entre spans inline */
            }
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
        
        // Obter posição e dimensões reais do vídeo
        const videoRect = video.getBoundingClientRect();
        const playerContainer = overlayContainer.parentElement;
        const playerRect = playerContainer.getBoundingClientRect();
        
        // Calcular offset do vídeo dentro do player (para modo teatro)
        const videoOffsetX = videoRect.left - playerRect.left;
        const videoOffsetY = videoRect.top - playerRect.top;
        
        // Atualizar posição e tamanho do overlay para cobrir exatamente o vídeo
        overlayContainer.style.left = videoOffsetX + 'px';
        overlayContainer.style.top = videoOffsetY + 'px';
        overlayContainer.style.width = videoRect.width + 'px';
        overlayContainer.style.height = videoRect.height + 'px';
        
        // YouTube usa aproximadamente 1% da altura do vídeo como base para sz=100
        const videoHeight = videoRect.height;
        const videoWidth = videoRect.width;
        const baseFontSize = videoHeight * 0.01;
        
        // Detectar tela cheia e adicionar +10px
        const isFullscreen = document.fullscreenElement || 
                            document.webkitFullscreenElement || 
                            document.querySelector('.ytp-fullscreen');
        
        // Detectar modo teatro (wide player)
        const isTheater = document.querySelector('ytd-watch-flexy[theater]') !== null ||
                         document.querySelector('.ytd-watch-flexy[theater]') !== null ||
                         document.body.classList.contains('no-sidebar');
        
        // Bônus de tamanho: +10px em fullscreen, +5px em teatro
        const fullscreenBonus = isFullscreen ? 10 : (isTheater ? 5 : 0);
        
        // Verificar se é ASS para calcular escala
        const isASS = subtitleData.isASS || false;
        const playResX = subtitleData.playResX || 384;
        const playResY = subtitleData.playResY || 288;
        const scaleX = videoWidth / playResX;
        const scaleY = videoHeight / playResY;
        
        const activeCues = subtitleData.cues.filter(cue => 
            currentTime >= cue.start && currentTime < cue.end
        );
        
        // Ordenar por layer para ASS
        if (isASS) {
            activeCues.sort((a, b) => (a.layer || 0) - (b.layer || 0));
        }
        
        if (activeCues.length > 0) {
            console.log('YTT Injector: Renderizando', activeCues.length, 'cues no tempo', currentTime.toFixed(2));
        }
        
        activeCues.forEach(cue => {
            const container = document.createElement('div');
            container.className = 'ytt-cue';
            
            // Calcular tempo relativo ao início da cue para karaokê/animações
            const relativeTimeMs = (currentTime - cue.start) * 1000;
            const cueDurationMs = (cue.end - cue.start) * 1000;
            
            // Renderização ASS com posicionamento absoluto
            if (cue.isASS) {
                renderASSCue(container, cue, relativeTimeMs, cueDurationMs, videoWidth, videoHeight, scaleX, scaleY, baseFontSize, fullscreenBonus);
            } else {
                // Renderização YTT padrão
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
            }
            
            overlayContainer.appendChild(container);
        });
    }
    
    function renderASSCue(container, cue, relativeTimeMs, cueDurationMs, videoWidth, videoHeight, scaleX, scaleY, baseFontSize, fullscreenBonus) {
        const style = cue.style || {};
        container.classList.add('ytt-ass-cue');
        
        // Posicionamento ASS
        let posX, posY;
        let transform = '';
        const alignment = style.alignment || 2;
        
        // Prioridade: \move > \pos > alignment+margins
        if (cue.move) {
            // Animação \move(x1,y1,x2,y2[,t1,t2])
            const move = cue.move;
            const t1 = move.t1 || 0;
            const t2 = move.t2 !== null ? move.t2 : cueDurationMs;
            
            let progress = 0;
            if (relativeTimeMs <= t1) {
                progress = 0;
            } else if (relativeTimeMs >= t2) {
                progress = 1;
            } else {
                progress = (relativeTimeMs - t1) / (t2 - t1);
            }
            
            posX = move.x1 + (move.x2 - move.x1) * progress;
            posY = move.y1 + (move.y2 - move.y1) * progress;
        } else if (cue.pos) {
            // Posição fixa \pos(x,y)
            posX = cue.pos.x;
            posY = cue.pos.y;
        } else {
            // Posicionamento por alignment e margens
            const marginL = (cue.marginL || style.marginl || 10);
            const marginR = (cue.marginR || style.marginr || 10);
            const marginV = (cue.marginV || style.marginv || 10);
            
            // Horizontal
            switch (alignment % 3) {
                case 1: posX = marginL; break; // Left
                case 0: posX = cue.playResX - marginR; break; // Right
                default: posX = cue.playResX / 2; break; // Center
            }
            
            // Vertical
            if (alignment >= 7) {
                posY = marginV; // Top
            } else if (alignment >= 4) {
                posY = cue.playResY / 2; // Middle
            } else {
                posY = cue.playResY - marginV; // Bottom
            }
        }
        
        // Converter coordenadas ASS para pixels do vídeo
        const left = posX * scaleX;
        const top = posY * scaleY;
        
        container.style.left = left + 'px';
        container.style.top = top + 'px';
        transform = getASSTransform(alignment);
        
        // Aplicar rotações se existirem
        if (style.rotateX) transform += ` rotateX(${style.rotateX}deg)`;
        if (style.rotateY) transform += ` rotateY(${style.rotateY}deg)`;
        if (style.rotateZ) transform += ` rotateZ(${-style.rotateZ}deg)`;
        
        container.style.transform = transform;
        if (style.rotateX || style.rotateY || style.rotateZ) {
            container.style.transformStyle = 'preserve-3d';
        }
        
        // Fade in/out
        let opacity = 1;
        const fadeIn = cue.fadeIn || 0;
        const fadeOut = cue.fadeOut || 0;
        
        if (fadeIn > 0 && relativeTimeMs < fadeIn) {
            opacity = relativeTimeMs / fadeIn;
        } else if (fadeOut > 0 && relativeTimeMs > (cueDurationMs - fadeOut)) {
            opacity = Math.max(0, (cueDurationMs - relativeTimeMs) / fadeOut);
        }
        container.style.opacity = Math.max(0, Math.min(1, opacity));
        
        // Justificação
        container.style.textAlign = (alignment % 3 === 1) ? 'left' : (alignment % 3 === 0) ? 'right' : 'center';
        
        // Renderizar spans
        cue.spans.forEach(spanData => {
            if (!spanData.text) return;
            
            // Processar quebras de linha
            const lines = spanData.text.split('\n');
            lines.forEach((lineText, lineIdx) => {
                if (lineIdx > 0) {
                    container.appendChild(document.createElement('br'));
                }
                
                if (!lineText) return;
                
                const span = document.createElement('span');
                span.className = 'ytt-span ytt-ass-span';
                
                let spanStyle = spanData.style || style;
                
                // Aplicar animações \t se existirem
                if (spanStyle.animations && spanStyle.animations.length > 0) {
                    spanStyle = parseAndApplyAnimations(spanStyle, relativeTimeMs, cueDurationMs);
                }
                
                // Aplicar estilos ASS
                applyASSStyles(span, spanStyle, scaleX, scaleY, baseFontSize, fullscreenBonus);
                
                // Karaokê ASS
                const kOffset = spanData.karaokeOffset || 0;
                const kDuration = spanData.karaokeDuration || 0;
                const kType = spanData.karaokeType;
                
                if (kDuration > 0 || kOffset > 0) {
                    if (relativeTimeMs < kOffset) {
                        // Ainda não chegou - usar cor secundária e esconder outline/shadow/background
                        span.style.color = spanStyle.secondaryColor || 'rgba(255, 0, 0, 1)';
                        // Esconder text-shadow (outline e sombra) antes do karaokê revelar
                        span.style.textShadow = 'none';
                        // Esconder background para BorderStyle 3
                        span.style.backgroundColor = 'transparent';
                    } else if (kType === 'kf' && relativeTimeMs < kOffset + kDuration) {
                        // Karaokê com preenchimento gradual (\kf)
                        const progress = (relativeTimeMs - kOffset) / kDuration;
                        const primaryColor = spanStyle.primaryColor || 'rgba(255, 255, 255, 1)';
                        const secondaryColor = spanStyle.secondaryColor || 'rgba(255, 0, 0, 1)';
                        span.style.background = `linear-gradient(to right, ${primaryColor} ${progress * 100}%, ${secondaryColor} ${progress * 100}%)`;
                        span.style.webkitBackgroundClip = 'text';
                        span.style.webkitTextFillColor = 'transparent';
                        span.style.backgroundClip = 'text';
                    }
                    // else: já passou do offset, usa cor primária normal com outline/shadow
                }
                
                span.textContent = lineText;
                container.appendChild(span);
            });
        });
    }
    
    function applyASSStyles(el, style, scaleX, scaleY, baseFontSize, fullscreenBonus) {
        // Fonte
        const fontFamily = getASSFontFamily(style.fontname);
        el.style.fontFamily = fontFamily;
        
        // Tamanho da fonte (escalar proporcionalmente)
        // ASS fontsize é em pixels na resolução PlayRes, então escalar diretamente
        // Em tela pequena, adicionar bônus para não ficar muito pequeno
        const smallScreenBonus = fullscreenBonus === 0 ? 4 : 0;
        const fontSize = Math.max(14, (style.fontsize || 20) * scaleY * 0.75 + fullscreenBonus + smallScreenBonus);
        el.style.fontSize = `${fontSize}px`;
        el.style.lineHeight = '1.2';
        
        // Escala X/Y
        if ((style.scalex && style.scalex !== 100) || (style.scaley && style.scaley !== 100)) {
            el.style.transform = `scale(${(style.scalex || 100) / 100}, ${(style.scaley || 100) / 100})`;
            el.style.display = 'inline-block';
        }
        
        // Espaçamento entre letras
        if (style.spacing) {
            el.style.letterSpacing = `${style.spacing * scaleX}px`;
        }
        
        // Cor primária - pode ter alpha override via \1a
        let primaryColor = style.primaryColor || 'rgba(255, 255, 255, 1)';
        if (style.primaryAlpha !== undefined) {
            // Aplicar alpha override
            primaryColor = applyAlphaToColor(primaryColor, style.primaryAlpha);
        }
        if (style.alpha !== undefined) {
            primaryColor = applyAlphaToColor(primaryColor, style.alpha);
        }
        el.style.color = primaryColor;
        
        // Bold, Italic, Underline, Strikeout
        if (style.bold) el.style.fontWeight = 'bold';
        if (style.italic) el.style.fontStyle = 'italic';
        
        let textDecoration = '';
        if (style.underline) textDecoration += 'underline ';
        if (style.strikeout) textDecoration += 'line-through ';
        if (textDecoration) el.style.textDecoration = textDecoration.trim();
        
        // Outline (bord) e Shadow (shad)
        const shadows = [];
        
        // Cor do outline - pode ter alpha override via \3a
        let outlineColor = style.outlineColor || 'rgba(0, 0, 0, 1)';
        if (style.outlineAlpha !== undefined) {
            outlineColor = applyAlphaToColor(outlineColor, style.outlineAlpha);
        }
        
        // Cor da sombra/fundo - pode ter alpha override via \4a
        let shadowColor = style.backColor || 'rgba(0, 0, 0, 0.5)';
        if (style.backAlpha !== undefined) {
            shadowColor = applyAlphaToColor(shadowColor, style.backAlpha);
        }
        
        // BorderStyle 3 = caixa opaca (fundo sólido)
        // No ASS, BorderStyle 3 usa OutlineColour como cor da caixa de fundo!
        const borderStyle = style.borderstyle || 1;
        if (borderStyle === 3) {
            // Usar outlineColor como fundo (comportamento ASS padrão)
            el.style.backgroundColor = outlineColor;
            el.style.padding = '2px 6px';
            el.style.borderRadius = '2px';
        }
        
        // Outline (somente para borderstyle 1)
        const outlineSize = style.outline || 0;
        if (outlineSize > 0 && borderStyle !== 3) {
            // Multiplicador maior para outline mais agressivo (similar ao Aegisub/VLC)
            const outline = Math.max(1.5, outlineSize * scaleY * 0.85);
            // Criar outline mais preciso com mais passos para suavidade
            const steps = Math.max(12, Math.ceil(outline * 6));
            for (let i = 0; i < steps; i++) {
                const angle = (i / steps) * 2 * Math.PI;
                const x = Math.cos(angle) * outline;
                const y = Math.sin(angle) * outline;
                shadows.push(`${x.toFixed(1)}px ${y.toFixed(1)}px 0 ${outlineColor}`);
            }
            // Camadas extras para outline mais sólido e denso
            shadows.push(`0 0 ${outline * 0.3}px ${outlineColor}`);
            shadows.push(`0 0 ${outline * 0.6}px ${outlineColor}`);
        }
        
        // Shadow (não usar para borderstyle 3, ou se shadow = 0)
        const shadowSize = style.shadow || 0;
        if (shadowSize > 0 && borderStyle !== 3) {
            // Sombra sólida estilo Aegisub - preenche o espaço entre texto e sombra
            const shadow = shadowSize * scaleY * 2.0;
            const blur = style.blur ? style.blur * scaleY : 0;
            // Criar várias camadas intermediárias para efeito de sombra sólida/3D
            const steps = Math.max(4, Math.ceil(shadow / 2));
            for (let i = 1; i <= steps; i++) {
                const offset = (shadow / steps) * i;
                shadows.push(`${offset}px ${offset}px ${blur}px ${shadowColor}`);
            }
        }
        
        // Blur extra (sem shadow)
        if (style.blur > 0 && shadowSize === 0 && outlineSize > 0) {
            shadows.push(`0 0 ${style.blur * scaleY}px ${outlineColor}`);
        }
        
        // Aplicar text-shadow ou remover completamente
        if (shadows.length > 0) {
            el.style.textShadow = shadows.join(', ');
        } else {
            // Garantir que não há nenhum text-shadow quando outline=0 e shadow=0
            el.style.textShadow = 'none';
        }
    }
    
    function applyAlphaToColor(color, alpha) {
        // Extrair rgba e substituir alpha
        const match = color.match(/rgba?\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*[\d.]+)?\s*\)/);
        if (match) {
            return `rgba(${match[1]}, ${match[2]}, ${match[3]}, ${alpha.toFixed(2)})`;
        }
        return color;
    }
    
    function getASSFontFamily(fontName) {
        if (!fontName) return '"YouTube Noto", Roboto, Arial, sans-serif';
        
        // Mapeamento de fontes comuns para fallbacks web
        const fontMap = {
            'arial': '"Arial", "Helvetica Neue", Helvetica, sans-serif',
            'arial black': '"Arial Black", "Arial Bold", Gadget, sans-serif',
            'comic sans ms': '"Comic Sans MS", cursive, sans-serif',
            'courier new': '"Courier New", Courier, monospace',
            'georgia': 'Georgia, serif',
            'impact': 'Impact, Haettenschweiler, "Arial Narrow Bold", sans-serif',
            'lucida console': '"Lucida Console", "Lucida Sans Typewriter", monaco, monospace',
            'lucida sans unicode': '"Lucida Sans Unicode", "Lucida Grande", sans-serif',
            'palatino linotype': '"Palatino Linotype", "Book Antiqua", Palatino, serif',
            'tahoma': 'Tahoma, Geneva, sans-serif',
            'times new roman': '"Times New Roman", Times, serif',
            'trebuchet ms': '"Trebuchet MS", Helvetica, sans-serif',
            'verdana': 'Verdana, Geneva, sans-serif',
            'webdings': 'Webdings',
            'wingdings': 'Wingdings, "Zapf Dingbats"',
            'ms gothic': '"MS Gothic", "MS PGothic", sans-serif',
            'ms mincho': '"MS Mincho", "MS PMincho", serif',
            'meiryo': 'Meiryo, "Meiryo UI", sans-serif',
            'malgun gothic': '"Malgun Gothic", sans-serif',
            'microsoft yahei': '"Microsoft YaHei", sans-serif',
            'simsun': 'SimSun, serif',
            'simhei': 'SimHei, sans-serif',
            'noto sans': '"Noto Sans", sans-serif',
            'noto serif': '"Noto Serif", serif',
            'roboto': 'Roboto, "Helvetica Neue", sans-serif',
            'open sans': '"Open Sans", sans-serif',
            'lato': 'Lato, sans-serif',
            'montserrat': 'Montserrat, sans-serif',
            'source sans pro': '"Source Sans Pro", sans-serif',
            'raleway': 'Raleway, sans-serif',
            'ubuntu': 'Ubuntu, sans-serif',
            'oswald': 'Oswald, sans-serif',
            'pt sans': '"PT Sans", sans-serif',
            'droid sans': '"Droid Sans", sans-serif',
            'fira sans': '"Fira Sans", sans-serif'
        };
        
        const lowerFont = fontName.toLowerCase();
        if (fontMap[lowerFont]) {
            return fontMap[lowerFont];
        }
        
        // Retornar a fonte original com fallbacks
        return `"${fontName}", "YouTube Noto", Roboto, Arial, sans-serif`;
    }
    
    function getASSTransform(alignment) {
        // Numpad alignment para transform
        // 7 8 9
        // 4 5 6
        // 1 2 3
        const transforms = {
            1: 'translate(0%, -100%)',    // bottom-left
            2: 'translate(-50%, -100%)',  // bottom-center
            3: 'translate(-100%, -100%)', // bottom-right
            4: 'translate(0%, -50%)',     // middle-left
            5: 'translate(-50%, -50%)',   // middle-center
            6: 'translate(-100%, -50%)',  // middle-right
            7: 'translate(0%, 0%)',       // top-left
            8: 'translate(-50%, 0%)',     // top-center
            9: 'translate(-100%, 0%)'     // top-right
        };
        return transforms[alignment] || 'translate(-50%, -100%)';
    }
    
    function calculateASSPosition(alignment, marginL, marginR, marginV, videoWidth, videoHeight) {
        let left, top, transform;
        
        // Horizontal
        switch (alignment % 3) {
            case 1: // Left
                left = marginL + 'px';
                break;
            case 0: // Right (3, 6, 9)
                left = (videoWidth - marginR) + 'px';
                break;
            default: // Center (2, 5, 8)
                left = '50%';
                break;
        }
        
        // Vertical
        if (alignment >= 7) {
            // Top
            top = marginV + 'px';
        } else if (alignment >= 4) {
            // Middle
            top = '50%';
        } else {
            // Bottom
            top = (videoHeight - marginV) + 'px';
        }
        
        transform = getASSTransform(alignment);
        
        return { left, top, transform };
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
        // mudar tamanho da fonte
        // Multiplicador de 1.06 para aumentar fonte em 6%
        const fontSize = Math.max(12, ((baseFontSize * (pen.sz / 100)) + 23 + fullscreenBonus) * 1.09);
        el.style.fontSize = `${fontSize}px`;
        el.style.lineHeight = '1.2';
        el.style.color = hexToRGBA(pen.fc, pen.fo / 254);
        
        if (pen.bo > 0) {
            el.style.backgroundColor = hexToRGBA(pen.bc, pen.bo / 254);
            el.style.padding = '2px 4px';
        }
        
        // Aplicar fonte diretamente no style para garantir
        // Mapeamento exato do YTSubConverter (YouTube font IDs)
        const fontFamilies = {
            0: '"YouTube Noto", Roboto, "Arial Unicode Ms", Arial, Helvetica, Verdana, "PT Sans Caption", sans-serif',
            1: '"Courier New", Courier, "Nimbus Mono L", "Cutive Mono", monospace',
            2: '"Times New Roman", Times, Georgia, Cambria, "PT Serif Caption", serif',
            3: '"Lucida Console", "DejaVu Sans Mono", Monaco, Consolas, "PT Mono", monospace',
            4: 'Roboto, Arial, sans-serif', // ID 4 não existe no YouTube, fallback
            5: '"Comic Sans MS", Impact, Handlee, fantasy',
            6: '"Monotype Corsiva", "URW Chancery L", "Apple Chancery", "Dancing Script", cursive',
            7: '"Carrois Gothic SC", sans-serif'
        };
        
        // Debug: ver qual fs está sendo usado
        if (pen.fs !== undefined && pen.fs !== 0) {
            console.log('YTT Font Debug: fs=' + pen.fs + ', font=' + fontFamilies[pen.fs]);
        }
        
        if (pen.fs !== undefined && fontFamilies[pen.fs]) {
            el.style.setProperty('font-family', fontFamilies[pen.fs], 'important');
            if (pen.fs === 7) el.style.fontVariant = 'small-caps'; // Carrois Gothic SC usa small-caps
        }
        
        if (pen.b) el.style.fontWeight = 'bold';
        if (pen.i) el.style.fontStyle = 'italic';
        if (pen.u) el.style.textDecoration = 'underline';
        
        if (pen.et && pen.et > 0) {
            el.style.textShadow = getEdgeEffect(pen.et, pen.ec, fontSize);
        }
    }
    
    function getEdgeEffect(et, color, fontSize) {
        const s = Math.max(1, Math.round(fontSize / 20)); // tamanho base da sombra
        const b = Math.max(3, Math.round(fontSize / 14)); // blur para soft shadow
        
        switch (et) {
            // Case 1: Drop Shadow - Sombra dura diagonal (sem blur)
            case 1: 
                return `${s}px ${s}px 0 ${color}, ${s+1}px ${s+1}px 0 ${color}`;
            
            // Case 2: Raised - Texto elevado com profundidade 3D
            case 2: {
                const layers = [];
                const depth = Math.max(2, Math.min(4, s));
                for (let i = 1; i <= depth; i++) {
                    layers.push(`${i}px ${i}px 0 ${color}`);
                }
                return layers.join(', ');
            }
            
            // Case 3: Depressed/Uniform - Contorno uniforme ao redor do texto
            case 3: {
                // Outline sólido nas 8 direções cardeais
                const o = Math.max(1, Math.min(s, 3)); // até 3px de outline
                return `
                    ${o}px 0 0 ${color},
                    -${o}px 0 0 ${color},
                    0 ${o}px 0 ${color},
                    0 -${o}px 0 ${color},
                    ${o}px ${o}px 0 ${color},
                    -${o}px ${o}px 0 ${color},
                    ${o}px -${o}px 0 ${color},
                    -${o}px -${o}px 0 ${color}
                `.trim().replace(/\s+/g, ' ');
            }
            
            // Case 4: Soft Shadow - Sombra suave com blur (diferente do case 1)
            case 4: 
                return `${s}px ${s}px ${b}px ${color}, ${s*1.5}px ${s*1.5}px ${b*1.5}px ${color}`;
            
            default: 
                return 'none';
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
        
        // Salvar preferência do usuário
        browserAPI.storage.local.set({ subtitlesVisible: subtitlesVisible });
        
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
        
        // Determinar o tipo de legenda atual
        const subtitleType = (subtitleData && subtitleData.isASS) ? 'ASS' : 'YTT';
        toggleButton.setAttribute('data-format', subtitleType);
        
        toggleButton.title = subtitlesVisible 
            ? `Legendas ${subtitleType} (ativadas) - Clique direito para idiomas` 
            : `Legendas ${subtitleType} (desativadas)`;
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
                content: attr(data-format) !important;
                position: absolute !important;
                bottom: 4px !important;
                left: 50% !important;
                transform: translateX(-50%) !important;
                font-size: 8px !important;
                font-weight: bold !important;
                color: #ff0 !important;
                text-shadow: 1px 1px 2px #000, -1px -1px 2px #000 !important;
                letter-spacing: 0.5px !important;
            }
            .ytt-toggle-btn[data-format="ASS"]::after {
                color: #0ff !important;
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
            /* Tooltip de notificação */
            .ytt-notification-tooltip {
                position: fixed;
                background: #fff;
                color: #1a1a1a;
                padding: 10px 14px;
                border-radius: 8px;
                font-size: 13px;
                font-family: 'YouTube Sans', Roboto, Arial, sans-serif;
                font-weight: 500;
                white-space: nowrap;
                box-shadow: 0 4px 15px rgba(0, 0, 0, 0.25);
                z-index: 2147483647;
                pointer-events: none;
                opacity: 0;
                animation: ytt-tooltip-fade 5s ease-in-out forwards;
            }
            .ytt-notification-tooltip::after {
                content: '';
                position: absolute;
                top: 100%;
                left: 50%;
                transform: translateX(-50%);
                border: 6px solid transparent;
                border-top-color: #fff;
            }
            @keyframes ytt-tooltip-fade {
                0% { opacity: 0; transform: translateY(5px); }
                10% { opacity: 1; transform: translateY(0); }
                80% { opacity: 1; transform: translateY(0); }
                100% { opacity: 0; transform: translateY(-5px); }
            }
            @keyframes ytt-toast-fade {
                0% { opacity: 0; transform: translateX(-50%) translateY(10px); }
                10% { opacity: 1; transform: translateX(-50%) translateY(0); }
                80% { opacity: 1; transform: translateX(-50%) translateY(0); }
                100% { opacity: 0; transform: translateX(-50%) translateY(-10px); }
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
        title.textContent = 'Idiomas disponíveis';
        menu.appendChild(title);
        
        availableLanguages.forEach(lang => {
            const item = document.createElement('div');
            item.className = 'ytt-lang-item' + (lang.code === currentLang ? ' active' : '');
            item.innerHTML = `
                <span class="check">${lang.code === currentLang ? '●' : ''}</span>
                <span>${lang.name}</span>
            `;
            item.addEventListener('click', (e) => {
                e.stopPropagation();
                switchLanguage(lang.code);
                closeLanguageMenu();
            });
            menu.appendChild(item);
        });
        
        // Adicionar separador e opção de denunciar (só se tem legenda ativa da nuvem)
        console.log('YTT Injector: Menu - currentSubtitleId:', currentSubtitleId, 'currentLang:', currentLang);
        if (currentSubtitleId) {
            console.log('YTT Injector: Adicionando opção de denunciar');
            const separator = document.createElement('div');
            separator.style.cssText = 'border-top: 1px solid rgba(255,255,255,0.1); margin: 8px 0;';
            menu.appendChild(separator);
            
            const reportItem = document.createElement('div');
            reportItem.className = 'ytt-lang-item ytt-report-item';
            reportItem.innerHTML = `
                <span class="check" style="color: #ff4757;">!</span>
                <span style="color: #ff4757;">${i18n('reportSubtitle')}</span>
            `;
            reportItem.addEventListener('click', (e) => {
                e.stopPropagation();
                closeLanguageMenu();
                showReportModal();
            });
            menu.appendChild(reportItem);
        }
        
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
    
    // ============ FUNÇÕES DE DENÚNCIA ============
    
    function showReportModal() {
        // Verificar se tem legenda ativa
        if (!currentSubtitleId) {
            console.log('YTT Injector: No cloud subtitle to report');
            return;
        }
        
        // Verificar se usuário está logado
        browserAPI.storage.local.get(['authToken'], (result) => {
            if (!result.authToken) {
                alert(i18n('loginToReport'));
                return;
            }
            
            createReportModal(result.authToken);
        });
    }
    
    function createReportModal(authToken) {
        // Remover modal existente
        const existingModal = document.getElementById('ytt-report-modal');
        if (existingModal) existingModal.remove();
        
        const overlay = document.createElement('div');
        overlay.id = 'ytt-report-modal';
        overlay.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0,0,0,0.8);
            z-index: 2147483647;
            display: flex;
            align-items: center;
            justify-content: center;
            font-family: 'YouTube Sans', Roboto, sans-serif;
        `;
        
        const modal = document.createElement('div');
        modal.style.cssText = `
            background: #282828;
            border-radius: 12px;
            padding: 24px;
            width: 320px;
            max-width: 90%;
            color: #fff;
        `;
        
        modal.innerHTML = `
            <h3 style="margin: 0 0 16px; font-size: 18px; font-weight: 600;">${i18n('reportTitle')}</h3>
            <p style="color: #aaa; font-size: 13px; margin-bottom: 16px;">${i18n('reportLanguageLabel')} ${currentLang}</p>
            
            <label style="display: block; margin-bottom: 8px; font-size: 13px; color: #aaa;">${i18n('reportReasonLabel')}</label>
            <select id="ytt-report-reason" style="
                width: 100%;
                padding: 10px 12px;
                border: 1px solid rgba(255,255,255,0.2);
                border-radius: 8px;
                background: #1a1a1a;
                color: #fff;
                font-size: 14px;
                margin-bottom: 16px;
                cursor: pointer;
            ">
                <option value="wrong_sync">${i18n('reasonWrongSync')}</option>
                <option value="wrong_language">${i18n('reasonWrongLanguage')}</option>
                <option value="offensive">${i18n('reasonOffensive')}</option>
                <option value="spam">${i18n('reasonSpam')}</option>
                <option value="copyright">${i18n('reasonCopyright')}</option>
                <option value="other">${i18n('reasonOther')}</option>
            </select>
            
            <label style="display: block; margin-bottom: 8px; font-size: 13px; color: #aaa;">${i18n('reportDescriptionLabel')}</label>
            <textarea id="ytt-report-description" placeholder="${i18n('reportDescriptionPlaceholder')}" style="
                width: 100%;
                padding: 10px 12px;
                border: 1px solid rgba(255,255,255,0.2);
                border-radius: 8px;
                background: #1a1a1a;
                color: #fff;
                font-size: 14px;
                margin-bottom: 16px;
                min-height: 80px;
                resize: vertical;
                box-sizing: border-box;
            "></textarea>
            
            <div style="display: flex; gap: 8px; justify-content: flex-end;">
                <button id="ytt-report-cancel" style="
                    padding: 10px 20px;
                    border: none;
                    border-radius: 8px;
                    background: #444;
                    color: #fff;
                    font-size: 14px;
                    cursor: pointer;
                ">${i18n('cancel')}</button>
                <button id="ytt-report-submit" style="
                    padding: 10px 20px;
                    border: none;
                    border-radius: 8px;
                    background: #ff4757;
                    color: #fff;
                    font-size: 14px;
                    font-weight: 600;
                    cursor: pointer;
                ">${i18n('send')}</button>
            </div>
        `;
        
        overlay.appendChild(modal);
        document.body.appendChild(overlay);
        
        // Event listeners
        document.getElementById('ytt-report-cancel').addEventListener('click', () => {
            overlay.remove();
        });
        
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) overlay.remove();
        });
        
        document.getElementById('ytt-report-submit').addEventListener('click', async () => {
            const reason = document.getElementById('ytt-report-reason').value;
            const description = document.getElementById('ytt-report-description').value;
            
            const submitBtn = document.getElementById('ytt-report-submit');
            submitBtn.disabled = true;
            submitBtn.textContent = '...';
            
            try {
                const response = await fetch(`${API_URL}/api/reports`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${authToken}`
                    },
                    body: JSON.stringify({
                        subtitleId: currentSubtitleId,
                        reason: reason,
                        description: description || null,
                        youtubeVideoId: getVideoId(),
                        language: currentLang
                    })
                });
                
                const data = await response.json();
                
                if (response.ok) {
                    overlay.remove();
                    showReportSuccess();
                } else {
                    alert(data.error || i18n('reportError'));
                    submitBtn.disabled = false;
                    submitBtn.textContent = i18n('send');
                }
            } catch (err) {
                alert(i18n('reportError'));
                submitBtn.disabled = false;
                submitBtn.textContent = i18n('send');
            }
        });
    }
    
    function showReportSuccess() {
        const toast = document.createElement('div');
        toast.style.cssText = `
            position: fixed;
            bottom: 80px;
            left: 50%;
            transform: translateX(-50%);
            background: #2ed573;
            color: #fff;
            padding: 12px 24px;
            border-radius: 8px;
            font-family: 'YouTube Sans', Roboto, sans-serif;
            font-size: 14px;
            font-weight: 600;
            z-index: 2147483647;
            box-shadow: 0 4px 12px rgba(0,0,0,0.3);
            animation: ytt-toast-fade 3s ease-in-out forwards;
        `;
        toast.textContent = i18n('reportSuccess');
        document.body.appendChild(toast);
        
        setTimeout(() => {
            if (toast.parentNode) toast.remove();
        }, 3000);
    }
    
    function removeSubtitle() {
        if (syncInterval) { clearInterval(syncInterval); syncInterval = null; }
        if (overlayContainer) { overlayContainer.remove(); overlayContainer = null; }
        subtitleData = null;
        currentFileName = null;
        // NÃO resetar subtitlesVisible aqui - manter preferência do usuário
        currentLang = null;
        currentSubtitleId = null; // Resetar ID da legenda
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
        'ar-SA': 'العربية',
        'tr-TR': 'Türkçe',
        'tr': 'Türkçe',
        'id-ID': 'Bahasa Indonesia',
        'id': 'Bahasa Indonesia',
        'th-TH': 'ไทย',
        'th': 'ไทย',
        'vi-VN': 'Tiếng Việt',
        'vi': 'Tiếng Việt',
        'pl-PL': 'Polski',
        'pl': 'Polski',
        'nl-NL': 'Nederlands',
        'nl': 'Nederlands',
        'sv-SE': 'Svenska',
        'sv': 'Svenska',
        'da-DK': 'Dansk',
        'da': 'Dansk',
        'no-NO': 'Norsk',
        'no': 'Norsk',
        'fi-FI': 'Suomi',
        'fi': 'Suomi',
        'cs-CZ': 'Čeština',
        'cs': 'Čeština',
        'hu-HU': 'Magyar',
        'hu': 'Magyar',
        'ro-RO': 'Română',
        'ro': 'Română',
        'el-GR': 'Ελληνικά',
        'el': 'Ελληνικά',
        'he-IL': 'עברית',
        'he': 'עברית',
        'hi-IN': 'हिन्दी',
        'hi': 'हिन्दी',
        'bn-BD': 'বাংলা',
        'bn': 'বাংলা',
        'uk-UA': 'Українська',
        'uk': 'Українська',
        'ms-MY': 'Bahasa Melayu',
        'ms': 'Bahasa Melayu',
        'tl-PH': 'Tagalog',
        'tl': 'Tagalog',
        'fa-IR': 'فارسی',
        'fa': 'فارسی'
    };
    
    function getLanguageName(code) {
        return languageNames[code] || code;
    }
    
    async function fetchAvailableLanguages(videoId) {
        try {
            const response = await fetch(`${API_URL}/api/subtitles/video/${videoId}`);
            if (response.ok) {
                const data = await response.json();
                // Mapear para o formato esperado com nome do idioma e formato
                availableLanguages = (data.subtitles || []).map(s => ({
                    code: s.language,
                    id: s.id,
                    name: getLanguageName(s.language),
                    format: s.format || 'ytt' // Guardar o formato da legenda
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
            console.log('YTT Injector: fetchSubtitleFromServer - availableLanguages:', availableLanguages);
            const langInfo = availableLanguages.find(l => l.code === lang);
            console.log('YTT Injector: fetchSubtitleFromServer - langInfo:', langInfo);
            if (!langInfo) return null;
            
            const response = await fetch(`${API_URL}/api/subtitles/${langInfo.id}/download`);
            if (response.ok) {
                const data = await response.json();
                console.log(`YTT Injector: Legenda encontrada (${lang}, formato: ${langInfo.format}) para`, videoId);
                currentLang = lang;
                currentSubtitleId = langInfo.id; // Salvar ID para denúncias
                console.log('YTT Injector: Definido currentSubtitleId:', currentSubtitleId, 'currentLang:', currentLang);
                // Retornar objeto com conteúdo e formato
                return {
                    content: data.content,
                    format: langInfo.format || detectSubtitleFormat(data.content)
                };
            }
            return null;
        } catch (err) {
            console.log('YTT Injector: Servidor não disponível ou sem legenda');
            return null;
        }
    }
    
    // Detectar formato da legenda pelo conteúdo
    function detectSubtitleFormat(content) {
        if (!content) return 'ytt';
        const trimmed = content.trim();
        
        // ASS/SSA: começa com [Script Info] ou tem Format:/Style:/Dialogue:
        if (trimmed.includes('[Script Info]') || 
            trimmed.includes('[V4+ Styles]') || 
            trimmed.includes('[V4 Styles]') ||
            trimmed.includes('[Events]')) {
            return 'ass';
        }
        
        // VTT: começa com WEBVTT
        if (trimmed.startsWith('WEBVTT')) {
            return 'vtt';
        }
        
        // YTT: é XML com tag <timedtext>
        if (trimmed.startsWith('<?xml') || trimmed.startsWith('<timedtext')) {
            return 'ytt';
        }
        
        // Default
        return 'ytt';
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
            const result = await browserAPI.storage.local.get(['authToken']);
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
                    format: detectSubtitleFormat(content), // Enviar formato detectado
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
        let result = null; // { content, format }
        let usedLang = null;
        
        // Verificar se idioma do navegador está disponível
        const browserLangAvailable = available.find(l => l.code === browserLang);
        if (browserLangAvailable) {
            result = await fetchSubtitleFromServer(videoId, browserLang);
            usedLang = browserLang;
        }
        
        // Se não encontrou, tentar variante do mesmo idioma (pt-PT se pt-BR não existe)
        if (!result) {
            const baseLang = browserLang.split('-')[0];
            const variantLang = available.find(l => l.code.startsWith(baseLang + '-'));
            if (variantLang) {
                result = await fetchSubtitleFromServer(videoId, variantLang.code);
                usedLang = variantLang.code;
            }
        }
        
        // Se ainda não encontrou, usar o primeiro disponível
        if (!result && available.length > 0) {
            result = await fetchSubtitleFromServer(videoId, available[0].code);
            usedLang = available[0].code;
        }
        
        if (result && result.content) {
            const format = result.format || 'ytt';
            const ext = format === 'ass' ? 'ass' : (format === 'vtt' ? 'vtt' : 'ytt');
            currentFileName = `${videoId}.${ext} [${usedLang}]`;
            injectSubtitle(result.content, format);
            updateToggleButtonLanguage();
            console.log(`YTT Injector: Legenda injetada automaticamente (${format}/${usedLang})`);
            
            // Mostrar notificação se legendas estão desativadas
            setTimeout(() => showSubtitleNotification(), 500);
        }
    }
    
    function updateToggleButtonLanguage() {
        if (toggleButton && currentLang) {
            toggleButton.title = `Legenda: ${currentLang}${availableLanguages.length > 1 ? ' (clique direito para trocar)' : ''}`;
        }
    }
    
    function showSubtitleNotification() {
        // Só mostrar se legendas estão desativadas
        if (subtitlesVisible) return;
        if (!toggleButton) return;
        
        // Remover tooltip existente
        const existing = document.querySelector('.ytt-notification-tooltip');
        if (existing) existing.remove();
        
        // Criar tooltip
        const tooltip = document.createElement('div');
        tooltip.className = 'ytt-notification-tooltip';
        tooltip.textContent = 'Legendas disponíveis para esse vídeo!';
        
        // Adicionar ao body para evitar corte por overflow
        document.body.appendChild(tooltip);
        
        // Calcular posição baseada no botão
        const btnRect = toggleButton.getBoundingClientRect();
        const tooltipRect = tooltip.getBoundingClientRect();
        
        // Posicionar acima do botão, centralizado
        let left = btnRect.left + (btnRect.width / 2) - (tooltipRect.width / 2);
        let top = btnRect.top - tooltipRect.height - 12;
        
        // Garantir que não saia da tela
        if (left < 10) left = 10;
        if (left + tooltipRect.width > window.innerWidth - 10) {
            left = window.innerWidth - tooltipRect.width - 10;
        }
        if (top < 10) top = btnRect.bottom + 12; // Se não couber acima, mostrar abaixo
        
        tooltip.style.left = left + 'px';
        tooltip.style.top = top + 'px';
        
        console.log('YTT Injector: Mostrando notificação de legendas disponíveis');
        
        // Remover após a animação (5s)
        setTimeout(() => {
            if (tooltip.parentNode) {
                tooltip.remove();
            }
        }, 5100);
    }
    
    async function switchLanguage(lang) {
        const videoId = getVideoId();
        if (!videoId) return;
        
        const result = await fetchSubtitleFromServer(videoId, lang);
        if (result && result.content) {
            removeSubtitle();
            const format = result.format || 'ytt';
            const ext = format === 'ass' ? 'ass' : (format === 'vtt' ? 'vtt' : 'ytt');
            currentFileName = `${videoId}.${ext} [${lang}]`;
            injectSubtitle(result.content, format);
            updateToggleButtonLanguage();
            console.log(`YTT Injector: Idioma trocado para ${lang} (${format})`);
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
