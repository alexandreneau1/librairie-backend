const express = require('express')
const router = express.Router()
const multer = require('multer')
const Papa = require('papaparse')
const axios = require('axios')
const cheerio = require('cheerio')
const pool = require('../db')
const verifierToken = require('../middleware/auth')

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!file.originalname.match(/\.(csv|txt)$/i)) return cb(new Error('Seuls les fichiers CSV sont acceptés'))
    cb(null, true)
  }
})

function normaliserISBN(isbn) {
  if (!isbn) return null
  return String(isbn).replace(/[^0-9X]/gi, '').trim()
}

function normaliserPrix(val) {
  if (!val) return null
  const propre = String(val).replace(',', '.').replace(/[^0-9.]/g, '')
  const n = parseFloat(propre)
  return isNaN(n) ? null : n
}

function normaliserDelai(val) {
  if (!val) return null
  const n = parseInt(String(val).trim(), 10)
  return isNaN(n) || n <= 0 ? null : n
}

// Calcule prix_achat à partir du prix public TTC et du taux de remise fournisseur
// Ex : prix 20€, remise 35% → prix_achat = 20 / 1.055 * (1 - 0.35) = 12.32€ HT
function calculerPrixAchat(prixTTC, remisePct) {
  if (!prixTTC || remisePct === null || remisePct === undefined) return null
  const prixHT = prixTTC / 1.055
  return Math.round(prixHT * (1 - remisePct / 100) * 100) / 100
}

function detecterColonnes(headers) {
  const h = headers.map(s => (s || '').toLowerCase().trim())
  const trouver = (...candidates) => {
    for (const c of candidates) {
      const idx = h.findIndex(x => x.includes(c))
      if (idx !== -1) return headers[idx]
    }
    return null
  }
  return {
    isbn:          trouver('ean', 'isbn', 'gencod', 'code'),
    titre:         trouver('titre', 'title', 'libelle'),
    auteur:        trouver('auteur', 'author', 'contributeur'),
    editeur:       trouver('editeur', 'publisher', 'diffuseur'),
    collection:    trouver('collection', 'serie'),
    prix:          trouver('prix', 'price', 'pvp', 'tarif'),
    stock:         trouver('stock', 'disponible', 'quantite', 'dispo'),
    date_parution: trouver('parution', 'publication', 'date_pub'),
    genre:         trouver('rayon', 'genre', 'theme', 'categorie'),
    description:   trouver('resume', 'description', 'quatrieme'),
    delai_reappro: trouver('delai_reappro', 'delai', 'reappro', 'delai_reapprovisionnement', 'jours'),
    // Colonnes remise fournisseur (présentes dans certains exports Dilicom/FEL)
    remise:        trouver('remise', 'taux_remise', 'remise_libraire', 'discount', 'taux'),
    prix_achat:    trouver('prix_achat', 'prix_net', 'tarif_net', 'cout'),
  }
}

const MAPPING_GENRES = {
  'roman': 'Roman', 'litterature': 'Roman', 'policier': 'Policier', 'thriller': 'Thriller',
  'science-fiction': 'Science-fiction', 'sf': 'Science-fiction', 'fantasy': 'Fantasy',
  'fantastique': 'Fantasy', 'biographie': 'Biographie', 'histoire': 'Histoire',
  'essai': 'Essai', 'jeunesse': 'Jeunesse', 'bande dessinee': 'Bande dessinée',
  'bd': 'Bande dessinée', 'manga': 'Bande dessinée', 'poesie': 'Poésie',
  'romance': 'Romance', 'developpement': 'Développement personnel', 'philosophie': 'Philosophie',
}

function mapperGenre(valeur) {
  if (!valeur) return null
  const v = valeur.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim()
  for (const [cle, genre] of Object.entries(MAPPING_GENRES)) {
    if (v.includes(cle)) return genre
  }
  return null
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /import/catalogue
// ─────────────────────────────────────────────────────────────────────────────
router.post('/catalogue', verifierToken, upload.single('fichier'), async (req, res) => {
  if (!req.file) return res.status(400).json({ message: 'Aucun fichier reçu' })

  const contenu = req.file.buffer.toString('utf-8')
  const premiereLigne = contenu.split('\n')[0]
  const separateur = (premiereLigne.split(';').length > premiereLigne.split(',').length) ? ';' : ','

  const parsed = Papa.parse(contenu, {
    header: true, delimiter: separateur, skipEmptyLines: true,
    transformHeader: h => h.trim(),
  })

  if (parsed.errors.length > 0 && parsed.data.length === 0) {
    return res.status(400).json({ message: 'Fichier CSV invalide', erreurs: parsed.errors.slice(0, 5) })
  }

  const colonnes = detecterColonnes(parsed.meta.fields || [])

  if (!colonnes.isbn || !colonnes.titre) {
    return res.status(400).json({
      message: 'Colonnes ISBN et Titre introuvables.',
      colonnes_detectees: parsed.meta.fields,
    })
  }

  const rapport = { crees: 0, mis_a_jour: 0, ignores: 0, avec_prix_achat: 0, erreurs: [] }
  const BATCH = 50

  for (let i = 0; i < parsed.data.length; i += BATCH) {
    const lot = parsed.data.slice(i, i + BATCH)
    await Promise.all(lot.map(async (ligne) => {
      try {
        const isbn = normaliserISBN(colonnes.isbn ? ligne[colonnes.isbn] : null)
        const t    = colonnes.titre ? (ligne[colonnes.titre] || '').trim() : ''
        if (!isbn || !t) { rapport.ignores++; return }

        const a     = colonnes.auteur        ? (ligne[colonnes.auteur]        || '').trim() : null
        const ed    = colonnes.editeur       ? (ligne[colonnes.editeur]       || '').trim() : null
        const col   = colonnes.collection    ? (ligne[colonnes.collection]    || '').trim() : null
        const p     = normaliserPrix(colonnes.prix ? ligne[colonnes.prix] : null)
        const s     = colonnes.stock         ? parseInt(ligne[colonnes.stock]) || 0 : 0
        const dp    = colonnes.date_parution ? (ligne[colonnes.date_parution] || '').trim() : null
        const g     = mapperGenre(colonnes.genre ? ligne[colonnes.genre] : null)
        const desc  = colonnes.description   ? (ligne[colonnes.description]  || '').trim() || null : null
        const delai = normaliserDelai(colonnes.delai_reappro ? ligne[colonnes.delai_reappro] : null)

        // Prix d'achat : soit colonne directe, soit calculé depuis remise fournisseur
        let prixAchat = null
        if (colonnes.prix_achat) {
          prixAchat = normaliserPrix(ligne[colonnes.prix_achat])
        }
        if (!prixAchat && colonnes.remise && p) {
          const remise = normaliserPrix(ligne[colonnes.remise])
          if (remise !== null && remise > 0 && remise < 100) {
            prixAchat = calculerPrixAchat(p, remise)
          }
        }
        if (prixAchat !== null) rapport.avec_prix_achat++

        const exist = await pool.query('SELECT id FROM livres WHERE isbn = $1', [isbn])

        if (exist.rows.length > 0) {
          await pool.query(
            `UPDATE livres SET
               titre=$1, auteur=$2, editeur=$3, collection=$4,
               prix=COALESCE($5, prix), stock=$6,
               date_publication=COALESCE($7, date_publication),
               genre=COALESCE($8, genre),
               description=COALESCE($9, description),
               delai_reappro=COALESCE($10, delai_reappro),
               prix_achat=COALESCE($11, prix_achat)
             WHERE isbn=$12`,
            [t, a, ed, col, p, s, dp, g, desc, delai, prixAchat, isbn]
          )
          rapport.mis_a_jour++
        } else {
          await pool.query(
            `INSERT INTO livres (titre, auteur, isbn, prix, stock, editeur, collection, date_publication, genre, description, delai_reappro, prix_achat)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
            [t, a, isbn, p || 0, s, ed, col, dp, g, desc, delai, prixAchat]
          )
          rapport.crees++
        }
      } catch (err) {
        rapport.ignores++
        if (rapport.erreurs.length < 10) rapport.erreurs.push(err.message)
      }
    }))
  }

  res.json({
    message: 'Import catalogue terminé',
    total: parsed.data.length,
    ...rapport
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// POST /import/top-ventes
// ─────────────────────────────────────────────────────────────────────────────
router.post('/top-ventes', verifierToken, async (req, res) => {
  try {
    const titresScrapés = []

    for (let page = 1; page <= 3; page++) {
      const url = `https://www.babelio.com/decouvrir/meilleuresventes/?p=${page}`
      const { data: html } = await axios.get(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
          'Accept-Language': 'fr-FR,fr;q=0.9',
          'Accept': 'text/html,application/xhtml+xml',
        },
        timeout: 10000,
      })

      const $ = cheerio.load(html)
      $('.livre_container, .masgrid_container').each((i, el) => {
        const titreBrut = $(el).find('.titre, .book_title, h4, h3').first().text().trim()
        const auteurBrut = $(el).find('.auteurs, .book_author, .auteur').first().text().trim()
        if (titreBrut) {
          titresScrapés.push({ rang: (page - 1) * 20 + i + 1, titre: titreBrut, auteur: auteurBrut })
        }
      })

      await new Promise(r => setTimeout(r, 800))
    }

    if (titresScrapés.length === 0) {
      return res.status(502).json({ message: 'Aucun résultat récupéré depuis Babelio.' })
    }

    const normaliser = s => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9 ]/g, '').trim()
    const livresEnBase = await pool.query('SELECT id, titre, auteur FROM livres')
    const mapBase = livresEnBase.rows.map(l => ({ id: l.id, titreN: normaliser(l.titre), auteurN: normaliser(l.auteur || '') }))

    const associations = []
    const nonTrouves = []

    for (const item of titresScrapés) {
      const titreN = normaliser(item.titre)
      const auteurN = normaliser(item.auteur)
      let match = mapBase.find(l => l.titreN === titreN)
      if (!match) match = mapBase.find(l => l.titreN.includes(titreN) || titreN.includes(l.titreN))
      if (match && auteurN) {
        const avecAuteur = mapBase.find(l => (l.titreN === titreN || l.titreN.includes(titreN)) && l.auteurN.includes(auteurN.split(' ')[0]))
        if (avecAuteur) match = avecAuteur
      }
      if (match) associations.push({ livre_id: match.id, rang: item.rang })
      else nonTrouves.push({ rang: item.rang, titre: item.titre, auteur: item.auteur })
    }

    await pool.query("DELETE FROM selections WHERE type = 'top_vente' AND genre IS NULL")
    for (const a of associations) {
      await pool.query(
        `INSERT INTO selections (livre_id, type, rang, actif) VALUES ($1, 'top_vente', $2, TRUE) ON CONFLICT DO NOTHING`,
        [a.livre_id, a.rang]
      )
    }

    res.json({ message: 'Scraping Babelio terminé', scrapes: titresScrapés.length, associes: associations.length, non_trouves_en_base: nonTrouves.length, non_trouves: nonTrouves.slice(0, 20) })
  } catch (err) {
    console.error('Erreur scraping Babelio:', err.message)
    if (err.code === 'ECONNREFUSED' || err.code === 'ETIMEDOUT') {
      return res.status(502).json({ message: 'Impossible de contacter Babelio.' })
    }
    res.status(500).json({ message: 'Erreur serveur', detail: err.message })
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// POST /import/prix
// ─────────────────────────────────────────────────────────────────────────────
router.post('/prix', verifierToken, upload.single('fichier'), async (req, res) => {
  if (!req.file) return res.status(400).json({ message: 'Aucun fichier reçu' })

  const contenu = req.file.buffer.toString('utf-8')
  const premiereLigne = contenu.split('\n')[0]
  const separateur = premiereLigne.split(';').length > premiereLigne.split(',').length ? ';' : ','

  const parsed = Papa.parse(contenu, {
    header: true, delimiter: separateur, skipEmptyLines: true,
    transformHeader: h => h.toLowerCase().trim(),
  })

  const colISBN  = parsed.meta.fields?.find(f => ['isbn', 'ean', 'gencod', 'code'].includes(f))
  const colLabel = parsed.meta.fields?.find(f => ['label', 'prix', 'recompense', 'distinction', 'libelle'].includes(f))

  if (!colISBN || !colLabel) {
    return res.status(400).json({ message: 'Le fichier doit contenir les colonnes "isbn" et "label".', colonnes_detectees: parsed.meta.fields })
  }

  const rapport = { ajoutes: 0, deja_presents: 0, isbn_introuvable: [], ignores: 0 }

  for (const ligne of parsed.data) {
    const isbn  = normaliserISBN(ligne[colISBN])
    const label = (ligne[colLabel] || '').trim()
    if (!isbn || !label) { rapport.ignores++; continue }

    const livre = await pool.query('SELECT id FROM livres WHERE isbn = $1', [isbn])
    if (livre.rows.length === 0) { rapport.isbn_introuvable.push(isbn); continue }

    const livre_id = livre.rows[0].id
    const exist = await pool.query("SELECT id FROM selections WHERE livre_id=$1 AND type='prix' AND label=$2", [livre_id, label])

    if (exist.rows.length > 0) rapport.deja_presents++
    else {
      await pool.query("INSERT INTO selections (livre_id, type, label, actif) VALUES ($1, 'prix', $2, TRUE)", [livre_id, label])
      rapport.ajoutes++
    }
  }

  res.json({ message: 'Import prix littéraires terminé', total: parsed.data.length, ...rapport })
})

// ─────────────────────────────────────────────────────────────────────────────
// POST /import/apercu-catalogue
// ─────────────────────────────────────────────────────────────────────────────
router.post('/apercu-catalogue', verifierToken, upload.single('fichier'), (req, res) => {
  if (!req.file) return res.status(400).json({ message: 'Aucun fichier reçu' })

  const contenu = req.file.buffer.toString('utf-8')
  const premiereLigne = contenu.split('\n')[0]
  const separateur = premiereLigne.split(';').length > premiereLigne.split(',').length ? ';' : ','

  const parsed = Papa.parse(contenu, {
    header: true, delimiter: separateur, skipEmptyLines: true, preview: 5,
    transformHeader: h => h.trim(),
  })

  const colonnes = detecterColonnes(parsed.meta.fields || [])

  res.json({
    colonnes_brutes: parsed.meta.fields,
    colonnes_mappees: colonnes,
    apercu: parsed.data,
    total_estime: contenu.split('\n').length - 1,
    separateur,
    avec_remise: !!colonnes.remise,
    avec_prix_achat: !!colonnes.prix_achat,
  })
})

module.exports = router