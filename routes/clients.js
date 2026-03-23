const express = require('express')
const router = express.Router()

const clients = [
  {
    id: 1,
    nom: 'Dupont',
    prenom: 'Marie',
    email: 'marie.dupont@email.com',
    telephone: '0612345678'
  },
  {
    id: 2,
    nom: 'Martin',
    prenom: 'Jean',
    email: 'jean.martin@email.com',
    telephone: '0698765432'
  },
  {
    id: 3,
    nom: 'Bernard',
    prenom: 'Sophie',
    email: 'sophie.bernard@email.com',
    telephone: '0634567890'
  }
]

router.get('/', function(req, res) {
  res.json(clients)
})

router.get('/:id', function(req, res) {
  const id = parseInt(req.params.id)
  const client = clients.find(function(c) {
    return c.id === id
  })
  if (!client) {
    res.status(404).json({ message: 'Client non trouve' })
  } else {
    res.json(client)
  }
})

module.exports = router