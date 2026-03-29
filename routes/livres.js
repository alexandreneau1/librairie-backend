const express = require('express')
const router = express.Router()
const pool = require('../db')
const verifierToken = require('../middleware/auth')

const normalise = function(str) {
  return str.toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9 ]/g, '')
    .replace(/\s+/g, '')
}

router.get('/', async function(req, res) {
  try {
    const titre = req.query.titre
    const result = await pool.query('SELECT * FROM livres')
    if (titre) {
      const recherche = normalise(titre)
      const filtres = result.rows.filter(function(livre) {
        const titreNormalise = normalise(livre.titre)
        return titreNormalise.includes(recherche)
      })
      res.json(filtres)
    } else {
      res.json(result.rows)
    }
  } catch (err) {
    console.log('erreur:', err.message)
    res.status(500).json({ message: 'Erreur serveur' })
  }
})

router.get('/:id', async function(req, res) {
  try {
    const id = parseInt(req.params.id)
    const result = await pool.query('SELECT * FROM livres WHERE id = $1', [id])
    if (result.rows.length === 0) {
      res.status(404).json({ message: 'Livre non trouve' })
    } else {
      res.json(result.rows[0])
    }
  } catch (err) {
    res.status(500).json({ message: 'Erreur serveur' })
  }
})

router.post('/', verifierToken, async function(req, res) {
  try {
    const { titre, auteur, isbn, prix, stock, genre, description, editeur, collection, date_publication, url_goodreads } = req.body
    const result = await pool.query(
      `INSERT INTO livres (titre, auteur, isbn, prix, stock, genre, description, editeur, collection, date_publication, url_goodreads)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
      [titre, auteur, isbn, prix, stock, genre || null, description || null, editeur || null, collection || null, date_publication || null, url_goodreads || null]
    )
    res.status(201).json(result.rows[0])
  } catch (err) {
    res.status(500).json({ message: 'Erreur serveur' })
  }
})

router.put('/:id', verifierToken, async function(req, res) {
  try {
    const id = parseInt(req.params.id)
    const { titre, auteur, isbn, prix, stock, genre, description, editeur, collection, date_publication, url_goodreads } = req.body
    const result = await pool.query(
      `UPDATE livres SET titre=$1, auteur=$2, isbn=$3, prix=$4, stock=$5, genre=$6,
       description=$7, editeur=$8, collection=$9, date_publication=$10, url_goodreads=$11
       WHERE id=$12 RETURNING *`,
      [titre, auteur, isbn, prix, stock, genre || null, description || null, editeur || null, collection || null, date_publication || null, url_goodreads || null, id]
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

router.delete('/:id', verifierToken, async function(req, res) {
  try {
    const id = parseInt(req.params.id)
    const result = await pool.query('DELETE FROM livres WHERE id=$1 RETURNING *', [id])
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