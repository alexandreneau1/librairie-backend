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

// GET /avis/:livre_id — avis d'un livre avec moyenne
router.get('/:livre_id', async function(req, res) {
  try {
    const livre_id = parseInt(req.params.livre_id)
    const result = await pool.query(
      `SELECT a.id, a.note, a.commentaire, a.date_avis,
              c.prenom, c.nom
       FROM avis a
       JOIN comptes_clients c ON a.compte_client_id = c.id
       WHERE a.livre_id = $1
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

// POST /avis/:livre_id — déposer un avis (client connecté)
router.post('/:livre_id', verifierTokenClient, async function(req, res) {
  try {
    const livre_id = parseInt(req.params.livre_id)
    const { note, commentaire } = req.body
    if (!note || note < 1 || note > 5) {
      return res.status(400).json({ message: 'Note invalide (1 à 5)' })
    }
    const result = await pool.query(
      `INSERT INTO avis (livre_id, compte_client_id, note, commentaire)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [livre_id, req.client.id, note, commentaire || null]
    )
    res.status(201).json(result.rows[0])
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ message: 'Vous avez déjà déposé un avis pour ce livre' })
    }
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