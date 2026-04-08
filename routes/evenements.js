const express = require('express')
const router = express.Router()
const pool = require('../db')
const verifierToken = require('../middleware/auth')

// GET /evenements — tous les événements actifs (public)
router.get('/', async function(req, res) {
  try {
    const result = await pool.query(`
      SELECT * FROM evenements
      WHERE actif = TRUE
      ORDER BY date_evenement ASC
    `)
    res.json(result.rows)
  } catch (err) {
    console.log('erreur evenements:', err.message)
    res.status(500).json({ message: 'Erreur serveur' })
  }
})

// GET /evenements/tous — tous les événements y compris inactifs (admin)
router.get('/tous', verifierToken, async function(req, res) {
  try {
    const result = await pool.query(`
      SELECT * FROM evenements ORDER BY date_evenement ASC
    `)
    res.json(result.rows)
  } catch (err) {
    res.status(500).json({ message: 'Erreur serveur' })
  }
})

// POST /evenements — créer un événement (admin)
router.post('/', verifierToken, async function(req, res) {
  try {
    const { titre, description, date_evenement, categorie, affiche_url, actif } = req.body
    if (!titre || !date_evenement) {
      return res.status(400).json({ message: 'Titre et date requis' })
    }
    const result = await pool.query(
      `INSERT INTO evenements (titre, description, date_evenement, categorie, affiche_url, actif)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [titre, description || null, date_evenement, categorie || null, affiche_url || null, actif !== false]
    )
    res.status(201).json(result.rows[0])
  } catch (err) {
    console.log('erreur creation evenement:', err.message)
    res.status(500).json({ message: 'Erreur serveur' })
  }
})

// PUT /evenements/:id — modifier un événement (admin)
router.put('/:id', verifierToken, async function(req, res) {
  try {
    const id = parseInt(req.params.id)
    const { titre, description, date_evenement, categorie, affiche_url, actif } = req.body
    const result = await pool.query(
      `UPDATE evenements SET titre=$1, description=$2, date_evenement=$3, categorie=$4, affiche_url=$5, actif=$6
       WHERE id=$7 RETURNING *`,
      [titre, description || null, date_evenement, categorie || null, affiche_url || null, actif !== false, id]
    )
    if (result.rows.length === 0) return res.status(404).json({ message: 'Événement introuvable' })
    res.json(result.rows[0])
  } catch (err) {
    res.status(500).json({ message: 'Erreur serveur' })
  }
})

// DELETE /evenements/:id — supprimer un événement (admin)
router.delete('/:id', verifierToken, async function(req, res) {
  try {
    const id = parseInt(req.params.id)
    await pool.query('DELETE FROM evenements WHERE id=$1', [id])
    res.json({ message: 'Événement supprimé' })
  } catch (err) {
    res.status(500).json({ message: 'Erreur serveur' })
  }
})

module.exports = router