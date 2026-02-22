# RevoSub - Documentação Completa

## Índice
1. [Visão Geral](#visão-geral)
2. [Arquitetura](#arquitetura)
3. [Estrutura de Arquivos](#estrutura-de-arquivos)
4. [Configuração da API/Backend](#configuração-da-apibackend)
5. [Configuração do Discord OAuth](#configuração-do-discord-oauth)
6. [Banco de Dados](#banco-de-dados)
7. [Como Realocar o Servidor](#como-realocar-o-servidor)
8. [Endpoints da API](#endpoints-da-api)
9. [Modificando a URL da API](#modificando-a-url-da-api)

---

## Visão Geral

RevoSub é uma extensão para navegadores Chromium que permite injetar legendas customizadas (.ytt, .vtt, .srt, .ass) em vídeos do YouTube, preservando estilos, cores, posicionamento e efeitos.

### Funcionalidades
- Injeção de legendas locais
- Armazenamento de legendas na nuvem (com login Discord)
- Carregamento automático de legendas da nuvem
- Suporte a múltiplos idiomas
- Suporte completo a ASS/SSA com estilos

---

## Arquitetura

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   Extensão      │────▶│   API Backend   │────▶│   Banco de      │
│   (Browser)     │◀────│   (Node.js)     │◀────│   Dados         │
└─────────────────┘     └─────────────────┘     └─────────────────┘
        │                       │
        │                       │
        ▼                       ▼
┌─────────────────┐     ┌─────────────────┐
│   YouTube       │     │   Discord       │
│   (Injeção)     │     │   OAuth         │
└─────────────────┘     └─────────────────┘
```

---

## Estrutura de Arquivos

```
ytt-injector-extension/
├── manifest.json      # Configuração da extensão (Manifest V3)
├── background.js      # Service Worker - gerencia OAuth callback
├── content.js         # Script injetado no YouTube - renderiza legendas
├── content.css        # Estilos do content script (vazio, estilos inline)
├── popup.html         # Interface do popup da extensão
├── popup.js           # Lógica do popup - upload, login, etc.
├── callback.html      # Página de callback do OAuth (não usada atualmente)
├── icons/
│   └── revosub-logo.png  # Ícone da extensão
└── DOCUMENTACAO.md    # Este arquivo
```

### Descrição de cada arquivo:

#### manifest.json
- Define nome, versão, permissões
- **host_permissions**: URLs que a extensão pode acessar
  - `https://www.youtube.com/*` - para injetar legendas
  - `https://auth.kennyy.com.br/*` - API do backend

#### background.js
- Service Worker do Manifest V3
- Detecta callback do OAuth Discord
- Extrai token de autenticação e salva no `chrome.storage.local`
- Fecha a aba de callback automaticamente

#### content.js
- Injetado em todas as páginas do YouTube
- Contém parsers para YTT, VTT, SRT e ASS
- Renderiza legendas sobre o player de vídeo
- Comunica com popup via `chrome.runtime.onMessage`
- Busca legendas automaticamente da API para o vídeo atual

#### popup.js
- Interface principal do usuário
- Login/Logout com Discord
- Upload de arquivos de legenda
- Upload para nuvem
- Listagem de legendas salvas

---

## Configuração da API/Backend

### URL Atual
```
https://auth.kennyy.com.br
```

### Requisitos do Servidor
- Node.js 18+ (ou similar)
- Banco de dados (PostgreSQL, MySQL ou SQLite)
- HTTPS obrigatório (certificado SSL)
- Domínio configurado

### Endpoints Necessários

A API precisa implementar os seguintes endpoints:

#### Autenticação

```
GET  /auth/discord
     Redireciona para Discord OAuth

GET  /auth/discord/callback?code=XXX
     Recebe callback do Discord
     Retorna página HTML com window.REVOSUB_AUTH = { token, user }
```

#### Usuários

```
GET  /api/users/me
     Headers: Authorization: Bearer <token>
     Retorna: { id, discordId, username, avatar }
```

#### Legendas

```
GET  /api/subtitles/video/:videoId/languages
     Retorna: [{ code: "pt-BR", name: "Português (Brasil)" }, ...]

GET  /api/subtitles/video/:videoId/lang/:langCode
     Retorna: { content: "<conteúdo da legenda>", format: "ass|vtt|ytt" }

GET  /api/subtitles/my
     Headers: Authorization: Bearer <token>
     Retorna: [{ id, videoId, language, format, isPublic, createdAt }, ...]

POST /api/subtitles
     Headers: Authorization: Bearer <token>
     Body: { videoId, language, content, format, isPublic }
     Retorna: { success: true, subtitle: {...} }

DELETE /api/subtitles/:id
     Headers: Authorization: Bearer <token>
     Retorna: { success: true }
```

---

## Configuração do Discord OAuth

### 1. Criar Aplicação no Discord

1. Acesse https://discord.com/developers/applications
2. Clique em "New Application"
3. Dê um nome (ex: "RevoSub")
4. Vá em "OAuth2" > "General"

### 2. Configurar Redirect URI

Adicione o redirect URI:
```
https://SEU_DOMINIO/auth/discord/callback
```

Exemplo atual:
```
https://auth.kennyy.com.br/auth/discord/callback
```

### 3. Obter Credenciais

Copie:
- **Client ID**: número público
- **Client Secret**: chave secreta (não compartilhar!)

### 4. Configurar no Backend

No seu servidor, configure as variáveis de ambiente:

```env
DISCORD_CLIENT_ID=seu_client_id
DISCORD_CLIENT_SECRET=seu_client_secret
DISCORD_REDIRECT_URI=https://seu_dominio/auth/discord/callback
```

### 5. Fluxo OAuth

1. Usuário clica em "Entrar com Discord"
2. Extensão abre `https://api/auth/discord`
3. Backend redireciona para Discord
4. Usuário autoriza
5. Discord redireciona para `/auth/discord/callback?code=XXX`
6. Backend troca código por token Discord
7. Backend cria/atualiza usuário no banco
8. Backend gera JWT próprio
9. Retorna página HTML com:
   ```html
   <script>
     window.REVOSUB_AUTH = {
       token: "jwt_token_aqui",
       user: { id, discordId, username, avatar }
     };
   </script>
   ```
10. background.js detecta e salva no storage
11. Aba de callback fecha automaticamente

---

## Banco de Dados

### Tabelas Necessárias

#### users
```sql
CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    discord_id VARCHAR(255) UNIQUE NOT NULL,
    username VARCHAR(255) NOT NULL,
    avatar VARCHAR(255),
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);
```

#### subtitles
```sql
CREATE TABLE subtitles (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id),
    video_id VARCHAR(50) NOT NULL,
    language VARCHAR(10) NOT NULL,
    content TEXT NOT NULL,
    format VARCHAR(10) DEFAULT 'ytt',  -- ytt, vtt, ass
    is_public BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    
    UNIQUE(video_id, language, user_id)
);

CREATE INDEX idx_subtitles_video ON subtitles(video_id);
CREATE INDEX idx_subtitles_user ON subtitles(user_id);
```

---

## Como Realocar o Servidor

### Passo 1: Preparar novo servidor

1. Provisionar VPS/servidor com:
   - Ubuntu 22.04+ (ou similar)
   - Node.js 18+
   - PostgreSQL/MySQL
   - Nginx (para reverse proxy)
   - Certbot (para SSL)

2. Configurar domínio DNS apontando para novo IP

### Passo 2: Migrar banco de dados

```bash
# No servidor antigo - exportar
pg_dump -U usuario nome_banco > backup.sql

# No servidor novo - importar
psql -U usuario nome_banco < backup.sql
```

### Passo 3: Configurar backend

1. Clonar/copiar código do backend
2. Instalar dependências: `npm install`
3. Configurar `.env`:

```env
# Servidor
PORT=3000
NODE_ENV=production

# Banco de dados
DATABASE_URL=postgresql://user:pass@localhost:5432/revosub

# Discord OAuth
DISCORD_CLIENT_ID=seu_client_id
DISCORD_CLIENT_SECRET=seu_client_secret
DISCORD_REDIRECT_URI=https://NOVO_DOMINIO/auth/discord/callback

# JWT
JWT_SECRET=chave_secreta_longa_e_aleatoria

# CORS
CORS_ORIGIN=*
```

4. Iniciar com PM2:
```bash
pm2 start npm --name "revosub-api" -- start
pm2 save
```

### Passo 4: Configurar Nginx + SSL

```nginx
server {
    listen 80;
    server_name novo_dominio.com;
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl;
    server_name novo_dominio.com;
    
    ssl_certificate /etc/letsencrypt/live/novo_dominio.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/novo_dominio.com/privkey.pem;
    
    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_cache_bypass $http_upgrade;
    }
}
```

```bash
# Obter certificado SSL
sudo certbot --nginx -d novo_dominio.com
```

### Passo 5: Atualizar Discord OAuth

1. Acesse https://discord.com/developers/applications
2. Selecione sua aplicação
3. Vá em OAuth2 > General
4. Atualize o Redirect URI para o novo domínio:
   ```
   https://NOVO_DOMINIO/auth/discord/callback
   ```

### Passo 6: Atualizar a extensão

Modificar a URL da API em 4 arquivos (veja seção abaixo).

---

## Modificando a URL da API

Se mudar o domínio do servidor, atualize em **4 arquivos**:

### 1. popup.js (linha 3)
```javascript
const API_URL = 'https://NOVO_DOMINIO';
```

### 2. content.js (linha 10)
```javascript
const API_URL = 'https://NOVO_DOMINIO';
```

### 3. background.js (linha 8)
```javascript
tab.url.includes('NOVO_DOMINIO/auth/discord/callback')
```

### 4. manifest.json (linha 15)
```json
"host_permissions": [
    "https://www.youtube.com/*",
    "https://youtube.com/*",
    "https://NOVO_DOMINIO/*"
]
```

### Comando para substituir automaticamente:

```powershell
# PowerShell - substituir URL antiga pela nova
$oldUrl = "auth.kennyy.com.br"
$newUrl = "NOVO_DOMINIO.com"
$files = @("popup.js", "content.js", "background.js", "manifest.json")

foreach ($file in $files) {
    (Get-Content $file) -replace $oldUrl, $newUrl | Set-Content $file
}
```

---

## Checklist de Migração

- [ ] Novo servidor provisionado
- [ ] Domínio DNS configurado
- [ ] Banco de dados migrado
- [ ] Backend instalado e rodando
- [ ] Nginx configurado
- [ ] SSL certificado instalado
- [ ] Discord OAuth redirect URI atualizado
- [ ] Extensão atualizada com nova URL
- [ ] Testado login com Discord
- [ ] Testado upload de legenda
- [ ] Testado carregamento automático
- [ ] Extensão republicada (se na Chrome Web Store)

---

## Contato / Suporte

Desenvolvido por Kenny

API atual: https://auth.kennyy.com.br

---

## Versão

- Extensão: 1.3.0
- Documentação: Janeiro 2026
