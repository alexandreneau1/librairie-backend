const express = require('express')
const router = express.Router()
const pool = require('../db')

router.get('/', async function(req, res) {
  try {
    const result = await pool.query('SELECT * FROM clients')
    res.json(result.rows)
  } catch (err) {
    res.status(500).json({ message: 'Erreur serveur' })
  }
})

router.get('/:id', async function(req, res) {
  try {
    const id = parseInt(req.params.id)
    const result = await pool.query(
      'SELECT * FROM clients WHERE id = $1',
      [id]
    )
    if (result.rows.length === 0) {
      res.status(404).json({ message: 'Client non trouve' })
    } else {
      res.json(result.rows[0])
    }
  } catch (err) {
    res.status(500).json({ message: 'Erreur serveur' })
  }
})
router.post('/', async function(req, res) {
  try {
    const { nom, prenom, email, telephone } = req.body
    const result = await pool.query(
      'INSERT INTO clients (nom, prenom, email, telephone) VALUES ($1, $2, $3, $4) RETURNING *',
      [nom, prenom, email, telephone]
    )
    res.status(201).json(result.rows[0])
  } catch (err) {
    res.status(500).json({ message: 'Erreur serveur' })
  }
})

router.put('/:id', async function(req, res) {
  try {
    const id = parseInt(req.params.id)
    const { nom, prenom, email, telephone } = req.body
    const result = await pool.query(
      'UPDATE clients SET nom=$1, prenom=$2, email=$3, telephone=$4 WHERE id=$5 RETURNING *',
      [nom, prenom, email, telephone, id]
    )
    if (result.rows.length === 0) {
      res.status(404).json({ message: 'Client non trouve' })
    } else {
      res.json(result.rows[0])
    }
  } catch (err) {
    res.status(500).json({ message: 'Erreur serveur' })
  }
})

router.delete('/:id', async function(req, res) {
  try {
    const id = parseInt(req.params.id)
    const result = await pool.query(
      'DELETE FROM clients WHERE id=$1 RETURNING *',
      [id]
    )
    if (result.rows.length === 0) {
      res.status(404).json({ message: 'Client non trouve' })
    } else {
      res.json({ message: 'Client supprime', client: result.rows[0] })
    }
  } catch (err) {
    res.status(500).json({ message: 'Erreur serveur' })
  }
})
module.exports = router