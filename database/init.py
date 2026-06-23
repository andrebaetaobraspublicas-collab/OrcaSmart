#!/usr/bin/env python3
"""
database/init.py — Criação inicial do banco de dados
Execute com: python database/init.py
"""

import sqlite3, os, sys
from datetime import date

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DB_PATH  = os.path.join(BASE_DIR, 'database', 'orcamento_obras.db')

print(f'\n📦  Iniciando criação do banco de dados...')
print(f'    Local: {DB_PATH}\n')

if os.path.exists(DB_PATH):
    print('⚠️   Banco já existe. Nenhuma alteração foi feita.')
    print('    Para recriar, delete o arquivo e execute novamente.\n')
    sys.exit(0)

conn = sqlite3.connect(DB_PATH)
conn.execute("PRAGMA foreign_keys = ON")
cur = conn.cursor()

cur.executescript("""
CREATE TABLE IF NOT EXISTS estados (
    id_estado          INTEGER PRIMARY KEY AUTOINCREMENT,
    codigo_ibge        INTEGER NOT NULL UNIQUE,
    uf                 TEXT    NOT NULL UNIQUE CHECK(length(uf)=2),
    nome_estado        TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS municipios (
    id_municipio          INTEGER PRIMARY KEY AUTOINCREMENT,
    codigo_ibge_municipio INTEGER NOT NULL UNIQUE,
    nome_municipio        TEXT    NOT NULL,
    uf                    TEXT    NOT NULL CHECK(length(uf)=2),
    id_estado             INTEGER REFERENCES estados(id_estado),
    aliquota_ibs          REAL    DEFAULT 0.0,
    aliquota_cbs          REAL    DEFAULT 0.0,
    aliquota_iss          REAL    DEFAULT 0.0,
    ano_aliquota          INTEGER DEFAULT NULL,
    UNIQUE(uf, nome_municipio)
);

CREATE INDEX IF NOT EXISTS idx_municipios_uf ON municipios(uf);

CREATE TABLE IF NOT EXISTS obras (
    id_obra            INTEGER PRIMARY KEY AUTOINCREMENT,
    codigo_obra        TEXT,
    nome_obra          TEXT NOT NULL,
    descricao          TEXT,
    tipo_obra          TEXT,
    contratante        TEXT,
    uf                 TEXT CHECK(length(uf)=2),
    municipio          TEXT,
    id_municipio       INTEGER REFERENCES municipios(id_municipio),
    cib                TEXT,
    endereco           TEXT,
    area_construida_m2 REAL,
    data_cadastro      TEXT DEFAULT (date('now')),
    situacao           TEXT DEFAULT 'Ativa' CHECK(situacao IN ('Ativa','Encerrada','Suspensa'))
);

CREATE TABLE IF NOT EXISTS datas_base (
    id_data_base  INTEGER PRIMARY KEY AUTOINCREMENT,
    mes           INTEGER NOT NULL CHECK(mes BETWEEN 1 AND 12),
    ano           INTEGER NOT NULL CHECK(ano > 2000),
    data_referencia TEXT,
    descricao     TEXT,
    UNIQUE(mes, ano)
);

CREATE TABLE IF NOT EXISTS fontes_referencia (
    id_fonte          INTEGER PRIMARY KEY AUTOINCREMENT,
    nome_fonte        TEXT NOT NULL,
    tipo_fonte        TEXT CHECK(tipo_fonte IN ('Oficial','Interna','Cotação','Outra')),
    orgao_responsavel TEXT,
    abrangencia       TEXT,
    observacoes       TEXT
);

CREATE TABLE IF NOT EXISTS unidades_medida (
    id_unidade   INTEGER PRIMARY KEY AUTOINCREMENT,
    sigla        TEXT NOT NULL UNIQUE,
    descricao    TEXT,
    tipo_unidade TEXT
);

CREATE TABLE IF NOT EXISTS orcamentos (
    id_orcamento       INTEGER PRIMARY KEY AUTOINCREMENT,
    id_obra            INTEGER NOT NULL REFERENCES obras(id_obra),
    nome_orcamento     TEXT NOT NULL,
    descricao          TEXT,
    id_data_base       INTEGER REFERENCES datas_base(id_data_base),
    uf_referencia      TEXT CHECK(length(uf_referencia)=2),
    versao             TEXT DEFAULT '1.0',
    status             TEXT DEFAULT 'Em elaboração'
        CHECK(status IN ('Em elaboração','Aprovado','Revisão','Cancelado')),
    regime_previdenciario TEXT DEFAULT 'Onerado'
        CHECK(regime_previdenciario IN ('Onerado','Desonerado')),
    valor_custo_direto REAL DEFAULT 0,
    valor_bdi          REAL DEFAULT 0,
    valor_total        REAL DEFAULT 0,
    data_criacao       TEXT DEFAULT (date('now')),
    observacoes        TEXT
);
""")

# ── Seed data ────────────────────────────────────────────────────────────────
hoje = date.today()
cur.execute("INSERT OR IGNORE INTO datas_base (mes,ano,descricao) VALUES (?,?,?)",
            [hoje.month, hoje.year, f'Data-base atual'])

fontes = [
    ('SINAPI', 'Oficial', 'Caixa Econômica Federal / IBGE', 'Nacional'),
    ('SICRO',  'Oficial', 'DNIT', 'Nacional'),
    ('Composição Própria', 'Interna', 'Empresa', 'Interno'),
]
for f in fontes:
    cur.execute("INSERT OR IGNORE INTO fontes_referencia (nome_fonte,tipo_fonte,orgao_responsavel,abrangencia) VALUES (?,?,?,?)", f)

unidades = [
    ('m²','Metro quadrado','Área'), ('m³','Metro cúbico','Volume'),
    ('m','Metro linear','Comprimento'), ('un','Unidade','Quantidade'),
    ('kg','Quilograma','Massa'), ('t','Tonelada','Massa'),
    ('h','Hora','Tempo'), ('vb','Verba','Outro'),
    ('l','Litro','Volume'), ('cj','Conjunto','Quantidade'),
    ('km','Quilômetro','Comprimento'), ('ha','Hectare','Área'),
]
for u in unidades:
    cur.execute("INSERT OR IGNORE INTO unidades_medida (sigla,descricao,tipo_unidade) VALUES (?,?,?)", u)

conn.commit()
conn.close()

print('✅  Tabelas criadas com sucesso!')
print('✅  Dados iniciais inseridos!')
print('\n🚀  Próximos passos:')
print('    1. python database/popular_municipios.py estados_municipios_brasil_ibge.xlsx')
print('    2. python server.py\n')
print('📋  Para banco existente, rode a migração de alíquotas:')
print('    python database/migrar_aliquotas_municipios.py estados_municipios_brasil_ibge.xlsx\n')
