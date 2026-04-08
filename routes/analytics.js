const express = require('express')
const router = express.Router()
const pool = require('../db')
const verifierToken = require('../middleware/auth')

// GET /api/analytics/ventes
// Basé sur la table `ventes` (ventes en boutique) et `commandes` (C&C)
router.get('/ventes', verifierToken, async function(req, res) {
  try {
    // CA total (ventes en boutique)
    const caTotal = await pool.query(`
      SELECT COALESCE(SUM(quantite * prix_unitaire), 0) AS ca_total
      FROM ventes
    `)

    // CA par mois sur les 12 derniers mois
    const caMensuel = await pool.query(`
      SELECT
        TO_CHAR(DATE_TRUNC('month', date_vente), 'YYYY-MM') AS mois,
        COALESCE(SUM(quantite * prix_unitaire), 0) AS ca
      FROM ventes
      WHERE date_vente >= NOW() - INTERVAL '12 months'
      GROUP BY DATE_TRUNC('month', date_vente)
      ORDER BY DATE_TRUNC('month', date_vente) ASC
    `)

    // Nombre total de ventes
    const nbVentes = await pool.query(`
      SELECT COUNT(*) AS total FROM ventes
    `)

    // Panier moyen par transaction (groupé par date_vente + client)
    const panierMoyen = await pool.query(`
      SELECT COALESCE(AVG(total_vente), 0) AS panier_moyen
      FROM (
        SELECT SUM(quantite * prix_unitaire) AS total_vente
        FROM ventes
        GROUP BY date_vente, client_id
      ) t
    `)

    // Top 10 livres par CA
    const topLivres = await pool.query(`
      SELECT
        l.titre,
        l.auteur,
        SUM(v.quantite) AS nb_vendus,
        SUM(v.quantite * v.prix_unitaire) AS ca
      FROM ventes v
      JOIN livres l ON l.id = v.livre_id
      GROUP BY l.titre, l.auteur
      ORDER BY ca DESC
      LIMIT 10
    `)

    // Commandes C&C par statut
    const statuts = await pool.query(`
      SELECT statut, COUNT(*) AS nb
      FROM commandes
      GROUP BY statut
      ORDER BY nb DESC
    `)

    // Nb commandes C&C
    const nbCommandes = await pool.query(`
      SELECT COUNT(*) AS total FROM commandes
    `)

    res.json({
      ca_total: parseFloat(caTotal.rows[0].ca_total),
      ca_mensuel: caMensuel.rows,
      nb_ventes: parseInt(nbVentes.rows[0].total),
      nb_commandes: parseInt(nbCommandes.rows[0].total),
      panier_moyen: parseFloat(panierMoyen.rows[0].panier_moyen),
      top_livres: topLivres.rows,
      statuts: statuts.rows
    })
  } catch (err) {
    console.log('erreur analytics/ventes:', err.message)
    res.status(500).json({ message: 'Erreur serveur', detail: err.message })
  }
})

// GET /api/analytics/clients
router.get('/clients', verifierToken, async function(req, res) {
  try {
    // Total clients inscrits
    const totalClients = await pool.query(`
      SELECT COUNT(*) AS total FROM comptes_clients
    `)

    // Nouveaux clients par mois (12 derniers mois)
    const clientsMensuel = await pool.query(`
      SELECT
        TO_CHAR(DATE_TRUNC('month', date_inscription), 'YYYY-MM') AS mois,
        COUNT(*) AS nb
      FROM comptes_clients
      WHERE date_inscription >= NOW() - INTERVAL '12 months'
      GROUP BY DATE_TRUNC('month', date_inscription)
      ORDER BY DATE_TRUNC('month', date_inscription) ASC
    `)

    // Top clients par CA (via ventes)
    const topClients = await pool.query(`
      SELECT
        cl.nom,
        cl.prenom,
        cl.email,
        COUNT(v.id) AS nb_achats,
        COALESCE(SUM(v.quantite * v.prix_unitaire), 0) AS ca_total
      FROM clients cl
      JOIN ventes v ON v.client_id = cl.id
      GROUP BY cl.nom, cl.prenom, cl.email
      ORDER BY ca_total DESC
      LIMIT 10
    `)

    // Clients avec commande C&C en attente
    const commandesAttente = await pool.query(`
      SELECT COUNT(*) AS nb FROM commandes WHERE statut = 'en attente'
    `)

    res.json({
      total_clients: parseInt(totalClients.rows[0].total),
      clients_mensuel: clientsMensuel.rows,
      top_clients: topClients.rows,
      commandes_attente: parseInt(commandesAttente.rows[0].nb)
    })
  } catch (err) {
    console.log('erreur analytics/clients:', err.message)
    res.status(500).json({ message: 'Erreur serveur', detail: err.message })
  }
})

// GET /api/analytics/catalogue
router.get('/catalogue', verifierToken, async function(req, res) {
  try {
    // Répartition par genre
    const genres = await pool.query(`
      SELECT
        COALESCE(genre, 'Non classé') AS genre,
        COUNT(*) AS nb_titres,
        COALESCE(SUM(stock), 0) AS stock_total
      FROM livres
      GROUP BY genre
      ORDER BY nb_titres DESC
    `)

    // Total livres
    const totalLivres = await pool.query(`
      SELECT COUNT(*) AS total, COALESCE(SUM(stock), 0) AS stock_total FROM livres
    `)

    // Ruptures de stock
    const ruptures = await pool.query(`
      SELECT id, titre, auteur, genre, prix
      FROM livres
      WHERE stock = 0
      ORDER BY titre ASC
    `)

    // Stock faible (1-3 exemplaires)
    const stockFaible = await pool.query(`
      SELECT id, titre, auteur, genre, stock, prix
      FROM livres
      WHERE stock BETWEEN 1 AND 3
      ORDER BY stock ASC, titre ASC
    `)

    // Valeur totale du stock
    const valeurStock = await pool.query(`
      SELECT COALESCE(SUM(stock * prix), 0) AS valeur FROM livres
    `)

    res.json({
      genres: genres.rows,
      total_livres: parseInt(totalLivres.rows[0].total),
      stock_total: parseInt(totalLivres.rows[0].stock_total),
      ruptures: ruptures.rows,
      stock_faible: stockFaible.rows,
      valeur_stock: parseFloat(valeurStock.rows[0].valeur)
    })
  } catch (err) {
    console.log('erreur analytics/catalogue:', err.message)
    res.status(500).json({ message: 'Erreur serveur', detail: err.message })
  }
})

module.exports = router