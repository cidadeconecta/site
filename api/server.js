/**
 * Cidade Conecta — API de vendas, webhook da Tebex e cargos do Discord.
 *
 *   npm install && cp .env.example .env && npm start
 *
 * Endpoints
 *   POST /tebex/webhook   recebe as notificações da Tebex (valida assinatura)
 *   GET  /vendas          lista os pedidos para o painel admin (usado pelo site)
 *   GET  /vip/:discordId  status da assinatura de um jogador
 *   GET  /entregas        fila de benefícios pendentes (consumida pelo script do FiveM)
 *   POST /entregas/:id/ok marca um benefício como entregue
 *   POST /api/server/status  recebe o status do FiveM (header X-Status-Key)
 *   GET  /api/server/status  status atual, consumido pela home
 *   POST /admin/login        login do painel (token de sessão)
 *   CRUD /admin/usuarios     gestão de acesso ao painel
 *   CRUD /produtos /categorias  catálogo da loja
 *   GET  /health          checagem simples
 */
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const mysql = require('mysql2/promise');
const cron = require('node-cron');

const {
  PORT = 8080,
  CORS_ORIGIN = '*',
  ADMIN_API_KEY = '',
  DB_HOST = 'localhost',
  DB_PORT = 3306,
  DB_USER,
  DB_PASSWORD,
  DB_NAME,
  TEBEX_WEBHOOK_SECRET = '',
  DISCORD_BOT_TOKEN = '',
  DISCORD_GUILD_ID = '',
  DISCORD_VIP_ROLE_ID = '',
  DISCORD_ROLE_MAP = '{}',
  VIP_DIAS = 30,
  STATUS_INGEST_KEY = '',
  STATUS_LOG = '1',
  ADMIN_SESSION_SECRET = '',
  ADMIN_BOOTSTRAP_USER = 'admin',
  ADMIN_BOOTSTRAP_PASSWORD = '',
} = process.env;

const SESSION_SECRET = ADMIN_SESSION_SECRET || crypto.randomBytes(32).toString('hex');

const roleMap = (() => {
  try { return JSON.parse(DISCORD_ROLE_MAP); } catch { return {}; }
})();

const pool = mysql.createPool({
  host: DB_HOST,
  port: Number(DB_PORT),
  user: DB_USER,
  password: DB_PASSWORD,
  database: DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  timezone: 'Z',
});

const app = express();
app.use(cors({ origin: CORS_ORIGIN === '*' ? true : CORS_ORIGIN.split(',').map(s => s.trim()) }));
// o corpo cru é necessário para validar a assinatura da Tebex
app.use('/tebex/webhook', express.raw({ type: '*/*', limit: '1mb' }));
app.use(express.json());

/* ------------------------------------------------------------------ Discord */

async function discord(path, options = {}) {
  if (!DISCORD_BOT_TOKEN) return null;
  const res = await fetch('https://discord.com/api/v10' + path, {
    ...options,
    headers: {
      Authorization: 'Bot ' + DISCORD_BOT_TOKEN,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  if (!res.ok && res.status !== 204) {
    console.error('[discord]', path, res.status, await res.text().catch(() => ''));
    return null;
  }
  return res.status === 204 ? true : res.json().catch(() => true);
}

const cargoDoPacote = (pacote) => roleMap[pacote] || roleMap[String(pacote).toLowerCase()] || DISCORD_VIP_ROLE_ID;

async function darCargo(discordId, pacote) {
  const cargo = cargoDoPacote(pacote);
  if (!discordId || !cargo || !DISCORD_GUILD_ID) return null;
  await discord(`/guilds/${DISCORD_GUILD_ID}/members/${discordId}/roles/${cargo}`, { method: 'PUT' });
  return cargo;
}

async function tirarCargo(discordId, cargo) {
  if (!discordId || !cargo || !DISCORD_GUILD_ID) return;
  await discord(`/guilds/${DISCORD_GUILD_ID}/members/${discordId}/roles/${cargo}`, { method: 'DELETE' });
}

/* -------------------------------------------------------------------- Tebex */

/** Assinatura da Tebex: X-Signature = HMAC_SHA256( sha256(body), secret ). */
function assinaturaValida(req) {
  if (!TEBEX_WEBHOOK_SECRET) return true; // sem secret configurado, não valida (use só em teste)
  const enviado = req.get('X-Signature') || '';
  const corpoHash = crypto.createHash('sha256').update(req.body).digest('hex');
  const esperado = crypto.createHmac('sha256', TEBEX_WEBHOOK_SECRET).update(corpoHash).digest('hex');
  const a = Buffer.from(enviado, 'utf8');
  const b = Buffer.from(esperado, 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** Procura o ID do Discord entre as variáveis preenchidas no checkout. */
function extrairDiscord(subject) {
  const campos = []
    .concat(subject?.customer?.username || [])
    .concat((subject?.custom && Object.values(subject.custom)) || [])
    .concat((subject?.variable_data && Object.values(subject.variable_data)) || [])
    .map(String);
  const idNumerico = campos.find((v) => /^\d{15,21}$/.test(v.trim()));
  return {
    id: idNumerico ? idNumerico.trim() : null,
    nome: subject?.customer?.username || campos[0] || null,
  };
}

app.post('/tebex/webhook', async (req, res) => {
  let evento;
  try { evento = JSON.parse(req.body.toString('utf8')); }
  catch { return res.status(400).json({ erro: 'json inválido' }); }

  // handshake inicial da Tebex
  if (evento.type === 'validation.webhook') {
    return res.json({ id: evento.id });
  }
  if (!assinaturaValida(req)) {
    return res.status(401).json({ erro: 'assinatura inválida' });
  }

  const subject = evento.subject || {};
  const tipo = evento.type || '';

  try {
    if (tipo === 'payment.completed') {
      const { id: discordId, nome } = extrairDiscord(subject);
      const produtos = subject.products || [];
      const transacao = subject.transaction_id || subject.id || String(Date.now());
      const valor = Number(subject.price?.amount ?? subject.amount ?? 0);
      const moeda = subject.price?.currency || 'BRL';
      const pagamento = subject.payment_method?.name || subject.gateway || null;
      const license = subject.custom?.license || subject.variable_data?.license || null;

      for (const [i, prod] of produtos.entries()) {
        const pacote = prod.name || 'Pacote';
        const pacoteId = String(prod.id ?? '');
        const pedido = '#CC' + String(transacao).replace(/\D/g, '').slice(-6).padStart(6, '0') + (produtos.length > 1 ? '-' + (i + 1) : '');

        await pool.execute(
          `INSERT INTO vendas (transacao, pedido, discord_id, discord_nome, license, pacote, pacote_id, valor, moeda, pagamento, status)
           VALUES (?,?,?,?,?,?,?,?,?,?, 'Pago')
           ON DUPLICATE KEY UPDATE status='Pago'`,
          [String(transacao) + (produtos.length > 1 ? ':' + i : ''), pedido, discordId, nome, license, pacote, pacoteId, valor, moeda, pagamento]
        );

        const cargo = await darCargo(discordId, pacoteId || pacote);
        const dias = Number(VIP_DIAS) || 30;
        await pool.execute(
          `INSERT INTO vip_assinaturas (discord_id, license, pacote, cargo_id, transacao, vencimento, status)
           VALUES (?,?,?,?,?, DATE_ADD(NOW(), INTERVAL ? DAY), 'ativo')
           ON DUPLICATE KEY UPDATE
             vencimento = DATE_ADD(GREATEST(vencimento, NOW()), INTERVAL ? DAY),
             status = 'ativo', cargo_id = VALUES(cargo_id), transacao = VALUES(transacao)`,
          [discordId, license, pacote, cargo, String(transacao), dias, dias]
        );

        await pool.execute(
          `INSERT INTO entregas (transacao, discord_id, license, pacote) VALUES (?,?,?,?)`,
          [String(transacao), discordId, license, pacote]
        );
      }
    }

    if (tipo === 'payment.refunded' || tipo === 'payment.chargeback') {
      const transacao = String(subject.transaction_id || subject.id || '');
      await pool.execute(`UPDATE vendas SET status='Reembolsado' WHERE transacao LIKE ?`, [transacao + '%']);
      const [linhas] = await pool.execute(
        `SELECT discord_id, cargo_id FROM vip_assinaturas WHERE transacao = ?`, [transacao]
      );
      for (const l of linhas) await tirarCargo(l.discord_id, l.cargo_id);
      await pool.execute(`UPDATE vip_assinaturas SET status='reembolsado' WHERE transacao = ?`, [transacao]);
    }

    res.json({ ok: true });
  } catch (e) {
    console.error('[webhook]', e);
    res.status(500).json({ erro: 'falha ao processar' });
  }
});

/* ---------------------------------------------------------------- Painel admin */

function autorizado(req) {
  if (!ADMIN_API_KEY) return true;
  const chave = req.query.key || req.get('X-Api-Key') || '';
  return chave === ADMIN_API_KEY;
}

app.get('/vendas', async (req, res) => {
  if (!autorizado(req)) return res.status(401).json({ erro: 'chave inválida' });
  const limite = Math.min(Number(req.query.limite) || 300, 1000);
  try {
    const [linhas] = await pool.query(
      `SELECT pedido, discord_nome, discord_id, license, pacote, pacote_id, valor, pagamento, status, criado_em
         FROM vendas ORDER BY criado_em DESC LIMIT ?`, [limite]
    );
    res.json(linhas.map((l) => ({
      id: l.pedido,
      cliente: l.discord_nome || l.discord_id || '—',
      discordId: l.discord_id || '',
      idGame: l.license || '',
      produto: l.pacote,
      produtoId: l.pacote_id || '',
      valor: Number(l.valor),
      pagamento: l.pagamento || '—',
      status: l.status,
      data: new Date(l.criado_em).toISOString(),
    })));
  } catch (e) {
    console.error('[vendas]', e);
    res.status(500).json({ erro: 'falha ao consultar' });
  }
});

app.get('/vip/:discordId', async (req, res) => {
  try {
    const [linhas] = await pool.execute(
      `SELECT pacote, inicio, vencimento, status FROM vip_assinaturas
        WHERE discord_id = ? AND status = 'ativo' ORDER BY vencimento DESC`, [req.params.discordId]
    );
    res.json({ discordId: req.params.discordId, assinaturas: linhas });
  } catch (e) {
    res.status(500).json({ erro: 'falha ao consultar' });
  }
});

/* ------------------------------------------------- Entrega no servidor FiveM */

app.get('/entregas', async (req, res) => {
  if (!autorizado(req)) return res.status(401).json({ erro: 'chave inválida' });
  const [linhas] = await pool.query(
    `SELECT id, transacao, discord_id, license, pacote FROM entregas WHERE entregue = 0 ORDER BY criado_em LIMIT 100`
  );
  res.json(linhas);
});

app.post('/entregas/:id/ok', async (req, res) => {
  if (!autorizado(req)) return res.status(401).json({ erro: 'chave inválida' });
  await pool.execute(`UPDATE entregas SET entregue = 1, entregue_em = NOW() WHERE id = ?`, [req.params.id]);
  res.json({ ok: true });
});


/* ------------------------------------------------ Status do servidor (FiveM) */

const numeroOuNulo = (v) => (v === undefined || v === null || v === '' || Number.isNaN(Number(v)) ? null : Math.trunc(Number(v)));
const textoOuNulo = (v, max) => (v === undefined || v === null ? null : String(v).slice(0, max));

function statusAutorizado(req) {
  if (!STATUS_INGEST_KEY) return true; // sem chave configurada (use só em teste)
  const chave = req.get('X-Status-Key') || req.query.key || '';
  const a = Buffer.from(String(chave));
  const b = Buffer.from(STATUS_INGEST_KEY);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

app.post('/api/server/status', async (req, res) => {
  if (!statusAutorizado(req)) return res.status(401).json({ erro: 'chave inválida' });
  const d = req.body || {};
  const dados = {
    server_name: textoOuNulo(d.serverName ?? d.server_name ?? 'Cidade Conecta', 255),
    ping_average: numeroOuNulo(d.pingAverage ?? d.ping_average),
    uptime: textoOuNulo(d.uptime, 50),
    players_connected: numeroOuNulo(d.playersConnected ?? d.players_connected),
    slots_available: numeroOuNulo(d.slotsAvailable ?? d.slots_available),
    queue: numeroOuNulo(d.queue),
    status: textoOuNulo(d.status, 20),
    status_color: textoOuNulo(d.statusColor ?? d.status_color, 20),
    police_on_duty: numeroOuNulo(d.policeOnDuty ?? d.police_on_duty),
    medical_on_duty: numeroOuNulo(d.medicalOnDuty ?? d.medical_on_duty),
    criminals_in_city: numeroOuNulo(d.criminalsInCity ?? d.criminals_in_city),
  };
  try {
    await pool.execute(
      `INSERT INTO server_status
         (id, server_name, ping_average, uptime, players_connected, slots_available, queue, status, status_color, police_on_duty, medical_on_duty, criminals_in_city)
       VALUES (1,?,?,?,?,?,?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE
         server_name=VALUES(server_name), ping_average=VALUES(ping_average), uptime=VALUES(uptime),
         players_connected=VALUES(players_connected), slots_available=VALUES(slots_available), queue=VALUES(queue),
         status=VALUES(status), status_color=VALUES(status_color), police_on_duty=VALUES(police_on_duty),
         medical_on_duty=VALUES(medical_on_duty), criminals_in_city=VALUES(criminals_in_city),
         updated_at=CURRENT_TIMESTAMP`,
      [dados.server_name, dados.ping_average, dados.uptime, dados.players_connected, dados.slots_available,
       dados.queue, dados.status, dados.status_color, dados.police_on_duty, dados.medical_on_duty, dados.criminals_in_city]
    );
    if (STATUS_LOG === '1') {
      await pool.execute(
        `INSERT INTO server_status_log (players_connected, queue, ping_average, status) VALUES (?,?,?,?)`,
        [dados.players_connected, dados.queue, dados.ping_average, dados.status]
      );
    }
    res.sendStatus(200);
  } catch (e) {
    console.error('[status]', e);
    res.status(500).json({ erro: 'falha ao salvar' });
  }
});

app.get('/api/server/status', async (_req, res) => {
  try {
    const [linhas] = await pool.query('SELECT * FROM server_status WHERE id = 1');
    if (!linhas.length) return res.json({ online: false });
    const l = linhas[0];
    const atualizado = new Date(l.updated_at);
    const segundos = Math.round((Date.now() - atualizado.getTime()) / 1000);
    res.json({
      serverName: l.server_name,
      pingAverage: l.ping_average,
      uptime: l.uptime,
      playersConnected: l.players_connected,
      slotsAvailable: l.slots_available,
      queue: l.queue,
      status: l.status,
      statusColor: l.status_color,
      policeOnDuty: l.police_on_duty,
      medicalOnDuty: l.medical_on_duty,
      criminalsInCity: l.criminals_in_city,
      atualizadoEm: atualizado.toISOString(),
      segundosAtras: segundos,
      // sem envio há mais de 3 minutos o site trata como offline
      online: segundos < 180,
    });
  } catch (e) {
    console.error('[status:get]', e);
    res.status(500).json({ erro: 'falha ao consultar' });
  }
});

app.get('/api/server/status/historico', async (req, res) => {
  const horas = Math.min(Math.max(Number(req.query.horas) || 24, 1), 720);
  try {
    const [linhas] = await pool.query(
      `SELECT players_connected, queue, ping_average, criado_em FROM server_status_log
        WHERE criado_em >= DATE_SUB(NOW(), INTERVAL ? HOUR) ORDER BY criado_em`, [horas]
    );
    res.json(linhas.map((l) => ({ jogadores: l.players_connected, fila: l.queue, ping: l.ping_average, em: new Date(l.criado_em).toISOString() })));
  } catch (e) {
    res.status(500).json({ erro: 'falha ao consultar' });
  }
});

/* ------------------------------------------------- Acesso ao painel admin */

function hashSenha(senha, salt = crypto.randomBytes(16).toString('hex')) {
  const dk = crypto.scryptSync(String(senha), salt, 64).toString('hex');
  return 'scrypt$' + salt + '$' + dk;
}
function senhaConfere(senha, guardado) {
  const [alg, salt, dk] = String(guardado || '').split('$');
  if (alg !== 'scrypt' || !salt || !dk) return false;
  const calc = crypto.scryptSync(String(senha), salt, 64).toString('hex');
  const a = Buffer.from(calc, 'hex');
  const b = Buffer.from(dk, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
function assinarToken(payload) {
  const corpo = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update(corpo).digest('base64url');
  return corpo + '.' + sig;
}
function lerToken(token) {
  const [corpo, sig] = String(token || '').split('.');
  if (!corpo || !sig) return null;
  const esperado = crypto.createHmac('sha256', SESSION_SECRET).update(corpo).digest('base64url');
  const a = Buffer.from(sig); const b = Buffer.from(esperado);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const p = JSON.parse(Buffer.from(corpo, 'base64url').toString('utf8'));
    if (!p.exp || p.exp < Date.now()) return null;
    return p;
  } catch { return null; }
}
function sessao(req) {
  const h = req.get('Authorization') || '';
  return lerToken(h.replace(/^Bearer\s+/i, '') || req.query.token);
}
function exigirAdmin(req, res, next) {
  const s = sessao(req);
  if (!s) return res.status(401).json({ erro: 'sessão inválida' });
  req.admin = s;
  next();
}

async function garantirAdminInicial() {
  try {
    const [[{ total }]] = await pool.query('SELECT COUNT(*) AS total FROM admin_usuarios');
    if (total > 0) return;
    const senha = ADMIN_BOOTSTRAP_PASSWORD || crypto.randomBytes(9).toString('base64url');
    await pool.execute(
      'INSERT INTO admin_usuarios (usuario, nome, senha_hash, papel, trocar_senha) VALUES (?,?,?,?,1)',
      [ADMIN_BOOTSTRAP_USER, 'Administrador', hashSenha(senha), 'dono']
    );
    console.log('[admin] usuário inicial criado: ' + ADMIN_BOOTSTRAP_USER + (ADMIN_BOOTSTRAP_PASSWORD ? ' (senha do .env)' : ' / senha: ' + senha));
  } catch (e) {
    console.error('[admin:bootstrap]', e.code || e.message);
  }
}

const tentativas = new Map(); // ip -> { n, until }
app.post('/admin/login', async (req, res) => {
  const ip = req.ip || 'x';
  const t = tentativas.get(ip);
  if (t && t.until > Date.now()) return res.status(429).json({ erro: 'muitas tentativas, aguarde' });
  const usuario = String((req.body && req.body.usuario) || '').trim();
  const senha = String((req.body && req.body.senha) || '');
  try {
    const [linhas] = await pool.execute('SELECT * FROM admin_usuarios WHERE usuario = ? AND ativo = 1', [usuario]);
    const u = linhas[0];
    if (!u || !senhaConfere(senha, u.senha_hash)) {
      const n = ((t && t.n) || 0) + 1;
      tentativas.set(ip, { n, until: n >= 5 ? Date.now() + 5 * 60000 : 0 });
      return res.status(401).json({ erro: 'usuário ou senha inválidos' });
    }
    tentativas.delete(ip);
    await pool.execute('UPDATE admin_usuarios SET ultimo_acesso = NOW() WHERE id = ?', [u.id]);
    res.json({
      token: assinarToken({ id: u.id, usuario: u.usuario, papel: u.papel, exp: Date.now() + 12 * 3600 * 1000 }),
      usuario: { id: u.id, usuario: u.usuario, nome: u.nome, papel: u.papel, trocarSenha: !!u.trocar_senha },
    });
  } catch (e) {
    console.error('[login]', e);
    res.status(500).json({ erro: 'falha no login' });
  }
});

app.get('/admin/usuarios', exigirAdmin, async (_req, res) => {
  const [linhas] = await pool.query('SELECT id, usuario, nome, papel, ativo, ultimo_acesso, criado_em FROM admin_usuarios ORDER BY criado_em');
  res.json(linhas);
});

app.post('/admin/usuarios', exigirAdmin, async (req, res) => {
  const { usuario, nome, senha, papel = 'admin' } = req.body || {};
  if (!usuario || !senha || String(senha).length < 8) return res.status(400).json({ erro: 'usuário e senha (mínimo 8 caracteres) são obrigatórios' });
  try {
    await pool.execute(
      'INSERT INTO admin_usuarios (usuario, nome, senha_hash, papel) VALUES (?,?,?,?)',
      [String(usuario).trim(), nome || null, hashSenha(senha), ['dono','admin','suporte'].includes(papel) ? papel : 'admin']
    );
    res.json({ ok: true });
  } catch (e) {
    res.status(e.code === 'ER_DUP_ENTRY' ? 409 : 500).json({ erro: e.code === 'ER_DUP_ENTRY' ? 'usuário já existe' : 'falha ao criar' });
  }
});

app.post('/admin/usuarios/:id/senha', exigirAdmin, async (req, res) => {
  const nova = String((req.body && req.body.senha) || '');
  if (nova.length < 8) return res.status(400).json({ erro: 'senha mínima de 8 caracteres' });
  await pool.execute('UPDATE admin_usuarios SET senha_hash = ?, trocar_senha = 0 WHERE id = ?', [hashSenha(nova), req.params.id]);
  res.json({ ok: true });
});

app.post('/admin/usuarios/:id/ativo', exigirAdmin, async (req, res) => {
  await pool.execute('UPDATE admin_usuarios SET ativo = ? WHERE id = ?', [req.body && req.body.ativo ? 1 : 0, req.params.id]);
  res.json({ ok: true });
});

app.delete('/admin/usuarios/:id', exigirAdmin, async (req, res) => {
  const [[{ total }]] = await pool.query('SELECT COUNT(*) AS total FROM admin_usuarios WHERE ativo = 1');
  if (total <= 1) return res.status(400).json({ erro: 'é preciso manter pelo menos um acesso ativo' });
  await pool.execute('DELETE FROM admin_usuarios WHERE id = ?', [req.params.id]);
  res.json({ ok: true });
});

/* --------------------------------------------------- Catálogo da loja */

const slugify = (v) => String(v || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48);

app.get('/categorias', async (_req, res) => {
  try {
    const [linhas] = await pool.query('SELECT slug, nome, ordem FROM categorias ORDER BY ordem, nome');
    res.json(linhas);
  } catch (e) { res.status(500).json({ erro: 'falha ao consultar' }); }
});

app.post('/categorias', exigirAdmin, async (req, res) => {
  const nome = String((req.body && req.body.nome) || '').trim();
  if (!nome) return res.status(400).json({ erro: 'nome obrigatório' });
  const slug = slugify(req.body.slug || nome);
  try {
    await pool.execute('INSERT INTO categorias (slug, nome, ordem) VALUES (?,?,?) ON DUPLICATE KEY UPDATE nome=VALUES(nome), ordem=VALUES(ordem)',
      [slug, nome, Number(req.body.ordem) || 0]);
    res.json({ ok: true, slug });
  } catch (e) { res.status(500).json({ erro: 'falha ao salvar' }); }
});

app.delete('/categorias/:slug', exigirAdmin, async (req, res) => {
  const [linhas] = await pool.execute('SELECT nome FROM categorias WHERE slug = ?', [req.params.slug]);
  const nome = linhas.length ? linhas[0].nome : req.params.slug;
  const [[{ total }]] = await pool.query('SELECT COUNT(*) AS total FROM produtos WHERE categoria IN (?, ?)', [nome, req.params.slug]);
  if (total > 0) return res.status(400).json({ erro: 'a categoria tem ' + total + ' produto(s); mova ou exclua antes' });
  await pool.execute('DELETE FROM categorias WHERE slug = ?', [req.params.slug]);
  res.json({ ok: true });
});

const mapearProduto = (p) => ({
  id: p.id, nome: p.nome, categoria: p.categoria, preco: Number(p.preco),
  precoAntigo: p.preco_antigo === null ? null : Number(p.preco_antigo),
  tag: p.tag, descricao: p.descricao, bullets: p.bullets ? String(p.bullets).split('\n').filter(Boolean) : [],
  imagem: p.imagem, tebexId: p.tebex_id, ativo: p.ativo ? 1 : 0, ordem: p.ordem,
});

app.get('/produtos', async (req, res) => {
  try {
    const todos = req.query.todos === '1' && sessao(req);
    const [linhas] = await pool.query(
      'SELECT * FROM produtos' + (todos ? '' : ' WHERE ativo = 1') + ' ORDER BY ordem, nome'
    );
    res.json(linhas.map(mapearProduto));
  } catch (e) { res.status(500).json({ erro: 'falha ao consultar' }); }
});

app.post('/produtos', exigirAdmin, async (req, res) => {
  const p = req.body || {};
  const id = slugify(p.id || p.nome);
  if (!id || !p.nome) return res.status(400).json({ erro: 'nome obrigatório' });
  try {
    await pool.execute(
      `INSERT INTO produtos (id, nome, categoria, preco, preco_antigo, tag, descricao, bullets, imagem, tebex_id, ativo, ordem)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE nome=VALUES(nome), categoria=VALUES(categoria), preco=VALUES(preco),
         preco_antigo=VALUES(preco_antigo), tag=VALUES(tag), descricao=VALUES(descricao), bullets=VALUES(bullets),
         imagem=VALUES(imagem), tebex_id=VALUES(tebex_id), ativo=VALUES(ativo), ordem=VALUES(ordem)`,
      [id, String(p.nome).slice(0, 120), String(p.categoria || 'Outros').slice(0, 48), Number(p.preco) || 0,
       p.precoAntigo ? Number(p.precoAntigo) : null, p.tag || null, p.descricao || null,
       Array.isArray(p.bullets) ? p.bullets.join('\n') : (p.bullets || null),
       p.imagem || null, p.tebexId || null, p.ativo === 0 ? 0 : 1, Number(p.ordem) || 0]
    );
    res.json({ ok: true, id });
  } catch (e) { console.error('[produtos]', e); res.status(500).json({ erro: 'falha ao salvar' }); }
});

app.delete('/produtos/:id', exigirAdmin, async (req, res) => {
  await pool.execute('DELETE FROM produtos WHERE id = ?', [req.params.id]);
  res.json({ ok: true });
});

app.get('/health', (_req, res) => res.json({ ok: true, hora: new Date().toISOString() }));

/* --------------------------------------------------- Expiração automática dos VIPs */

cron.schedule('0 * * * *', async () => {
  try {
    const [vencidas] = await pool.query(
      `SELECT id, discord_id, cargo_id FROM vip_assinaturas WHERE status = 'ativo' AND vencimento < NOW()`
    );
    for (const v of vencidas) {
      await tirarCargo(v.discord_id, v.cargo_id);
      await pool.execute(`UPDATE vip_assinaturas SET status = 'vencido' WHERE id = ?`, [v.id]);
      console.log('[vip] expirado:', v.discord_id);
    }
  } catch (e) {
    console.error('[cron]', e);
  }
});

garantirAdminInicial();

app.listen(PORT, () => console.log('Cidade Conecta API na porta ' + PORT));
