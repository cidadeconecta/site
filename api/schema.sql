-- Banco da Cidade Conecta
-- mysql -u root -p < schema.sql

CREATE DATABASE IF NOT EXISTS cidadeconecta
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE cidadeconecta;

-- toda compra confirmada pela Tebex
CREATE TABLE IF NOT EXISTS vendas (
  id            BIGINT AUTO_INCREMENT PRIMARY KEY,
  transacao     VARCHAR(64)  NOT NULL UNIQUE,      -- id da transação na Tebex
  pedido        VARCHAR(32)  NOT NULL,             -- código exibido no painel (#CC0001)
  discord_id    VARCHAR(32)  NULL,
  discord_nome  VARCHAR(64)  NULL,
  license       VARCHAR(64)  NULL,                 -- identificador do FiveM, se informado
  pacote        VARCHAR(64)  NOT NULL,
  pacote_id     VARCHAR(32)  NULL,
  valor         DECIMAL(10,2) NOT NULL DEFAULT 0,
  moeda         VARCHAR(8)   NOT NULL DEFAULT 'BRL',
  pagamento     VARCHAR(24)  NULL,                 -- Pix, Cartão, Boleto...
  status        ENUM('Pago','Pendente','Reembolsado','Estornado') NOT NULL DEFAULT 'Pago',
  cupom         VARCHAR(32)  NULL,
  criado_em     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_discord (discord_id),
  INDEX idx_criado (criado_em)
) ENGINE=InnoDB;

-- assinatura ativa de cada jogador
CREATE TABLE IF NOT EXISTS vip_assinaturas (
  id           BIGINT AUTO_INCREMENT PRIMARY KEY,
  discord_id   VARCHAR(32) NOT NULL,
  license      VARCHAR(64) NULL,
  pacote       VARCHAR(64) NOT NULL,
  cargo_id     VARCHAR(32) NULL,
  transacao    VARCHAR(64) NULL,
  inicio       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  vencimento   DATETIME NOT NULL,
  status       ENUM('ativo','vencido','reembolsado') NOT NULL DEFAULT 'ativo',
  UNIQUE KEY uniq_discord_pacote (discord_id, pacote),
  INDEX idx_vencimento (vencimento),
  INDEX idx_status (status)
) ENGINE=InnoDB;

-- entrega dos benefícios no servidor FiveM (consumido pelo script do jogo)
CREATE TABLE IF NOT EXISTS entregas (
  id          BIGINT AUTO_INCREMENT PRIMARY KEY,
  transacao   VARCHAR(64) NOT NULL,
  discord_id  VARCHAR(32) NULL,
  license     VARCHAR(64) NULL,
  pacote      VARCHAR(64) NOT NULL,
  entregue    TINYINT(1) NOT NULL DEFAULT 0,
  criado_em   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  entregue_em DATETIME NULL,
  INDEX idx_pendentes (entregue, criado_em)
) ENGINE=InnoDB;

-- status enviado pelo servidor FiveM (linha única, id = 1)
CREATE TABLE IF NOT EXISTS server_status (
  id                INT PRIMARY KEY DEFAULT 1,
  server_name       VARCHAR(255) NULL,
  ping_average      INT NULL,
  uptime            VARCHAR(50) NULL,
  players_connected INT NULL,
  slots_available   INT NULL,
  queue             INT NULL,
  status            VARCHAR(20) NULL,
  status_color      VARCHAR(20) NULL,
  police_on_duty    INT NULL,
  medical_on_duty   INT NULL,
  criminals_in_city INT NULL,
  updated_at        TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- histórico opcional (um registro por envio, para gráficos)
CREATE TABLE IF NOT EXISTS server_status_log (
  id                BIGINT AUTO_INCREMENT PRIMARY KEY,
  players_connected INT NULL,
  queue             INT NULL,
  ping_average      INT NULL,
  status            VARCHAR(20) NULL,
  criado_em         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_criado (criado_em)
) ENGINE=InnoDB;

-- acesso ao painel administrativo (senha guardada como hash scrypt)
CREATE TABLE IF NOT EXISTS admin_usuarios (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  usuario    VARCHAR(64) NOT NULL UNIQUE,
  nome       VARCHAR(80) NULL,
  senha_hash VARCHAR(255) NOT NULL,
  papel      ENUM('dono','admin','suporte') NOT NULL DEFAULT 'admin',
  ativo      TINYINT(1) NOT NULL DEFAULT 1,
  trocar_senha TINYINT(1) NOT NULL DEFAULT 0,
  ultimo_acesso DATETIME NULL,
  criado_em  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- categorias da loja
CREATE TABLE IF NOT EXISTS categorias (
  id        INT AUTO_INCREMENT PRIMARY KEY,
  slug      VARCHAR(48) NOT NULL UNIQUE,
  nome      VARCHAR(64) NOT NULL,
  ordem     INT NOT NULL DEFAULT 0,
  criado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- catálogo da loja VIP
CREATE TABLE IF NOT EXISTS produtos (
  id          VARCHAR(48) PRIMARY KEY,
  nome        VARCHAR(120) NOT NULL,
  categoria   VARCHAR(48) NOT NULL,
  preco       DECIMAL(10,2) NOT NULL DEFAULT 0,
  preco_antigo DECIMAL(10,2) NULL,
  tag         VARCHAR(32) NULL,
  descricao   TEXT NULL,
  bullets     TEXT NULL,            -- uma vantagem por linha
  imagem      LONGTEXT NULL,        -- URL ou data URL
  tebex_id    VARCHAR(48) NULL,
  ativo       TINYINT(1) NOT NULL DEFAULT 1,
  ordem       INT NOT NULL DEFAULT 0,
  atualizado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_categoria (categoria, ativo)
) ENGINE=InnoDB;
