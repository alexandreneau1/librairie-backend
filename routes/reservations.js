const express = require('express')
const router = express.Router()
const pool = require('../db')
const verifierToken = require('../middleware/auth')

router.post('/', async function(req, res) {
  try {
    const { livre_id, nom, email } = req.body
    const livre = await pool.query(
      'SELECT * FROM livres WHERE id = $1',
      [livre_id]
    )
    if (livre.rows.length === 0) {
      return res.status(404).json({ message: 'Livre non trouve' })
    }
    if (livre.rows[0].stock === 0) {
      return res.status(400).json({ message: 'Stock epuise' })
    }
    const result = await pool.query(
      'INSERT INTO reservations (livre_id, nom, email) VALUES ($1, $2, $3) RETURNING *',
      [livre_id, nom, email]
    )
    res.status(201).json(result.rows[0])
  } catch (err) {
    console.log('erreur:', err.message)
    res.status(500).json({ message: 'Erreur serveur' })
  }
})

router.get('/', verifierToken, async function(req, res) {
  try {
    const result = await pool.query(
      `SELECT r.id, r.nom, r.email, r.date_reservation, r.statut, l.titre
       FROM reservations r
       JOIN livres l ON r.livre_id = l.id
       ORDER BY r.date_reservation DESC`
    )
    res.json(result.rows)
  } catch (err) {
    res.status(500).json({ message: 'Erreur serveur' })
  }
})

router.put('/:id/statut', verifierToken, async function(req, res) {
  try {
    const id = parseInt(req.params.id)
    const { statut } = req.body
    const result = await pool.query(
      'UPDATE reservations SET statut=$1 WHERE id=$2 RETURNING *',
      [statut, id]
    )
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Reservation non trouvee' })
    }
    res.json(result.rows[0])
  } catch (err) {
    res.status(500).json({ message: 'Erreur serveur' })
  }
})

module.exports = router