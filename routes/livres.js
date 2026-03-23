const express = require('express')
const router = express.Router()
const livres = require('../data/livres.json')

router.get('/', function(req, res) {
  const titre = req.query.titre
  if (titre) {
    const resultats = livres.filter(function(l) {
      return l.titre.toLowerCase().includes(titre.toLowerCase())
    })
    res.json(resultats)
  } else {
    res.json(livres)
  }
})

router.get('/:id', function(req, res) {
  const id = parseInt(req.params.id)
  const livre = livres.find(function(l) {
    return l.id === id
  })
  if (!livre) {
    res.status(404).json({ message: 'Livre non trouve' })
  } else {
    res.json(livre)
  }
})

module.exports = router