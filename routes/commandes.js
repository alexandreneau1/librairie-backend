const express = require('express')
const router = express.Router()
const pool = require('../db')
const verifierToken = require('../middleware/auth')
const { Resend } = require('resend')

const resend = new Resend(process.env.RESEND_API_KEY)

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

    // Envoi du mail quand la commande passe au statut "pret"
    if (statut === 'pret') {
      const commande = result.rows[0]

      // Récupérer le titre du livre
      const livre = await pool.query('SELECT titre FROM livres WHERE id = $1', [commande.livre_id])
      const titreLivre = livre.rows.length > 0 ? livre.rows[0].titre : 'votre livre'

      try {
        await resend.emails.send({
          from: 'Bookdog <onboarding@resend.dev>',
          to: commande.email,
          subject: 'Votre commande est prête à récupérer — Bookdog',
          html: `
            <div style="font-family: Georgia, serif; max-width: 520px; margin: 0 auto; color: #1a1a1a;">
              <div style="background-color: #1a3d2b; padding: 24px 32px;">
                <h1 style="color: #f9f6f1; margin: 0; font-size: 22px; letter-spacing: 1px;">BOOKDOG</h1>
                <p style="color: #c9a84c; margin: 4px 0 0; font-size: 13px;">42 rue Laugier, Paris 17e</p>
              </div>
              <div style="padding: 32px; background-color: #f9f6f1;">
                <p style="font-size: 16px;">Bonjour <strong>${commande.nom}</strong>,</p>
                <p style="font-size: 15px; line-height: 1.6;">
                  Bonne nouvelle ! Votre commande Click &amp; Collect est prête à être récupérée en librairie.
                </p>
                <div style="background: #fff; border-left: 4px solid #c9a84c; padding: 16px 20px; margin: 24px 0; border-radius: 2px;">
                  <p style="margin: 0; font-size: 14px; color: #555;">Livre commandé</p>
                  <p style="margin: 6px 0 0; font-size: 16px; font-weight: bold;">${titreLivre}</p>
                </div>
                <p style="font-size: 14px; color: #444; line-height: 1.6;">
                  Vous pouvez passer nous voir aux horaires d'ouverture :<br/>
                  <strong>Lundi – Samedi, 10h – 20h</strong>
                </p>
                <p style="font-size: 14px; color: #444;">
                  Une question ? Appelez-nous au <strong>06 77 40 21 51</strong> ou répondez à cet email.
                </p>
              </div>
              <div style="background-color: #1a3d2b; padding: 16px 32px; text-align: center;">
                <p style="color: #f9f6f1; font-size: 12px; margin: 0; opacity: 0.7;">© Bookdog — 42 rue Laugier, 75017 Paris</p>
              </div>
            </div>
          `
        })
      } catch (mailErr) {
        // On logue l'erreur mail sans bloquer la réponse API
        console.log('Erreur envoi mail:', mailErr.message)
      }
    }

    res.json(result.rows[0])
  } catch (err) {
    res.status(500).json({ message: 'Erreur serveur' })
  }
})

module.exports = router