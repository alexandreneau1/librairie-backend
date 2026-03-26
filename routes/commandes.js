const express = require('express')
const router = express.Router()
const pool = require('../db')
const verifierToken = require('../middleware/auth')

router.post('/', async function(req, res) {
  try {
    const { livre_id, nom, email, telephone, type } = req.body
    const livre = await pool.query('SELECT * FROM livres WHERE id = $1', [livre_id])
    if (livre.rows.length === 0) {
      return res.status(404).json({ message: 'Livre non trouve' })
    }
    const result = await pool.query(
      'INSERT INTO commandes (livre_id, nom, email, telephone, type) VALUES ($1, $2, $3, $4, $5) RETURNING *',
      [livre_id, nom, email, telephone, type]
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
      `SELECT c.id, c.nom, c.email, c.telephone, c.type, c.statut, c.date_commande, l.titre, l.prix
       FROM commandes c
       JOIN livres l ON c.livre_id = l.id
       ORDER BY c.date_commande DESC`
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
      'UPDATE commandes SET statut=$1 WHERE id=$2 RETURNING *',
      [statut, id]
    )
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Commande non trouvee' })
    }
    res.json(result.rows[0])
  } catch (err) {
    res.status(500).json({ message: 'Erreur serveur' })
  }
})

module.exports = router