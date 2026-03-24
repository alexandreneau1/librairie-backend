const express = require('express')
const router = express.Router()
const pool = require('../db')

router.get('/', async function(req, res) {
  try {
    const result = await pool.query(
      `SELECT v.id, v.date_vente, v.quantite, v.prix_unitaire,
        c.nom, c.prenom, l.titre
       FROM ventes v
       JOIN clients c ON v.client_id = c.id
       JOIN livres l ON v.livre_id = l.id
       ORDER BY v.date_vente DESC`
    )
    res.json(result.rows)
  } catch (err) {
    res.status(500).json({ message: 'Erreur serveur' })
  }
})

router.post('/', async function(req, res) {
  try {
    const { client_id, livre_id, quantite } = req.body
    const livre = await pool.query(
      'SELECT prix, stock FROM livres WHERE id = $1',
      [livre_id]
    )
    if (livre.rows.length === 0) {
      return res.status(404).json({ message: 'Livre non trouve' })
    }
    if (livre.rows[0].stock < quantite) {
      return res.status(400).json({ message: 'Stock insuffisant' })
    }
    const prix_unitaire = livre.rows[0].prix
    const vente = await pool.query(
      'INSERT INTO ventes (client_id, livre_id, quantite, prix_unitaire) VALUES ($1, $2, $3, $4) RETURNING *',
      [client_id, livre_id, quantite, prix_unitaire]
    )
    await pool.query(
      'UPDATE livres SET stock = stock - $1 WHERE id = $2',
      [quantite, livre_id]
    )
    res.status(201).json(vente.rows[0])
  } catch (err) {
    res.status(500).json({ message: 'Erreur serveur' })
  }
})

module.exports = router