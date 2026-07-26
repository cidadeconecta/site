# Cidade Conecta — site

Site estático (HTML + CSS + JS, sem build). Suba **todo o conteúdo desta pasta** na raiz do repositório.

| Arquivo | Página |
| --- | --- |
| index.html | Home |
| loja.html | Loja VIP |
| regras.html | Regulamento |

Também sobem junto: `support.js`, `image-slot.js`, `assets/`, `robots.txt`, `sitemap.xml` e `.nojekyll`.

## GitHub Pages
1. Envie os arquivos para a raiz do repositório (branch `main`).
2. Settings → Pages → Source: **Deploy from a branch**, branch `main`, pasta `/ (root)`.

## Segurança — leia antes de publicar
- O **painel administrativo não está neste pacote de propósito**. A versão atual valida usuário/senha no próprio navegador (o segredo fica visível no código-fonte) e guarda chaves da Tebex, token do bot do Discord e senha do banco no `localStorage`. Publicar isso expõe suas credenciais. Use o painel apenas localmente ou por trás de login real no backend.
- Nunca cole a **Tebex Secret Key**, o **token do bot** ou a senha do MySQL em campos do navegador de uma página pública — esses valores pertencem ao backend (`backend/.env`).
- As páginas já sobem com `Content-Security-Policy`, `referrer-policy` e `rel="noopener"` em todos os links externos.
- Sendo estático, o site não tem banco nem formulários gravando dados: a superfície de ataque fica no backend e no Discord OAuth.

## SEO
- Cada página tem `title`, `description`, canonical, Open Graph e Twitter Card.
- Ajuste o domínio nos canonical/OG e no `sitemap.xml` se publicar em domínio próprio.
