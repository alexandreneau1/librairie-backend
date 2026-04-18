const express = require('express')
const router = express.Router()
const pool = require('../db')
const verifierToken = require('../middleware/auth')
const { Resend } = require('resend')
const resend = new Resend(process.env.RESEND_API_KEY)

// ── Helpers ───────────────────────────────────────────────────────────────────

// Calcule le délai de relance en semaines selon le nombre de pages estimé
// Si non disponible, on utilise 3 semaines par défaut
function calculerDelaiRelance(livre) {
  // On estime ~50 pages/jour pour un lecteur moyen
  // donc 200p = 4 jours, 400p = 8 jours, 600p = 12 jours
  // On arrondit à la semaine supérieure + 1 semaine tampon
  if (!livre.nb_pages) return 3 // défaut : 3 semaines
  const jours = Math.ceil(livre.nb_pages / 50)
  const semaines = Math.ceil(jours / 7) + 1
  return Math.min(Math.max(semaines, 2), 8) // entre 2 et 8 semaines
}

function dateEnvoi(semaines) {
  const d = new Date()
  d.setDate(d.getDate() + semaines * 7)
  // Normaliser à 10h00 le matin
  d.setHours(10, 0, 0, 0)
  return d
}

// ── GET /crm/taches — liste toutes les tâches (admin) ────────────────────────
router.get('/taches', verifierToken, async (req, res) => {
  try {
    const { type, envoye, limit = 50 } = req.query
    let where = []
    let params = []
    let idx = 1

    if (type) { where.push(`t.type = $${idx++}`); params.push(type) }
    if (envoye !== undefined) { where.push(`t.envoye = $${idx++}`); params.push(envoye === 'true') }

    const whereClause = where.length ? 'WHERE ' + where.join(' AND ') : ''

    const result = await pool.query(`
      SELECT
        t.*,
        l.titre as livre_titre, l.auteur as livre_auteur,
        l.serie, l.tome_numero,
        ls.titre as tome_suivant_titre, ls.tome_numero as tome_suivant_numero,
        cc.prenom, cc.nom as client_nom
      FROM crm_taches t
      LEFT JOIN livres l ON l.id = t.livre_id
      LEFT JOIN livres ls ON ls.id = t.livre_suivant_id
      LEFT JOIN comptes_clients cc ON cc.id = t.client_id
      ${whereClause}
      ORDER BY t.date_envoi ASC
      LIMIT $${idx}
    `, [...params, parseInt(limit)])

    res.json(result.rows)
  } catch (err) {
    res.status(500).json({ message: 'Erreur serveur', detail: err.message })
  }
})

// ── GET /crm/stats — statistiques CRM ────────────────────────────────────────
router.get('/stats', verifierToken, async (req, res) => {
  try {
    const stats = await pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE NOT envoye) as en_attente,
        COUNT(*) FILTER (WHERE envoye) as envoyes,
        COUNT(*) FILTER (WHERE NOT envoye AND date_envoi <= NOW()) as dus_aujourd_hui,
        COUNT(*) FILTER (WHERE NOT envoye AND date_envoi > NOW() AND date_envoi <= NOW() + INTERVAL '7 days') as dus_7_jours,
        COUNT(*) FILTER (WHERE type = 'relance_saga' AND NOT envoye) as sagas_en_attente,
        COUNT(*) FILTER (WHERE type = 'recommandation' AND NOT envoye) as recos_en_attente
      FROM crm_taches
    `)

    const clientsOptin = await pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE email_recommandations = TRUE) as optin_recos,
        COUNT(*) FILTER (WHERE email_relance_saga = TRUE) as optin_sagas,
        COUNT(*) as total
      FROM comptes_clients
    `)

    res.json({
      taches: stats.rows[0],
      clients: clientsOptin.rows[0],
    })
  } catch (err) {
    res.status(500).json({ message: 'Erreur serveur' })
  }
})

// ── PUT /crm/taches/:id — modifier date_envoi ────────────────────────────────
router.put('/taches/:id', verifierToken, async (req, res) => {
  try {
    const id = parseInt(req.params.id)
    const { date_envoi, annuler } = req.body

    if (annuler) {
      await pool.query('DELETE FROM crm_taches WHERE id = $1', [id])
      return res.json({ message: 'Tâche supprimée' })
    }

    if (!date_envoi) return res.status(400).json({ message: 'date_envoi requis' })

    const result = await pool.query(
      'UPDATE crm_taches SET date_envoi = $1 WHERE id = $2 AND envoye = FALSE RETURNING *',
      [new Date(date_envoi), id]
    )
    if (result.rows.length === 0) return res.status(404).json({ message: 'Tâche introuvable ou déjà envoyée' })
    res.json(result.rows[0])
  } catch (err) {
    res.status(500).json({ message: 'Erreur serveur' })
  }
})

// ── DELETE /crm/taches/:id ────────────────────────────────────────────────────
router.delete('/taches/:id', verifierToken, async (req, res) => {
  try {
    await pool.query('DELETE FROM crm_taches WHERE id = $1', [parseInt(req.params.id)])
    res.json({ message: 'Tâche supprimée' })
  } catch (err) {
    res.status(500).json({ message: 'Erreur serveur' })
  }
})

// ── POST /crm/taches/envoyer — envoie toutes les tâches dues ─────────────────
router.post('/taches/envoyer', verifierToken, async (req, res) => {
  try {
    // Récupérer toutes les tâches dues et non envoyées
    const taches = await pool.query(`
      SELECT
        t.*,
        l.titre as livre_titre, l.auteur as livre_auteur, l.serie, l.tome_numero,
        ls.titre as tome_suivant_titre, ls.auteur as tome_suivant_auteur,
        ls.tome_numero as tome_suivant_numero, ls.prix as tome_suivant_prix,
        ls.id as tome_suivant_id,
        cc.prenom, cc.nom as client_nom, cc.email_recommandations, cc.email_relance_saga
      FROM crm_taches t
      LEFT JOIN livres l ON l.id = t.livre_id
      LEFT JOIN livres ls ON ls.id = t.livre_suivant_id
      LEFT JOIN comptes_clients cc ON cc.id = t.client_id
      WHERE t.envoye = FALSE AND t.date_envoi <= NOW()
    `)

const rapport = { envoyes: 0, erreurs: 0, ignores: 0, details: [] }
    for (const tache of taches.rows) {
      try {
        // Vérifier que le client est toujours opt-in
        if (tache.type === 'recommandation' && tache.email_recommandations === false) {
          rapport.ignores++
          await pool.query('DELETE FROM crm_taches WHERE id = $1', [tache.id])
          continue
        }
        if (tache.type === 'relance_saga' && tache.email_relance_saga === false) {
          rapport.ignores++
          await pool.query('DELETE FROM crm_taches WHERE id = $1', [tache.id])
          continue
        }

        let html = ''
        let subject = ''

        if (tache.type === 'relance_saga') {
          subject = `Avez-vous terminé ${tache.livre_titre} ? La suite vous attend !`
          html = emailRelanceSaga({
            prenom: tache.prenom || 'cher lecteur',
            livreTitre: tache.livre_titre,
            livreAuteur: tache.livre_auteur,
            serie: tache.serie,
            tomeActuel: tache.tome_numero,
            tomeSuivantTitre: tache.tome_suivant_titre,
            tomeSuivantAuteur: tache.tome_suivant_auteur,
            tomeSuivantNumero: tache.tome_suivant_numero,
            tomeSuivantPrix: tache.tome_suivant_prix,
            tomeSuivantId: tache.tome_suivant_id,
          })
        } else if (tache.type === 'recommandation') {
          const data = tache.data || {}
          subject = `${tache.prenom || 'Cher lecteur'}, vos recommandations du mois chez Bookdog`
          html = emailRecommandation({
            prenom: tache.prenom || 'cher lecteur',
            recommandations: data.recommandations || [],
          })
        }

        if (!html) { rapport.ignores++; continue }

        await resend.emails.send({
          from: 'Bookdog <onboarding@resend.dev>',
          to: tache.email,
          subject,
          html,
        })

        await pool.query(
          'UPDATE crm_taches SET envoye = TRUE, date_envoi_effectif = NOW() WHERE id = $1',
          [tache.id]
        )

        rapport.envoyes++
        rapport.details.push({ id: tache.id, type: tache.type, email: tache.email, statut: 'envoyé' })

      } catch (err) {
        rapport.erreurs++
        rapport.details.push({ id: tache.id, type: tache.type, email: tache.email, statut: 'erreur', detail: err.message })
      }
    }

    res.json({ message: 'Envoi terminé', ...rapport })
  } catch (err) {
    res.status(500).json({ message: 'Erreur serveur', detail: err.message })
  }
})

// ── POST /crm/recommandations/planifier ──────────────────────────────────────
// Crée les tâches de recommandation mensuelle pour tous les clients opt-in
// qui n'ont pas déjà une tâche planifiée ce mois-ci
router.post('/recommandations/planifier', verifierToken, async (req, res) => {
  try {
    const clients = await pool.query(`
      SELECT cc.id, cc.email, cc.prenom, cc.nom
      FROM comptes_clients cc
      WHERE cc.email_recommandations = TRUE
      AND NOT EXISTS (
        SELECT 1 FROM crm_taches t
        WHERE t.client_id = cc.id
        AND t.type = 'recommandation'
        AND t.envoye = FALSE
        AND date_trunc('month', t.date_envoi) = date_trunc('month', NOW())
      )
    `)

    // Date d'envoi : 1er du mois suivant à 10h
    const premierDuMois = new Date()
    premierDuMois.setMonth(premierDuMois.getMonth() + 1)
    premierDuMois.setDate(1)
    premierDuMois.setHours(10, 0, 0, 0)

    let crees = 0
    for (const client of clients.rows) {
      // Récupérer les recommandations Gemini pour ce client
      try {
        const token_fake = null // pas de token client ici, on utilise l'id directement
        const historique = await pool.query(`
          SELECT DISTINCT l.titre, l.auteur, l.genre
          FROM commandes c
          JOIN livres l ON l.id = c.livre_id
          WHERE c.email = $1
          ORDER BY l.titre
          LIMIT 20
        `, [client.email])

        const wishlistItems = await pool.query(`
          SELECT l.titre, l.auteur, l.genre
          FROM wishlist w JOIN livres l ON l.id = w.livre_id
          WHERE w.email = $1 LIMIT 10
        `, [client.email])

        const catalogueDispo = await pool.query(`
          SELECT id, titre, auteur, genre, prix
          FROM livres WHERE stock > 0
          ORDER BY RANDOM() LIMIT 30
        `)

        // Appel Gemini
        const prompt = `Tu es libraire. Voici les livres achetés par ce client : ${JSON.stringify(historique.rows)}.
Sa wishlist : ${JSON.stringify(wishlistItems.rows)}.
Catalogue disponible : ${JSON.stringify(catalogueDispo.rows)}.
Propose 3 livres du catalogue qu'il n'a pas encore lus et qui correspondent à ses goûts.
Réponds UNIQUEMENT en JSON : [{"livre_id": X, "titre": "...", "auteur": "...", "genre": "...", "prix": X.XX, "raison": "..."}]`

        const geminiRes = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{ parts: [{ text: prompt }] }],
              generationConfig: { maxOutputTokens: 4096 },
            }),
          }
        )

        const geminiData = await geminiRes.json()
        const text = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || '[]'
        const clean = text.replace(/```json|```/g, '').trim()
        const recommandations = JSON.parse(clean)

        await pool.query(
          `INSERT INTO crm_taches (type, email, client_id, data, date_envoi)
           VALUES ('recommandation', $1, $2, $3, $4)`,
          [client.email, client.id, JSON.stringify({ recommandations }), premierDuMois]
        )
        crees++
      } catch (err) {
        console.error('Erreur planif reco client', client.email, err.message)
      }
    }

    res.json({ message: 'Planification terminée', taches_creees: crees, date_envoi: premierDuMois })
  } catch (err) {
    res.status(500).json({ message: 'Erreur serveur', detail: err.message })
  }
})

// ── Fonction utilitaire : créer une tâche relance saga ────────────────────────
// Appelée depuis commandes.js après chaque commande
async function creerTacheRelanceSaga(email, clientId, livreId) {
  try {
    // Récupérer les infos du livre
    const livreResult = await pool.query(
      'SELECT * FROM livres WHERE id = $1', [livreId]
    )
    if (livreResult.rows.length === 0) return
    const livre = livreResult.rows[0]

    // Le livre doit être un tome d'une série
    if (!livre.serie || !livre.tome_numero) return

    // Chercher le tome suivant dans le catalogue
    const tomeSuivant = await pool.query(
      `SELECT id, titre, auteur, prix, tome_numero
       FROM livres
       WHERE serie = $1 AND tome_numero = $2`,
      [livre.serie, livre.tome_numero + 1]
    )

    // Vérifier que le client n'a pas déjà commandé ce tome
    if (tomeSuivant.rows.length > 0) {
      const dejaCommande = await pool.query(
        `SELECT id FROM commandes WHERE email = $1 AND livre_id = $2 LIMIT 1`,
        [email, tomeSuivant.rows[0].id]
      )
      if (dejaCommande.rows.length > 0) return // déjà commandé, pas de relance
    }

    // Vérifier opt-in du client
    if (clientId) {
      const client = await pool.query(
        'SELECT email_relance_saga FROM comptes_clients WHERE id = $1', [clientId]
      )
      if (client.rows.length > 0 && client.rows[0].email_relance_saga === false) return
    }

    // Calculer délai
    const semaines = calculerDelaiRelance(livre)
    const dateEnvoi = dateEnvoi(semaines)

    await pool.query(
      `INSERT INTO crm_taches (type, email, client_id, livre_id, livre_suivant_id, date_envoi)
       VALUES ('relance_saga', $1, $2, $3, $4, $5)`,
      [
        email,
        clientId || null,
        livreId,
        tomeSuivant.rows.length > 0 ? tomeSuivant.rows[0].id : null,
        dateEnvoi,
      ]
    )

    console.log(`[CRM] Tâche relance saga créée : ${livre.titre} → dans ${semaines} semaines → ${email}`)
  } catch (err) {
    console.error('[CRM] Erreur création tâche saga:', err.message)
  }
}

// ── Templates email ───────────────────────────────────────────────────────────
function emailRelanceSaga({ prenom, livreTitre, livreAuteur, serie, tomeActuel, tomeSuivantTitre, tomeSuivantAuteur, tomeSuivantNumero, tomeSuivantPrix, tomeSuivantId }) {
  const avecTomeSuivant = !!tomeSuivantTitre

  return `
    <div style="font-family:Georgia,serif;max-width:600px;margin:0 auto;color:#1C1C1C;">
      <div style="background:#1A3C2E;padding:28px 32px;border-radius:12px 12px 0 0;">
        <h1 style="color:white;font-size:24px;margin:0;letter-spacing:2px;">BOOKDOG</h1>
        <p style="color:#EAF2EC;font-size:13px;margin:4px 0 0;">Librairie indépendante — 42 rue Laugier, Paris 17e</p>
      </div>
      <div style="background:white;padding:32px;border:1px solid #eee;border-top:none;border-radius:0 0 12px 12px;">
        <p style="font-size:16px;margin:0 0 16px;">Bonjour <strong>${prenom}</strong>,</p>
        <p style="color:#6B6B5E;margin:0 0 24px;line-height:1.7;">
          Vous avez récemment réservé <strong>${livreTitre}</strong> de ${livreAuteur}${serie ? ` (tome ${tomeActuel} de la série <em>${serie}</em>)` : ''}.
          Vous avez eu le temps de le lire ?
        </p>
        ${avecTomeSuivant ? `
        <div style="background:#F9F6F0;border-radius:12px;padding:24px;margin-bottom:24px;border-left:4px solid #1A3C2E;">
          <p style="color:#1A3C2E;font-size:12px;letter-spacing:2px;font-weight:600;margin:0 0 8px;">LA SUITE VOUS ATTEND</p>
          <p style="font-size:18px;font-weight:700;color:#1C1C1C;margin:0 0 4px;">${tomeSuivantTitre}</p>
          <p style="color:#6B6B5E;font-style:italic;margin:0 0 12px;">${tomeSuivantAuteur}${tomeSuivantNumero ? ` — Tome ${tomeSuivantNumero}` : ''}</p>
          <p style="font-size:20px;font-weight:700;color:#1A3C2E;margin:0 0 16px;">${tomeSuivantPrix} €</p>
          <a href="http://localhost:3000/livres/${tomeSuivantId}"
             style="display:inline-block;background:#1A3C2E;color:white;padding:12px 28px;border-radius:40px;text-decoration:none;font-weight:700;font-size:14px;">
            Réserver le tome ${tomeSuivantNumero || ''} →
          </a>
        </div>
        ` : `
        <div style="background:#F9F6F0;border-radius:12px;padding:24px;margin-bottom:24px;">
          <p style="color:#1A3C2E;font-size:14px;font-weight:700;margin:0 0 8px;">La suite de la série est disponible en boutique</p>
          <p style="color:#6B6B5E;font-size:13px;margin:0;">Contactez-nous ou venez nous rendre visite pour connaître la disponibilité.</p>
        </div>
        `}
        <div style="background:#EAF2EC;border-radius:10px;padding:16px 20px;">
          <p style="font-weight:700;color:#1A3C2E;margin:0 0 6px;font-size:14px;">📍 Bookdog</p>
          <p style="margin:0;font-size:13px;color:#6B6B5E;line-height:1.8;">
            42 rue Laugier, 75017 Paris<br>
            Lun–Sam : 10h00 – 20h00 · 06 77 40 21 51
          </p>
        </div>
        <p style="font-size:11px;color:#bbb;margin-top:20px;text-align:center;">
          Vous recevez cet email car vous êtes client Bookdog.
          <a href="http://localhost:3000/compte/dashboard" style="color:#6B6B5E;">Gérer mes préférences</a>
        </p>
      </div>
    </div>
  `
}

function emailRecommandation({ prenom, recommandations }) {
  const lignes = recommandations.map((r, i) => `
    <a href="http://localhost:3000/livres/${r.livre_id}" style="text-decoration:none;display:block;margin-bottom:16px;">
      <div style="background:#F9F6F0;border-radius:10px;padding:20px;border-left:4px solid #D4AF37;">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px;">
          <span style="background:#D4AF37;color:#1A3C2E;font-size:10px;font-weight:700;padding:3px 8px;border-radius:20px;">#${i+1}</span>
          <span style="color:#1A3C2E;font-weight:700;font-size:16px;">${Number(r.prix).toFixed(2)} €</span>
        </div>
        <p style="font-weight:700;font-size:16px;color:#1C1C1C;margin:0 0 4px;">${r.titre}</p>
        <p style="color:#6B6B5E;font-style:italic;font-size:13px;margin:0 0 8px;">${r.auteur}</p>
        <p style="color:#6B6B5E;font-size:13px;margin:0;line-height:1.5;font-style:italic;">${r.raison}</p>
      </div>
    </a>
  `).join('')

  return `
    <div style="font-family:Georgia,serif;max-width:600px;margin:0 auto;color:#1C1C1C;">
      <div style="background:#1A3C2E;padding:28px 32px;border-radius:12px 12px 0 0;">
        <h1 style="color:white;font-size:24px;margin:0;letter-spacing:2px;">BOOKDOG</h1>
        <p style="color:#EAF2EC;font-size:13px;margin:4px 0 0;">Librairie indépendante — 42 rue Laugier, Paris 17e</p>
      </div>
      <div style="background:white;padding:32px;border:1px solid #eee;border-top:none;border-radius:0 0 12px 12px;">
        <p style="color:#D4AF37;font-size:11px;letter-spacing:2px;font-weight:600;margin:0 0 8px;">SÉLECTION DU MOIS</p>
        <h2 style="font-size:24px;font-weight:700;color:#1C1C1C;margin:0 0 8px;">Bonjour ${prenom},</h2>
        <p style="color:#6B6B5E;margin:0 0 28px;line-height:1.7;">
          Notre libraire IA a sélectionné pour vous 3 livres qui correspondent à vos goûts de lecture.
        </p>
        ${lignes}
        <div style="text-align:center;margin-top:28px;">
          <a href="http://localhost:3000/livres"
             style="display:inline-block;background:#1A3C2E;color:white;padding:12px 28px;border-radius:40px;text-decoration:none;font-weight:700;font-size:14px;">
            Découvrir tout le catalogue →
          </a>
        </div>
        <div style="background:#EAF2EC;border-radius:10px;padding:16px 20px;margin-top:24px;">
          <p style="font-weight:700;color:#1A3C2E;margin:0 0 6px;font-size:14px;">📍 Bookdog</p>
          <p style="margin:0;font-size:13px;color:#6B6B5E;line-height:1.8;">
            42 rue Laugier, 75017 Paris · Lun–Sam 10h–20h
          </p>
        </div>
        <p style="font-size:11px;color:#bbb;margin-top:20px;text-align:center;">
          Vous recevez cet email mensuellement.
          <a href="http://localhost:3000/compte/dashboard" style="color:#6B6B5E;">Se désabonner</a>
        </p>
      </div>
    </div>
  `
}

module.exports = router
module.exports.creerTacheRelanceSaga = creerTacheRelanceSaga