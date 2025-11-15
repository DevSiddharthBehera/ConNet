require('dotenv').config()
const { connect } = require('../src/db')
const User = require('../src/models/User')
const bcrypt = require('bcryptjs')

async function run() {
  await connect()
  const samples = [
    { username: 'alice', password: 'password123', displayName: 'Alice' },
    { username: 'bob', password: 'password123', displayName: 'Bob' },
    { username: 'carol', password: 'password123', displayName: 'Carol' }
  ]

  for (const s of samples) {
    try {
      const existing = await User.findOne({ username: s.username })
      if (existing) {
        console.log(`User ${s.username} already exists, skipping.`)
        continue
      }
      const hashed = await bcrypt.hash(s.password, 10)
      const u = new User({ username: s.username, password: hashed, displayName: s.displayName })
      await u.save()
      console.log(`Created user ${s.username} with id ${u._id.toString()}`)
    } catch (err) {
      console.error('Error creating user', s.username, err)
    }
  }

  console.log('Seeding complete')
  process.exit(0)
}

run().catch(err => {
  console.error('Seed failed', err)
  process.exit(1)
})
