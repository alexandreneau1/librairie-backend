require('dotenv').config()
const express = require('express')
const app = express()
const cors = require('cors')
const PORT = 3001

app.use(cors())
app.use(express.json())

const livresRouter = require('./routes/livres')
const clientsRouter = require('./routes/clients')
const ventesRouter = require('./routes/ventes')
const authRouter = require('./routes/auth')
const reservationsRouter = require('./routes/reservations')
const commandesRouter = require('./routes/commandes')
const compteRouter = require('./routes/compte')
const avisRouter = require('./routes/avis')
const selectionsRouter = require('./routes/selections')
const importRoutes = require('./routes/import')
const analyticsRoutes = require('./routes/analytics')
const recommandationsRoutes = require('./routes/recommandations')

app.use('/api/recommandations', recommandationsRoutes)
app.use('/api/analytics', analyticsRoutes)
app.use('/import', importRoutes)
app.use('/selections', selectionsRouter)
app.use('/avis', avisRouter)
app.use('/livres', livresRouter)
app.use('/clients', clientsRouter)
app.use('/ventes', ventesRouter)
app.use('/auth', authRouter)
app.use('/reservations', reservationsRouter)
app.use('/commandes', commandesRouter)
app.use('/compte', compteRouter)

app.get('/', function(req, res) {
  res.json({ message: 'Backend librairie OK' })
})

app.listen(PORT, function() {
  console.log('Serveur demarre sur http://localhost:3001')
})