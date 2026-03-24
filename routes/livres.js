const express = require('express')
const router = express.Router()
const pool = require('../db')

router.get('/', async function(req, res) {
  try {
    const titre = req.query.titre
    let result
    if (titre) {
      result = await pool.query(
        'SELECT * FROM livres WHERE LOWER(titre) LIKE LOWER($1)',
        ['%' + titre + '%']
      )
    } else {
      result = await pool.query('SELECT * FROM livres')
    }
    res.json(result.rows)
  } catch (err) {
    res.status(500).json({ message: 'Erreur serveur' })
  }
})

router.get('/:id', async function(req, res) {
  try {
    const id = parseInt(req.params.id)
    const result = await pool.query(
      'SELECT * FROM livres WHERE id = $1',
      [id]
    )
    if (result.rows.length === 0) {
      res.status(404).json({ message: 'Livre non trouve' })
    } else {
      res.json(result.rows[0])
    }
  } catch (err) {
    res.status(500).json({ message: 'Erreur serveur' })
  }
})

router.post('/', async function(req, res) {
  try {
    const { titre, auteur, isbn, prix, stock } = req.body
    const result = await pool.query(
      'INSERT INTO livres (titre, auteur, isbn, prix, stock) VALUES ($1, $2, $3, $4, $5) RETURNING *',
      [titre, auteur, isbn, prix, stock]
    )
    res.status(201).json(result.rows[0])
  } catch (err) {
    res.status(500).json({ message: 'Erreur serveur' })
  }
})

router.put('/:id', async function(req, res) {
  try {
    const id = parseInt(req.params.id)
    const { titre, auteur, isbn, prix, stock } = req.body
    const result = await pool.query(
      'UPDATE livres SET titre=$1, auteur=$2, isbn=$3, prix=$4, stock=$5 WHERE id=$6 RETURNING *',
      [titre, auteur, isbn, prix, stock, id]
    )
    if (result.rows.length === 0) {
      res.status(404).json({ message: 'Livre non trouve' })
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
      'DELETE FROM livres WHERE id=$1 RETURNING *',
      [id]
    )
    if (result.rows.length === 0) {
      res.status(404).json({ message: 'Livre non trouve' })
    } else {
      res.json({ message: 'Livre supprime', livre: result.rows[0] })
    }
  } catch (err) {
    res.status(500).json({ message: 'Erreur serveur' })
  }
})

module.exports = router