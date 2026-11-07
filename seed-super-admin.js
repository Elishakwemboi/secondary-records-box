const path = require('path');
const sqlite3 = require('sqlite3').verbose();

// Matches setup-db.js database file path resolution
const dbPath = path.join(__dirname, 'database.db');
const db = new sqlite3.Database(dbPath);

const superAdmin = {
  full_name: 'Super Administrator',
  email: 'superadmin@system.com',
  password_hash: 'admin123', 
  role: 'super_admin'
};

const sql = `
  INSERT INTO users (school_id, full_name, email, password_hash, role)
  VALUES (NULL, ?, ?, ?, ?)
`;

db.run(
  sql,
  [superAdmin.full_name, superAdmin.email, superAdmin.password_hash, superAdmin.role],
  function (err) {
    if (err) {
      if (err.message.includes('UNIQUE constraint failed: users.email')) {
        console.log('Super admin already exists with this email.');
      } else {
        console.error('Error inserting super admin:', err.message);
      }
    } else {
      console.log(`Super admin created successfully with ID: ${this.lastID}`);
    }
    
    db.close((closeErr) => {
      if (closeErr) {
        console.error('Error closing database connection:', closeErr.message);
      }
    });
  }
);