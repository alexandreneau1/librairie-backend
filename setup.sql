\encoding UTF8
SET client_encoding = 'UTF8';

-- ─────────────────────────────────────────────────────────────────────────────
-- BOOKDOG — Schéma partiel (wishlist uniquement)
-- La base complète a été montée par migrations manuelles.
-- Voir section "Tech debt" du CLAUDE.md.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS wishlist (
  id SERIAL PRIMARY KEY,
  email VARCHAR(150) NOT NULL,
  livre_id INT NOT NULL REFERENCES livres(id) ON DELETE CASCADE,
  date_ajout TIMESTAMP DEFAULT NOW(),
  UNIQUE(email, livre_id)
);
