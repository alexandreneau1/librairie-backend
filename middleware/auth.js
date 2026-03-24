const jwt = require('jsonwebtoken')

const SECRET = 'librairie_secret_key'

function verifierToken(req, res, next) {
  const authHeader = req.headers['authorization']
  const token = authHeader && authHeader.split(' ')[1]
  if (!token) {
    return res.status(401).json({ message: 'Token manquant' })
  }
  try {
    const utilisateur = jwt.verify(token, SECRET)
    req.utilisateur = utilisateur
    next()
  } catch (err) {
    res.status(403).json({ message: 'Token invalide' })
  }
}

module.exports = verifierToken