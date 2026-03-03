#!/usr/bin/env node
const { DB_PATH } = require('./lib/db');
console.log('Database path:', DB_PATH);

const fs = require('fs');
console.log('Database file exists:', fs.existsSync(DB_PATH));

if (fs.existsSync(DB_PATH)) {
  const db = require('better-sqlite3')(DB_PATH);
  const count = db.prepare('SELECT COUNT(*) as count FROM orders').get().count;
  console.log('Orders count:', count);
  db.close();
}