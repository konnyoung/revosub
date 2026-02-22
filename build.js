/**
 * RevoSub Extension Build Script
 * 
 * Gera versões para Chrome e Firefox a partir do código fonte único.
 * 
 * Uso: node build.js [chrome|firefox|all]
 * 
 * Exemplos:
 *   node build.js          # Gera ambas as versões
 *   node build.js chrome   # Gera apenas Chrome
 *   node build.js firefox  # Gera apenas Firefox
 */

const fs = require('fs');
const path = require('path');

// Configuração
const SRC_DIR = path.join(__dirname, 'src');
const BUILD_DIR = path.join(__dirname, 'build');
const MANIFESTS_DIR = path.join(__dirname, 'manifests');

// Arquivos a serem copiados
const FILES_TO_COPY = [
    'content.js',
    'content.css',
    'popup.html',
    'popup.js',
    'background.js'
];

// Pastas a serem copiadas
const DIRS_TO_COPY = [
    'icons',
    '_locales'
];

/**
 * Cria diretório se não existir
 */
function ensureDir(dir) {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
        console.log(`  📁 Criado: ${path.relative(__dirname, dir)}`);
    }
}

/**
 * Copia arquivo
 */
function copyFile(src, dest) {
    fs.copyFileSync(src, dest);
}

/**
 * Copia diretório recursivamente
 */
function copyDir(src, dest) {
    ensureDir(dest);
    const entries = fs.readdirSync(src, { withFileTypes: true });
    
    for (const entry of entries) {
        const srcPath = path.join(src, entry.name);
        const destPath = path.join(dest, entry.name);
        
        if (entry.isDirectory()) {
            copyDir(srcPath, destPath);
        } else {
            copyFile(srcPath, destPath);
        }
    }
}

/**
 * Limpa diretório de build
 */
function cleanBuildDir(target) {
    const targetDir = path.join(BUILD_DIR, target);
    if (fs.existsSync(targetDir)) {
        try {
            fs.rmSync(targetDir, { recursive: true, force: true });
        } catch (err) {
            console.log(`  ⚠️  Não foi possível limpar ${target}/ - pasta em uso?`);
            console.log(`     Feche programas que estejam usando essa pasta.`);
            console.log(`     Erro: ${err.message}`);
            throw err;
        }
    }
    ensureDir(targetDir);
}

/**
 * Aplica transformações específicas do browser no código
 */
function transformCode(content, target) {
    // O polyfill browserAPI já está no código, não precisa de transformação
    // Mas podemos adicionar um comentário identificando a versão
    const header = `// RevoSub Extension - Build: ${target.toUpperCase()}\n// Generated: ${new Date().toISOString()}\n\n`;
    return header + content;
}

/**
 * Constrói para um target específico (chrome ou firefox)
 */
function build(target) {
    console.log(`\n🔨 Building for ${target.toUpperCase()}...`);
    
    const targetDir = path.join(BUILD_DIR, target);
    cleanBuildDir(target);
    
    // Copiar arquivos JS/HTML/CSS
    let copied = 0;
    for (const file of FILES_TO_COPY) {
        const srcFile = path.join(SRC_DIR, file);
        const destFile = path.join(targetDir, file);
        
        if (fs.existsSync(srcFile)) {
            let content = fs.readFileSync(srcFile, 'utf8');
            
            // Aplicar transformações em arquivos JS
            if (file.endsWith('.js')) {
                content = transformCode(content, target);
            }
            
            fs.writeFileSync(destFile, content);
            copied++;
        } else {
            console.log(`  ⚠️  Arquivo não encontrado: ${file}`);
        }
    }
    console.log(`  📄 ${copied} arquivos copiados`);
    
    // Copiar diretórios (icons, etc)
    for (const dir of DIRS_TO_COPY) {
        const srcDir = path.join(SRC_DIR, dir);
        const destDir = path.join(targetDir, dir);
        
        if (fs.existsSync(srcDir)) {
            copyDir(srcDir, destDir);
            console.log(`  📁 Pasta copiada: ${dir}/`);
        }
    }
    
    // Copiar manifesto correto
    const manifestSrc = path.join(MANIFESTS_DIR, `manifest.${target}.json`);
    const manifestDest = path.join(targetDir, 'manifest.json');
    
    if (fs.existsSync(manifestSrc)) {
        copyFile(manifestSrc, manifestDest);
        console.log(`  📋 Manifesto: manifest.${target}.json → manifest.json`);
    } else {
        console.log(`  ❌ Manifesto não encontrado: manifest.${target}.json`);
        return false;
    }
    
    console.log(`  ✅ Build ${target.toUpperCase()} completo!`);
    console.log(`     → ${path.relative(__dirname, targetDir)}`);
    return true;
}

/**
 * Função principal
 */
function main() {
    const args = process.argv.slice(2);
    const target = args[0] || 'all';
    
    console.log('╔════════════════════════════════════════╗');
    console.log('║     RevoSub Extension Builder          ║');
    console.log('╚════════════════════════════════════════╝');
    
    // Verificar se src existe
    if (!fs.existsSync(SRC_DIR)) {
        console.log('\n❌ Pasta src/ não encontrada!');
        console.log('   Crie a pasta src/ com os arquivos fonte.');
        process.exit(1);
    }
    
    let success = true;
    
    if (target === 'all' || target === 'chrome') {
        success = build('chrome') && success;
    }
    
    if (target === 'all' || target === 'firefox') {
        success = build('firefox') && success;
    }
    
    if (target !== 'all' && target !== 'chrome' && target !== 'firefox') {
        console.log(`\n❌ Target inválido: ${target}`);
        console.log('   Use: chrome, firefox, ou all');
        process.exit(1);
    }
    
    console.log('\n' + '═'.repeat(42));
    if (success) {
        console.log('✅ Build finalizado com sucesso!');
        console.log('\nPróximos passos:');
        console.log('  Chrome: Carregue build/chrome/ em chrome://extensions');
        console.log('  Firefox: Carregue build/firefox/ em about:debugging');
    } else {
        console.log('⚠️  Build finalizado com avisos');
    }
}

main();
