# Cidade Conecta RolePlay

Site (estático) + API (Node/Express + MySQL).

## O que é cada coisa

| Caminho | O que é |
| --- | --- |
| `index.html` | Home |
| `loja.html` | Loja VIP |
| `regras.html` | Regulamento |
| `admin.html` | Painel administrativo |
| `support.js`, `image-slot.js` | Runtime das páginas — obrigatórios |
| `assets/` | Imagens das cenas, eventos e headers |
| `robots.txt`, `sitemap.xml`, `.nojekyll` | SEO / GitHub Pages |
| `api/` | Backend: vendas, cupons, produtos, status do FiveM, login do painel |

## 1. Subir o site (GitHub Pages)

1. Crie o repositório e envie **tudo desta pasta** para a raiz do branch `main`.
2. Settings → Pages → Source: **Deploy from a branch** → branch `main`, pasta `/ (root)`.
3. O site sai em `https://SEU-USUARIO.github.io/SEU-REPO/`.

O site funciona sozinho; sem a API ficam sem dados apenas: status do servidor, catálogo dinâmico da loja, cupons e o painel admin.

## 2. Subir a API (Railway)

1. Crie um serviço a partir de `api/` (ou de um repositório só com essa pasta).
2. Adicione um MySQL e rode `api/schema.sql` inteiro no banco.
3. Copie `api/.env.example` para as variáveis do serviço e preencha:
   - `MYSQL*` — dados do banco
   - `STATUS_INGEST_KEY` — chave que o script do FiveM envia no header `X-Status-Key`
   - `ADMIN_SESSION_SECRET` — string longa aleatória
   - `ADMIN_BOOTSTRAP_USER` / `ADMIN_BOOTSTRAP_PASSWORD` — primeiro login do painel (apague depois de trocar a senha)
   - `CORS_ORIGIN` — a URL do site publicado
4. Start command: `npm start`.

Detalhes de cada rota, do script Lua do FiveM e do Discord OAuth estão em `api/README.md`.

## 3. Ligar site e API

Abra `admin.html` → Configurações → Integrações → **URL da API** e cole a URL pública da API (ex.: `https://sua-api.up.railway.app`). Salve.

## 4. Domínio próprio

Ao trocar o domínio, atualize em `index.html`, `loja.html` e `regras.html` as tags `canonical`, `og:url` e `twitter:url`, e as URLs do `sitemap.xml`.

## Segurança

- Nunca comite o `.env` (já está no `.gitignore`).
- Tebex Secret, token do bot e senha do MySQL pertencem **só** ao `.env` da API.
- O login do painel é validado na API com senha em hash; não há credencial no HTML.
