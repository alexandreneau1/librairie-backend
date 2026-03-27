const express = require('express')
const router = express.Router()
const pool = require('../db')
const bcrypt = require('bcrypt')
const jwt = require('jsonwebtoken')

// POST /compte/inscription
router.post('/inscription', async function(req, res) {
  try {
    const { nom, prenom, email, mot_de_passe } = req.body
    if (!email || !mot_de_passe) {
      return res.status(400).json({ message: 'Email et mot de passe requis' })
    }
    const existant = await pool.query('SELECT id FROM comptes_clients WHERE email = $1', [email])
    if (existant.rows.length > 0) {
      return res.status(409).json({ message: 'Un compte existe déjà avec cet email' })
    }
    const hash = await bcrypt.hash(mot_de_passe, 10)
    const result = await pool.query(
      'INSERT INTO comptes_clients (nom, prenom, email, mot_de_passe) VALUES ($1, $2, $3, $4) RETURNING id, nom, prenom, email, date_inscription',
      [nom, prenom, email, hash]
    )
    res.status(201).json(result.rows[0])
  } catch (err) {
    console.log('erreur inscription:', err.message)
    res.status(500).json({ message: 'Erreur serveur' })
  }
})

// POST /compte/connexion
router.post('/connexion', async function(req, res) {
  try {
    const { email, mot_de_passe } = req.body
    const result = await pool.query('SELECT * FROM comptes_clients WHERE email = $1', [email])
    if (result.rows.length === 0) {
      return res.status(401).json({ message: 'Email ou mot de passe incorrect' })
    }
    const client = result.rows[0]
    const valide = await bcrypt.compare(mot_de_passe, client.mot_de_passe)
    if (!valide) {
      return res.status(401).json({ message: 'Email ou mot de passe incorrect' })
    }
    const token = jwt.sign(
      { id: client.id, email: client.email, role: 'client' },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    )
    res.json({ token, client: { id: client.id, nom: client.nom, prenom: client.prenom, email: client.email } })
  } catch (err) {
    console.log('erreur connexion:', err.message)
    res.status(500).json({ message: 'Erreur serveur' })
  }
})

// Middleware : vérifier token client
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

// GET /compte/historique
router.get('/historique', verifierTokenClient, async function(req, res) {
  try {
    const email = req.client.email

    const commandes = await pool.query(
      `SELECT c.id, c.type, c.statut, c.date_commande, l.titre, l.auteur, l.prix
       FROM commandes c
       JOIN livres l ON c.livre_id = l.id
       WHERE c.email = $1
       ORDER BY c.date_commande DESC`,
      [email]
    )

    const reservations = await pool.query(
      `SELECT r.id, r.statut, r.date_reservation, l.titre, l.auteur, l.prix
       FROM reservations r
       JOIN livres l ON r.livre_id = l.id
       WHERE r.email = $1
       ORDER BY r.date_reservation DESC`,
      [email]
    )

    const ventes = await pool.query(
      `SELECT v.id, v.quantite, v.prix_unitaire, v.date_vente, l.titre, l.auteur
       FROM ventes v
       JOIN livres l ON v.livre_id = l.id
       WHERE v.client_id = (SELECT id FROM clients WHERE email = $1 LIMIT 1)
       ORDER BY v.date_vente DESC`,
      [email]
    )

    res.json({
      commandes: commandes.rows,
      reservations: reservations.rows,
      ventes: ventes.rows
    })
  } catch (err) {
    console.log('erreur historique:', err.message)
    res.status(500).json({ message: 'Erreur serveur' })
  }
})

// GET /compte/wishlist
router.get('/wishlist', verifierTokenClient, async function(req, res) {
  try {
    const result = await pool.query(
      `SELECT w.id, w.date_ajout, l.id as livre_id, l.titre, l.auteur, l.prix, l.stock
       FROM wishlist w
       JOIN livres l ON w.livre_id = l.id
       WHERE w.email = $1
       ORDER BY w.date_ajout DESC`,
      [req.client.email]
    )
    res.json(result.rows)
  } catch (err) {
    res.status(500).json({ message: 'Erreur serveur' })
  }
})

// POST /compte/wishlist
router.post('/wishlist', verifierTokenClient, async function(req, res) {
  try {
    const { livre_id } = req.body
    const result = await pool.query(
      'INSERT INTO wishlist (email, livre_id) VALUES ($1, $2) RETURNING *',
      [req.client.email, livre_id]
    )
    res.status(201).json(result.rows[0])
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ message: 'Livre déjà dans la wishlist' })
    }
    res.status(500).json({ message: 'Erreur serveur' })
  }
})

// DELETE /compte/wishlist/:livre_id
router.delete('/wishlist/:livre_id', verifierTokenClient, async function(req, res) {
  try {
    const livre_id = parseInt(req.params.livre_id)
    await pool.query('DELETE FROM wishlist WHERE email = $1 AND livre_id = $2', [req.client.email, livre_id])
    res.json({ message: 'Livre retiré de la wishlist' })
  } catch (err) {
    res.status(500).json({ message: 'Erreur serveur' })
  }
})

module.exports = router