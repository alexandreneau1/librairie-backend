const express = require('express')
const router = express.Router()
const pool = require('../db')
const jwt = require('jsonwebtoken')

function verifierTokenClient(req, res, next) {
  const authHeader = req.headers['authorization']
  const token = authHeader && authHeader.split(' ')[1]
  if (!token) return res.status(401).json({ message: 'Token manquant' })
  jwt.verify(token, process.env.JWT_SECRET, function(err, decoded) {
    if (err) return res.status(403).json({ message: 'Token invalide' })
    if (decoded.role !== 'client') return res.status(403).json({ message: 'Accès refusé' })
    req.client = decoded
    next()
  })
}

// GET /avis/mes-fiches — toutes les fiches du client connecté (publiques + privées)
// IMPORTANT : déclarée avant GET /:livre_id pour éviter que "mes-fiches" soit interprété comme un livre_id
router.get('/mes-fiches', verifierTokenClient, async function(req, res) {
  try {
    const result = await pool.query(
      `SELECT a.id, a.livre_id, a.note, a.commentaire, a.public, a.date_debut, a.date_fin, a.date_avis,
              l.titre, l.auteur, l.isbn
       FROM avis a
       JOIN livres l ON a.livre_id = l.id
       WHERE a.compte_client_id = $1
       ORDER BY a.date_avis DESC`,
      [req.client.id]
    )
    res.json(result.rows)
  } catch (err) {
    res.status(500).json({ message: 'Erreur serveur' })
  }
})

// GET /avis/:livre_id — avis publics d'un livre avec moyenne
router.get('/:livre_id', async function(req, res) {
  try {
    const livre_id = parseInt(req.params.livre_id)
    const result = await pool.query(
      `SELECT a.id, a.note, a.commentaire, a.date_avis,
              c.prenom, c.nom
       FROM avis a
       JOIN comptes_clients c ON a.compte_client_id = c.id
       WHERE a.livre_id = $1 AND a.public = TRUE
       ORDER BY a.date_avis DESC`,
      [livre_id]
    )
    const moyenne = result.rows.length > 0
      ? (result.rows.reduce((sum, a) => sum + a.note, 0) / result.rows.length).toFixed(1)
      : null
    res.json({ avis: result.rows, moyenne, total: result.rows.length })
  } catch (err) {
    res.status(500).json({ message: 'Erreur serveur' })
  }
})

// POST /avis/:livre_id — déposer une fiche de lecture (client connecté)
router.post('/:livre_id', verifierTokenClient, async function(req, res) {
  try {
    const livre_id = parseInt(req.params.livre_id)
    const { note, commentaire, public: estPublic, date_debut, date_fin } = req.body
    if (!note || note < 1 || note > 5) {
      return res.status(400).json({ message: 'Note invalide (1 à 5)' })
    }
    const result = await pool.query(
      `INSERT INTO avis (livre_id, compte_client_id, note, commentaire, public, date_debut, date_fin)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [livre_id, req.client.id, note, commentaire || null, estPublic === true, date_debut || null, date_fin || null]
    )
    res.status(201).json(result.rows[0])
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ message: 'Vous avez déjà déposé un avis pour ce livre' })
    }
    res.status(500).json({ message: 'Erreur serveur' })
  }
})

// PUT /avis/:id — modifier sa propre fiche de lecture
router.put('/:id', verifierTokenClient, async function(req, res) {
  try {
    const id = parseInt(req.params.id)
    const { note, commentaire, public: estPublic, date_debut, date_fin } = req.body
    if (!note || note < 1 || note > 5) {
      return res.status(400).json({ message: 'Note invalide (1 à 5)' })
    }
    const result = await pool.query(
      `UPDATE avis
       SET note = $1, commentaire = $2, public = $3, date_debut = $4, date_fin = $5
       WHERE id = $6 AND compte_client_id = $7
       RETURNING *`,
      [note, commentaire || null, estPublic === true, date_debut || null, date_fin || null, id, req.client.id]
    )
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Fiche introuvable' })
    }
    res.json(result.rows[0])
  } catch (err) {
    res.status(500).json({ message: 'Erreur serveur' })
  }
})

// DELETE /avis/:id — supprimer son propre avis
router.delete('/:id', verifierTokenClient, async function(req, res) {
  try {
    const id = parseInt(req.params.id)
    await pool.query(
      'DELETE FROM avis WHERE id = $1 AND compte_client_id = $2',
      [id, req.client.id]
    )
    res.json({ message: 'Avis supprimé' })
  } catch (err) {
    res.status(500).json({ message: 'Erreur serveur' })
  }
})

module.exports = router
