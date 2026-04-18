// seed.js — Bookdog
// Usage : node seed.js
// Génère ~100 clients, historique d'achats, événements, CE, CRM tasks

require('dotenv').config()
const { Pool } = require('pg')
const bcrypt = require('bcrypt')

const pool = new Pool({
  user: 'postgres',
  host: 'localhost',
  database: 'librairie',
  password: '',
  port: 5432,
})

// ── Données françaises réalistes ──────────────────────────────────────────

const PRENOMS_F = ['Emma','Léa','Chloé','Sarah','Camille','Lucie','Marie','Julie','Sophie','Clara','Inès','Alice','Manon','Jade','Élise','Margot','Anaïs','Pauline','Laura','Céline','Nathalie','Isabelle','Aurélie','Charlotte','Mathilde']
const PRENOMS_H = ['Thomas','Nicolas','Julien','Antoine','Pierre','Alexandre','Maxime','Hugo','Théo','Baptiste','Lucas','Quentin','Romain','Alexis','Clément','François','Vincent','Sébastien','Adrien','Paul','Marc','Simon','Étienne','Guillaume','Raphaël']
const NOMS = ['Martin','Bernard','Thomas','Petit','Robert','Richard','Durand','Dubois','Moreau','Laurent','Simon','Michel','Lefebvre','Leroy','Roux','David','Bertrand','Morel','Fournier','Girard','Bonnet','Dupont','Lambert','Fontaine','Rousseau','Vincent','Muller','Lefevre','Faure','Andre','Mercier','Blanc','Guerin','Boyer','Garnier','Chevalier','François','Legrand','Gauthier','Garcia']

const DOMAINES_EMAIL = ['gmail.com','orange.fr','free.fr','laposte.net','hotmail.fr','yahoo.fr','sfr.fr','outlook.fr']

const EVENEMENTS_DATA = [
  { titre: 'Rencontre avec Leïla Slimani', description: 'Leïla Slimani dédicacera son dernier roman et échangera avec les lecteurs autour de son œuvre. Inscription recommandée.', categorie: 'Dédicace', jours: 12 },
  { titre: 'Club de lecture — Juin', description: 'Ce mois-ci, nous lisons "La Promesse de l\'aube" de Romain Gary. Venez partager vos impressions autour d\'un verre.', categorie: 'Club de lecture', jours: 18 },
  { titre: 'Atelier écriture créative', description: 'Animé par l\'auteure Agnès Desarthe, cet atelier de 3h est ouvert à tous les niveaux. Places limitées à 15 participants.', categorie: 'Atelier', jours: 25 },
  { titre: 'Conférence : Le roman policier aujourd\'hui', description: 'Table ronde avec trois auteurs de polars français contemporains. Modération par la libraire en chef.', categorie: 'Conférence', jours: 31 },
  { titre: 'Lecture pour enfants — Les petits lecteurs', description: 'Chaque samedi matin, notre librairie accueille les 4–8 ans pour une heure de lecture à voix haute et d\'histoires illustrées.', categorie: 'Lecture', jours: 7 },
  { titre: 'Soirée BD & Mangas', description: 'Présentation des nouveautés BD de la saison et rencontre avec le dessinateur Riad Sattouf pour une séance de dédicaces.', categorie: 'Dédicace', jours: 42 },
  { titre: 'Rencontre : Prix Goncourt 2025', description: 'Le lauréat du Prix Goncourt vous présente son roman primé. Discussion suivie d\'une séance de dédicaces.', categorie: 'Rencontre', jours: 55 },
  { titre: 'Atelier reliure artisanale', description: 'Apprenez à relier vos propres livres avec les techniques traditionnelles. Matériel fourni. Maximum 10 participants.', categorie: 'Atelier', jours: 63 },
  { titre: 'Club de lecture — Juillet', description: 'Au programme : "La Horde du Contrevent" d\'Alain Damasio. Un roman de science-fiction à ne pas manquer.', categorie: 'Club de lecture', jours: 48 },
  { titre: 'Festival des Premières Œuvres', description: 'Cinq primo-romanciers présentent leur premier livre. Une soirée de découvertes littéraires dans une ambiance conviviale.', categorie: 'Rencontre', jours: 70 },
]

const CES_DATA = [
  { nom: 'Sanofi', code: 'sanofi', remise: 10, adresse_livraison: '54 rue du Château, 92200 Neuilly-sur-Seine', contact_nom: 'Marie Bouchard', contact_email: 'marie.bouchard@sanofi.com', domaines: ['sanofi.com'] },
  { nom: 'BNP Paribas', code: 'bnpparibas', remise: 8, adresse_livraison: '16 boulevard des Italiens, 75009 Paris', contact_nom: 'Luc Renard', contact_email: 'l.renard@bnpparibas.com', domaines: ['bnpparibas.com', 'bnpparibas.fr'] },
  { nom: 'RATP', code: 'ratp', remise: 7, adresse_livraison: '54 quai de la Rapée, 75012 Paris', contact_nom: 'Fatima Ouali', contact_email: 'f.ouali@ratp.fr', domaines: ['ratp.fr'] },
]

// ── Helpers ───────────────────────────────────────────────────────────────

function alea(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min }
function aleatoire(arr) { return arr[Math.floor(Math.random() * arr.length)] }
function dateAleatoire(joursAvant, joursAvantMin = 0) {
  const d = new Date()
  d.setDate(d.getDate() - alea(joursAvantMin, joursAvant))
  d.setHours(alea(8, 21), alea(0, 59))
  return d
}
function dateFuture(jours) {
  const d = new Date()
  d.setDate(d.getDate() + jours)
  d.setHours(alea(17, 20), 0, 0, 0)
  return d
}

function genererEmail(prenom, nom, domaine) {
  const p = prenom.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z]/g, '')
  const n = nom.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z]/g, '')
  const formats = [`${p}.${n}@${domaine}`, `${p}${n}@${domaine}`, `${p[0]}${n}@${domaine}`, `${p}.${n}${alea(1,99)}@${domaine}`]
  return aleatoire(formats)
}

// ── Main ──────────────────────────────────────────────────────────────────

async function seed() {
  const client = await pool.connect()
  try {
    console.log('\n🌱 Démarrage du seed Bookdog...\n')

    // ── 1. Récupérer les livres existants ─────────────────────────────────
    const { rows: livres } = await client.query('SELECT id, prix, genre, serie, tome_numero FROM livres ORDER BY id')
    if (livres.length === 0) {
      console.error('❌ Aucun livre en base. Importez d\'abord un catalogue CSV.')
      return
    }
    console.log(`📚 ${livres.length} livres trouvés en base`)

    // ── 2. Nettoyer les données de seed (optionnel — commentez si vous ne voulez pas reset) ──
    console.log('🧹 Nettoyage des anciennes données de seed...')
    try { await client.query(`DELETE FROM crm_taches`) } catch {}
    try { await client.query(`DELETE FROM ventes`) } catch {}
    try { await client.query(`DELETE FROM commandes`) } catch {}
    try { await client.query(`DELETE FROM wishlist`) } catch {}
    try { await client.query(`DELETE FROM avis`) } catch {}
    await client.query(`DELETE FROM comptes_clients`)
    try { await client.query(`DELETE FROM clients`) } catch {}
    await client.query(`DELETE FROM evenements`)
    await client.query(`DELETE FROM ce_domaines WHERE ce_id IN (SELECT id FROM ces WHERE code IN ('sanofi','bnpparibas','ratp'))`)
    await client.query(`DELETE FROM ces WHERE code IN ('sanofi','bnpparibas','ratp')`)

    // ── 3. Créer les CE ───────────────────────────────────────────────────
    console.log('🏢 Création des CE...')
    const ceIds = {}
    for (const ce of CES_DATA) {
      const { rows } = await client.query(
        `INSERT INTO ces (nom, code, remise, adresse_livraison, contact_nom, contact_email, actif)
         VALUES ($1, $2, $3, $4, $5, $6, true) RETURNING id`,
        [ce.nom, ce.code, ce.remise, ce.adresse_livraison, ce.contact_nom, ce.contact_email]
      )
      ceIds[ce.code] = rows[0].id
      for (const dom of ce.domaines) {
        await client.query(`INSERT INTO ce_domaines (ce_id, domaine) VALUES ($1, $2)`, [rows[0].id, dom])
      }
    }
    console.log(`   ✓ ${CES_DATA.length} CE créés`)

    // ── 4. Créer les clients ──────────────────────────────────────────────
    console.log('👥 Création des clients...')
    const motDePasse = await bcrypt.hash('password123', 10)
    const clientIds = []
    const clientEmails = []
    const nbClients = 100

    // Répartition CE : ~15 clients CE
    const ceCodesDispos = Object.keys(ceIds)
    const emailsUtilises = new Set()

    for (let i = 0; i < nbClients; i++) {
      const estFemme = Math.random() > 0.45
      const prenom = estFemme ? aleatoire(PRENOMS_F) : aleatoire(PRENOMS_H)
      const nom = aleatoire(NOMS)

      // Domaine email : parfois CE, sinon normal
      let domaine, ceId = null
      const estCE = i < 15 // les 15 premiers sont CE
      if (estCE && i < 5) { domaine = 'sanofi.com'; ceId = ceIds['sanofi'] }
      else if (estCE && i < 10) { domaine = 'bnpparibas.com'; ceId = ceIds['bnpparibas'] }
      else if (estCE && i < 15) { domaine = 'ratp.fr'; ceId = ceIds['ratp'] }
      else { domaine = aleatoire(DOMAINES_EMAIL) }

      let email = genererEmail(prenom, nom, domaine)
      let tentatives = 0
      while (emailsUtilises.has(email) && tentatives < 10) {
        email = genererEmail(prenom, nom, domaine) + String(tentatives)
        tentatives++
      }
      emailsUtilises.add(email)

      const dateInscription = dateAleatoire(365, 1)
      const emailRecos = Math.random() > 0.25
      const emailRelance = Math.random() > 0.2

      const { rows: rowsClients } = await client.query(
        `INSERT INTO clients (nom, prenom, email) VALUES ($1, $2, $3) ON CONFLICT (email) DO UPDATE SET nom=EXCLUDED.nom RETURNING id`,
        [nom, prenom, email]
      )
      const clientsId = rowsClients[0].id

      const { rows } = await client.query(
        `INSERT INTO comptes_clients (nom, prenom, email, mot_de_passe, date_inscription, ce_id, email_recommandations, email_relance_saga)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (email) DO NOTHING RETURNING id`,
        [nom, prenom, email, motDePasse, dateInscription, ceId, emailRecos, emailRelance]
      )
      const compteId = rows[0]?.id || clientsId
      clientIds.push(clientsId)
      clientEmails.push({ id: clientsId, compteId, email, nom, prenom, dateInscription, ceId })
    }
    console.log(`   ✓ ${nbClients} clients créés (mot de passe : password123)`)

    // ── 5. Créer les ventes ───────────────────────────────────────────────
    console.log('💰 Création des ventes...')
    let nbVentes = 0

    for (const c of clientEmails) {
      // Nombre d'achats par client : distribution réaliste
      const rand = Math.random()
      let nbAchats
      if (rand < 0.2) nbAchats = 0        // 20% n'ont jamais acheté
      else if (rand < 0.5) nbAchats = alea(1, 2)   // 30% : 1-2 achats
      else if (rand < 0.8) nbAchats = alea(3, 6)   // 30% : 3-6 achats
      else nbAchats = alea(7, 18)                   // 20% : gros lecteurs

      for (let j = 0; j < nbAchats; j++) {
        const livre = aleatoire(livres)
        // La date de vente est après l'inscription
        const joursDepuisInscription = Math.floor((new Date() - new Date(c.dateInscription)) / (1000 * 60 * 60 * 24))
        const joursAvant = joursDepuisInscription > 0 ? alea(0, joursDepuisInscription) : 0
        const dateVente = new Date(c.dateInscription)
        dateVente.setDate(dateVente.getDate() + joursAvant)
        dateVente.setHours(alea(9, 20), alea(0, 59))

        // Appliquer remise CE si le client en a une
        let prixVente = livre.prix
        if (c.ceId) {
          const ceData = CES_DATA.find(ce => ceIds[ce.code] === c.ceId)
          if (ceData) prixVente = parseFloat((livre.prix * (1 - ceData.remise / 100)).toFixed(2))
        }

        await client.query(
          `INSERT INTO ventes (client_id, livre_id, quantite, prix_unitaire, date_vente)
           VALUES ($1, $2, $3, $4, $5)`,
          [c.id, livre.id, 1, prixVente, dateVente]
        )
        nbVentes++
      }
    }
    console.log(`   ✓ ${nbVentes} ventes créées`)

    // ── 6. Commandes Click & Collect ─────────────────────────────────────
    console.log('🛒 Création des commandes Click & Collect...')
    const statutsCommandes = ['en attente', 'en attente', 'en attente', 'pret', 'recupere', 'recupere', 'recupere', 'annulee']
    let nbCommandes = 0

    for (let i = 0; i < 40; i++) {
      const c = aleatoire(clientEmails)
      const livre = aleatoire(livres)
      const dateCommande = dateAleatoire(60, 0)
      const statut = aleatoire(statutsCommandes)
      const type = Math.random() > 0.3 ? 'stock' : 'commande'

      await client.query(
        `INSERT INTO commandes (livre_id, nom, email, telephone, type, statut, date_commande)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [livre.id, `${c.prenom} ${c.nom}`, c.email, `06${alea(10,99)}${alea(100,999)}${alea(100,999)}`, type, statut, dateCommande]
      )
      nbCommandes++
    }
    console.log(`   ✓ ${nbCommandes} commandes créées`)

    // ── 7. Wishlist ───────────────────────────────────────────────────────
    // Vérifie si la table wishlist existe
    const { rows: tables } = await client.query(`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename='wishlist'`)
    if (tables.length > 0) {
      console.log('❤️  Création des wishlists...')
      let nbWishlist = 0
      for (const c of clientEmails.slice(0, 60)) {
        const nbLivres = alea(0, 5)
        const livresWishlist = [...livres].sort(() => Math.random() - 0.5).slice(0, nbLivres)
        for (const l of livresWishlist) {
          try {
            await client.query(
              `INSERT INTO wishlist (client_id, livre_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
              [c.id, l.id]
            )
            nbWishlist++
          } catch {}
        }
      }
      console.log(`   ✓ ${nbWishlist} livres en wishlist`)
    }

    // ── 8. Avis ───────────────────────────────────────────────────────────
    const { rows: tablesAvis } = await client.query(`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename='avis'`)
    if (tablesAvis.length > 0) {
      console.log('⭐ Création des avis...')
      let nbAvis = 0
      // Récupérer les ventes pour ne mettre un avis que sur un livre acheté
      const { rows: ventesExistantes } = await client.query('SELECT client_id, livre_id FROM ventes')
      const ventesSet = new Set(ventesExistantes.map(v => `${v.client_id}_${v.livre_id}`))
      const commentaires5 = [
        'Un chef-d\'œuvre absolu, je recommande vivement !',
        'Lu en une nuit, impossible de lâcher ce livre.',
        'L\'un des meilleurs romans que j\'aie lus cette année.',
        'Une plume exceptionnelle, une histoire bouleversante.',
        'Magnifique. Je l\'offrirai à tout mon entourage.',
      ]
      const commentaires4 = [
        'Très bon livre, quelques longueurs mais globalement excellent.',
        'Belle découverte, j\'ai adoré les personnages.',
        'Un roman prenant, bien écrit. Je lirai la suite.',
        'Très agréable à lire, je le conseille.',
      ]
      const commentaires3 = [
        'Correct sans être exceptionnel. Quelques belles pages.',
        'Bien mais j\'en attendais davantage.',
        'Lecture agréable mais sans grand souvenir.',
      ]
      const commentaires = { 5: commentaires5, 4: commentaires4, 3: commentaires3, 2: ['Pas vraiment mon genre, je suis passé à côté.'], 1: ['Très déçu(e) par ce livre.'] }

      for (const v of ventesExistantes.slice(0, 200)) {
        if (Math.random() > 0.4) continue // 60% ne laissent pas d'avis
        const note = Math.random() < 0.5 ? 5 : Math.random() < 0.6 ? 4 : Math.random() < 0.6 ? 3 : Math.random() < 0.5 ? 2 : 1
        const avecCommentaire = Math.random() > 0.3
        const texte = avecCommentaire ? aleatoire(commentaires[note] || commentaires[3]) : null
        try {
          await client.query(
            `INSERT INTO avis (client_id, livre_id, note, commentaire) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
            [v.client_id, v.livre_id, note, texte]
          )
          nbAvis++
        } catch {}
      }
      console.log(`   ✓ ${nbAvis} avis créés`)
    }

    // ── 9. Événements ─────────────────────────────────────────────────────
    console.log('📅 Création des événements...')
    for (const ev of EVENEMENTS_DATA) {
      await client.query(
        `INSERT INTO evenements (titre, description, date_evenement, categorie, actif)
         VALUES ($1, $2, $3, $4, true)`,
        [ev.titre, ev.description, dateFuture(ev.jours), ev.categorie]
      )
    }
    // 3 événements passés
    const evPassés = [
      { titre: 'Dédicace — Amélie Nothomb', description: 'Séance de dédicaces pour le dernier roman d\'Amélie Nothomb.', categorie: 'Dédicace', joursAvant: 20 },
      { titre: 'Club de lecture — Avril', description: 'Lecture de "Voyage au bout de la nuit" de Céline.', categorie: 'Club de lecture', joursAvant: 35 },
      { titre: 'Rencontre jeunesse', description: 'Rencontre avec l\'illustratrice Kitty Crowther pour les enfants.', categorie: 'Rencontre', joursAvant: 12 },
    ]
    for (const ev of evPassés) {
      const d = new Date(); d.setDate(d.getDate() - ev.joursAvant); d.setHours(18, 0, 0, 0)
      await client.query(
        `INSERT INTO evenements (titre, description, date_evenement, categorie, actif) VALUES ($1, $2, $3, $4, true)`,
        [ev.titre, ev.description, d, ev.categorie]
      )
    }
    console.log(`   ✓ ${EVENEMENTS_DATA.length + evPassés.length} événements créés`)

    // ── 10. Tâches CRM ─────────────────────────────────────────────────────
    const { rows: tablescrm } = await client.query(`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename='crm_taches'`)
    if (tablescrm.length > 0) {
      console.log('📬 Création des tâches CRM...')
      let nbCrm = 0

      // Livres avec série
      const livresAvecSerie = livres.filter(l => l.serie && l.tome_numero)
      const clientsOptinRelance = clientEmails.filter(c => true) // tous (opt-in stocké en base)

      // Relances saga pour 20 clients
      if (livresAvecSerie.length >= 2) {
        const clientsRelance = clientsOptinRelance.slice(0, 20)
        for (const c of clientsRelance) {
          const tome1 = livresAvecSerie[0]
          const dateFutureRelance = new Date(); dateFutureRelance.setDate(dateFutureRelance.getDate() + alea(1, 30))
          try {
            await client.query(
              `INSERT INTO crm_taches (type, email, client_id, livre_id, date_envoi, envoye, data)
               VALUES ('relance_saga', $1, $2, $3, $4, false, $5)`,
              [c.email, c.id, tome1.id, dateFutureRelance, JSON.stringify({ serie: tome1.serie })]
            )
            nbCrm++
          } catch {}
        }
      }

      // Recommandations mensuelles pour 30 clients
      const clientsReco = clientsOptinRelance.slice(0, 30)
      const livresReco = livres.slice(0, Math.min(50, livres.length))
      const dateReco = new Date(); dateReco.setDate(1); dateReco.setMonth(dateReco.getMonth() + 1)
      for (const c of clientsReco) {
        const recos = [...livresReco].sort(() => Math.random() - 0.5).slice(0, 3)
        try {
          await client.query(
            `INSERT INTO crm_taches (type, email, client_id, date_envoi, envoye, data)
             VALUES ('recommandation', $1, $2, $3, false, $4)`,
            [c.email, c.id, dateReco, JSON.stringify({ titres: recos.map(l => l.id) })]
          )
          nbCrm++
        } catch {}
      }

      // Quelques tâches déjà envoyées (historique)
      for (let i = 0; i < 15; i++) {
        const c = aleatoire(clientEmails)
        const dateEnvoi = dateAleatoire(60, 7)
        try {
          await client.query(
            `INSERT INTO crm_taches (type, email, client_id, date_envoi, envoye, date_envoi_effectif, data)
             VALUES ('recommandation', $1, $2, $3, true, $3, $4)`,
            [c.email, c.id, dateEnvoi, JSON.stringify({ titres: [] })]
          )
          nbCrm++
        } catch {}
      }

      console.log(`   ✓ ${nbCrm} tâches CRM créées`)
    }

    // ── Résumé ─────────────────────────────────────────────────────────────
    const { rows: [stats] } = await client.query(`
      SELECT
        (SELECT COUNT(*) FROM comptes_clients) AS clients,
        (SELECT COUNT(*) FROM ventes) AS ventes,
        (SELECT COUNT(*) FROM commandes) AS commandes,
        (SELECT COUNT(*) FROM evenements) AS evenements,
        (SELECT COUNT(*) FROM ces) AS ces
    `)

    console.log('\n✅ Seed terminé !\n')
    console.log('📊 État de la base :')
    console.log(`   👥 Clients        : ${stats.clients}`)
    console.log(`   💰 Ventes         : ${stats.ventes}`)
    console.log(`   🛒 Commandes      : ${stats.commandes}`)
    console.log(`   📅 Événements     : ${stats.evenements}`)
    console.log(`   🏢 CE             : ${stats.ces}`)
    console.log('\n🔑 Mot de passe de tous les faux clients : password123')
    console.log('   (email : visible dans /admin/analytics ou psql)\n')

  } catch (err) {
    console.error('❌ Erreur :', err.message)
    console.error(err.stack)
  } finally {
    client.release()
    await pool.end()
  }
}

seed()