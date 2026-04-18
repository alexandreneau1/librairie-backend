const express = require('express')
const router = express.Router()
const pool = require('../db')
const verifierToken = require('../middleware/auth')

const TVA = 1.055
const TAUX_MARGE_ESTIME = 0.32

function clausePeriode(colonne, periode) {
  const map = {
    '7j':  `${colonne} >= NOW() - INTERVAL '7 days'`,
    '30j': `${colonne} >= NOW() - INTERVAL '30 days'`,
    '3m':  `${colonne} >= NOW() - INTERVAL '3 months'`,
    '6m':  `${colonne} >= NOW() - INTERVAL '6 months'`,
    '1an': `${colonne} >= NOW() - INTERVAL '12 months'`,
    'tout': '1=1',
  }
  return map[periode] || map['1an']
}

function nbMoisGraphique(periode) {
  const map = { '7j': 1, '30j': 1, '3m': 3, '6m': 6, '1an': 12, 'tout': 24 }
  return map[periode] || 12
}

// ── Charges fixes ─────────────────────────────────────────────────────────────

// GET /api/analytics/charges
router.get('/charges', verifierToken, async function(req, res) {
  try {
    const { rows } = await pool.query(`
      SELECT id, nom, montant, categorie, actif, date_creation
      FROM charges_fixes
      ORDER BY categorie ASC, nom ASC
    `)
    const total = rows.filter(r => r.actif).reduce((s, r) => s + parseFloat(r.montant), 0)
    res.json({ charges: rows, total_mensuel: Math.round(total * 100) / 100 })
  } catch (err) {
    console.error('erreur analytics/charges GET:', err.message)
    res.status(500).json({ message: 'Erreur serveur' })
  }
})

// POST /api/analytics/charges
router.post('/charges', verifierToken, async function(req, res) {
  const { nom, montant, categorie } = req.body
  if (!nom || montant === undefined) return res.status(400).json({ message: 'Nom et montant requis' })
  try {
    const { rows } = await pool.query(
      `INSERT INTO charges_fixes (nom, montant, categorie) VALUES ($1, $2, $3) RETURNING *`,
      [nom.trim(), parseFloat(montant), categorie?.trim() || null]
    )
    res.status(201).json(rows[0])
  } catch (err) {
    console.error('erreur analytics/charges POST:', err.message)
    res.status(500).json({ message: 'Erreur serveur' })
  }
})

// PUT /api/analytics/charges/:id
router.put('/charges/:id', verifierToken, async function(req, res) {
  const { nom, montant, categorie, actif } = req.body
  try {
    const { rows } = await pool.query(
      `UPDATE charges_fixes SET nom=$1, montant=$2, categorie=$3, actif=$4 WHERE id=$5 RETURNING *`,
      [nom?.trim(), parseFloat(montant), categorie?.trim() || null, actif !== undefined ? actif : true, req.params.id]
    )
    if (rows.length === 0) return res.status(404).json({ message: 'Charge introuvable' })
    res.json(rows[0])
  } catch (err) {
    console.error('erreur analytics/charges PUT:', err.message)
    res.status(500).json({ message: 'Erreur serveur' })
  }
})

// DELETE /api/analytics/charges/:id
router.delete('/charges/:id', verifierToken, async function(req, res) {
  try {
    await pool.query(`DELETE FROM charges_fixes WHERE id=$1`, [req.params.id])
    res.json({ message: 'Charge supprimée' })
  } catch (err) {
    console.error('erreur analytics/charges DELETE:', err.message)
    res.status(500).json({ message: 'Erreur serveur' })
  }
})

// ── Ventes ────────────────────────────────────────────────────────────────────

router.get('/ventes', verifierToken, async function(req, res) {
  const periode = req.query.periode || '1an'
  const where = clausePeriode('v.date_vente', periode)
  const nbMois = nbMoisGraphique(periode)

  try {
    const caTotal = await pool.query(`
      SELECT COALESCE(SUM(v.quantite * v.prix_unitaire), 0) AS ca_total
      FROM ventes v WHERE ${where}
    `)
    const caTTC = parseFloat(caTotal.rows[0].ca_total)
    const caHT = caTTC / TVA

    const margeQuery = await pool.query(`
      SELECT
        COALESCE(SUM(
          v.quantite * (
            (v.prix_unitaire / ${TVA}) -
            COALESCE(l.prix_achat, v.prix_unitaire / ${TVA} * ${TAUX_MARGE_ESTIME})
          )
        ), 0) AS marge_brute,
        COUNT(CASE WHEN l.prix_achat IS NOT NULL THEN 1 END) AS lignes_avec_prix_achat,
        COUNT(v.id) AS lignes_total
      FROM ventes v
      JOIN livres l ON l.id = v.livre_id
      WHERE ${where}
    `)

    const margeBrute = parseFloat(margeQuery.rows[0].marge_brute)
    const lignesAvecPrixAchat = parseInt(margeQuery.rows[0].lignes_avec_prix_achat)
    const lignesTotal = parseInt(margeQuery.rows[0].lignes_total)
    const tauxCouverture = lignesTotal > 0 ? Math.round((lignesAvecPrixAchat / lignesTotal) * 100) : 0
    const tauxMarge = caHT > 0 ? Math.round((margeBrute / caHT) * 100) : 0

    // Charges fixes actives
    const chargesRes = await pool.query(`
      SELECT id, nom, montant, categorie, actif
      FROM charges_fixes WHERE actif = TRUE ORDER BY categorie, nom
    `)
    const chargesMensuelles = chargesRes.rows.reduce((s, c) => s + parseFloat(c.montant), 0)

    // Charges proratisées selon la période
    const facteurPeriode = { '7j': 7/30, '30j': 1, '3m': 3, '6m': 6, '1an': 12, 'tout': 12 }
    const facteur = facteurPeriode[periode] || 12
    const chargesPeriode = chargesMensuelles * facteur
    const resultatExploitation = margeBrute - chargesPeriode
    const tauxResultat = caHT > 0 ? Math.round((resultatExploitation / caHT) * 100) : 0

    const caMensuel = await pool.query(`
      SELECT
        TO_CHAR(DATE_TRUNC('month', v.date_vente), 'YYYY-MM') AS mois,
        COALESCE(SUM(v.quantite * v.prix_unitaire), 0) AS ca,
        COALESCE(SUM(
          v.quantite * (
            (v.prix_unitaire / ${TVA}) -
            COALESCE(l.prix_achat, v.prix_unitaire / ${TVA} * ${TAUX_MARGE_ESTIME})
          )
        ), 0) AS marge
      FROM ventes v
      JOIN livres l ON l.id = v.livre_id
      WHERE v.date_vente >= NOW() - INTERVAL '${nbMois} months'
      GROUP BY DATE_TRUNC('month', v.date_vente)
      ORDER BY DATE_TRUNC('month', v.date_vente) ASC
    `)

    const nbVentes = await pool.query(`SELECT COUNT(*) AS total FROM ventes v WHERE ${where}`)
    const panierMoyen = await pool.query(`
      SELECT COALESCE(AVG(total_vente), 0) AS panier_moyen
      FROM (
        SELECT SUM(v.quantite * v.prix_unitaire) AS total_vente
        FROM ventes v WHERE ${where}
        GROUP BY v.date_vente, v.client_id
      ) t
    `)

    const topLivres = await pool.query(`
      SELECT
        l.titre, l.auteur, l.prix_achat,
        SUM(v.quantite) AS nb_vendus,
        SUM(v.quantite * v.prix_unitaire) AS ca,
        SUM(v.quantite * v.prix_unitaire) / ${TVA} AS ca_ht,
        SUM(v.quantite * ((v.prix_unitaire / ${TVA}) - COALESCE(l.prix_achat, v.prix_unitaire / ${TVA} * ${TAUX_MARGE_ESTIME}))) AS marge_brute,
        CASE WHEN l.prix_achat IS NOT NULL THEN 'reel' ELSE 'estime' END AS source_marge
      FROM ventes v
      JOIN livres l ON l.id = v.livre_id
      WHERE ${where}
      GROUP BY l.titre, l.auteur, l.prix_achat
      ORDER BY ca DESC LIMIT 10
    `)

    const remisesCE = await pool.query(`
      SELECT
        c.nom AS ce_nom, c.remise AS taux_remise,
        COUNT(v.id) AS nb_ventes,
        COALESCE(SUM(v.quantite * v.prix_unitaire), 0) AS ca_facture,
        COALESCE(SUM(v.quantite * l.prix), 0) AS ca_prix_public,
        COALESCE(SUM(v.quantite * (l.prix - v.prix_unitaire)), 0) AS remise_accordee
      FROM ventes v
      JOIN livres l ON l.id = v.livre_id
      JOIN clients cl ON cl.id = v.client_id
      JOIN comptes_clients cc ON cc.email = cl.email
      JOIN ces c ON c.id = cc.ce_id
      WHERE ${where}
      GROUP BY c.nom, c.remise
      ORDER BY remise_accordee DESC
    `)

    const statuts = await pool.query(`SELECT statut, COUNT(*) AS nb FROM commandes GROUP BY statut ORDER BY nb DESC`)
    const nbCommandes = await pool.query(`SELECT COUNT(*) AS total FROM commandes`)

    let caPrec = 0
    if (periode !== 'tout') {
      const intervMap = { '7j': '7 days', '30j': '30 days', '3m': '3 months', '6m': '6 months', '1an': '12 months' }
      const interv = intervMap[periode] || '12 months'
      const caP = await pool.query(`
        SELECT COALESCE(SUM(quantite * prix_unitaire), 0) AS ca
        FROM ventes
        WHERE date_vente >= NOW() - INTERVAL '${interv}' * 2
          AND date_vente < NOW() - INTERVAL '${interv}'
      `)
      caPrec = parseFloat(caP.rows[0].ca)
    }

    res.json({
      ca_total: caTTC,
      ca_ht: Math.round(caHT * 100) / 100,
      ca_precedent: caPrec,
      marge_brute: Math.round(margeBrute * 100) / 100,
      taux_marge: tauxMarge,
      taux_marge_estime: TAUX_MARGE_ESTIME * 100,
      couverture_prix_achat: tauxCouverture,
      charges_mensuelles: Math.round(chargesMensuelles * 100) / 100,
      charges_periode: Math.round(chargesPeriode * 100) / 100,
      charges_detail: chargesRes.rows,
      resultat_exploitation: Math.round(resultatExploitation * 100) / 100,
      taux_resultat: tauxResultat,
      ca_mensuel: caMensuel.rows,
      nb_ventes: parseInt(nbVentes.rows[0].total),
      nb_commandes: parseInt(nbCommandes.rows[0].total),
      panier_moyen: parseFloat(panierMoyen.rows[0].panier_moyen),
      top_livres: topLivres.rows,
      remises_ce: remisesCE.rows,
      statuts: statuts.rows,
    })
  } catch (err) {
    console.error('erreur analytics/ventes:', err.message)
    res.status(500).json({ message: 'Erreur serveur', detail: err.message })
  }
})

// ── Clients ───────────────────────────────────────────────────────────────────

router.get('/clients', verifierToken, async function(req, res) {
  const periode = req.query.periode || '1an'
  const nbMois = nbMoisGraphique(periode)

  try {
    const totalClients = await pool.query(`SELECT COUNT(*) AS total FROM comptes_clients`)
    const clientsMensuel = await pool.query(`
      SELECT TO_CHAR(DATE_TRUNC('month', date_inscription), 'YYYY-MM') AS mois, COUNT(*) AS nb
      FROM comptes_clients
      WHERE date_inscription >= NOW() - INTERVAL '${nbMois} months'
      GROUP BY DATE_TRUNC('month', date_inscription)
      ORDER BY DATE_TRUNC('month', date_inscription) ASC
    `)
    const clientsActifs = await pool.query(`
      SELECT COUNT(DISTINCT cl.id) AS nb FROM clients cl JOIN ventes v ON v.client_id = cl.id
    `)
    const topClients = await pool.query(`
      SELECT cl.nom, cl.prenom, cl.email, COUNT(v.id) AS nb_commandes,
        COALESCE(SUM(v.quantite * v.prix_unitaire), 0) AS ca_total
      FROM clients cl JOIN ventes v ON v.client_id = cl.id
      GROUP BY cl.nom, cl.prenom, cl.email ORDER BY ca_total DESC LIMIT 10
    `)
    const repartitionCE = await pool.query(`
      SELECT CASE WHEN ce_id IS NOT NULL THEN 'Clients CE' ELSE 'Clients standard' END AS type, COUNT(*) AS nb
      FROM comptes_clients GROUP BY (ce_id IS NOT NULL)
    `)
    const optins = await pool.query(`
      SELECT SUM(CASE WHEN email_recommandations THEN 1 ELSE 0 END) AS optin_recos,
        SUM(CASE WHEN email_relance_saga THEN 1 ELSE 0 END) AS optin_relance, COUNT(*) AS total
      FROM comptes_clients
    `)
    const commandesAttente = await pool.query(`SELECT COUNT(*) AS nb FROM commandes WHERE statut = 'en attente'`)

    res.json({
      total_clients: parseInt(totalClients.rows[0].total),
      clients_actifs: parseInt(clientsActifs.rows[0].nb),
      clients_mensuel: clientsMensuel.rows,
      top_clients: topClients.rows,
      repartition_ce: repartitionCE.rows,
      optins: { recos: parseInt(optins.rows[0].optin_recos), relance: parseInt(optins.rows[0].optin_relance), total: parseInt(optins.rows[0].total) },
      commandes_attente: parseInt(commandesAttente.rows[0].nb),
    })
  } catch (err) {
    console.error('erreur analytics/clients:', err.message)
    res.status(500).json({ message: 'Erreur serveur', detail: err.message })
  }
})

// ── Catalogue ─────────────────────────────────────────────────────────────────

router.get('/catalogue', verifierToken, async function(req, res) {
  try {
    const genres = await pool.query(`
      SELECT COALESCE(genre, 'Non classé') AS genre, COUNT(*) AS nb_titres, COALESCE(SUM(stock), 0) AS stock_total
      FROM livres GROUP BY genre ORDER BY nb_titres DESC
    `)
    const totalLivres = await pool.query(`SELECT COUNT(*) AS total, COALESCE(SUM(stock), 0) AS stock_total FROM livres`)
    const ruptures = await pool.query(`SELECT id, titre, auteur, genre, prix FROM livres WHERE stock = 0 ORDER BY titre ASC`)
    const stockFaible = await pool.query(`SELECT id, titre, auteur, genre, stock, prix FROM livres WHERE stock BETWEEN 1 AND 3 ORDER BY stock ASC, titre ASC`)
    const valeurStock = await pool.query(`
      SELECT
        COALESCE(SUM(stock * prix), 0) AS valeur_ttc,
        COALESCE(SUM(stock * COALESCE(prix_achat, prix / ${TVA} * (1 - ${TAUX_MARGE_ESTIME}))), 0) AS valeur_achat
      FROM livres
    `)
    const genresVentes = await pool.query(`
      SELECT COALESCE(l.genre, 'Non classé') AS genre, COUNT(v.id) AS nb_ventes,
        COALESCE(SUM(v.quantite * v.prix_unitaire), 0) AS ca
      FROM livres l LEFT JOIN ventes v ON v.livre_id = l.id
      GROUP BY l.genre ORDER BY nb_ventes DESC LIMIT 8
    `)
    const couverturePrixAchat = await pool.query(`SELECT COUNT(*) AS total, COUNT(prix_achat) AS avec_prix_achat FROM livres`)
    const total = parseInt(couverturePrixAchat.rows[0].total)
    const avecPrixAchat = parseInt(couverturePrixAchat.rows[0].avec_prix_achat)

    res.json({
      genres: genres.rows,
      genres_ventes: genresVentes.rows,
      total_livres: total,
      stock_total: parseInt(totalLivres.rows[0].stock_total),
      ruptures: ruptures.rows,
      stock_faible: stockFaible.rows,
      valeur_stock: parseFloat(valeurStock.rows[0].valeur_ttc),
      valeur_stock_achat: Math.round(parseFloat(valeurStock.rows[0].valeur_achat) * 100) / 100,
      couverture_prix_achat: total > 0 ? Math.round((avecPrixAchat / total) * 100) : 0,
    })
  } catch (err) {
    console.error('erreur analytics/catalogue:', err.message)
    res.status(500).json({ message: 'Erreur serveur', detail: err.message })
  }
})

module.exports = router