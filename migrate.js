const sqlite3 = require('sqlite3').verbose();
// Replace 'database.sqlite' with whatever your actual database file is named
const db = new sqlite3.Database('database.sqlite', (err) => {
  if (err) {
    console.error('Error opening database', err.message);
  } else {
    console.log('Connected to the database.');
  }
});

db.run("ALTER TABLE users ADD COLUMN phone TEXT;", (err) => {
  if (err) {
    console.log("Column might already exist or error:", err.message);
  } else {
    console.log("Successfully added 'phone' column to 'users' table!");
  }
  db.close();
});