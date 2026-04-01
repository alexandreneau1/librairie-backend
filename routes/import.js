const express = require('express')
const router = express.Router()
const multer = require('multer')
const Papa = require('papaparse')
const axios = require('axios')
const cheerio = require('cheerio')
const pool = require('../db')
const verifierToken = require('../middleware/auth')

// ── Multer : fichiers en mémoire (pas sur disque) ─────────────────────────────
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }, // 20 Mo max
  fileFilter: (req, file, cb) => {
    if (!file.originalname.match(/\.(csv|txt)$/i)) {
      return cb(new Error('Seuls les fichiers CSV sont acceptés'))
    }
    cb(null, true)
  }
})

// ── Normalisation texte ───────────────────────────────────────────────────────
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

// ── Détection colonnes Dilicom ────────────────────────────────────────────────
// Dilicom utilise plusieurs formats selon les distributeurs.
// On supporte les variantes les plus courantes.
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
    isbn:        trouver('ean', 'isbn', 'gencod', 'code'),
    titre:       trouver('titre', 'title', 'libelle'),
    auteur:      trouver('auteur', 'author', 'contributeur'),
    editeur:     trouver('editeur', 'publisher', 'diffuseur'),
    collection:  trouver('collection', 'serie'),
    prix:        trouver('prix', 'price', 'pvp', 'tarif'),
    stock:       trouver('stock', 'disponible', 'quantite', 'dispo'),
    date_parution: trouver('parution', 'publication', 'date_pub'),
    genre:       trouver('rayon', 'genre', 'theme', 'categorie'),
    description: trouver('resume', 'description', 'quatrieme'),
  }
}

// ── Mapping genres Dilicom → genres Bookdog ───────────────────────────────────
const MAPPING_GENRES = {
  'roman':               'Roman',
  'litterature':         'Roman',
  'policier':            'Policier',
  'thriller':            'Thriller',
  'science-fiction':     'Science-fiction',
  'sf':                  'Science-fiction',
  'fantasy':             'Fantasy',
  'fantastique':         'Fantasy',
  'biographie':          'Biographie',
  'histoire':            'Histoire',
  'essai':               'Essai',
  'jeunesse':            'Jeunesse',
  'bande dessinee':      'Bande dessinée',
  'bd':                  'Bande dessinée',
  'manga':               'Bande dessinée',
  'poesie':              'Poésie',
  'romance':             'Romance',
  'developpement':       'Développement personnel',
  'philosophie':         'Philosophie',
}

function mapperGenre(valeur) {
  if (!valeur) return null
  const v = valeur.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim()
  for (const [cle, genre] of Object.entries(MAPPING_GENRES)) {
    if (v.includes(cle)) return genre
  }
  return null // genre inconnu → NULL en base
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /import/catalogue
// Upload CSV Dilicom → upsert dans `livres`
// ─────────────────────────────────────────────────────────────────────────────
router.post('/catalogue', verifierToken, upload.single('fichier'), async (req, res) => {
  if (!req.file) return res.status(400).json({ message: 'Aucun fichier reçu' })

  const contenu = req.file.buffer.toString('utf-8')

  // Détection séparateur (Dilicom utilise souvent ";" mais parfois ",")
  const premiereLigne = contenu.split('\n')[0]
  const separateur = (premiereLigne.split(';').length > premiereLigne.split(',').length) ? ';' : ','

  const parsed = Papa.parse(contenu, {
    header: true,
    delimiter: separateur,
    skipEmptyLines: true,
    transformHeader: h => h.trim(),
  })

  if (parsed.errors.length > 0 && parsed.data.length === 0) {
    return res.status(400).json({ message: 'Fichier CSV invalide', erreurs: parsed.errors.slice(0, 5) })
  }

  const colonnes = detecterColonnes(parsed.meta.fields || [])

  if (!colonnes.isbn || !colonnes.titre) {
    return res.status(400).json({
      message: 'Colonnes ISBN et Titre introuvables. Vérifiez le format du fichier.',
      colonnes_detectees: parsed.meta.fields,
    })
  }

  const rapport = { crees: 0, mis_a_jour: 0, ignores: 0, erreurs: [] }
  const BATCH = 50 // traitement par lots pour ne pas saturer la connexion PG

  for (let i = 0; i < parsed.data.length; i += BATCH) {
    const lot = parsed.data.slice(i, i + BATCH)
    await Promise.all(lot.map(async (ligne) => {
      try {
        const isbn  = normaliserISBN(colonnes.isbn ? ligne[colonnes.isbn] : null)
        const t     = colonnes.titre  ? (ligne[colonnes.titre]  || '').trim() : ''
        if (!isbn || !t) { rapport.ignores++; return }

        const a     = colonnes.auteur      ? (ligne[colonnes.auteur]      || '').trim() : null
        const ed    = colonnes.editeur     ? (ligne[colonnes.editeur]     || '').trim() : null
        const col   = colonnes.collection  ? (ligne[colonnes.collection]  || '').trim() : null
        const p     = normaliserPrix(colonnes.prix ? ligne[colonnes.prix] : null)
        const s     = colonnes.stock       ? parseInt(ligne[colonnes.stock]) || 0 : 0
        const dp    = colonnes.date_parution ? (ligne[colonnes.date_parution] || '').trim() : null
        const g     = mapperGenre(colonnes.genre ? ligne[colonnes.genre] : null)
        const desc  = colonnes.description ? (ligne[colonnes.description] || '').trim() || null : null

        // Vérifier existence
        const exist = await pool.query('SELECT id FROM livres WHERE isbn = $1', [isbn])

        if (exist.rows.length > 0) {
          await pool.query(
            `UPDATE livres SET
               titre=$1, auteur=$2, editeur=$3, collection=$4,
               prix=COALESCE($5, prix), stock=$6,
               date_publication=COALESCE($7, date_publication),
               genre=COALESCE($8, genre),
               description=COALESCE($9, description)
             WHERE isbn=$10`,
            [t, a, ed, col, p, s, dp, g, desc, isbn]
          )
          rapport.mis_a_jour++
        } else {
          await pool.query(
            `INSERT INTO livres (titre, auteur, isbn, prix, stock, editeur, collection, date_publication, genre, description)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
            [t, a, isbn, p || 0, s, ed, col, dp, g, desc]
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
// Scraping Babelio → croisement ISBN en base → maj selections
// ─────────────────────────────────────────────────────────────────────────────
router.post('/top-ventes', verifierToken, async (req, res) => {
  try {
    // Pages Babelio meilleures ventes (on scrape les 3 premières pages = ~60 titres)
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

      // Structure Babelio : .livre_container > .titre et lien vers la fiche
      $('.livre_container, .masgrid_container').each((i, el) => {
        const lienFiche = $(el).find('a').attr('href') || ''
        const titreBrut = $(el).find('.titre, .book_title, h4, h3').first().text().trim()
        const auteurBrut = $(el).find('.auteurs, .book_author, .auteur').first().text().trim()
        if (titreBrut) {
          titresScrapés.push({
            rang: (page - 1) * 20 + i + 1,
            titre: titreBrut,
            auteur: auteurBrut,
            lienFiche: lienFiche.startsWith('/') ? `https://www.babelio.com${lienFiche}` : lienFiche,
          })
        }
      })

      // Pause polie entre les requêtes
      await new Promise(r => setTimeout(r, 800))
    }

    if (titresScrapés.length === 0) {
      return res.status(502).json({ message: 'Aucun résultat récupéré depuis Babelio. La structure de la page a peut-être changé.' })
    }

    // Croisement avec la base : recherche par titre normalisé
    const normaliser = s => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9 ]/g, '').trim()

    const livresEnBase = await pool.query('SELECT id, titre, auteur FROM livres')
    const mapBase = livresEnBase.rows.map(l => ({
      id: l.id,
      titreN: normaliser(l.titre),
      auteurN: normaliser(l.auteur || ''),
    }))

    const associations = []
    const nonTrouves = []

    for (const item of titresScrapés) {
      const titreN = normaliser(item.titre)
      const auteurN = normaliser(item.auteur)

      // Correspondance exacte titre d'abord
      let match = mapBase.find(l => l.titreN === titreN)

      // Si pas de match exact → correspondance partielle (titre contient ou est contenu)
      if (!match) {
        match = mapBase.find(l =>
          l.titreN.includes(titreN) || titreN.includes(l.titreN)
        )
      }

      // Si auteur disponible, on affine
      if (match && auteurN) {
        const avecAuteur = mapBase.find(l =>
          (l.titreN === titreN || l.titreN.includes(titreN)) &&
          l.auteurN.includes(auteurN.split(' ')[0]) // au moins le nom de famille
        )
        if (avecAuteur) match = avecAuteur
      }

      if (match) {
        associations.push({ livre_id: match.id, rang: item.rang, titre: item.titre })
      } else {
        nonTrouves.push({ rang: item.rang, titre: item.titre, auteur: item.auteur })
      }
    }

    // Mise à jour selections : on vide les top_ventes existants puis on réinsère
    await pool.query("DELETE FROM selections WHERE type = 'top_vente' AND genre IS NULL")

    for (const a of associations) {
      await pool.query(
        `INSERT INTO selections (livre_id, type, rang, actif)
         VALUES ($1, 'top_vente', $2, TRUE)
         ON CONFLICT DO NOTHING`,
        [a.livre_id, a.rang]
      )
    }

    res.json({
      message: 'Scraping Babelio terminé',
      scrapes: titresScrapés.length,
      associes: associations.length,
      non_trouves_en_base: nonTrouves.length,
      non_trouves: nonTrouves.slice(0, 20), // liste des titres non trouvés pour info
    })

  } catch (err) {
    console.error('Erreur scraping Babelio:', err.message)
    if (err.code === 'ECONNREFUSED' || err.code === 'ETIMEDOUT') {
      return res.status(502).json({ message: 'Impossible de contacter Babelio. Réessayez dans quelques minutes.' })
    }
    res.status(500).json({ message: 'Erreur serveur', detail: err.message })
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// POST /import/prix
// Upload CSV (2 colonnes : isbn, label) → selections type 'prix'
// ─────────────────────────────────────────────────────────────────────────────
router.post('/prix', verifierToken, upload.single('fichier'), async (req, res) => {
  if (!req.file) return res.status(400).json({ message: 'Aucun fichier reçu' })

  const contenu = req.file.buffer.toString('utf-8')
  const premiereLigne = contenu.split('\n')[0]
  const separateur = premiereLigne.split(';').length > premiereLigne.split(',').length ? ';' : ','

  const parsed = Papa.parse(contenu, {
    header: true,
    delimiter: separateur,
    skipEmptyLines: true,
    transformHeader: h => h.toLowerCase().trim(),
  })

  // Accepte : isbn/ean + label/prix/recompense
  const colISBN  = parsed.meta.fields?.find(f => ['isbn', 'ean', 'gencod', 'code'].includes(f))
  const colLabel = parsed.meta.fields?.find(f => ['label', 'prix', 'recompense', 'distinction', 'libelle'].includes(f))

  if (!colISBN || !colLabel) {
    return res.status(400).json({
      message: 'Le fichier doit contenir les colonnes "isbn" (ou "ean") et "label" (ou "prix").',
      colonnes_detectees: parsed.meta.fields,
      exemple: 'isbn;label\n9782070360024;Prix Goncourt 2023'
    })
  }

  const rapport = { ajoutes: 0, deja_presents: 0, isbn_introuvable: [], ignores: 0 }

  for (const ligne of parsed.data) {
    const isbn  = normaliserISBN(ligne[colISBN])
    const label = (ligne[colLabel] || '').trim()
    if (!isbn || !label) { rapport.ignores++; continue }

    const livre = await pool.query('SELECT id FROM livres WHERE isbn = $1', [isbn])
    if (livre.rows.length === 0) {
      rapport.isbn_introuvable.push(isbn)
      continue
    }

    const livre_id = livre.rows[0].id

    // Vérifie si cette sélection prix existe déjà
    const exist = await pool.query(
      "SELECT id FROM selections WHERE livre_id=$1 AND type='prix' AND label=$2",
      [livre_id, label]
    )

    if (exist.rows.length > 0) {
      rapport.deja_presents++
    } else {
      await pool.query(
        "INSERT INTO selections (livre_id, type, label, actif) VALUES ($1, 'prix', $2, TRUE)",
        [livre_id, label]
      )
      rapport.ajoutes++
    }
  }

  res.json({
    message: 'Import prix littéraires terminé',
    total: parsed.data.length,
    ...rapport,
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// GET /import/apercu-catalogue
// Retourne les 5 premières lignes parsées pour prévisualisation avant import
// ─────────────────────────────────────────────────────────────────────────────
router.post('/apercu-catalogue', verifierToken, upload.single('fichier'), (req, res) => {
  if (!req.file) return res.status(400).json({ message: 'Aucun fichier reçu' })

  const contenu = req.file.buffer.toString('utf-8')
  const premiereLigne = contenu.split('\n')[0]
  const separateur = premiereLigne.split(';').length > premiereLigne.split(',').length ? ';' : ','

  const parsed = Papa.parse(contenu, {
    header: true,
    delimiter: separateur,
    skipEmptyLines: true,
    preview: 5,
    transformHeader: h => h.trim(),
  })

  const colonnes = detecterColonnes(parsed.meta.fields || [])

  res.json({
    colonnes_brutes: parsed.meta.fields,
    colonnes_mappees: colonnes,
    apercu: parsed.data,
    total_estime: contenu.split('\n').length - 1,
    separateur,
  })
})

module.exports = router