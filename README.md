# Cidade Conecta — site

Site estático da Cidade Conecta (GTA RolePlay / FiveM). Cada arquivo é autônomo:
não precisa de build, servidor ou dependências.

| Arquivo | Página |
| --- | --- |
| index.html | Home |
| loja.html | Loja VIP |
| regras.html | Regulamento |
| admin.html | Painel administrativo (login: admin / cidade2026) |

## Publicar no GitHub Pages

1. Crie o repositório `cidade-conecta-site` no GitHub (público).
2. Envie o conteúdo desta pasta para a raiz do repositório (arraste os arquivos na
   interface do GitHub ou use git):

   ```bash
   git init
   git add .
   git commit -m "site Cidade Conecta"
   git branch -M main
   git remote add origin https://github.com/SEU-USUARIO/cidade-conecta-site.git
   git push -u origin main
   ```

3. No repositório: **Settings → Pages → Source: Deploy from a branch**,
   branch `main`, pasta `/ (root)`, salvar.
4. Em poucos minutos o site fica em
   `https://SEU-USUARIO.github.io/cidade-conecta-site/`.

### Domínio próprio (opcional)
Crie um arquivo `CNAME` na raiz com o domínio (ex.: `cidadeconecta.gg`) e aponte
no seu provedor de DNS um registro CNAME para `SEU-USUARIO.github.io`.

## Observações importantes

- **Painel admin:** publicado assim, ele é acessível por qualquer pessoa que
  descubra a URL e os dados ficam apenas no navegador (localStorage). Para uso
  real, hospede o painel atrás de autenticação de verdade ou remova
  `admin.html` do repositório.
- **Checkout:** o botão do carrinho leva para a webstore Tebex configurada em
  Admin → Integrações. Ajuste o domínio da sua loja antes de divulgar.
- **Links das redes sociais e do Discord** estão como `#` — troque pelas URLs
  reais.
- **Imagens:** os espaços de imagem são preenchidos arrastando arquivos na
  ferramenta de edição; no site publicado eles aparecem como placeholders até
  que você gere uma nova versão com as imagens aplicadas.
