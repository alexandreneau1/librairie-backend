const { Pool } = require('pg')

const pool = new Pool({
  user: 'postgres',
  host: 'localhost',
  database: 'librairie',
  password: '',
  port: 5432
})

module.exports = pool