const express = require('express')
const app = express()
const PORT = 3000

app.use(express.json())

const livresRouter = require('./routes/livres')
app.use('/livres', livresRouter)

app.get('/', function(req, res) {
  res.json({ message: 'Backend librairie OK' })
})

app.listen(PORT, function() {
  console.log('Serveur demarre sur http://localhost:3000')
})