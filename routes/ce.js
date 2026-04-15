const express = require('express')
const router = express.Router()
const pool = require('../db')
const verifierToken = require('../middleware/auth')

// ── GET /ce — liste tous les CE (admin) ───────────────────────────────────────
router.get('/', verifierToken, async (req, res) => {
  try {
    const ces = await pool.query(`
      SELECT c.*,
        COALESCE(json_agg(d.domaine) FILTER (WHERE d.domaine IS NOT NULL), '[]') AS domaines
      FROM ces c
      LEFT JOIN ce_domaines d ON d.ce_id = c.id
      GROUP BY c.id
      ORDER BY c.date_creation DESC
    `)
    res.json(ces.rows)
  } catch (err) {
    res.status(500).json({ message: 'Erreur serveur', detail: err.message })
  }
})

// ── GET /ce/:code — infos publiques d'un CE par son code URL ─────────────────
// Utilisé par la page d'atterrissage /ce/[code]
router.get('/:code', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, nom, code, remise, adresse_livraison FROM ces WHERE code = $1 AND actif = TRUE`,
      [req.params.code]
    )
    if (result.rows.length === 0) return res.status(404).json({ message: 'CE introuvable ou inactif' })
    res.json(result.rows[0])
  } catch (err) {
    res.status(500).json({ message: 'Erreur serveur' })
  }
})

// ── GET /ce/domaine/:domaine — détection CE par domaine email ─────────────────
// Utilisé à l'inscription pour détecter automatiquement le CE
router.get('/domaine/:domaine', async (req, res) => {
  try {
    const domaine = req.params.domaine.toLowerCase().trim()
    const result = await pool.query(`
      SELECT c.id, c.nom, c.code, c.remise, c.adresse_livraison
      FROM ces c
      INNER JOIN ce_domaines d ON d.ce_id = c.id
      WHERE d.domaine = $1 AND c.actif = TRUE
    `, [domaine])
    if (result.rows.length === 0) return res.json({ ce: null })
    res.json({ ce: result.rows[0] })
  } catch (err) {
    res.status(500).json({ message: 'Erreur serveur' })
  }
})

// ── POST /ce — créer un CE (admin) ───────────────────────────────────────────
router.post('/', verifierToken, async (req, res) => {
  try {
    const { nom, code, remise, adresse_livraison, contact_nom, contact_email, domaines } = req.body
    if (!nom || !code) return res.status(400).json({ message: 'Nom et code requis' })

    // Vérifier unicité du code
    const exist = await pool.query('SELECT id FROM ces WHERE code = $1', [code])
    if (exist.rows.length > 0) return res.status(400).json({ message: 'Ce code CE est déjà utilisé' })

    const result = await pool.query(
      `INSERT INTO ces (nom, code, remise, adresse_livraison, contact_nom, contact_email, actif)
       VALUES ($1, $2, $3, $4, $5, $6, TRUE) RETURNING *`,
      [nom, code.toLowerCase().trim(), remise || 5.00, adresse_livraison || null, contact_nom || null, contact_email || null]
    )
    const ce = result.rows[0]

    // Ajouter les domaines si fournis
    if (domaines && Array.isArray(domaines)) {
      for (const d of domaines) {
        const dom = d.toLowerCase().trim()
        if (dom) {
          await pool.query(
            'INSERT INTO ce_domaines (ce_id, domaine) VALUES ($1, $2) ON CONFLICT DO NOTHING',
            [ce.id, dom]
          )
        }
      }
    }

    res.status(201).json({ message: 'CE créé', ce })
  } catch (err) {
    res.status(500).json({ message: 'Erreur serveur', detail: err.message })
  }
})

// ── PUT /ce/:id — modifier un CE (admin) ─────────────────────────────────────
router.put('/:id', verifierToken, async (req, res) => {
  try {
    const id = parseInt(req.params.id)
    const { nom, remise, adresse_livraison, contact_nom, contact_email, actif } = req.body
    const result = await pool.query(
      `UPDATE ces SET nom=$1, remise=$2, adresse_livraison=$3,
       contact_nom=$4, contact_email=$5, actif=$6
       WHERE id=$7 RETURNING *`,
      [nom, remise, adresse_livraison, contact_nom, contact_email, actif !== false, id]
    )
    if (result.rows.length === 0) return res.status(404).json({ message: 'CE introuvable' })
    res.json(result.rows[0])
  } catch (err) {
    res.status(500).json({ message: 'Erreur serveur' })
  }
})

// ── DELETE /ce/:id — supprimer un CE (admin) ──────────────────────────────────
router.delete('/:id', verifierToken, async (req, res) => {
  try {
    const id = parseInt(req.params.id)
    await pool.query('DELETE FROM ces WHERE id=$1', [id])
    res.json({ message: 'CE supprimé' })
  } catch (err) {
    res.status(500).json({ message: 'Erreur serveur' })
  }
})

// ── POST /ce/:id/domaines — ajouter un domaine à un CE (admin) ───────────────
router.post('/:id/domaines', verifierToken, async (req, res) => {
  try {
    const ce_id = parseInt(req.params.id)
    const { domaine } = req.body
    if (!domaine) return res.status(400).json({ message: 'Domaine requis' })
    const dom = domaine.toLowerCase().trim()

    // Vérifier que le CE existe
    const ce = await pool.query('SELECT id FROM ces WHERE id=$1', [ce_id])
    if (ce.rows.length === 0) return res.status(404).json({ message: 'CE introuvable' })

    // Vérifier unicité du domaine toutes tables confondues
    const exist = await pool.query('SELECT id FROM ce_domaines WHERE domaine=$1', [dom])
    if (exist.rows.length > 0) return res.status(400).json({ message: `Le domaine "${dom}" est déjà attribué à un CE` })

    const result = await pool.query(
      'INSERT INTO ce_domaines (ce_id, domaine) VALUES ($1, $2) RETURNING *',
      [ce_id, dom]
    )
    res.status(201).json(result.rows[0])
  } catch (err) {
    res.status(500).json({ message: 'Erreur serveur', detail: err.message })
  }
})

// ── DELETE /ce/domaines/:id — supprimer un domaine (admin) ───────────────────
router.delete('/domaines/:id', verifierToken, async (req, res) => {
  try {
    const id = parseInt(req.params.id)
    await pool.query('DELETE FROM ce_domaines WHERE id=$1', [id])
    res.json({ message: 'Domaine supprimé' })
  } catch (err) {
    res.status(500).json({ message: 'Erreur serveur' })
  }
})

module.exports = router