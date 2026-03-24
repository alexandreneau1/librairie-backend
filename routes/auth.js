const express = require('express')
const router = express.Router()
const pool = require('../db')
const bcrypt = require('bcrypt')
const jwt = require('jsonwebtoken')

const SECRET = 'librairie_secret_key'

router.post('/inscription', async function(req, res) {
  try {
    const { email, mot_de_passe } = req.body
    const hash = await bcrypt.hash(mot_de_passe, 10)
    const result = await pool.query(
      'INSERT INTO utilisateurs (email, mot_de_passe) VALUES ($1, $2) RETURNING id, email, role',
      [email, hash]
    )
    res.status(201).json(result.rows[0])
  } catch (err) {
    res.status(500).json({ message: 'Erreur serveur' })
  }
})

router.post('/connexion', async function(req, res) {
  try {
    const { email, mot_de_passe } = req.body
    const result = await pool.query(
      'SELECT * FROM utilisateurs WHERE email = $1',
      [email]
    )
    if (result.rows.length === 0) {
      return res.status(401).json({ message: 'Email ou mot de passe incorrect' })
    }
    const utilisateur = result.rows[0]
    const valide = await bcrypt.compare(mot_de_passe, utilisateur.mot_de_passe)
    if (!valide) {
      return res.status(401).json({ message: 'Email ou mot de passe incorrect' })
    }
    const token = jwt.sign(
      { id: utilisateur.id, email: utilisateur.email, role: utilisateur.role },
      SECRET,
      { expiresIn: '24h' }
    )
    res.json({ token })
  } catch (err) {
    res.status(500).json({ message: 'Erreur serveur' })
  }
})

module.exports = router