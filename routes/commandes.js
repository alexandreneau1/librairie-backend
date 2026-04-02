const express = require('express')
const router = express.Router()
const pool = require('../db')
const verifierToken = require('../middleware/auth')
const { Resend } = require('resend')
const resend = new Resend(process.env.RESEND_API_KEY)

// POST /commandes — commande article unique (existant)
router.post('/', async function(req, res) {
  try {
    const { livre_id, nom, email, telephone, type } = req.body
    const livre = await pool.query('SELECT * FROM livres WHERE id = $1', [livre_id])
    if (livre.rows.length === 0) return res.status(404).json({ message: 'Livre introuvable' })
    const result = await pool.query(
      `INSERT INTO commandes (livre_id, nom, email, telephone, type, statut)
       VALUES ($1, $2, $3, $4, $5, 'en attente') RETURNING *`,
      [livre_id, nom, email, telephone || null, type || 'stock']
    )
    res.status(201).json(result.rows[0])
  } catch (err) {
    console.error('erreur commande:', err.message)
    res.status(500).json({ message: 'Erreur serveur' })
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// POST /commandes/panier — commande multi-articles depuis le panier
// Body : { nom, email, telephone, articles: [{ livre_id, quantite }] }
// Crée une commande par article (quantité > 1 = N lignes) et envoie un mail
// récapitulatif unique.
// ─────────────────────────────────────────────────────────────────────────────
router.post('/panier', async function(req, res) {
  const { nom, email, telephone, articles } = req.body

  if (!nom || !email) {
    return res.status(400).json({ message: 'Nom et email obligatoires' })
  }
  if (!Array.isArray(articles) || articles.length === 0) {
    return res.status(400).json({ message: 'Le panier est vide' })
  }

  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    const commandesCreees = []
    const lignesRecap = [] // pour le mail

    for (const article of articles) {
      const { livre_id, quantite = 1 } = article
      if (!livre_id || quantite < 1) continue

      // Récupérer le livre
      const livreResult = await client.query('SELECT * FROM livres WHERE id = $1', [livre_id])
      if (livreResult.rows.length === 0) continue
      const livre = livreResult.rows[0]

      const type = livre.stock > 0 ? 'stock' : 'commande'

      // Créer une commande par exemplaire
      for (let i = 0; i < quantite; i++) {
        const result = await client.query(
          `INSERT INTO commandes (livre_id, nom, email, telephone, type, statut)
           VALUES ($1, $2, $3, $4, $5, 'en attente') RETURNING id`,
          [livre_id, nom, email, telephone || null, type]
        )
        commandesCreees.push(result.rows[0].id)
      }

      lignesRecap.push({
        titre: livre.titre,
        auteur: livre.auteur,
        prix: livre.prix,
        quantite,
        type,
        total: (livre.prix * quantite).toFixed(2),
      })
    }

    if (commandesCreees.length === 0) {
      await client.query('ROLLBACK')
      return res.status(400).json({ message: 'Aucun article valide dans le panier' })
    }

    await client.query('COMMIT')

    // ── Mail de confirmation ──────────────────────────────────────────────────
    const totalGeneral = lignesRecap.reduce((acc, l) => acc + parseFloat(l.total), 0).toFixed(2)

    const lignesHtml = lignesRecap.map(l => `
      <tr>
        <td style="padding:10px 12px;border-bottom:1px solid #eee;">
          <strong>${l.titre}</strong><br>
          <span style="color:#6B6B5E;font-size:13px;font-style:italic;">${l.auteur}</span>
        </td>
        <td style="padding:10px 12px;border-bottom:1px solid #eee;text-align:center;">${l.quantite}</td>
        <td style="padding:10px 12px;border-bottom:1px solid #eee;text-align:right;">${l.prix} €</td>
        <td style="padding:10px 12px;border-bottom:1px solid #eee;text-align:right;font-weight:600;color:#1A3C2E;">${l.total} €</td>
      </tr>
    `).join('')

    const badgeDispo = lignesRecap.some(l => l.type === 'commande')
      ? `<p style="background:#fff8e6;border-radius:8px;padding:12px 16px;color:#9A6F09;font-size:13px;margin:20px 0;">
           ⚠️ Certains titres ne sont pas en stock et seront commandés auprès de notre distributeur (3 à 5 jours ouvrés).
         </p>`
      : ''

    try {
      await resend.emails.send({
        from: 'onboarding@resend.dev',
        to: email,
        subject: `Votre commande Bookdog — ${lignesRecap.length} titre${lignesRecap.length > 1 ? 's' : ''}`,
        html: `
          <div style="font-family:Georgia,serif;max-width:600px;margin:0 auto;color:#1C1C1C;">
            <div style="background:#1A3C2E;padding:28px 32px;border-radius:12px 12px 0 0;">
              <h1 style="color:white;font-size:24px;margin:0;letter-spacing:2px;">BOOKDOG</h1>
              <p style="color:#EAF2EC;font-size:13px;margin:4px 0 0;">Librairie indépendante — 42 rue Laugier, Paris 17e</p>
            </div>
            <div style="background:white;padding:32px;border:1px solid #eee;border-top:none;border-radius:0 0 12px 12px;">
              <p style="font-size:16px;margin:0 0 8px;">Bonjour <strong>${nom}</strong>,</p>
              <p style="color:#6B6B5E;margin:0 0 24px;">Votre commande Click &amp; Collect a bien été enregistrée. Vous pouvez venir retirer vos livres dès réception de notre confirmation.</p>

              <table style="width:100%;border-collapse:collapse;margin-bottom:16px;">
                <thead>
                  <tr style="background:#F9F6F0;">
                    <th style="padding:10px 12px;text-align:left;font-size:12px;color:#6B6B5E;letter-spacing:1px;font-weight:600;">TITRE</th>
                    <th style="padding:10px 12px;text-align:center;font-size:12px;color:#6B6B5E;letter-spacing:1px;font-weight:600;">QTÉ</th>
                    <th style="padding:10px 12px;text-align:right;font-size:12px;color:#6B6B5E;letter-spacing:1px;font-weight:600;">PRIX UNIT.</th>
                    <th style="padding:10px 12px;text-align:right;font-size:12px;color:#6B6B5E;letter-spacing:1px;font-weight:600;">TOTAL</th>
                  </tr>
                </thead>
                <tbody>${lignesHtml}</tbody>
                <tfoot>
                  <tr>
                    <td colspan="3" style="padding:12px;text-align:right;font-weight:700;font-size:15px;">Total</td>
                    <td style="padding:12px;text-align:right;font-weight:700;font-size:18px;color:#1A3C2E;">${totalGeneral} €</td>
                  </tr>
                </tfoot>
              </table>

              ${badgeDispo}

              <div style="background:#EAF2EC;border-radius:10px;padding:16px 20px;margin-top:24px;">
                <p style="font-weight:700;color:#1A3C2E;margin:0 0 8px;font-size:14px;">📍 Informations pratiques</p>
                <p style="margin:0;font-size:13px;color:#6B6B5E;line-height:1.8;">
                  42 rue Laugier, 75017 Paris<br>
                  Lun–Sam : 10h00 – 20h00<br>
                  06 77 40 21 51
                </p>
              </div>
              <p style="font-size:12px;color:#bbb;margin-top:24px;text-align:center;">Paiement sur place au retrait · Bookdog 2026</p>
            </div>
          </div>
        `,
      })
    } catch (mailErr) {
      // Mail non bloquant — on log mais on ne fail pas la commande
      console.error('Erreur envoi mail panier:', mailErr.message)
    }

    res.status(201).json({
      message: 'Commandes enregistrées',
      nb_commandes: commandesCreees.length,
      ids: commandesCreees,
      recap: lignesRecap,
      total: totalGeneral,
    })

  } catch (err) {
    await client.query('ROLLBACK')
    console.error('erreur commande panier:', err.message)
    res.status(500).json({ message: 'Erreur serveur' })
  } finally {
    client.release()
  }
})

// GET /commandes — toutes les commandes (admin)
router.get('/', verifierToken, async function(req, res) {
  try {
    const result = await pool.query(
      `SELECT c.*, l.titre, l.auteur, l.prix
       FROM commandes c
       JOIN livres l ON c.livre_id = l.id
       ORDER BY c.date_commande DESC`
    )
    res.json(result.rows)
  } catch (err) {
    res.status(500).json({ message: 'Erreur serveur' })
  }
})

// PUT /commandes/:id/statut — changer le statut (admin)
router.put('/:id/statut', verifierToken, async function(req, res) {
  try {
    const id = parseInt(req.params.id)
    const { statut } = req.body
    const result = await pool.query(
      `UPDATE commandes SET statut = $1 WHERE id = $2
       RETURNING *, (SELECT titre FROM livres WHERE id = commandes.livre_id) as titre`,
      [statut, id]
    )
    const commande = result.rows[0]

    // Mail "prêt"
    if (statut === 'pret' && commande) {
      try {
        await resend.emails.send({
          from: 'onboarding@resend.dev',
          to: commande.email,
          subject: `Votre commande est prête — ${commande.titre}`,
          html: `
            <div style="font-family:Georgia,serif;max-width:600px;margin:0 auto;">
              <div style="background:#1A3C2E;padding:28px 32px;border-radius:12px 12px 0 0;">
                <h1 style="color:white;font-size:24px;margin:0;letter-spacing:2px;">BOOKDOG</h1>
              </div>
              <div style="background:white;padding:32px;border:1px solid #eee;border-radius:0 0 12px 12px;">
                <p style="font-size:16px;">Bonjour <strong>${commande.nom}</strong>,</p>
                <p>Votre exemplaire de <strong>${commande.titre}</strong> est prêt à être retiré en boutique.</p>
                <div style="background:#EAF2EC;border-radius:10px;padding:16px 20px;margin-top:20px;">
                  <p style="font-weight:700;color:#1A3C2E;margin:0 0 6px;">📍 Bookdog</p>
                  <p style="margin:0;font-size:13px;color:#6B6B5E;">42 rue Laugier, 75017 Paris · Lun–Sam 10h–20h</p>
                </div>
              </div>
            </div>
          `,
        })
      } catch (mailErr) {
        console.error('Erreur mail prêt:', mailErr.message)
      }
    }

    res.json(commande)
  } catch (err) {
    res.status(500).json({ message: 'Erreur serveur' })
  }
})

module.exports = router