const express = require('express')
const app = express()
const PORT = 3000

app.use(express.json())

const livres = [
  {
    id: 1,
    titre: 'Le Petit Prince',
    auteur: 'Antoine de Saint-Exupery',
    isbn: '9782070408504',
    prix: 8.50,
    stock: 5
  },
  {
    id: 2,
    titre: 'L Etranger',
    auteur: 'Albert Camus',
    isbn: '9782070360024',
    prix: 7.90,
    stock: 3
  },
  {
    id: 3,
    titre: 'Voyage au bout de la nuit',
    auteur: 'Louis-Ferdinand Celine',
    isbn: '9782070360307',
    prix: 9.20,
    stock: 2
  }
]

app.get('/', function(req, res) {
  res.json({ message: 'Backend librairie OK' })
})

app.get('/livres', function(req, res) {
  res.json(livres)
})

app.get('/livres/:id', function(req, res) {
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

app.listen(PORT, function() {
  console.log('Serveur demarre sur http://localhost:3000')
})