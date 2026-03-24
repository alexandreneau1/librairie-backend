const express = require('express')
const app = express()
const PORT = 3000

app.use(express.json())

const livresRouter = require('./routes/livres')
const clientsRouter = require('./routes/clients')
const ventesRouter = require('./routes/ventes')

app.use('/livres', livresRouter)
app.use('/clients', clientsRouter)
app.use('/ventes', ventesRouter)

app.get('/', function(req, res) {
  res.json({ message: 'Backend librairie OK' })
})

app.listen(PORT, function() {
  console.log('Serveur demarre sur http://localhost:3000')
})