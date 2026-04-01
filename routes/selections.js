const express = require('express')
const router = express.Router()
const pool = require('../db')
const verifierToken = require('../middleware/auth')

// GET /selections — récupérer toutes les sélections actives (public)
router.get('/', async function(req, res) {
  try {
    const genre = req.query.genre || null
    const result = await pool.query(
      `SELECT s.id, s.type, s.label, s.rang, s.genre,
              l.id as livre_id, l.titre, l.auteur, l.isbn, l.prix, l.stock, l.genre as livre_genre
       FROM selections s
       JOIN livres l ON s.livre_id = l.id
       WHERE s.actif = TRUE
       AND ($1::varchar IS NULL OR s.genre IS NULL OR s.genre = $1)
       ORDER BY s.type, s.rang ASC NULLS LAST, s.date_ajout DESC`,
      [genre]
    )
    const data = {
      coups_de_coeur: result.rows.filter(r => r.type === 'coup_de_coeur'),
      prix: result.rows.filter(r => r.type === 'prix'),
      top_ventes: result.rows.filter(r => r.type === 'top_vente').sort((a, b) => (a.rang || 99) - (b.rang || 99))
    }
    res.json(data)
  } catch (err) {
    console.log('erreur selections:', err.message)
    res.status(500).json({ message: 'Erreur serveur' })
  }
})

// POST /selections — ajouter une sélection (admin)
router.post('/', verifierToken, async function(req, res) {
  try {
    const { livre_id, type, label, rang, genre } = req.body
    const result = await pool.query(
      `INSERT INTO selections (livre_id, type, label, rang, genre)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [livre_id, type, label || null, rang || null, genre || null]
    )
    res.status(201).json(result.rows[0])
  } catch (err) {
    res.status(500).json({ message: 'Erreur serveur' })
  }
})

// PUT /selections/:id — modifier une sélection (admin)
router.put('/:id', verifierToken, async function(req, res) {
  try {
    const id = parseInt(req.params.id)
    const { label, rang, genre, actif } = req.body
    const result = await pool.query(
      `UPDATE selections SET label=$1, rang=$2, genre=$3, actif=$4 WHERE id=$5 RETURNING *`,
      [label || null, rang || null, genre || null, actif !== undefined ? actif : true, id]
    )
    res.json(result.rows[0])
  } catch (err) {
    res.status(500).json({ message: 'Erreur serveur' })
  }
})

// DELETE /selections/:id — supprimer une sélection (admin)
router.delete('/:id', verifierToken, async function(req, res) {
  try {
    const id = parseInt(req.params.id)
    await pool.query('DELETE FROM selections WHERE id=$1', [id])
    res.json({ message: 'Sélection supprimée' })
  } catch (err) {
    res.status(500).json({ message: 'Erreur serveur' })
  }
})

module.exports = router