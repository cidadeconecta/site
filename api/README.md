# Cidade Conecta — API (vendas, Tebex e Discord)

Serviço Node.js que fecha o ciclo da Loja VIP: recebe o pagamento da Tebex,
grava no MySQL, aplica o cargo no Discord, entrega o benefício no FiveM e
alimenta o histórico de vendas do painel admin.

```
Tebex ──webhook──▶ /tebex/webhook ──▶ MySQL ──▶ /vendas ──▶ painel admin (site)
                          │                └──▶ /entregas ──▶ script do FiveM
                          └──▶ bot do Discord (cargo VIP)
```

## 1. Instalar

Requisitos: Node 18+, MySQL 8, um domínio com HTTPS (a Tebex só chama URLs https).

```bash
cd backend
npm install
cp .env.example .env      # preencha as variáveis
mysql -u root -p < schema.sql
npm start                 # sobe em http://localhost:8080
```

Em produção use PM2 (`pm2 start server.js --name cidade-conecta-api`) atrás de um
Nginx com certificado SSL.

## 2. Configurar a Tebex

1. Creator Panel → **Webhooks** → *Add endpoint*: `https://api.seudominio.gg/tebex/webhook`
2. Marque os eventos `payment.completed`, `payment.refunded` e `payment.chargeback`.
3. Copie o **Secret key** para `TEBEX_WEBHOOK_SECRET` no `.env`.
4. No pacote da loja, crie uma **variável obrigatória** pedindo o ID do Discord do
   comprador (é ele que o serviço usa para aplicar o cargo).

O endpoint responde ao handshake `validation.webhook` automaticamente.

## 3. Configurar o Discord

1. Discord Developers → sua aplicação → **Bot** → copie o token para `DISCORD_BOT_TOKEN`.
2. Convide o bot com o escopo `bot` e a permissão **Manage Roles**.
3. O cargo do bot precisa estar **acima** dos cargos VIP na lista de cargos.
4. Preencha `DISCORD_GUILD_ID`, `DISCORD_VIP_ROLE_ID` e, se cada pacote tiver um
   cargo diferente, `DISCORD_ROLE_MAP={"vip-ouro":"ID","vip-diamante":"ID"}`.

VIPs vencidos perdem o cargo automaticamente (rotina de hora em hora).

## 4. Ligar o painel do site

No `admin.html` → **Integrações** → *Endpoint de vendas em JSON*:

```
https://api.seudominio.gg/vendas?key=SUA_ADMIN_API_KEY
```

`CORS_ORIGIN` no `.env` deve conter a origem do site
(`https://cidadeconecta.github.io`).

## 5. Entregar no FiveM

O servidor do jogo consome a fila de entregas:

```lua
-- resource cidade_conecta_vip (server.lua) — exemplo enxuto
local API   = 'https://api.seudominio.gg'
local KEY   = 'SUA_ADMIN_API_KEY'

CreateThread(function()
  while true do
    PerformHttpRequest(API .. '/entregas?key=' .. KEY, function(code, body)
      if code ~= 200 then return end
      for _, e in ipairs(json.decode(body)) do
        -- aplique aqui o benefício (garagem, slot, veículo, skin...)
        print(('[VIP] entregar %s para %s'):format(e.pacote, e.discord_id or e.license))
        PerformHttpRequest(API .. '/entregas/' .. e.id .. '/ok?key=' .. KEY,
          function() end, 'POST', '', { ['Content-Type'] = 'application/json' })
      end
    end, 'GET')
    Wait(30000)
  end
end)
```

## Endpoints

| Método | Rota | Uso |
| --- | --- | --- |
| POST | `/tebex/webhook` | recebe os eventos da Tebex (assinatura validada) |
| GET | `/vendas?key=` | histórico de pedidos para o painel |
| GET | `/vip/:discordId` | assinaturas ativas de um jogador |
| GET | `/entregas?key=` | fila de benefícios pendentes |
| POST | `/entregas/:id/ok?key=` | marca a entrega como concluída |
| GET | `/health` | monitoramento |

## Segurança

- `ADMIN_API_KEY` protege as rotas de leitura — troque a chave padrão.
- Nunca exponha `TEBEX_SECRET_KEY` ou o token do bot no site: eles ficam só aqui.
- Mantenha o serviço atrás de HTTPS; a Tebex recusa endpoints http.


## 6. Status do servidor na home

O resource do FiveM envia o status para a API; a home lê e mostra em tempo real
(atualiza a cada 30 s e trata como offline se o último envio tiver mais de 3 min).

**Enviar (script do jogo):**

```lua
PerformHttpRequest('https://api.seudominio.gg/api/server/status', function() end,
  'POST', json.encode({
    serverName = 'Cidade Conecta',
    pingAverage = ping, uptime = uptime,
    playersConnected = jogadores, slotsAvailable = slots, queue = fila,
    status = 'Online', statusColor = 'green',
    policeOnDuty = policiais, medicalOnDuty = medicos, criminalsInCity = ilegais,
  }), { ['Content-Type'] = 'application/json', ['X-Status-Key'] = 'STATUS_INGEST_KEY do .env' })
```

**Ler (o site já faz isso):** `GET /api/server/status` devolve os mesmos campos
mais `atualizadoEm`, `segundosAtras` e `online`.
`GET /api/server/status/historico?horas=24` devolve a série para gráficos
(precisa de `STATUS_LOG=1`).

Não é preciso configurar nada no painel: a home usa a mesma URL de API salva em
**Configurações → Discord/API**.

## 7. Acesso ao painel admin

O login do painel agora é validado na API (`POST /admin/login`), com senha
guardada como hash scrypt na tabela `admin_usuarios` e sessão de 12 h.

- Primeiro acesso: se a tabela estiver vazia, o serviço cria o usuário de
  `ADMIN_BOOTSTRAP_USER` / `ADMIN_BOOTSTRAP_PASSWORD` (.env) e marca a troca de
  senha como pendente. Troque a senha no primeiro login e apague o valor do `.env`.
- Gestão de acesso: **Configurações → Acesso ao painel** (criar, ativar/desativar,
  trocar senha, excluir).
- Nunca há usuário ou senha no HTML do site.

## 8. Catálogo no banco

Produtos e categorias ficam no MySQL (`produtos`, `categorias`):

| rota | uso |
| --- | --- |
| `GET /produtos` | loja (só ativos) |
| `GET /produtos?todos=1` | painel (com sessão) |
| `POST /produtos` | criar/editar (sessão) |
| `DELETE /produtos/:id` | excluir (sessão) |
| `GET /categorias` | loja e painel |
| `POST /categorias` / `DELETE /categorias/:slug` | painel (sessão) |

Sem API configurada o painel continua funcionando no navegador (localStorage) e
sincroniza quando a API responder.
