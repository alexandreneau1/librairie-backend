const express = require('express')
const router = express.Router()
const pool = require('../db')
const bcrypt = require('bcrypt')
const jwt = require('jsonwebtoken')
const crypto = require('crypto')
const { Resend } = require('resend')

const resend = new Resend(process.env.RESEND_API_KEY)

// POST /compte/inscription
router.post('/inscription', async function(req, res) {
  try {
    const { nom, prenom, email, mot_de_passe, ce_id } = req.body
    if (!email || !mot_de_passe) {
      return res.status(400).json({ message: 'Email et mot de passe requis' })
    }

    const existant = await pool.query('SELECT id FROM comptes_clients WHERE email = $1', [email])
    if (existant.rows.length > 0) {
      return res.status(409).json({ message: 'Un compte existe déjà avec cet email' })
    }

    // Vérification CE : si ce_id fourni, on vérifie que le domaine email correspond bien
    let ceIdValide = null
    if (ce_id) {
      const domaine = email.split('@')[1]?.toLowerCase()
      if (domaine) {
        const ceCheck = await pool.query(`
          SELECT c.id FROM ces c
          INNER JOIN ce_domaines d ON d.ce_id = c.id
          WHERE c.id = $1 AND d.domaine = $2 AND c.actif = TRUE
        `, [ce_id, domaine])
        if (ceCheck.rows.length > 0) ceIdValide = ce_id
        // Si le domaine ne correspond pas au ce_id fourni, on ignore silencieusement
      }
    } else {
      // Tentative de détection automatique par domaine même sans ce_id explicite
      const domaine = email.split('@')[1]?.toLowerCase()
      if (domaine) {
        const ceAuto = await pool.query(`
          SELECT c.id FROM ces c
          INNER JOIN ce_domaines d ON d.ce_id = c.id
          WHERE d.domaine = $1 AND c.actif = TRUE
        `, [domaine])
        if (ceAuto.rows.length > 0) ceIdValide = ceAuto.rows[0].id
      }
    }

    const hash = await bcrypt.hash(mot_de_passe, 10)
    const result = await pool.query(
      `INSERT INTO comptes_clients (nom, prenom, email, mot_de_passe, ce_id)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, nom, prenom, email, date_inscription, ce_id`,
      [nom, prenom, email, hash, ceIdValide]
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

    // Récupérer les infos CE si le client en a un
    let ce = null
    if (client.ce_id) {
      const ceResult = await pool.query(
        'SELECT id, nom, code, remise, adresse_livraison FROM ces WHERE id = $1 AND actif = TRUE',
        [client.ce_id]
      )
      if (ceResult.rows.length > 0) ce = ceResult.rows[0]
    }

    const token = jwt.sign(
      { id: client.id, email: client.email, role: 'client' },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    )

    res.json({
      token,
      client: {
        id: client.id,
        nom: client.nom,
        prenom: client.prenom,
        email: client.email,
        ce: ce, // null si pas de CE
      }
    })
  } catch (err) {
    console.log('erreur connexion:', err.message)
    res.status(500).json({ message: 'Erreur serveur' })
  }
})

// POST /compte/reset-demande
router.post('/reset-demande', async function(req, res) {
  try {
    const { email } = req.body
    if (!email) {
      return res.status(400).json({ message: 'Email requis' })
    }
    const client = await pool.query('SELECT id FROM comptes_clients WHERE email = $1', [email])
    if (client.rows.length === 0) {
      return res.json({ message: 'Si un compte existe avec cet email, un lien a été envoyé.' })
    }
    const token = crypto.randomBytes(32).toString('hex')
    const expiration = new Date(Date.now() + 60 * 60 * 1000) // 1h
    await pool.query(
      'INSERT INTO reset_tokens (email, token, expire_le) VALUES ($1, $2, $3)',
      [email, token, expiration]
    )
    const lien = 'http://localhost:3000/compte/reset/' + token
    try {
      await resend.emails.send({
        from: 'Bookdog <onboarding@resend.dev>',
        to: email,
        subject: 'Réinitialisation de votre mot de passe — Bookdog',
        html: `
          <div style="font-family: Georgia, serif; max-width: 520px; margin: 0 auto; color: #1a1a1a;">
            <div style="background-color: #1a3d2b; padding: 24px 32px;">
              <h1 style="color: #f9f6f1; margin: 0; font-size: 22px; letter-spacing: 1px;">BOOKDOG</h1>
              <p style="color: #c9a84c; margin: 4px 0 0; font-size: 13px;">42 rue Laugier, Paris 17e</p>
            </div>
            <div style="padding: 32px; background-color: #f9f6f1;">
              <p style="font-size: 16px;">Bonjour,</p>
              <p style="font-size: 15px; line-height: 1.6;">
                Vous avez demandé à réinitialiser votre mot de passe. Cliquez sur le bouton ci-dessous pour en choisir un nouveau.
              </p>
              <div style="text-align: center; margin: 32px 0;">
                <a href="${lien}" style="background-color: #1a3d2b; color: white; padding: 14px 32px; border-radius: 40px; text-decoration: none; font-size: 15px; font-weight: 700;">
                  Réinitialiser mon mot de passe
                </a>
              </div>
              <p style="font-size: 13px; color: #888; line-height: 1.6;">
                Ce lien est valable 1 heure. Si vous n'avez pas fait cette demande, ignorez cet email.
              </p>
            </div>
            <div style="background-color: #1a3d2b; padding: 16px 32px; text-align: center;">
              <p style="color: #f9f6f1; font-size: 12px; margin: 0; opacity: 0.7;">© Bookdog — 42 rue Laugier, 75017 Paris</p>
            </div>
          </div>
        `
      })
    } catch (mailErr) {
      console.log('Erreur envoi mail reset:', mailErr.message)
    }
    res.json({ message: 'Si un compte existe avec cet email, un lien a été envoyé.' })
  } catch (err) {
    console.log('erreur reset-demande:', err.message)
    res.status(500).json({ message: 'Erreur serveur' })
  }
})

// POST /compte/reset-confirmer
router.post('/reset-confirmer', async function(req, res) {
  try {
    const { token, mot_de_passe } = req.body
    if (!token || !mot_de_passe) {
      return res.status(400).json({ message: 'Token et mot de passe requis' })
    }
    if (mot_de_passe.length < 8) {
      return res.status(400).json({ message: 'Le mot de passe doit contenir au minimum 8 caractères' })
    }
    const result = await pool.query(
      'SELECT * FROM reset_tokens WHERE token = $1 AND utilise = FALSE AND expire_le > NOW()',
      [token]
    )
    if (result.rows.length === 0) {
      return res.status(400).json({ message: 'Lien invalide ou expiré' })
    }
    const resetToken = result.rows[0]
    const hash = await bcrypt.hash(mot_de_passe, 10)
    await pool.query('UPDATE comptes_clients SET mot_de_passe = $1 WHERE email = $2', [hash, resetToken.email])
    await pool.query('UPDATE reset_tokens SET utilise = TRUE WHERE token = $1', [token])
    res.json({ message: 'Mot de passe mis à jour avec succès' })
  } catch (err) {
    console.log('erreur reset-confirmer:', err.message)
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

// GET /compte/preferences
router.get("/preferences", verifierTokenClient, async function(req, res) {
  try {
    const result = await pool.query(
      "SELECT email_recommandations, email_relance_saga FROM comptes_clients WHERE id = $1",
      [req.client.id]
    )
    if (result.rows.length === 0) return res.status(404).json({ message: "Client introuvable" })
    res.json(result.rows[0])
  } catch (err) {
    res.status(500).json({ message: "Erreur serveur" })
  }
})

// PUT /compte/preferences
router.put("/preferences", verifierTokenClient, async function(req, res) {
  try {
    const { email_recommandations, email_relance_saga } = req.body
    await pool.query(
      "UPDATE comptes_clients SET email_recommandations = $1, email_relance_saga = $2 WHERE id = $3",
      [email_recommandations !== false, email_relance_saga !== false, req.client.id]
    )
    res.json({ message: "Preferences mises a jour", email_recommandations, email_relance_saga })
  } catch (err) {
    res.status(500).json({ message: "Erreur serveur" })
  }
})

module.exports = router