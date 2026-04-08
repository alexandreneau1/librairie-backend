const express = require('express')
const router = express.Router()
const pool = require('../db')
const jwt = require('jsonwebtoken')

// Middleware client
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

// GET /api/recommandations
router.get('/', verifierTokenClient, async function(req, res) {
  try {
    const compteClientId = req.client.id
    const email = req.client.email

    // 1. Prénom
    const compteResult = await pool.query(
      'SELECT prenom FROM comptes_clients WHERE id = $1',
      [compteClientId]
    )
    const prenom = compteResult.rows[0]?.prenom || ''

    // 2. Historique achats
    const achatsResult = await pool.query(
      `SELECT l.titre, l.auteur, l.genre, v.quantite, v.date_vente
       FROM ventes v
       JOIN livres l ON l.id = v.livre_id
       JOIN clients c ON c.id = v.client_id
       WHERE c.email = $1
       ORDER BY v.date_vente DESC
       LIMIT 20`,
      [email]
    )
    const achats = achatsResult.rows

    // 3. Wishlist
    const wishlistResult = await pool.query(
      `SELECT l.titre, l.auteur, l.genre
       FROM wishlist w
       JOIN livres l ON l.id = w.livre_id
       WHERE w.email = $1`,
      [email]
    )
    const wishlist = wishlistResult.rows

    // 4. Catalogue disponible
    const catalogueResult = await pool.query(
      `SELECT id, titre, auteur, genre, prix
       FROM livres
       WHERE stock > 0
       ORDER BY titre ASC
       LIMIT 80`
    )
    const catalogue = catalogueResult.rows

    // 5. Exclure livres déjà connus
    const titresDejaConnus = new Set([
      ...achats.map(a => a.titre),
      ...wishlist.map(w => w.titre)
    ])
    const catalogueFiltre = catalogue.filter(l => !titresDejaConnus.has(l.titre))

    // 6. Prompt
    const contexteAchats = achats.length > 0
      ? achats.map(a => `- "${a.titre}" de ${a.auteur} (${a.genre || 'genre inconnu'})`).join('\n')
      : 'Aucun achat enregistré'

    const contexteWishlist = wishlist.length > 0
      ? wishlist.map(w => `- "${w.titre}" de ${w.auteur} (${w.genre || 'genre inconnu'})`).join('\n')
      : 'Wishlist vide'

    const catalogueTexte = catalogueFiltre
      .map(l => `[ID:${l.id}] "${l.titre}" — ${l.auteur} — ${l.genre || 'Non classé'} — ${l.prix}€`)
      .join('\n')

    const prompt = `Tu es le libraire de Bookdog, une librairie indépendante parisienne.
Tu dois recommander exactement 3 livres à ${prenom || 'ce client'} parmi le catalogue disponible.

HISTORIQUE D'ACHATS :
${contexteAchats}

WISHLIST :
${contexteWishlist}

CATALOGUE DISPONIBLE EN STOCK (recommande uniquement parmi ces livres) :
${catalogueTexte}

Réponds UNIQUEMENT en JSON valide, sans texte avant ni après, sans balises markdown.
Format exact :
{
  "recommandations": [
    {
      "livre_id": 12,
      "titre": "Titre du livre",
      "auteur": "Nom Auteur",
      "genre": "Genre",
      "prix": 15.90,
      "raison": "Courte explication personnalisée de 1-2 phrases pourquoi ce livre correspond à ce client"
    }
  ]
}`

    // 7. Appel Gemini API
    const urlGemini = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`

    const response = await fetch(urlGemini, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: 2048,
        }
      })
    })

    if (!response.ok) {
      const err = await response.text()
      console.log('Erreur API Gemini:', err)
      return res.status(500).json({ message: 'Erreur API Gemini' })
    }

    const data = await response.json()
    const texte = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim()

    if (!texte) {
      console.log('Réponse Gemini vide:', JSON.stringify(data))
      return res.status(500).json({ message: 'Réponse Gemini vide' })
    }

    // 8. Nettoyer et parser le JSON (Gemini peut ajouter des backticks)
    const texteNettoye = texte.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()

    let recommandations
    try {
      const parsed = JSON.parse(texteNettoye)
      recommandations = parsed.recommandations
    } catch (e) {
      console.log('Erreur parsing JSON Gemini:', texteNettoye)
      return res.status(500).json({ message: 'Réponse Gemini invalide' })
    }

    res.json({
      prenom,
      recommandations,
      nb_achats: achats.length,
      nb_wishlist: wishlist.length
    })

  } catch (err) {
    console.log('erreur recommandations:', err.message)
    res.status(500).json({ message: 'Erreur serveur', detail: err.message })
  }
})

module.exports = router